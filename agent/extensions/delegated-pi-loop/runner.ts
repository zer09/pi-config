import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  atomicWriteText,
  createArtifactDir,
  createPrivateDirectory,
  readPrivateText,
  removeDirectory,
} from "./artifacts.ts";
import { buildDelegatePrompt, oracleGuard, roleLabel, routeKey } from "./routes.ts";
import { loadRoutingConfig, oracleModelIds, selectRoutes } from "./routing.ts";
import {
  DEFAULT_GRACE_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_IDLE_WARNING_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  delegateEnvironment,
  FORCED_KILL_VERIFY_RESERVE_MS,
  MANDATORY_CLEANUP_RESERVE_MS,
  resolvePiInvocation,
  supervisePi,
  terminateProcessGroup,
  type TerminationOutcome,
} from "./supervisor.ts";
import type {
  AttemptStatus,
  ChainAttempt,
  DelegateOutcome,
  DelegateProgress,
  DelegateReasonStatus,
  DelegateRunResult,
  DelegateState,
  DelegateTerminalReasonValue,
  PiInvocation,
  PiRoute,
  RunOptions,
} from "./types.ts";

function roundedSeconds(milliseconds: number): number {
  return Math.round(milliseconds / 100) / 10;
}

/**
 * Failure states that always continue to the next route, even after tools or
 * accepted report recovery. Completed runs, intentional BLOCKED/FAILED
 * markers, and cancellation are terminal and never fall back.
 */
const OPERATIONAL_FAILURE_STATES: ReadonlySet<string> = new Set([
  "provider_failed",
  "stalled",
  "timed_out",
  "output_limit",
  "prompt_rejected",
  "invalid_result",
  "invalid_stream",
  "missing_report",
  "child_failed",
  "spawn_failed",
]);

export function isOperationalFailureState(state: DelegateState | "catalog_unavailable"): boolean {
  return OPERATIONAL_FAILURE_STATES.has(state);
}

/** Catalog preflight outcome: present, absent, stopped by its time budget, or failed cleanup. */
export type CatalogOutcome = "available" | "unavailable" | "timed_out" | "cleanup_failed";

async function routeIsCatalogued(
  invocation: PiInvocation,
  route: PiRoute,
  cwd: string,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<CatalogOutcome> {
  const args = [...invocation.prefixArgs, "--list-models", `${route.provider}/${route.model}`];
  const child = spawn(invocation.command, args, {
    cwd,
    env: delegateEnvironment(),
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolveClose!: () => void;
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const onClose = () => resolveClose();
  let spawnFailed = false;
  const onChildError = () => {
    spawnFailed = true;
  };
  let stdout = "";
  const stdoutDecoder = new StringDecoder("utf8");
  let outputBytes = 0;
  const onStdoutData = (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes <= 1024 * 1024) stdout += stdoutDecoder.write(chunk);
  };
  const onStderrData = (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
  };
  const removeChildListeners = () => {
    child.removeListener("close", onClose);
    child.removeListener("error", onChildError);
    child.stdout?.removeListener("data", onStdoutData);
    child.stderr?.removeListener("data", onStderrData);
  };
  child.once("close", onClose);
  child.once("error", onChildError);
  child.stdout?.on("data", onStdoutData);
  child.stderr?.on("data", onStderrData);

  // Catalog termination is stored and awaited before this function
  // returns, and terminateProcessGroup verifies process-group disappearance,
  // so no catalog child or descendant survives into the next route. The
  // stop timer and the graceful window both leave the forced-kill
  // verification reserve inside the route share before its absolute
  // deadline, so the verified kill never needs time the route no longer has.
  let stopped = false;
  let termination: Promise<TerminationOutcome> | undefined;
  // Resolves as soon as the stop path starts termination. The wait below
  // races it against close, because a descendant that inherited the catalog
  // child's stdio pipes can keep the close event blocked indefinitely, even
  // after the catalog child itself exited.
  let signalTerminationStarted!: () => void;
  const terminationStarted = new Promise<void>((resolve) => {
    signalTerminationStarted = resolve;
  });
  const sweepGraceMs = () =>
    Math.max(0, Math.min(1000, deadlineMs - performance.now() - FORCED_KILL_VERIFY_RESERVE_MS));
  const stop = () => {
    if (stopped) return;
    stopped = true;
    termination = terminateProcessGroup(child, sweepGraceMs(), deadlineMs);
    signalTerminationStarted();
  };
  const timer = setTimeout(
    stop,
    Math.max(0, Math.min(15_000, deadlineMs - performance.now() - FORCED_KILL_VERIFY_RESERVE_MS)),
  );
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  try {
    // Close or the stop path starts the settlement: once termination starts,
    // only its bounded promise is awaited, so a negative outcome is consumed
    // and mapped to cleanup_failed without an unbounded close wait first.
    await Promise.race([closePromise, terminationStarted]);
    if (!stopped) {
      // Natural exit inside the budget: the group is still swept and its
      // disappearance verified before the outcome returns.
      termination = terminateProcessGroup(child, sweepGraceMs(), deadlineMs);
    }
    const terminationOutcome = await termination!;
    // Stop consuming output before ending the decoder. A negative cleanup
    // proof can leave a child alive, so no later data may reach settled state.
    removeChildListeners();
    stdout += stdoutDecoder.end();
    // A preflight group that cannot be proven dead is a bounded cleanup
    // failure: the caller fails the chain closed instead of risking overlap.
    if (!terminationOutcome.ok) return "cleanup_failed";
    // A stopped preflight never proves the route is absent: it hit its time
    // budget (route share or the fixed preflight cap) or the abort signal the
    // caller checks separately, so it stays distinct from unavailability.
    if (stopped) return "timed_out";
    if (spawnFailed || child.exitCode !== 0 || outputBytes > 1024 * 1024) return "unavailable";

    return stdout.split(/\r?\n/).some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields.length >= 2 && fields[0] === route.provider && fields[1] === route.model;
    }) ? "available" : "unavailable";
  } finally {
    // The stop timer and the abort listener are cleared even when the
    // termination or outcome handling throws mid-settlement.
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    removeChildListeners();
  }
}

