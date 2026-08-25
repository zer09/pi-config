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
import { interruptionSource } from "./manager.ts";
import { buildDelegatePrompt, oracleGuard, roleLabel, routeKey } from "./routes.ts";
import { loadRoutingConfig, oracleModelIds, selectRoutes } from "./routing.ts";
import { buildDelegateResourceSelection, loadDelegateResources } from "./resources.ts";
import {
  DEFAULT_CLEANUP_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_IDLE_WARNING_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TERMINATION_GRACE_MS,
  DEFAULT_WORK_TIMEOUT_MS,
  delegateEnvironment,
  FINAL_CLEANUP_ALLOWANCE_MS,
  resolvePiInvocation,
  supervisePi,
  terminateProcessGroup,
  type TerminationOutcome,
} from "./supervisor.ts";
import type {
  AttemptStatus,
  ChainAttempt,
  CleanupFailureReason,
  DeadlineCause,
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
 * Failure states eligible for fallback while productive-work time remains,
 * even after tools or accepted report recovery. Global work timeout,
 * completed runs, intentional BLOCKED/FAILED markers, cancellation, and
 * cleanup proof failure are terminal.
 */
const OPERATIONAL_FAILURE_STATES: ReadonlySet<string> = new Set([
  "provider_failed",
  "stalled",
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

/** Catalog preflight outcome with fixed privacy-safe stop metadata. */
export interface CatalogResult {
  readonly outcome: "available" | "unavailable" | "timed_out" | "cleanup_failed" | "interrupted";
  readonly deadlineCause?: DeadlineCause;
  readonly cleanupFailureReason?: CleanupFailureReason;
}

async function routeIsCatalogued(
  invocation: PiInvocation,
  catalogResourceArgs: readonly string[],
  verifyCatalog: () => void,
  route: PiRoute,
  cwd: string,
  workDeadline: number,
  catalogTimeoutMs: number,
  signal?: AbortSignal,
): Promise<CatalogResult> {
  const catalogDeadline = Math.min(workDeadline, performance.now() + catalogTimeoutMs);
  const catalogDeadlineCause: DeadlineCause = catalogDeadline === workDeadline
    ? "work_deadline"
    : "catalog_preflight";
  // The lean catalog profile disables every discovery flag and explicitly
  // loads only the approved catalog extension entries (the provider alias
  // extension), so catalog preflights never load model-tool extensions,
  // skills, context files, or presentation resources.
  const args = [
    ...invocation.prefixArgs,
    ...catalogResourceArgs,
    "--list-models",
    `${route.provider}/${route.model}`,
  ];
  // Fail-closed boundary recheck immediately before this catalog spawn:
  // every approved catalog entry is re-resolved to its validated canonical
  // regular file inside the extensions root, and every selected skill is
  // re-verified as a precondition even though the alias-only catalog argv
  // never receives a `--skill` path, so a post-validation swap of either
  // fails closed before the catalog child command line exists.
  verifyCatalog();
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

  // Catalog termination is stored and awaited before this function returns.
  // Cleanup gets its own bounded allowance and proves group disappearance, so
  // no catalog child or descendant survives into the next route.
  let stopped = false;
  let stopOutcome: CatalogResult["outcome"] = "timed_out";
  let deadlineCause: DeadlineCause | undefined;
  let termination: Promise<TerminationOutcome> | undefined;
  // Resolves as soon as the stop path starts termination. The wait below
  // races it against close, because a descendant that inherited the catalog
  // child's stdio pipes can keep the close event blocked indefinitely, even
  // after the catalog child itself exited.
  let signalTerminationStarted!: () => void;
  const terminationStarted = new Promise<void>((resolve) => {
    signalTerminationStarted = resolve;
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (signal?.aborted) stopOutcome = "interrupted";
    else deadlineCause = catalogDeadlineCause;
    const cleanupDeadline = performance.now() + DEFAULT_CLEANUP_TIMEOUT_MS;
    termination = terminateProcessGroup(
      child,
      DEFAULT_TERMINATION_GRACE_MS,
      cleanupDeadline - FINAL_CLEANUP_ALLOWANCE_MS,
    );
    signalTerminationStarted();
  };
  const timer = setTimeout(stop, Math.max(0, catalogDeadline - performance.now()));
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
      const cleanupDeadline = performance.now() + DEFAULT_CLEANUP_TIMEOUT_MS;
      termination = terminateProcessGroup(
        child,
        DEFAULT_TERMINATION_GRACE_MS,
        cleanupDeadline - FINAL_CLEANUP_ALLOWANCE_MS,
      );
    }
    const terminationOutcome = await termination!;
    // Stop consuming output before ending the decoder. A negative cleanup
    // proof can leave a child alive, so no later data may reach settled state.
    removeChildListeners();
    stdout += stdoutDecoder.end();
    // A preflight group that cannot be proven dead is a bounded cleanup
    // failure: the caller fails the chain closed instead of risking overlap.
    if (!terminationOutcome.ok) {
      return { outcome: "cleanup_failed", cleanupFailureReason: terminationOutcome.reason, deadlineCause };
    }
    if (stopped) return { outcome: stopOutcome, deadlineCause };
    if (spawnFailed || child.exitCode !== 0 || outputBytes > 1024 * 1024) return { outcome: "unavailable" };

    const available = stdout.split(/\r?\n/).some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields.length >= 2 && fields[0] === route.provider && fields[1] === route.model;
    });
    return { outcome: available ? "available" : "unavailable" };
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
    deadlineCause: status.deadlineCause,
    cleanupFailureReason: status.cleanupFailureReason,
    interruptionSource: status.interruptionSource,
    workBudgetSeconds: status.workBudgetSeconds,
    remainingWorkSecondsAtAttemptStart: status.remainingWorkSecondsAtAttemptStart,
    activeToolCount: status.activeToolCount,
    activeToolName: status.activeToolName,
    activeToolElapsedSeconds: status.activeToolElapsedSeconds,
  };
}

