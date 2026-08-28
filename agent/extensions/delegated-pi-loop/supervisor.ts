import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, atomicWriteText, readPrivateText } from "./artifacts.ts";
import { interruptionSource } from "./manager.ts";
import { REPORT_RECOVERY_PROMPT } from "./instructions.ts";
import { evaluateLiveness } from "./liveness.ts";
import { PiRpcMonitor } from "./monitor.ts";
import { RpcJsonlProtocol, type ProtocolRecord } from "./protocol.ts";
import { routeKey } from "./routes.ts";
import type {
  AttemptStatus,
  CleanupFailureReason,
  DeadlineCause,
  DelegateProgress,
  DelegateRole,
  DelegateState,
  InterruptionSource,
  MonitorSnapshot,
  PiInvocation,
  PiRoute,
  StallCause,
} from "./types.ts";

/**
 * Renewable-liveness defaults. There is deliberately no total-work
 * deadline: `DEFAULT_PROGRESS_STALL_MS` bounds only the maximum gap between
 * novel structural checkpoints and is never measured from delegate start.
 */
export const DEFAULT_ACTIVITY_WARNING_MS = 5 * 60 * 1000;
export const DEFAULT_ACTIVITY_IDLE_MS = 10 * 60 * 1000;
export const DEFAULT_PROGRESS_WARNING_MS = 15 * 60 * 1000;
export const DEFAULT_PROGRESS_STALL_MS = 45 * 60 * 1000;
export const DEFAULT_REPORT_RECOVERY_IDLE_MS = 5 * 60 * 1000;
export const DEFAULT_CATALOG_TIMEOUT_MS = 15_000;
export const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;
export const DEFAULT_TERMINATION_GRACE_MS = 5_000;
/** Fixed upper bound on stream settlement after a recorded leader exit. */
export const DEFAULT_LEADER_EXIT_SETTLEMENT_MS = 1_000;
export const FORCED_KILL_VERIFY_MS = 3_000;
export const FINAL_CLEANUP_ALLOWANCE_MS = 2_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 1_000;

/** Bounded, sanitized outcome of one process-group termination attempt. */
export type TerminationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CleanupFailureReason };

/**
 * Probe surface over one child and its process group. Kept as one injectable
 * object so termination tests can simulate groups that survive SIGKILL or
 * leaders whose close event never arrives, deterministically and instantly.
 */
export interface TerminationProbes {
  readonly now: () => number;
  readonly delay: (ms: number) => Promise<void>;
  readonly processIsRunning: () => boolean;
  readonly groupExists: () => boolean;
  readonly signalGroup: (name: NodeJS.Signals) => void;
  /** Resolves true when the leader's close event fired inside the budget. */
  readonly waitForClose: (timeoutMs: number) => Promise<boolean>;
}

interface SuperviseBaseOptions {
  readonly label: string;
  readonly role: DelegateRole;
  readonly attempt: number;
  readonly cwd: string;
  readonly artifactDir: string;
  readonly promptPath: string;
  /** Chain-level count of advances after an attempt that had executed tools or accepted recovery. */
  readonly restartAfterWorkCount?: number;
  readonly signal?: AbortSignal;
  readonly activityWarningMs: number;
  readonly activityIdleMs: number;
  readonly progressWarningMs: number;
  readonly progressStallMs: number;
  readonly reportRecoveryIdleMs: number;
  readonly maxOutputBytes: number;
  readonly graceMs: number;
  readonly cleanupTimeoutMs?: number;
  readonly onProgress?: (progress: DelegateProgress) => void;
}

export interface SupervisePiOptions extends SuperviseBaseOptions {
  readonly route: PiRoute;
  readonly piInvocation: PiInvocation;
  /**
   * Prebuilt immutable runtime resource arguments from `resources.ts`. They
   * are appended after the invocation prefix and before the mode/provider
   * arguments, and stay identical across every attempt and recovery round of
   * one delegate invocation.
   */
  readonly runtimeResourceArgs: readonly string[];
  /**
   * Fail-closed pre-spawn re-verification from `resources.ts`. Runs
   * immediately before the child command line is spawned, once per route
   * attempt including fallbacks, and re-resolves canonical identity,
   * containment, and file-type invariants for every approved runtime
   * extension entry and selected skill, so a post-validation symlink swap
   * fails the attempt before any child process exists.
   */
  readonly verifyRuntimeResources: () => void;
}