function progressFromStatus(status: AttemptStatus, attempt: number, restartAfterWorkCount: number): DelegateProgress {
  return {
    label: status.label,
    role: status.role,
    state: status.state,
    protocol: status.protocol,
    route: status.route,
    attempt,
    phase: status.phase,
    lastEvent: status.lastEvent,
    lastEventDetail: status.lastEventDetail,
    lastEventAt: status.lastEventAt,
    idleSeconds: status.idleSeconds,
    elapsedSeconds: status.elapsedSeconds,
    toolExecutionCount: status.toolExecutionCount,
    idleWarningCount: status.idleWarningCount,
    restartAfterWorkCount,
    reportNudgeCount: status.reportNudgeCount,
    reportRecoveryReason: status.reportRecoveryReason,
    reportRound: status.reportRound,
    providerFailureCategory: status.providerFailureCategory,
    delegateOutcome: status.delegateOutcome,
    terminalReason: status.terminalReason,
    reasonStatus: status.reasonStatus,
    blockedMisuseSuspected: status.blockedMisuseSuspected,
  };
}

function initialProgress(label: string, options: RunOptions): DelegateProgress {
  const now = new Date().toISOString();
  return {
    label,
    role: options.role,
    state: "catalog_check",
    protocol: "pi-rpc",
    attempt: 0,
    phase: "catalog",
    lastEvent: "catalog_check",
    lastEventAt: now,
    idleSeconds: 0,
    elapsedSeconds: 0,
    toolExecutionCount: 0,
    idleWarningCount: 0,
    restartAfterWorkCount: 0,
    reportNudgeCount: 0,
    reportRound: 1,
  };
}

