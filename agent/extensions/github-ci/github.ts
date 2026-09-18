import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./input.ts";
import { safeText, safeUrl } from "./output.ts";
import { abortError } from "./watch.ts";
import type {
  FailureSummary,
  RunSnapshot,
  WatchDependencies,
} from "./types.ts";

export const RUN_FIELDS = "status,conclusion,attempt,headSha,event,url";
export const EXEC_TIMEOUT_MS = 30_000;
export const MAX_FAILED_JOBS = 2;
export const MAX_FAILED_STEPS = 3;

function token(value: string): string {
  return /^[a-z][a-z0-9_-]{0,39}$/.test(value)
    ? safeText(value, 40)
    : "unknown";
}

function failedConclusion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !["", "success", "skipped", "neutral"].includes(value)
  );
}

function parseRun(data: unknown, repo: string, id: number): RunSnapshot {
  if (
    !isRecord(data) ||
    typeof data.status !== "string" ||
    !data.status ||
    !(data.conclusion === null || typeof data.conclusion === "string") ||
    typeof data.attempt !== "number" ||
    !Number.isSafeInteger(data.attempt) ||
    data.attempt < 1
  ) {
    throw new Error("github_ci_wait: invalid run response.");
  }
  return {
    status: token(data.status),
    conclusion: data.conclusion ? token(data.conclusion) : null,
    attempt: data.attempt,
    headSha:
      typeof data.headSha === "string" &&
      /^[a-fA-F0-9]{40,64}$/.test(data.headSha)
        ? data.headSha
        : null,
    event: typeof data.event === "string" ? token(data.event) : null,
    url: safeUrl(data.url, repo, id),
  };
}

function parseFailures(
  data: unknown,
  repo: string,
  id: number,
): FailureSummary {
  if (!isRecord(data) || !Array.isArray(data.jobs))
    throw new Error("github_ci_wait: invalid jobs response.");
  const summary: FailureSummary = { jobs: [], omittedJobs: 0 };
  for (const job of data.jobs) {
    if (!isRecord(job) || !failedConclusion(job.conclusion)) continue;
    if (summary.jobs.length >= MAX_FAILED_JOBS) {
      summary.omittedJobs++;
      continue;
    }
    const steps: string[] = [];
    let omittedSteps = 0;
    if (Array.isArray(job.steps)) {
      for (const step of job.steps) {
        if (!isRecord(step) || !failedConclusion(step.conclusion)) continue;
        if (steps.length < MAX_FAILED_STEPS)
          steps.push(safeText(step.name, 48));
        else omittedSteps++;
      }
    }
    summary.jobs.push({
      name: safeText(job.name),
      conclusion: token(job.conclusion),
      steps,
      omittedSteps,
      url: safeUrl(job.url, repo, id, true),
    });
  }
  return summary;
}

export function createQueries(
  pi: Pick<ExtensionAPI, "exec">,
): Pick<WatchDependencies, "queryRun" | "queryFailureSummary"> {
  async function query(
    repo: string,
    id: number,
    fields: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw abortError();
    try {
      const result = await pi.exec(
        "gh",
        ["run", "view", String(id), "--repo", repo, "--json", fields],
        {
          signal,
          timeout: EXEC_TIMEOUT_MS,
        },
      );
      if (signal.aborted) throw abortError();
      if (
        result.code !== 0 ||
        result.killed ||
        result.stdout.length > (fields === "jobs" ? 2_000_000 : 8192)
      ) {
        throw new Error("query failed");
      }
      return JSON.parse(result.stdout);
    } catch {
      // An exec AbortError does not prove that this query was cancelled.
      if (signal.aborted) throw abortError();
      // gh errors can include authentication details. Never attach their output or original error.
      throw new Error("github_ci_wait: gh query failed.");
    }
  }
  return {
    async queryRun(repo, id, signal) {
      return parseRun(await query(repo, id, RUN_FIELDS, signal), repo, id);
    },
    async queryFailureSummary(repo, id, signal) {
      return parseFailures(await query(repo, id, "jobs", signal), repo, id);
    },
  };
}