function isoNow(): string {
  return new Date().toISOString();
}

function elapsedSeconds(started: number): number {
  return Math.round((performance.now() - started) / 100) / 10;
}

/**
 * Combines the monitor's completed-interval maximum with the still-open
 * interval measured from one captured `now`, so current and maximum ages
 * cannot drift across separate clock reads. A negative anomalous delta
 * clamps to zero. Telemetry only: never a liveness-decision input.
 */
export function observableProgressGapMs(snapshot: MonitorSnapshot, now: number): number {
  return Math.max(
    snapshot.maxCompletedProgressGapMs,
    Math.max(0, now - snapshot.lastStructuralProgressMonotonic),
  );
}

export function resolvePiInvocation(): PiInvocation {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, prefixArgs: [currentScript] };
  }
  const executable = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(executable)) return { command: process.execPath, prefixArgs: [] };
  return { command: "pi", prefixArgs: [] };
}

export function delegateEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of [
    "PI_SESSION_ID",
    "PI_SESSION_FILE",
    "PI_PROVIDER",
    "PI_MODEL",
    "PI_REASONING_LEVEL",
  ]) {
    delete environment[key];
  }
  environment.PI_SKIP_VERSION_CHECK = "1";
  environment.PI_DELEGATED_CHILD = "1";
  environment.PI_DELEGATE_PARENT_PID = String(process.pid);
  return environment;
}

function processIsRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/** Waits for the leader's close event. True means close fired; false means the bounded wait timed out. */
async function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!processIsRunning(child)) return true;
  return await new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const onClose = () => done(true);
    const done = (closed: boolean) => {
      if (timer) clearTimeout(timer);
      child.removeListener("close", onClose);
      resolve(closed);
    };
    child.once("close", onClose);
    timer = setTimeout(() => done(false), Math.max(0, timeoutMs));
  });
}

function defaultTerminationProbes(child: ChildProcess): TerminationProbes {
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (process.platform === "win32") {
    // Windows has no signal process groups: the child is the whole group, so
    // group probes delegate to child liveness and signals go to the child.
    return {
      now: () => performance.now(),
      delay,
      processIsRunning: () => processIsRunning(child),
      groupExists: () => processIsRunning(child),
      signalGroup: (name) => {
        child.kill(name);
      },
      waitForClose: (timeoutMs) => waitForClose(child, timeoutMs),
    };
  }
  const groupExists = (): boolean => {
    try {
      process.kill(-child.pid!, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  };
  const signalGroup = (name: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  return {
    now: () => performance.now(),
    delay,
    processIsRunning: () => processIsRunning(child),
    groupExists,
    signalGroup,
    waitForClose: (timeoutMs) => waitForClose(child, timeoutMs),
  };
}

/** Test seam: replaceable probe factory for deterministic termination tests. */
export const terminationProbes: { build: (child: ChildProcess) => TerminationProbes } = {
  build: defaultTerminationProbes,
};

/**
 * Terminates one process group inside the cleanup-only deadline. Success
 * requires positive leader-close or recorded-exit proof plus a dead group.
 */
export async function terminateProcessGroupWith(
  graceMs: number,
  cleanupDeadline: number,
  probes: TerminationProbes,
): Promise<TerminationOutcome> {
  const remainingMs = () => Math.max(0, cleanupDeadline - probes.now());
  if (probes.groupExists()) {
    probes.signalGroup("SIGTERM");
    const graceDeadline = Math.min(
      cleanupDeadline,
      probes.now() + Math.min(graceMs, DEFAULT_TERMINATION_GRACE_MS),
    );
    while (probes.groupExists() && probes.now() < graceDeadline) {
      await probes.delay(Math.min(25, graceDeadline - probes.now()));
    }
    if (probes.groupExists()) {
      probes.signalGroup("SIGKILL");
      const verifyDeadline = Math.min(cleanupDeadline, probes.now() + FORCED_KILL_VERIFY_MS);
      while (probes.groupExists() && probes.now() < verifyDeadline) {
        await probes.delay(Math.min(25, verifyDeadline - probes.now()));
      }
      if (probes.groupExists()) return { ok: false, reason: "group_alive" };
    }
  }
  const closeSeen = await probes.waitForClose(remainingMs());
  if (!closeSeen && probes.processIsRunning()) return { ok: false, reason: "close_unconfirmed" };
  if (probes.groupExists()) return { ok: false, reason: "group_alive" };
  return { ok: true };
}

export async function terminateProcessGroup(
  child: ChildProcess,
  graceMs: number,
  cleanupDeadline = performance.now() + DEFAULT_CLEANUP_TIMEOUT_MS - FINAL_CLEANUP_ALLOWANCE_MS,
): Promise<TerminationOutcome> {
  if (child.pid === undefined) return { ok: true };
  return terminateProcessGroupWith(graceMs, cleanupDeadline, terminationProbes.build(child));
}

function spawnDetached(command: string, args: readonly string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}): ChildProcess {
  return spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function finishWriteStream(stream: WriteStream, allowanceMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener("finish", done);
      stream.removeListener("error", done);
      resolve();
    };
    const timer = setTimeout(() => {
      stream.destroy();
      done();
    }, Math.max(0, allowanceMs));
    stream.once("finish", done);
    stream.once("error", done);
    stream.end();
  });
}

