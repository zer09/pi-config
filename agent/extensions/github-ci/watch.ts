import { validateInput } from "./input.ts";
import { safeText } from "./output.ts";
import type {
  Outcome,
  RunState,
  WaitDetails,
  WatchDependencies,
} from "./types.ts";

// Two failed queries are tolerated. A third consecutive failure stops the watcher.
export const MAX_CONSECUTIVE_FAILURES = 3;

export function abortError(): Error {
  const error = new Error("github_ci_wait: cancelled.");
  error.name = "AbortError";
  return error;
}

export function abortableSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function unsuccessful(run: RunState): boolean {
  return run.status === "completed" && run.conclusion !== "success";
}

export async function watchRuns(
  input: unknown,
  deps: WatchDependencies,
  signal?: AbortSignal,
): Promise<WaitDetails> {
  const params = validateInput(input);
  const started = deps.now();
  const deadline = started + params.timeoutSeconds * 1000;
  const runs: RunState[] = params.runs.map((run) => ({
    id: run.id,
    ...(run.label === undefined ? {} : { label: safeText(run.label, 48) }),
    status: "unknown",
    conclusion: null,
    attempt: null,
    headSha: null,
    event: null,
    url: null,
  }));
  const failures: WaitDetails["failures"] = [];
  const streaks = new Map<number, number>();
  const stop = new AbortController();
  const workSignal = signal
    ? AbortSignal.any([signal, stop.signal])
    : stop.signal;
  const timer = new AbortController();
  let timedOut = false;
  let timerFailed = false;
  let pollCount = 0;

  function interruption(): "CANCELLED" | "TIMEOUT" | undefined {
    if (signal?.aborted) return "CANCELLED";
    if (timedOut || deps.now() >= deadline) {
      timedOut = true;
      stop.abort();
      return "TIMEOUT";
    }
    return undefined;
  }

  // The same injected sleep drives both the deadline and intervals, so tests need no real clock.
  const deadlineTask = deps
    .sleep(Math.max(0, deadline - deps.now()), timer.signal)
    .then(() => {
      timedOut = true;
      stop.abort();
    })
    .catch(() => {
      if (!timer.signal.aborted) {
        timerFailed = true;
        stop.abort();
      }
    });

  let outcome: Outcome | undefined;
  try {
    while (!outcome) {
      outcome = interruption();
      if (outcome) break;
      if (timerFailed) throw new Error("github_ci_wait: watcher timer failed.");
      const cycle = new AbortController();
      const cycleSignal = AbortSignal.any([workSignal, cycle.signal]);
      let failedFast = false;
      let failedQuery: number | undefined;
      pollCount++;
      // Each task catches its own error. Await all tasks even after abort to drain every gh call.
      await Promise.all(
        runs
          .filter((run) => run.status !== "completed")
          .map(async (run) => {
            try {
              const latest = await deps.queryRun(
                params.repo,
                run.id,
                cycleSignal,
              );
              if (cycleSignal.aborted) return;
              Object.assign(run, latest);
              streaks.set(run.id, 0);
              if (params.failFast && unsuccessful(run)) {
                failedFast = true;
                cycle.abort();
              }
            } catch {
              // Dependency AbortErrors still count unless this cycle was aborted.
              if (cycleSignal.aborted) return;
              const count = (streaks.get(run.id) ?? 0) + 1;
              streaks.set(run.id, count);
              if (count >= MAX_CONSECUTIVE_FAILURES) {
                failedQuery = run.id;
                cycle.abort();
              }
            }
          }),
      );
      outcome = interruption();
      if (outcome) break;
      if (timerFailed) throw new Error("github_ci_wait: watcher timer failed.");
      if (failedFast) outcome = "FAIL";
      else if (failedQuery !== undefined) {
        throw new Error(
          `github_ci_wait: run ${failedQuery} query failed ${MAX_CONSECUTIVE_FAILURES} consecutive times.`,
        );
      } else if (runs.every((run) => run.status === "completed")) {
        outcome = runs.some(unsuccessful) ? "FAIL" : "PASS";
      }
      if (!outcome) {
        try {
          await deps.sleep(
            Math.min(
              params.intervalSeconds * 1000,
              Math.max(0, deadline - deps.now()),
            ),
            workSignal,
          );
        } catch {
          if (!workSignal.aborted)
            throw new Error("github_ci_wait: watcher sleep failed.");
        }
      }
    }

    await Promise.all(
      runs.filter(unsuccessful).map(async (run) => {
        let summary;
        const interrupted = interruption();
        if (interrupted) {
          summary = {
            jobs: [],
            omittedJobs: 0,
            error:
              interrupted === "CANCELLED"
                ? ("cancelled" as const)
                : ("timeout" as const),
          };
        } else {
          try {
            summary = await deps.queryFailureSummary(
              params.repo,
              run.id,
              workSignal,
            );
          } catch {
            summary = {
              jobs: [],
              omittedJobs: 0,
              error: "unavailable" as const,
            };
          }
        }
        return { id: run.id, ...summary };
      }),
    ).then((summaries) => failures.push(...summaries));

    // Optional summary errors, including their deadline, must not erase an observed FAIL.
    if (signal?.aborted) outcome = "CANCELLED";
    return {
      outcome,
      elapsedSeconds: Math.round(Math.max(0, deps.now() - started) / 100) / 10,
      pollCount,
      runs,
      failures,
    };
  } finally {
    timer.abort();
    stop.abort();
    await deadlineTask;
  }
}
