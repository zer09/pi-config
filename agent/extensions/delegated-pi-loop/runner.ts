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
import { buildDelegatePrompt } from "./instructions.ts";
import { oracleGuard, roleLabel, routeKey } from "./routes.ts";
import { loadRoutingConfig, oracleModelIds, requireRole, selectRoutes } from "./routing.ts";
import { buildDelegateResourceSelection, loadDelegateResources } from "./resources.ts";
import {
  DEFAULT_ACTIVITY_IDLE_MS,
  DEFAULT_ACTIVITY_WARNING_MS,
  DEFAULT_CATALOG_TIMEOUT_MS,
  DEFAULT_CLEANUP_TIMEOUT_MS,
  DEFAULT_LEADER_EXIT_SETTLEMENT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_PROGRESS_STALL_MS,
  DEFAULT_PROGRESS_WARNING_MS,
  DEFAULT_REPORT_RECOVERY_IDLE_MS,
  DEFAULT_TERMINATION_GRACE_MS,
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
  DelegateRole,
  DelegateRunResult,
  DelegateState,
  DelegateTerminalReasonValue,
  PiInvocation,
  PiRoute,
  RunOptions,
  StallCause,
} from "./types.ts";

function roundedSeconds(milliseconds: number): number {
  return Math.round(milliseconds / 100) / 10;
}

/**
 * Failure states eligible for fallback after positive cleanup proof, even
 * after tools or accepted report recovery. There is no remaining-work-time
 * predicate: completed runs, intentional BLOCKED/FAILED markers,
 * cancellation, and cleanup proof failure are terminal.
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
  catalogTimeoutMs: number,
  signal?: AbortSignal,
): Promise<CatalogResult> {
  // Catalog preflight owns one fixed independent deadline; no shared chain
  // work budget exists to clamp it.
  const catalogDeadline = performance.now() + catalogTimeoutMs;
  const catalogDeadlineCause: DeadlineCause = "catalog_preflight";
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
  // True only after the child's real close event: unlike a recorded exit,
  // close proves the stdout and stderr streams drained to their ends.
  let closed = false;
  const onClose = () => {
    closed = true;
    resolveClose();
  };
  let resolveLeaderExited!: () => void;
  // Resolves when the leader records its exit even if the close event stays
  // blocked because a descendant inherited the leader's stdio pipes.
  const leaderExited = new Promise<void>((resolve) => {
    resolveLeaderExited = resolve;
  });
  const onExit = () => resolveLeaderExited();
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
    child.removeListener("exit", onExit);
    child.removeListener("error", onChildError);
    child.stdout?.removeListener("data", onStdoutData);
    child.stderr?.removeListener("data", onStderrData);
  };
  child.once("close", onClose);
  child.once("exit", onExit);
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
  // One absolute cleanup deadline per preflight. The drain wait below is
  // charged against this same budget, so settlement never adds wall time.
  let cleanupDeadline = 0;
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
    cleanupDeadline = performance.now() + DEFAULT_CLEANUP_TIMEOUT_MS;
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
    // Close, the stop path, or a recorded leader exit starts the settlement:
    // once termination starts, only its bounded promise is awaited, so a
    // negative outcome is consumed and mapped to cleanup_failed without an
    // unbounded close wait first. A leader exit without close (a descendant
    // holds the pipes) settles through the same natural-exit sweep below.
    await Promise.race([closePromise, terminationStarted, leaderExited]);
    if (!stopped) {
      // Natural settlement won before the deadline: disarm the execution
      // timer and the abort listener immediately so a later deadline tick
      // can no longer flip the settled outcome to timed_out or start a
      // second termination mid-cleanup, then run exactly one independently
      // bounded cleanup proof. timed_out/catalog_preflight is returned only
      // when the deadline itself won before natural settlement.
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      cleanupDeadline = performance.now() + DEFAULT_CLEANUP_TIMEOUT_MS;
      termination = terminateProcessGroup(
        child,
        DEFAULT_TERMINATION_GRACE_MS,
        cleanupDeadline - FINAL_CLEANUP_ALLOWANCE_MS,
      );
    }
    const terminationOutcome = await termination!;
    // A preflight group that cannot be proven dead is a bounded cleanup
    // failure: the caller fails the chain closed instead of risking overlap.
    // Output consumption stops immediately, because a negative proof can
    // leave a child alive and no later data may reach a settled state.
    if (!terminationOutcome.ok) {
      removeChildListeners();
      return { outcome: "cleanup_failed", cleanupFailureReason: terminationOutcome.reason, deadlineCause };
    }
    if (stopped) {
      removeChildListeners();
      return { outcome: stopOutcome, deadlineCause };
    }
    if (!closed && !spawnFailed) {
      // A positive termination proof can complete before the close event:
      // after a recorded leader exit the group is already dead while the
      // final stdout bytes still sit unread in the pipes, and a descendant
      // that inherited them can delay or block close indefinitely. Parsing
      // now would settle on incomplete output, so the listeners stay
      // attached and the drain gets the fixed leader-exit settlement window
      // charged inside the same absolute cleanup deadline, never a new one.
      const settlementBudgetMs = Math.min(
        DEFAULT_LEADER_EXIT_SETTLEMENT_MS,
        Math.max(0, cleanupDeadline - performance.now()),
      );
      let settlementTimer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          closePromise,
          new Promise<void>((resolve) => {
            settlementTimer = setTimeout(resolve, settlementBudgetMs);
          }),
        ]);
      } finally {
        if (settlementTimer !== undefined) clearTimeout(settlementTimer);
      }
    }
    // Stop consuming output before ending the decoder: nothing after this
    // point may feed more data into the settled snapshot.
    removeChildListeners();
    stdout += stdoutDecoder.end();
    if (!closed && !spawnFailed) {
      // Stream settlement stayed unproven inside the bounded window. Parsing
      // partial output could discard the valid catalog tail, so the preflight
      // fails closed with the bounded close_unconfirmed reason instead.
      return { outcome: "cleanup_failed", cleanupFailureReason: "close_unconfirmed" };
    }
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
    activityIdleSeconds: status.activityIdleSeconds,
    elapsedSeconds: status.elapsedSeconds,
    toolExecutionCount: status.toolExecutionCount,
    activityWarningCount: status.activityWarningCount,
    progressWarningCount: status.progressWarningCount,
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
    stallCause: status.stallCause,
    cleanupFailureReason: status.cleanupFailureReason,
    interruptionSource: status.interruptionSource,
    rpcIdleSeconds: status.rpcIdleSeconds,
    progressIdleSeconds: status.progressIdleSeconds,
    maxProgressIdleSeconds: status.maxProgressIdleSeconds,
    activityEventCount: status.activityEventCount,
    structuralProgressCount: status.structuralProgressCount,
    duplicateCheckpointCount: status.duplicateCheckpointCount,
    activeToolCount: status.activeToolCount,
    activeToolName: status.activeToolName,
    activeToolElapsedSeconds: status.activeToolElapsedSeconds,
    activeToolIdleSeconds: status.activeToolIdleSeconds,
  };
}

/**
 * Fresh catalog-safe progress baseline shared by the pre-supervision initial
 * progress and every later catalog preflight: a catalog check is
 * unsupervised, so it never carries a prior attempt's liveness telemetry
 * (phase, detail, idle ages, warning latches/counts, active-tool fields);
 * only invocation-level values that legitimately cross routes survive.
 */