export async function runDelegate(options: RunOptions): Promise<DelegateRunResult> {
  // The routing config is the single authority for model, provider, and
  // thinking policy; a missing or invalid config fails closed right here.
  const routing = options.routingConfig ?? loadRoutingConfig();
  // Defensive oracle gates run before any artifact or child process exists,
  // so a parent running any configured Oracle model never spawns a
  // self-reviewing oracle.
  const guard = oracleGuard(options.role, options.parentModelId, oracleModelIds(routing));
  if (guard) throw guard;
  const label = roleLabel(options.role);
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleWarningMs = options.idleWarningMs ?? DEFAULT_IDLE_WARNING_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  if (timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) throw new Error("timeout must be between 1 ms and 45 minutes");
  if (idleWarningMs <= 0 || idleTimeoutMs <= idleWarningMs || idleTimeoutMs > DEFAULT_IDLE_TIMEOUT_MS) {
    throw new Error("idle limits must be positive, ordered, and no longer than 10 minutes");
  }

  // Route selection happens exactly once per invocation through the shared
  // selector, which also fixes each tier's single random primary draw. It
  // completes before any private artifact exists, so a rejected config or
  // override leaves no artifact directory behind.
  const routes = selectRoutes(routing, options.role, options.routingOverride, {
    parentProvider: options.parentProvider,
    random: options.random,
  });

  // Private temporary supervision directory. Ownership transfers to the
  // caller only when this function returns a DelegateRunResult: the caller
  // then persists the failure diagnostic, assembles the tool result, and
  // removes the directory through finalizeDelegateRun.
  const artifactDir = await createArtifactDir(label);
  try {
    const promptPath = path.join(artifactDir, "prompt.md");
    const prompt = buildDelegatePrompt(options.role, options.cwd, options.prompt);
    await atomicWriteText(promptPath, prompt);
    await chmod(promptPath, 0o600);

    const attempts: ChainAttempt[] = [];
    const piInvocation = options.piInvocation ?? resolvePiInvocation();
    // One monotonic absolute deadline for the whole chain. Route attempts
    // receive soft shares of it below, so time spent on one route always
    // shrinks what every later route may still use.
    const chainDeadline = started + timeoutMs;
    let selectedRoute: string | undefined;
    let report = "";
    let finalState: DelegateState = "routes_unavailable";
    let finalProgress = initialProgress(label, options);
    let restartAfterWorkCount = 0;
    let terminalStreamErrors: readonly string[] = [];
    let delegateOutcome: DelegateOutcome | undefined;
    let terminalReason: DelegateTerminalReasonValue | undefined;
    let reasonStatus: DelegateReasonStatus | undefined;
    let blockedMisuseSuspected: boolean | undefined;
    options.onProgress?.(finalProgress);

    for (let index = 0; index < routes.length; index += 1) {
      if (options.signal?.aborted) {
        finalState = "interrupted";
        break;
      }
      const route = routes[index]!;
      const remainingMs = chainDeadline - performance.now();
      if (remainingMs <= 0) {
        finalState = "timed_out";
        break;
      }

      // Deterministic soft allocation: every remaining route, this one
      // included, receives an equal share of the current cumulative
      // remainder, so a hanging non-final route cannot consume the whole
      // fallback budget. The share is an absolute soft deadline covering
      // this route's catalog preflight, supervision, and cleanup/termination;
      // because the final route is the only one remaining, its share is the
      // full remainder.
      const routeDeadline = performance.now() + remainingMs / (routes.length - index);

      finalProgress = {
        ...finalProgress,
        state: "catalog_check",
        route: routeKey(route),
        attempt: index + 1,
        lastEvent: "catalog_check",
        lastEventAt: new Date().toISOString(),
        elapsedSeconds: roundedSeconds(performance.now() - started),
      };
      options.onProgress?.(finalProgress);
      const catalogStarted = performance.now();
      const catalog = await routeIsCatalogued(
        piInvocation,
        route,
        options.cwd,
        routeDeadline,
        options.signal,
      );
      if (options.signal?.aborted) {
        finalState = "interrupted";
        break;
      }
      if (catalog === "timed_out") {
        // The preflight was stopped by its share (or the fixed preflight
        // cap), not proven absent: record the route-budget timeout and let
        // the next route use its reserved share while cumulative time
        // remains.
        attempts.push({
          route: routeKey(route),
          state: "timed_out",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
        });
        // The final route owns the full remainder, so its budget stop means
        // the cumulative deadline is exhausted as soon as no supervision
        // could still fit the mandatory cleanup reserve inside it.
        if (index >= routes.length - 1 && chainDeadline - performance.now() <= MANDATORY_CLEANUP_RESERVE_MS) {
          finalState = "timed_out";
          break;
        }
        continue;
      }
      if (catalog === "cleanup_failed") {
        // The preflight's process group could not be proven dead. No later
        // route may start next to a possibly-live group, so the chain fails
        // closed right here with the sanitized terminal state.
        attempts.push({
          route: routeKey(route),
          state: "cleanup_failed",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
        });
        finalState = "cleanup_failed";
        break;
      }
      if (catalog === "unavailable") {
        attempts.push({
          route: routeKey(route),
          state: "catalog_unavailable",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
        });
        continue;
      }

      // Supervision runs on this route's remaining soft share, so catalog
      // preflight time is deducted and the attempt's own termination and
      // cleanup stay inside the reserved allocation. A non-positive share
      // on the final route means the cumulative deadline is exhausted; on a
      // non-final route it records a soft timeout and advances.
      const superviseBudgetMs = routeDeadline - performance.now();
      if (superviseBudgetMs <= 0) {
        attempts.push({
          route: routeKey(route),
          state: "timed_out",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
        });
        if (index >= routes.length - 1) {
          finalState = "timed_out";
          break;
        }
        continue;
      }

      const attemptDir = path.join(artifactDir, `attempt-${String(index + 1).padStart(2, "0")}`);
      await createPrivateDirectory(attemptDir);
      const common = {
        label,
        role: options.role,
        attempt: index + 1,
        cwd: options.cwd,
        artifactDir: attemptDir,
        promptPath,
        restartAfterWorkCount,
        signal: options.signal,
        timeoutMs: superviseBudgetMs,
        // The absolute route deadline bounds supervision, termination, and
        // group cleanup together: supervisePi reserves the cleanup budget
        // before route work, so the whole attempt fits inside its share.
        deadline: routeDeadline,
        idleWarningMs,
        idleTimeoutMs,
        maxOutputBytes,
        graceMs,
        onProgress: (progress: DelegateProgress) => {
          finalProgress = progress;
          options.onProgress?.(progress);
        },
      };
      const attemptStarted = performance.now();
      const attemptStatus = await supervisePi({ ...common, route, piInvocation });
      terminalStreamErrors = attemptStatus.streamErrors;
      attempts.push({
        route: routeKey(route),
        state: attemptStatus.state,
        elapsedSeconds: roundedSeconds(performance.now() - attemptStarted),
      });

      if (attemptStatus.state === "completed") {
        selectedRoute = routeKey(route);
        finalState = "completed";
        report = await readPrivateText(attemptStatus.reportPath);
        finalProgress = progressFromStatus(attemptStatus, index + 1, restartAfterWorkCount);
        delegateOutcome = attemptStatus.delegateOutcome;
        terminalReason = attemptStatus.terminalReason;
        reasonStatus = attemptStatus.reasonStatus;
        blockedMisuseSuspected = attemptStatus.blockedMisuseSuspected;
        break;
      }

      if (!isOperationalFailureState(attemptStatus.state)) {
        // Completed, intentional BLOCKED/FAILED markers, interruption, and
        // cleanup failure are terminal: the delegate's own outcome stands
        // (or the group stays unproven) and no route advances. A missing or
        // rejected terminal reason never changes that: BLOCKED and FAILED
        // stay terminal with reason unspecified.
        selectedRoute = routeKey(route);
        finalState = attemptStatus.state;
        if (attemptStatus.reportPresent) {
          report = await readPrivateText(attemptStatus.reportPath);
        }
        finalProgress = progressFromStatus(attemptStatus, index + 1, restartAfterWorkCount);
        delegateOutcome = attemptStatus.delegateOutcome;
        terminalReason = attemptStatus.terminalReason;
        reasonStatus = attemptStatus.reasonStatus;
        blockedMisuseSuspected = attemptStatus.blockedMisuseSuspected;
        break;
      }

      if (index >= routes.length - 1) {
        // An exhausted operational chain keeps the existing safe outcome.
        finalState = "routes_unavailable";
        break;
      }

      if (attemptStatus.toolExecutionCount > 0 || attemptStatus.reportRecoveryAccepted) {
        // The failed attempt may already have changed the working tree: rewrite
        // the next private prompt from the original assignment plus the fixed
        // sanitized restart note. Rebuilding from the original keeps the note
        // from stacking across repeated restarts.
        restartAfterWorkCount += 1;
        attempts[attempts.length - 1] = { ...attempts[attempts.length - 1]!, restartAfterWork: true };
        await atomicWriteText(
          promptPath,
          buildDelegatePrompt(options.role, options.cwd, options.prompt, { restartAfterWork: true }),
        );
        await chmod(promptPath, 0o600);
      }
    }

    const elapsed = roundedSeconds(performance.now() - started);
    const endedAt = new Date().toISOString();
    // All outcome data travels in memory; no chain-level report.md or status.json
    // is written. The caller persists the failure diagnostic (if any), assembles
    // the tool result, and then removes the artifact directory.
    finalProgress = { ...finalProgress, state: finalState, elapsedSeconds: elapsed };
    options.onProgress?.(finalProgress);

    return {
      label,
      role: options.role,
      state: finalState,
      report,
      artifactDir,
      selectedRoute,
      attempts,
      startedAt,
      endedAt,
      elapsedSeconds: elapsed,
      streamErrors: terminalStreamErrors,
      progress: finalProgress,
      delegateOutcome,
      terminalReason,
      reasonStatus,
      blockedMisuseSuspected,
    };
  } catch (error) {
    // A throw before the successful return (for example a throwing
    // onProgress callback) rejects without a DelegateRunResult, so
    // finalizeDelegateRun never cleans this run up. Remove the private
    // prompt artifact best-effort, then rethrow the original exception:
    // removeDirectory swallows its own errors, so it cannot replace it.
    await removeDirectory(artifactDir);
    throw error;
  }
}