function progressFromMonitor(
  options: SupervisePiOptions,
  state: DelegateState,
  started: number,
  monitor: PiRpcMonitor,
  reportNudgeCount: 0 | 1,
  reportRecoveryReason: "missing_report" | "invalid_result" | undefined,
  metadata: {
    readonly deadlineCause?: DeadlineCause;
    readonly stallCause?: StallCause;
    readonly cleanupFailureReason?: CleanupFailureReason;
    readonly interruptionSource?: InterruptionSource;
  } = {},
): DelegateProgress {
  const snapshot = monitor.snapshot();
  const now = performance.now();
  const rpcIdleSeconds = Math.round((now - snapshot.lastValidRpcMonotonic) / 100) / 10;
  const activityIdleSeconds = Math.round((now - snapshot.lastActivityMonotonic) / 100) / 10;
  const progressIdleSeconds = Math.round((now - snapshot.lastStructuralProgressMonotonic) / 100) / 10;
  // The same captured `now` closes the open interval for the maximum, so
  // progressIdleSeconds and maxProgressIdleSeconds stay consistent.
  const maxProgressIdleSeconds = Math.round(observableProgressGapMs(snapshot, now) / 100) / 10;
  const leaseWarning = activityIdleSeconds * 1000 >= options.activityWarningMs
    ? "activity"
    : progressIdleSeconds * 1000 >= options.progressWarningMs
      ? "progress"
      : undefined;
  return {
    label: options.label,
    role: options.role,
    state,
    protocol: "pi-rpc",
    route: routeKey(options.route),
    attempt: options.attempt,
    phase: snapshot.phase,
    lastEvent: snapshot.lastEvent,
    lastEventDetail: snapshot.lastEventDetail,
    lastEventAt: snapshot.lastEventAt,
    activityIdleSeconds,
    elapsedSeconds: elapsedSeconds(started),
    toolExecutionCount: snapshot.toolExecutionCount,
    activityWarningCount: snapshot.activityWarningCount,
    progressWarningCount: snapshot.progressWarningCount,
    leaseWarning,
    restartAfterWorkCount: options.restartAfterWorkCount ?? 0,
    reportNudgeCount,
    reportRecoveryReason,
    reportRound: snapshot.reportRound,
    providerFailureCategory: snapshot.providerFailureCategory,
    delegateOutcome: snapshot.outcome,
    terminalReason: snapshot.terminalReason,
    reasonStatus: snapshot.reasonStatus,
    blockedMisuseSuspected: snapshot.blockedMisuseSuspected,
    rpcIdleSeconds,
    progressIdleSeconds,
    maxProgressIdleSeconds,
    activityEventCount: snapshot.activityEventCount,
    structuralProgressCount: snapshot.structuralProgressCount,
    duplicateCheckpointCount: snapshot.duplicateCheckpointCount,
    activeToolCount: snapshot.activeToolCount,
    activeToolName: snapshot.activeToolName,
    activeToolElapsedSeconds: snapshot.activeToolElapsedSeconds,
    activeToolIdleSeconds: snapshot.activeToolIdleSeconds,
    deadlineCause: metadata.deadlineCause,
    stallCause: metadata.stallCause,
    cleanupFailureReason: metadata.cleanupFailureReason,
    interruptionSource: metadata.interruptionSource,
  };
}