function initialProgress(label: string, options: RunOptions, workBudgetSeconds: number): DelegateProgress {
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
    workBudgetSeconds,
    activeToolCount: 0,
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORK_TIMEOUT_MS;
  const idleWarningMs = options.idleWarningMs ?? DEFAULT_IDLE_WARNING_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const graceMs = options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const catalogTimeoutMs = options.catalogTimeoutMs ?? 15_000;
  if (timeoutMs <= 0 || timeoutMs > DEFAULT_WORK_TIMEOUT_MS) throw new Error("timeout must be between 1 ms and 45 minutes");
  if (cleanupTimeoutMs <= 0 || cleanupTimeoutMs > DEFAULT_CLEANUP_TIMEOUT_MS) {
    throw new Error("cleanup timeout must be between 1 ms and 10 seconds");
  }
  if (catalogTimeoutMs <= 0 || catalogTimeoutMs > 15_000) {
    throw new Error("catalog timeout must be between 1 ms and 15 seconds");
  }
  if (idleWarningMs <= 0 || idleTimeoutMs <= idleWarningMs || idleTimeoutMs > DEFAULT_IDLE_TIMEOUT_MS) {
    throw new Error("idle limits must be positive, ordered, and no longer than 10 minutes");
  }

  // Route selection happens exactly once per invocation through the shared
  // selector, which also fixes each tier's single random primary draw. It
  // completes before any private artifact exists, so a rejected config or
  // override leaves no artifact directory behind.
  const routes = selectRoutes(routing, options.role, options.routingOverride, {
    random: options.random,
  });

  // The child resource selection is built (and its extension and skill
  // paths fully re-verified) exactly once for the whole invocation, before
  // any private artifact exists. Every route attempt, catalog preflight,
  // and report-recovery round reuses these exact argument arrays, so the
  // child resource profile never changes during provider fallback; each
  // spawn first re-runs the selection's fail-closed verification closures.
  const resourceSelection = options.resourceSelection
    ?? buildDelegateResourceSelection(options.resourcePolicy ?? loadDelegateResources());

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
    // One monotonic productive-work deadline belongs to the whole delegate.
    // Every provider receives this same absolute deadline.
    const workDeadline = started + timeoutMs;
    const workBudgetSeconds = roundedSeconds(timeoutMs);
    let selectedRoute: string | undefined;
    let report = "";
    let finalState: DelegateState = "routes_unavailable";
    let finalProgress = initialProgress(label, options, workBudgetSeconds);
    let restartAfterWorkCount = 0;
    let terminalStreamErrors: readonly string[] = [];
    let delegateOutcome: DelegateOutcome | undefined;
    let terminalReason: DelegateTerminalReasonValue | undefined;
    let reasonStatus: DelegateReasonStatus | undefined;
    let blockedMisuseSuspected: boolean | undefined;
    let deadlineCause: DeadlineCause | undefined;
    let cleanupFailureReason: CleanupFailureReason | undefined;
    let interruptionSourceValue: DelegateRunResult["interruptionSource"];
    options.onProgress?.(finalProgress);

    for (let index = 0; index < routes.length; index += 1) {
      if (options.signal?.aborted) {
        finalState = "interrupted";
        interruptionSourceValue = interruptionSource(options.signal.reason);
        break;
      }
      const route = routes[index]!;
      const remainingMs = workDeadline - performance.now();
      if (remainingMs <= 0) {
        finalState = "timed_out";
        deadlineCause = "work_deadline";
        break;
      }
      const remainingWorkSecondsAtAttemptStart = roundedSeconds(remainingMs);

      finalProgress = {
        ...finalProgress,
        state: "catalog_check",
        route: routeKey(route),
        attempt: index + 1,
        lastEvent: "catalog_check",
        lastEventAt: new Date().toISOString(),
        elapsedSeconds: roundedSeconds(performance.now() - started),
        remainingWorkSecondsAtAttemptStart,
      };
      options.onProgress?.(finalProgress);
      const catalogStarted = performance.now();
      const catalog = await routeIsCatalogued(
        piInvocation,
        resourceSelection.catalogArgs,
        resourceSelection.verifyCatalogSpawn,
        route,
        options.cwd,
        workDeadline,
        catalogTimeoutMs,
        options.signal,
      );
      if (catalog.outcome === "interrupted" || options.signal?.aborted) {
        attempts.push({
          route: routeKey(route),
          state: "interrupted",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
          interruptionSource: interruptionSource(options.signal?.reason),
          remainingWorkSecondsAtAttemptStart,
        });
        finalState = "interrupted";
        interruptionSourceValue = interruptionSource(options.signal?.reason);
        break;
      }
      if (catalog.outcome === "cleanup_failed") {
        cleanupFailureReason = catalog.cleanupFailureReason;
        attempts.push({
          route: routeKey(route),
          state: "cleanup_failed",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
          deadlineCause: catalog.deadlineCause,
          cleanupFailureReason,
          remainingWorkSecondsAtAttemptStart,
        });
        finalState = "cleanup_failed";
        break;
      }
      if (catalog.outcome === "timed_out") {
        attempts.push({
          route: routeKey(route),
          state: "timed_out",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
          deadlineCause: catalog.deadlineCause,
          remainingWorkSecondsAtAttemptStart,
        });
        if (catalog.deadlineCause === "work_deadline" || workDeadline - performance.now() <= 0) {
          finalState = "timed_out";
          deadlineCause = "work_deadline";
          break;
        }
        // A fixed 15-second catalog preflight timeout may continue while the
        // shared productive-work budget remains.
        continue;
      }
      if (workDeadline - performance.now() <= 0) {
        finalState = "timed_out";
        deadlineCause = "work_deadline";
        break;
      }
      if (catalog.outcome === "unavailable") {
        attempts.push({
          route: routeKey(route),
          state: "catalog_unavailable",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
          remainingWorkSecondsAtAttemptStart,
        });
        continue;
      }

      const superviseBudgetMs = workDeadline - performance.now();
      if (superviseBudgetMs <= 0) {
        finalState = "timed_out";
        deadlineCause = "work_deadline";
        break;
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
        workDeadline,
        workBudgetSeconds,
        remainingWorkSecondsAtAttemptStart,
        idleWarningMs,
        idleTimeoutMs,
        maxOutputBytes,
        graceMs,
        cleanupTimeoutMs,
        onProgress: (progress: DelegateProgress) => {
          finalProgress = progress;
          options.onProgress?.(progress);
        },
      };
      const attemptStarted = performance.now();
      const attemptStatus = await supervisePi({
        ...common,
        route,
        piInvocation,
        runtimeResourceArgs: resourceSelection.runtimeArgs,
        verifyRuntimeResources: resourceSelection.verifyRuntimeSpawn,
      });
      terminalStreamErrors = attemptStatus.streamErrors;
      attempts.push({
        route: routeKey(route),
        state: attemptStatus.state,
        elapsedSeconds: roundedSeconds(performance.now() - attemptStarted),
        deadlineCause: attemptStatus.deadlineCause,
        cleanupFailureReason: attemptStatus.cleanupFailureReason,
        interruptionSource: attemptStatus.interruptionSource,
        remainingWorkSecondsAtAttemptStart,
        activeToolCount: attemptStatus.activeToolCount,
        activeToolName: attemptStatus.activeToolName,
        activeToolElapsedSeconds: attemptStatus.activeToolElapsedSeconds,
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
        deadlineCause = attemptStatus.deadlineCause;
        cleanupFailureReason = attemptStatus.cleanupFailureReason;
        interruptionSourceValue = attemptStatus.interruptionSource;
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
        deadlineCause = attemptStatus.deadlineCause;
        cleanupFailureReason = attemptStatus.cleanupFailureReason;
        interruptionSourceValue = attemptStatus.interruptionSource;
        break;
      }

      if (workDeadline - performance.now() <= 0) {
        finalState = "timed_out";
        deadlineCause = "work_deadline";
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
    finalProgress = {
      ...finalProgress,
      state: finalState,
      elapsedSeconds: elapsed,
      deadlineCause,
      cleanupFailureReason,
      interruptionSource: interruptionSourceValue,
      workBudgetSeconds,
    };
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
      deadlineCause,
      cleanupFailureReason,
      interruptionSource: interruptionSourceValue,
      workBudgetSeconds,
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