function catalogCheckProgress(
  label: string,
  role: DelegateRole,
  route: string | undefined,
  attempt: number,
  elapsedSeconds: number,
  restartAfterWorkCount: number,
): DelegateProgress {
  return {
    label,
    role,
    state: "catalog_check",
    protocol: "pi-rpc",
    route,
    attempt,
    phase: "catalog",
    lastEvent: "catalog_check",
    lastEventAt: new Date().toISOString(),
    activityIdleSeconds: 0,
    elapsedSeconds,
    toolExecutionCount: 0,
    activityWarningCount: 0,
    progressWarningCount: 0,
    restartAfterWorkCount,
    reportNudgeCount: 0,
    reportRound: 1,
    activityEventCount: 0,
    structuralProgressCount: 0,
    duplicateCheckpointCount: 0,
    activeToolCount: 0,
  };
}

function initialProgress(label: string, options: RunOptions): DelegateProgress {
  return catalogCheckProgress(label, options.role, undefined, 0, 0, 0);
}

export async function runDelegate(options: RunOptions): Promise<DelegateRunResult> {
  // The routing config is the single authority for model, provider, and
  // thinking policy; a missing or invalid config fails closed right here.
  const routing = options.routingConfig ?? loadRoutingConfig();
  // Registry-owned runtime role validation: an unknown role id fails closed
  // here before guards, artifacts, or any child process exists.
  const role = requireRole(routing, options.role);
  // Defensive oracle gates run before any artifact or child process exists,
  // so a parent running any configured Oracle model never spawns a
  // self-reviewing oracle.
  const guard = oracleGuard(role, options.parentModelId, oracleModelIds(routing));
  if (guard) throw guard;
  const label = roleLabel(role);
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const activityWarningMs = options.activityWarningMs ?? DEFAULT_ACTIVITY_WARNING_MS;
  const activityIdleMs = options.activityIdleMs ?? DEFAULT_ACTIVITY_IDLE_MS;
  const progressWarningMs = options.progressWarningMs ?? DEFAULT_PROGRESS_WARNING_MS;
  const progressStallMs = options.progressStallMs ?? DEFAULT_PROGRESS_STALL_MS;
  const reportRecoveryIdleMs = options.reportRecoveryIdleMs ?? DEFAULT_REPORT_RECOVERY_IDLE_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const graceMs = options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const catalogTimeoutMs = options.catalogTimeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS;
  if (cleanupTimeoutMs <= 0 || cleanupTimeoutMs > DEFAULT_CLEANUP_TIMEOUT_MS) {
    throw new Error("cleanup timeout must be between 1 ms and 10 seconds");
  }
  if (catalogTimeoutMs <= 0 || catalogTimeoutMs > DEFAULT_CATALOG_TIMEOUT_MS) {
    throw new Error("catalog timeout must be between 1 ms and 15 seconds");
  }
  if (activityWarningMs <= 0 || activityIdleMs <= activityWarningMs || activityIdleMs > DEFAULT_ACTIVITY_IDLE_MS) {
    throw new Error("activity limits must be positive, ordered, and no longer than 10 minutes");
  }
  if (progressWarningMs <= 0 || progressStallMs <= progressWarningMs || progressStallMs > DEFAULT_PROGRESS_STALL_MS) {
    throw new Error("progress limits must be positive, ordered, and no longer than 45 minutes");
  }
  if (reportRecoveryIdleMs <= 0 || reportRecoveryIdleMs > DEFAULT_REPORT_RECOVERY_IDLE_MS) {
    throw new Error("report recovery idle must be between 1 ms and 5 minutes");
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
  // then persists the run diagnostic, assembles the tool result, and
  // removes the directory through finalizeDelegateRun.
  const artifactDir = await createArtifactDir(label);
  try {
    const promptPath = path.join(artifactDir, "prompt.md");
    const prompt = buildDelegatePrompt(role, options.cwd, options.prompt);
    await atomicWriteText(promptPath, prompt);
    await chmod(promptPath, 0o600);

    const attempts: ChainAttempt[] = [];
    const piInvocation = options.piInvocation ?? resolvePiInvocation();
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
    let deadlineCause: DeadlineCause | undefined;
    let stallCauseValue: StallCause | undefined;
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

      finalProgress = catalogCheckProgress(
        label,
        options.role,
        routeKey(route),
        index + 1,
        roundedSeconds(performance.now() - started),
        restartAfterWorkCount,
      );
      options.onProgress?.(finalProgress);
      const catalogStarted = performance.now();
      const catalog = await routeIsCatalogued(
        piInvocation,
        resourceSelection.catalogArgs,
        resourceSelection.verifyCatalogSpawn,
        route,
        options.cwd,
        catalogTimeoutMs,
        options.signal,
      );
      if (catalog.outcome === "interrupted" || options.signal?.aborted) {
        attempts.push({
          route: routeKey(route),
          state: "interrupted",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
          interruptionSource: interruptionSource(options.signal?.reason),
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
        });
        // A fixed 15-second catalog preflight timeout consumes no shared
        // work budget (none exists); the finite route chain continues.
        continue;
      }
      if (catalog.outcome === "unavailable") {
        attempts.push({
          route: routeKey(route),
          state: "catalog_unavailable",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
        });
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
        activityWarningMs,
        activityIdleMs,
        progressWarningMs,
        progressStallMs,
        reportRecoveryIdleMs,
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
        stallCause: attemptStatus.stallCause,
        rpcIdleSeconds: attemptStatus.rpcIdleSeconds,
        activityIdleSeconds: attemptStatus.activityIdleSeconds,
        progressIdleSeconds: attemptStatus.progressIdleSeconds,
        maxProgressIdleSeconds: attemptStatus.maxProgressIdleSeconds,
        activityEventCount: attemptStatus.activityEventCount,
        structuralProgressCount: attemptStatus.structuralProgressCount,
        duplicateCheckpointCount: attemptStatus.duplicateCheckpointCount,
        activityWarningCount: attemptStatus.activityWarningCount,
        progressWarningCount: attemptStatus.progressWarningCount,
        cleanupFailureReason: attemptStatus.cleanupFailureReason,
        interruptionSource: attemptStatus.interruptionSource,
        activeToolCount: attemptStatus.activeToolCount,
        activeToolName: attemptStatus.activeToolName,
        activeToolElapsedSeconds: attemptStatus.activeToolElapsedSeconds,
        activeToolIdleSeconds: attemptStatus.activeToolIdleSeconds,
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
        stallCauseValue = attemptStatus.stallCause;
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
        stallCauseValue = attemptStatus.stallCause;
        cleanupFailureReason = attemptStatus.cleanupFailureReason;
        interruptionSourceValue = attemptStatus.interruptionSource;
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
          buildDelegatePrompt(role, options.cwd, options.prompt, { restartAfterWork: true }),
        );
        await chmod(promptPath, 0o600);
      }
    }

    const elapsed = roundedSeconds(performance.now() - started);
    const endedAt = new Date().toISOString();
    // All outcome data travels in memory; no chain-level report.md or status.json
    // is written. The caller persists the schema-8 run telemetry (failure
    // diagnostic or best-effort success record), assembles the tool result,
    // and then removes the artifact directory.
    finalProgress = {
      ...finalProgress,
      state: finalState,
      elapsedSeconds: elapsed,
      deadlineCause,
      stallCause: stallCauseValue,
      cleanupFailureReason,
      interruptionSource: interruptionSourceValue,
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
      stallCause: stallCauseValue,
      cleanupFailureReason,
      interruptionSource: interruptionSourceValue,
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