export async function supervisePi(options: SupervisePiOptions): Promise<AttemptStatus> {
  const started = performance.now();
  const startedAt = isoNow();
  // Productive work has no total deadline: renewable liveness leases are the
  // only wall-clock stop, evaluated by the ticker below. Cleanup starts only
  // after work ends and receives a separate bounded allowance.
  const cleanupTimeoutMs = Math.min(
    options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
    DEFAULT_CLEANUP_TIMEOUT_MS,
  );
  const terminationGraceMs = Math.min(options.graceMs, DEFAULT_TERMINATION_GRACE_MS);
  const finalCleanupAllowanceMs = Math.min(
    FINAL_CLEANUP_ALLOWANCE_MS,
    Math.max(1, Math.floor(cleanupTimeoutMs / 5)),
  );
  // Leader-exit settlement window: a fixed short drain chance for final
  // stdout before the incomplete snapshot is classified. It never adds a
  // new budget: it is charged inside the same absolute cleanup deadline,
  // so it shrinks whenever the configured cleanup constants demand it.
  const leaderExitSettlementMs = Math.min(
    DEFAULT_LEADER_EXIT_SETTLEMENT_MS,
    Math.max(0, cleanupTimeoutMs - finalCleanupAllowanceMs),
  );
  // Explicit recorded leader-exit time. The close event can stay blocked
  // indefinitely when a descendant inherited the leader's stdio pipes, so
  // settlement decisions key off this signal, not off close.
  let leaderExitAt: number | undefined;
  const newCleanupDeadline = () => (leaderExitAt ?? performance.now()) + cleanupTimeoutMs;
  const terminationDeadlineFor = (cleanupDeadline: number) =>
    cleanupDeadline - finalCleanupAllowanceMs;
  const reportPath = path.join(options.artifactDir, "report.md");
  const stderrPath = path.join(options.artifactDir, "stderr.log");
  const statusPath = path.join(options.artifactDir, "status.json");
  const stderrStream = createWriteStream(stderrPath, { flags: "wx", mode: 0o600 });
  const prompt = await readPrivateText(options.promptPath);
  const protocol = new RpcJsonlProtocol();
  const initialCommand = protocol.beginPrompt(1, prompt);
  const monitor = new PiRpcMonitor(started, startedAt, () => performance.now(), isoNow, () => emitProgress(false));
  let outputBytes = 0;
  let state: DelegateState = "running";
  let completionCleanupPerformed = false;
  let activityWarningIssued = false;
  let progressWarningIssued = false;
  let lastProgressAt = 0;
  let terminalRequested = false;
  let terminationPromise: Promise<TerminationOutcome> | undefined;
  let reportNudgeCount: 0 | 1 = 0;
  let reportRecoveryReason: "missing_report" | "invalid_result" | undefined;
  let reportRecoveryAccepted = false;
  let progressSinkFailed = false;
  let progressSinkError: unknown;
  let deadlineCause: DeadlineCause | undefined;
  let stallCauseValue: StallCause | undefined;
  let cleanupFailureReason: CleanupFailureReason | undefined;
  let interruptionSourceValue: InterruptionSource | undefined;
  let cleanupDeadline: number | undefined;

  const buildStatus = (
    finalState: DelegateState,
    exitCode: number | null,
    snapshot: MonitorSnapshot,
    reportPresent: boolean,
  ): AttemptStatus => {
    // One settlement `now` drives every idle age including the final open
    // interval of the maximum, so the recorded values cannot drift apart.
    const settledAt = performance.now();
    return {
      schemaVersion: 1,
      label: options.label,
      role: options.role,
      route: routeKey(options.route),
      protocol: "pi-rpc",
      state: finalState,
      delegateOutcome: monitor.outcome(snapshot.reportRound),
      terminalReason: snapshot.terminalReason,
      reasonStatus: snapshot.reasonStatus,
      blockedMisuseSuspected: snapshot.blockedMisuseSuspected,
      deadlineCause,
      stallCause: stallCauseValue,
      cleanupFailureReason,
      interruptionSource: interruptionSourceValue,
      startedAt,
      endedAt: isoNow(),
      elapsedSeconds: elapsedSeconds(started),
      exitCode,
      completionCleanupPerformed,
      outputBytes,
      reportPresent,
      reportPath,
      stderrPath,
      activityEventCount: snapshot.activityEventCount,
      structuralProgressCount: snapshot.structuralProgressCount,
      duplicateCheckpointCount: snapshot.duplicateCheckpointCount,
      lastEvent: snapshot.lastEvent,
      lastEventDetail: snapshot.lastEventDetail,
      lastEventAt: snapshot.lastEventAt,
      phase: snapshot.phase,
      activityIdleSeconds: Math.round((settledAt - snapshot.lastActivityMonotonic) / 100) / 10,
      rpcIdleSeconds: Math.round((settledAt - snapshot.lastValidRpcMonotonic) / 100) / 10,
      progressIdleSeconds: Math.round((settledAt - snapshot.lastStructuralProgressMonotonic) / 100) / 10,
      maxProgressIdleSeconds: Math.round(observableProgressGapMs(snapshot, settledAt) / 100) / 10,
      activityWarningCount: snapshot.activityWarningCount,
      progressWarningCount: snapshot.progressWarningCount,
      sessionSeen: snapshot.sessionSeen,
      agentStartCount: snapshot.agentStartCount,
      agentEndCount: snapshot.agentEndCount,
      agentEndSeen: snapshot.agentEndSeen,
      agentSettledSeen: snapshot.agentSettledSeen,
      toolExecutionCount: snapshot.toolExecutionCount,
      activeToolCount: snapshot.activeToolCount,
      activeToolName: snapshot.activeToolName,
      activeToolElapsedSeconds: snapshot.activeToolElapsedSeconds,
      activeToolIdleSeconds: snapshot.activeToolIdleSeconds,
      routeUnavailableSeen: snapshot.routeUnavailableSeen,
      providerFailureCategory: snapshot.providerFailureCategory,
      reportNudgeCount,
      reportRecoveryReason,
      reportRound: snapshot.reportRound,
      reportRecoveryAccepted,
      streamErrors: snapshot.errors,
    };
  };

  const args = [
    ...options.piInvocation.prefixArgs,
    ...options.runtimeResourceArgs,
    "--mode",
    "rpc",
    "--no-session",
    "--approve",
    "--provider",
    options.route.provider,
    "--model",
    options.route.model,
    "--thinking",
    options.route.thinking,
  ];
  // Fail-closed boundary recheck immediately before this spawn: canonical
  // identity, containment, and file-type invariants are re-resolved for
  // every approved runtime extension entry and selected skill, so a
  // post-validation symlink swap can never reach a child command line. The
  // stderr stream is the only resource open at this point; close it before
  // rethrowing so the rejected attempt leaks no file handle.
  try {
    options.verifyRuntimeResources();
  } catch (error) {
    stderrStream.close();
    throw error;
  }
  const child = spawnDetached(options.piInvocation.command, args, {
    cwd: options.cwd,
    env: delegateEnvironment(),
  });

  function emitProgress(force: boolean): void {
    const now = performance.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    if (progressSinkFailed) return;
    try {
      options.onProgress?.(progressFromMonitor(
        options,
        state,
        started,
        monitor,
        reportNudgeCount,
        reportRecoveryReason,
        { deadlineCause, stallCause: stallCauseValue, cleanupFailureReason, interruptionSource: interruptionSourceValue },
      ));
    } catch (error) {
      // The caller-owned progress sink failed inside a supervisor-owned
      // callback (RPC stdout activity, interval ticker, or final emit). The
      // exception must not escape into EventEmitter or timer callbacks:
      // capture the first original error, stop delivering progress forever,
      // request process-group termination, and let the normal cleanup below
      // finish before supervisePi rejects with that exact error.
      progressSinkFailed = true;
      progressSinkError = error;
      requestTermination("child_failed");
    }
  }

  function requestTermination(nextState: DelegateState, cleanup = false, stallCause?: StallCause): void {
    if (terminalRequested) return;
    terminalRequested = true;
    state = nextState;
    completionCleanupPerformed = cleanup;
    if (nextState === "stalled") {
      deadlineCause = "idle_deadline";
      stallCauseValue = stallCause;
    } else if (nextState === "interrupted") {
      interruptionSourceValue = interruptionSource(options.signal?.reason);
    }
    // The cleanup budget is one absolute window: once the leader's exit is
    // recorded, any later termination anchors at that instant, so a
    // settlement window plus cleanup together stay inside the fixed budget.
    cleanupDeadline = newCleanupDeadline();
    terminationPromise = terminateProcessGroup(
      child,
      terminationGraceMs,
      terminationDeadlineFor(cleanupDeadline),
    );
    signalTerminationStarted();
  }

  function writeProtocol(line: string): boolean {
    outputBytes += Buffer.byteLength(line);
    if (outputBytes > options.maxOutputBytes) {
      requestTermination("output_limit");
      return false;
    }
    if (!child.stdin || child.stdin.destroyed || !processIsRunning(child)) return false;
    try {
      child.stdin.write(line);
      return true;
    } catch {
      return false;
    }
  }

  function evaluateRound(): void {
    if (terminalRequested) return;
    const snapshot = monitor.snapshot();
    if (snapshot.errors.length > 0) {
      requestTermination("invalid_stream");
      return;
    }
    const roundState = monitor.classifyRound(snapshot.reportRound);
    if (roundState === "running") return;
    if (roundState === "blocked" || roundState === "delegate_failed") {
      requestTermination(roundState);
      return;
    }
    if (roundState === "completed" || roundState === "provider_failed") {
      requestTermination(roundState, roundState === "completed");
      return;
    }
    if (roundState !== "missing_report" && roundState !== "invalid_result") {
      requestTermination(roundState);
      return;
    }
    if (snapshot.reportRound === 2) {
      requestTermination(roundState);
      return;
    }
    if (
      reportNudgeCount !== 0
      || !processIsRunning(child)
      || options.signal?.aborted
      || outputBytes > options.maxOutputBytes
    ) {
      requestTermination(roundState);
      return;
    }
    reportNudgeCount = 1;
    reportRecoveryReason = roundState;
    monitor.beginRecovery();
    let command: string;
    try {
      command = protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT);
    } catch {
      requestTermination("invalid_stream");
      return;
    }
    if (!writeProtocol(command)) requestTermination("child_failed");
    else emitProgress(true);
  }

  function handleProtocolRecord(record: ProtocolRecord): void {
    // A protocol error is terminal for the stream. It is branched on before
    // the RPC-health clock so a malformed, oversized, duplicate, or
    // out-of-order record can never renew communication liveness on its way
    // to invalid_stream. Valid prompt responses and events still renew once.
    if (record.kind === "protocol_error") {
      monitor.addProtocolError(record.category);
      state = "invalid_stream";
      if (!terminalRequested) requestTermination("invalid_stream");
      return;
    }
    // Every accepted protocol record renews RPC health: it passed framed
    // JSONL parsing and prompt-round correlation. Malformed, oversized,
    // duplicate, and out-of-order records fail earlier and never reach here.
    monitor.recordValidRpc();
    if (record.kind === "prompt_rejected") {
      requestTermination("prompt_rejected");
      return;
    }
    if (record.kind === "ui_response") {
      if (!writeProtocol(record.line)) requestTermination("child_failed");
      return;
    }
    if (record.kind === "ui_activity") {
      monitor.recordUiActivity(record.method);
      return;
    }
    if (record.kind === "prompt_accepted") {
      monitor.acceptPrompt(record.round);
      if (record.round === 2) reportRecoveryAccepted = true;
      evaluateRound();
      return;
    }
    monitor.consumeEvent(record.round, record.event);
    evaluateRound();
  }

  // Resolves as soon as requestTermination starts the cleanup path. The
  // wait below races it against close, because a descendant that inherited
  // the leader's stdio pipes can keep the close event blocked long after the
  // bounded termination already finished.
  let signalTerminationStarted!: () => void;
  const terminationStarted = new Promise<void>((resolve) => {
    signalTerminationStarted = resolve;
  });
  let resolveClose!: () => void;
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const onClose = () => {
    resolveClose();
  };
  // The recorded leader-exit signal: fixes the settlement-window start and
  // anchors the single absolute cleanup budget at the exit instant.
  const onLeaderExit = () => {
    if (leaderExitAt === undefined) leaderExitAt = performance.now();
  };
  let spawnError: Error | undefined;
  const onChildError = (error: Error) => {
    spawnError = error;
    requestTermination("spawn_failed");
  };
  const ignoreStdinError = () => {};
  const onStdoutData = (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > options.maxOutputBytes) {
      requestTermination("output_limit");
      return;
    }
    protocol.feed(chunk, handleProtocolRecord);
  };
  const onStderrData = (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > options.maxOutputBytes) requestTermination("output_limit");
    else stderrStream.write(chunk);
  };
  const removeChildListeners = () => {
    child.removeListener("close", onClose);
    child.removeListener("exit", onLeaderExit);
    child.removeListener("error", onChildError);
    child.stdin?.removeListener("error", ignoreStdinError);
    child.stdout?.removeListener("data", onStdoutData);
    child.stderr?.removeListener("data", onStderrData);
  };
  child.once("close", onClose);
  child.once("exit", onLeaderExit);
  child.once("error", onChildError);
  child.stdin?.on("error", ignoreStdinError);
  child.stdout?.on("data", onStdoutData);
  child.stderr?.on("data", onStderrData);
  writeProtocol(initialCommand);

  const abort = () => requestTermination("interrupted");
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  // The ticker is the only wall-clock authority for productive work. It
  // evaluates the pure renewable-liveness reducer each tick; total elapsed
  // time is never a termination condition.
  const ticker = setInterval(() => {
    if (terminalRequested) return;
    if (!processIsRunning(child)) {
      // The leader's exit is recorded, but the close event can stay blocked
      // indefinitely when a descendant inherited the leader's stdio pipes.
      // Classification must not freeze before final stdout drains, so one
      // fixed short settlement window keeps the stdout/protocol listeners
      // and the normal evaluateRound path active: a valid late terminal
      // result may still complete. A natural close ends the window at once.
      if (leaderExitAt === undefined) leaderExitAt = performance.now();
      if (performance.now() - leaderExitAt < leaderExitSettlementMs) {
        emitProgress(false);
        return;
      }
      // The window expired without terminal settlement or close: classify
      // the incomplete snapshot exactly like a natural close would and start
      // group termination with only the remaining cleanup budget.
      const snapshot = monitor.snapshot();
      const classified = monitor.classifyRound(snapshot.reportRound, true);
      if (classified !== "running") {
        requestTermination(classified, classified === "completed");
      } else {
        requestTermination(child.exitCode !== 0 ? "child_failed" : "invalid_stream");
      }
      return;
    }
    emitProgress(false);
    if (outputBytes > options.maxOutputBytes) {
      requestTermination("output_limit");
      return;
    }
    const now = performance.now();
    const snapshot = monitor.snapshot();
    const inRecovery = snapshot.reportRound === 2;
    // The recovery round gets its own shorter activity-idle lease; tools are
    // forbidden there, so the reporting phase cannot hide behind tool output.
    const activityIdleMs = inRecovery ? options.reportRecoveryIdleMs : options.activityIdleMs;
    const ages = {
      rpcIdleMs: now - snapshot.lastValidRpcMonotonic,
      activityIdleMs: now - snapshot.lastActivityMonotonic,
      progressIdleMs: now - snapshot.lastStructuralProgressMonotonic,
      activeToolIdleMs: snapshot.activeToolLastNovelUpdateMonotonic === undefined
        ? undefined
        : now - snapshot.activeToolLastNovelUpdateMonotonic,
      duplicateCheckpointsSinceNovel: snapshot.duplicateCheckpointsSinceNovel,
    };
    const decision = evaluateLiveness(ages, {
      activityWarningMs: options.activityWarningMs,
      activityIdleMs,
      progressWarningMs: options.progressWarningMs,
      progressStallMs: options.progressStallMs,
    });
    if (decision.action === "stall") {
      // Any communication-family stall during the recovery round reports the
      // dedicated bounded reporting-phase cause.
      const cause: StallCause = inRecovery && decision.cause !== "progress_stagnation" && decision.cause !== "repeated_cycle"
        ? "report_recovery_idle"
        : decision.cause;
      requestTermination("stalled", false, cause);
      return;
    }
    // Warnings are one-shot per lease interval: a fresh lease clears the
    // latch so a later interval can warn again.
    if (ages.activityIdleMs < options.activityWarningMs) activityWarningIssued = false;
    if (ages.progressIdleMs < options.progressWarningMs) progressWarningIssued = false;
    if (decision.action === "warn" && decision.kind === "activity" && !activityWarningIssued) {
      activityWarningIssued = true;
      monitor.issueActivityWarning();
      emitProgress(true);
    } else if (decision.action === "warn" && decision.kind === "progress" && !progressWarningIssued) {
      progressWarningIssued = true;
      monitor.issueProgressWarning();
      emitProgress(true);
    }
  }, 100);

  try {
    // Close or termination-request starts the settlement. Once termination
    // starts, only its bounded promise is awaited, so a negative outcome is
    // consumed and mapped to cleanup_failed without an unbounded close wait;
    // a natural close keeps the sweep-only path below.
    await Promise.race([closePromise, terminationStarted]);
    if (cleanupDeadline === undefined) cleanupDeadline = newCleanupDeadline();
    const cleanupOutcome = await (terminationPromise
      ?? terminateProcessGroup(child, terminationGraceMs, terminationDeadlineFor(cleanupDeadline)));
    // A negative proof can leave a noisy child alive. Detach it before ending
    // stderr and settling artifacts so later output cannot reach closed state.
    removeChildListeners();
    options.signal?.removeEventListener("abort", abort);
    if (!terminalRequested || completionCleanupPerformed) protocol.finish(handleProtocolRecord);
    child.stdin?.end();
    const finalAllowance = cleanupDeadline === undefined
      ? finalCleanupAllowanceMs
      : Math.max(0, Math.min(finalCleanupAllowanceMs, cleanupDeadline - performance.now()));
    await finishWriteStream(stderrStream, finalAllowance);
    await chmod(stderrPath, 0o600);

    if (progressSinkFailed) {
      // Ticker, abort listener, child/group, and stderr cleanup are complete.
      // The caller-owned sink is dead, so no status or final progress can be
      // delivered: reject with the original sink error instead of returning.
      throw progressSinkError;
    }

    const snapshot = monitor.snapshot();
    if (outputBytes > options.maxOutputBytes) state = "output_limit";
    else if (!terminalRequested) {
      if (spawnError) state = "spawn_failed";
      else {
        const classified = monitor.classifyRound(snapshot.reportRound, true);
        if (classified !== "running") state = classified;
        else if (child.exitCode !== 0) state = "child_failed";
        else state = "invalid_stream";
      }
    }
    if (snapshot.errors.length > 0 && state === "completed") state = "invalid_stream";
    if (!cleanupOutcome.ok) {
      cleanupFailureReason = cleanupOutcome.reason;
      state = "cleanup_failed";
    }

    const finalReport = monitor.finalReport(snapshot.reportRound);
    if (finalReport !== undefined) await atomicWriteText(reportPath, finalReport);
    const reportPresent = Boolean(finalReport?.trim());
    const status = buildStatus(state, child.exitCode, snapshot, reportPresent);
    await atomicWriteJson(statusPath, status);
    emitProgress(true);
    if (progressSinkFailed) throw progressSinkError;
    return status;
  } finally {
    // Timers, the abort listener, child listeners, and the ephemeral
    // novelty keys are cleared even when termination, artifact cleanup, or
    // the caller's progress sink throws mid-settlement.
    clearInterval(ticker);
    options.signal?.removeEventListener("abort", abort);
    removeChildListeners();
    monitor.clearEphemeralState();
  }
}

export async function attemptOutputBytes(status: AttemptStatus): Promise<number> {
  return status.outputBytes || await fileSize(status.stderrPath);
}
