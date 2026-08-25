import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, atomicWriteText, readPrivateText } from "./artifacts.ts";
import { interruptionSource } from "./manager.ts";
import { PiRpcMonitor } from "./monitor.ts";
import { RECOVERY_PROMPT, RpcJsonlProtocol, type ProtocolRecord } from "./protocol.ts";
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
} from "./types.ts";

export const DEFAULT_WORK_TIMEOUT_MS = 45 * 60 * 1000;
export const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;
export const DEFAULT_TERMINATION_GRACE_MS = 5_000;
export const FORCED_KILL_VERIFY_MS = 3_000;
export const FINAL_CLEANUP_ALLOWANCE_MS = 2_000;
export const DEFAULT_IDLE_WARNING_MS = 5 * 60 * 1000;
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
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
  /** Remaining productive-work budget at this attempt's start. */
  readonly timeoutMs: number;
  /** One absolute productive-work deadline shared by every route. */
  readonly workDeadline: number;
  readonly workBudgetSeconds: number;
  readonly remainingWorkSecondsAtAttemptStart: number;
  readonly idleWarningMs: number;
  readonly idleTimeoutMs: number;
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
    readonly cleanupFailureReason?: CleanupFailureReason;
    readonly interruptionSource?: InterruptionSource;
  } = {},
): DelegateProgress {
  const snapshot = monitor.snapshot();
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
    idleSeconds: Math.round((performance.now() - snapshot.lastActivityMonotonic) / 100) / 10,
    elapsedSeconds: elapsedSeconds(started),
    toolExecutionCount: snapshot.toolExecutionCount,
    idleWarningCount: snapshot.warningCount,
    restartAfterWorkCount: options.restartAfterWorkCount ?? 0,
    reportNudgeCount,
    reportRecoveryReason,
    reportRound: snapshot.reportRound,
    providerFailureCategory: snapshot.providerFailureCategory,
    delegateOutcome: snapshot.outcome,
    terminalReason: snapshot.terminalReason,
    reasonStatus: snapshot.reasonStatus,
    blockedMisuseSuspected: snapshot.blockedMisuseSuspected,
    workBudgetSeconds: options.workBudgetSeconds,
    remainingWorkSecondsAtAttemptStart: options.remainingWorkSecondsAtAttemptStart,
    activeToolCount: snapshot.activeToolCount,
    activeToolName: snapshot.activeToolName,
    activeToolElapsedSeconds: snapshot.activeToolElapsedSeconds,
    deadlineCause: metadata.deadlineCause,
    cleanupFailureReason: metadata.cleanupFailureReason,
    interruptionSource: metadata.interruptionSource,
  };
}

export async function supervisePi(options: SupervisePiOptions): Promise<AttemptStatus> {
  const started = performance.now();
  const startedAt = isoNow();
  // Productive work uses the one absolute delegate deadline. Cleanup starts
  // only after work ends and receives a separate bounded allowance.
  const workDeadline = Math.min(started + options.timeoutMs, options.workDeadline);
  const cleanupTimeoutMs = Math.min(
    options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
    DEFAULT_CLEANUP_TIMEOUT_MS,
  );
  const terminationGraceMs = Math.min(options.graceMs, DEFAULT_TERMINATION_GRACE_MS);
  const finalCleanupAllowanceMs = Math.min(
    FINAL_CLEANUP_ALLOWANCE_MS,
    Math.max(1, Math.floor(cleanupTimeoutMs / 5)),
  );
  const newCleanupDeadline = () => performance.now() + cleanupTimeoutMs;
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
  let idleWarningIssued = false;
  let lastProgressAt = 0;
  let terminalRequested = false;
  let terminationPromise: Promise<TerminationOutcome> | undefined;
  let reportNudgeCount: 0 | 1 = 0;
  let reportRecoveryReason: "missing_report" | "invalid_result" | undefined;
  let reportRecoveryAccepted = false;
  let progressSinkFailed = false;
  let progressSinkError: unknown;
  let deadlineCause: DeadlineCause | undefined;
  let cleanupFailureReason: CleanupFailureReason | undefined;
  let interruptionSourceValue: InterruptionSource | undefined;
  let cleanupDeadline: number | undefined;

  const buildStatus = (
    finalState: DelegateState,
    exitCode: number | null,
    snapshot: MonitorSnapshot,
    reportPresent: boolean,
  ): AttemptStatus => ({
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
    cleanupFailureReason,
    interruptionSource: interruptionSourceValue,
    workBudgetSeconds: options.workBudgetSeconds,
    remainingWorkSecondsAtAttemptStart: options.remainingWorkSecondsAtAttemptStart,
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
    lastEvent: snapshot.lastEvent,
    lastEventDetail: snapshot.lastEventDetail,
    lastEventAt: snapshot.lastEventAt,
    phase: snapshot.phase,
    idleSeconds: Math.round((performance.now() - snapshot.lastActivityMonotonic) / 100) / 10,
    idleWarningCount: snapshot.warningCount,
    sessionSeen: snapshot.sessionSeen,
    agentStartCount: snapshot.agentStartCount,
    agentEndCount: snapshot.agentEndCount,
    agentEndSeen: snapshot.agentEndSeen,
    agentSettledSeen: snapshot.agentSettledSeen,
    toolExecutionCount: snapshot.toolExecutionCount,
    activeToolCount: snapshot.activeToolCount,
    activeToolName: snapshot.activeToolName,
    activeToolElapsedSeconds: snapshot.activeToolElapsedSeconds,
    routeUnavailableSeen: snapshot.routeUnavailableSeen,
    providerFailureCategory: snapshot.providerFailureCategory,
    reportNudgeCount,
    reportRecoveryReason,
    reportRound: snapshot.reportRound,
    reportRecoveryAccepted,
    streamErrors: snapshot.errors,
  });

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
        { deadlineCause, cleanupFailureReason, interruptionSource: interruptionSourceValue },
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

  function requestTermination(nextState: DelegateState, cleanup = false): void {
    if (terminalRequested) return;
    terminalRequested = true;
    state = nextState;
    completionCleanupPerformed = cleanup;
    if (nextState === "timed_out") deadlineCause = "work_deadline";
    else if (nextState === "stalled") deadlineCause = "idle_deadline";
    else if (nextState === "interrupted") {
      interruptionSourceValue = interruptionSource(options.signal?.reason);
    }
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
      || performance.now() >= workDeadline
    ) {
      requestTermination(roundState);
      return;
    }
    reportNudgeCount = 1;
    reportRecoveryReason = roundState;
    monitor.beginRecovery();
    let command: string;
    try {
      command = protocol.beginPrompt(2, RECOVERY_PROMPT);
    } catch {
      requestTermination("invalid_stream");
      return;
    }
    if (!writeProtocol(command)) requestTermination("child_failed");
    else emitProgress(true);
  }

  function handleProtocolRecord(record: ProtocolRecord): void {
    if (record.kind === "protocol_error") {
      monitor.addProtocolError(record.category);
      state = "invalid_stream";
      if (!terminalRequested) requestTermination("invalid_stream");
      return;
    }
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
  let closed = false;
  let resolveClose!: () => void;
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const onClose = () => {
    closed = true;
    resolveClose();
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
    child.removeListener("error", onChildError);
    child.stdin?.removeListener("error", ignoreStdinError);
    child.stdout?.removeListener("data", onStdoutData);
    child.stderr?.removeListener("data", onStderrData);
  };
  child.once("close", onClose);
  child.once("error", onChildError);
  child.stdin?.on("error", ignoreStdinError);
  child.stdout?.on("data", onStdoutData);
  child.stderr?.on("data", onStderrData);
  writeProtocol(initialCommand);

  const abort = () => requestTermination("interrupted");
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  // One one-shot timer enforces the shared productive-work deadline. Meaningful
  // activity resets idle age only and never reschedules this timer.
  const deadlineTimer = setTimeout(() => {
    if (terminalRequested || closed) return;
    requestTermination("timed_out");
  }, Math.max(0, workDeadline - performance.now()));

  const ticker = setInterval(() => {
    if (terminalRequested || !processIsRunning(child)) return;
    const now = performance.now();
    const snapshot = monitor.snapshot();
    const idleMs = now - snapshot.lastActivityMonotonic;
    emitProgress(false);
    if (outputBytes > options.maxOutputBytes) requestTermination("output_limit");
    else if (idleMs >= options.idleTimeoutMs) requestTermination("stalled");
    else if (idleMs >= options.idleWarningMs && !idleWarningIssued) {
      idleWarningIssued = true;
      monitor.issueIdleWarning();
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
    // Timers and the abort listener are cleared even when termination,
    // artifact cleanup, or the caller's progress sink throws mid-settlement.
    clearInterval(ticker);
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", abort);
    removeChildListeners();
  }
}

export async function attemptOutputBytes(status: AttemptStatus): Promise<number> {
  return status.outputBytes || await fileSize(status.stderrPath);
}
