import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, atomicWriteText, readPrivateText } from "./artifacts.ts";
import { PiRpcMonitor } from "./monitor.ts";
import { RECOVERY_PROMPT, RpcJsonlProtocol, type ProtocolRecord } from "./protocol.ts";
import { routeKey } from "./routes.ts";
import type {
  AttemptStatus,
  DelegateProgress,
  DelegateRole,
  DelegateState,
  MonitorSnapshot,
  PiInvocation,
  PiRoute,
} from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
export const DEFAULT_GRACE_MS = 15 * 1000;
export const DEFAULT_IDLE_WARNING_MS = 5 * 60 * 1000;
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 1_000;

/** Floor reserved inside every absolute deadline for forced-kill verification. */
export const FORCED_KILL_VERIFY_RESERVE_MS = 40;
/** Tail reserved inside every absolute deadline for final stderr/status/progress cleanup. */
export const FINAL_CLEANUP_RESERVE_MS = 20;
/**
 * Mandatory tail every deadline-bounded attempt must be able to fit before
 * it spawns: forced-kill verification plus the final artifact cleanup. A
 * remaining share smaller than this never starts a child.
 */
export const MANDATORY_CLEANUP_RESERVE_MS = FORCED_KILL_VERIFY_RESERVE_MS + FINAL_CLEANUP_RESERVE_MS;

/** Bounded, sanitized outcome of one process-group termination attempt. */
export type TerminationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "group_alive" | "close_unconfirmed" };

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
  readonly timeoutMs: number;
  readonly idleWarningMs: number;
  readonly idleTimeoutMs: number;
  readonly maxOutputBytes: number;
  readonly graceMs: number;
  /**
   * Absolute cleanup-inclusive deadline on the performance.now() timeline:
   * supervision, graceful/forced termination, and group cleanup all fit
   * inside it. Undefined preserves standalone supervision, where the soft
   * timeout plus the full configured grace stay unclamped.
   */
  readonly deadline?: number;
  readonly onProgress?: (progress: DelegateProgress) => void;
}

export interface SupervisePiOptions extends SuperviseBaseOptions {
  readonly route: PiRoute;
  readonly piInvocation: PiInvocation;
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
 * Terminates one process group through injectable probes. Resolves ok only
 * with a positive proof: the leader's close event fired (or its exit was
 * otherwise recorded) and a final groupExists probe is false. Any group
 * liveness left after SIGKILL, or a close that stays unconfirmed, reports a
 * bounded cleanup failure the caller must fail closed on. With an absolute
 * deadline every wait is clamped to the time still available; there is no
 * verification floor that could extend past it.
 */
export async function terminateProcessGroupWith(
  graceMs: number,
  deadlineMs: number | undefined,
  probes: TerminationProbes,
): Promise<TerminationOutcome> {
  const remainingMs = () =>
    deadlineMs === undefined ? Number.POSITIVE_INFINITY : deadlineMs - probes.now();
  // Absolute-deadline clamping: the graceful window never exceeds the time
  // still available. When the configured grace cannot fit before the
  // deadline, the effective grace is zero and termination escalates
  // immediately to SIGKILL instead of waiting.
  const effectiveGraceMs = Math.max(0, Math.min(graceMs, remainingMs()));
  if (probes.groupExists()) {
    if (effectiveGraceMs > 0) {
      probes.signalGroup("SIGTERM");
      const graceDeadline = probes.now() + effectiveGraceMs;
      while (probes.groupExists() && probes.now() < graceDeadline) {
        // Poll no further than the graceful boundary, so the reserved
        // forced-kill window after it stays intact.
        await probes.delay(Math.min(25, graceDeadline - probes.now()));
      }
    }
    if (probes.groupExists()) {
      probes.signalGroup("SIGKILL");
      // Bounded wait that verifies actual process-group disappearance, not
      // just signal delivery. With an absolute deadline the window is
      // clamped to the remaining time; without one it keeps the historical
      // floor so standalone supervision never returns early on a wedged group.
      const verifyMs = deadlineMs === undefined
        ? Math.max(1000, graceMs)
        : Math.max(0, Math.min(1000, remainingMs()));
      const verifyDeadline = probes.now() + verifyMs;
      while (probes.groupExists() && probes.now() < verifyDeadline) {
        await probes.delay(Math.min(10, verifyDeadline - probes.now()));
      }
      if (probes.groupExists()) return { ok: false, reason: "group_alive" };
    }
  }
  // Positive close proof: the close event fired inside a bounded wait, or
  // the leader is otherwise provably gone because its exit was recorded.
  const closeBudgetMs = deadlineMs === undefined
    ? Math.max(1000, graceMs)
    : Math.max(0, Math.min(1000, remainingMs()));
  const closeSeen = await probes.waitForClose(closeBudgetMs);
  if (!closeSeen && probes.processIsRunning()) return { ok: false, reason: "close_unconfirmed" };
  if (probes.groupExists()) return { ok: false, reason: "group_alive" };
  return { ok: true };
}

export async function terminateProcessGroup(
  child: ChildProcess,
  graceMs: number,
  deadlineMs?: number,
): Promise<TerminationOutcome> {
  // Without a pid nothing was ever spawned, so there is nothing to prove.
  if (child.pid === undefined) return { ok: true };
  return terminateProcessGroupWith(graceMs, deadlineMs, terminationProbes.build(child));
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

function progressFromMonitor(
  options: SupervisePiOptions,
  state: DelegateState,
  started: number,
  monitor: PiRpcMonitor,
  reportNudgeCount: 0 | 1,
  reportRecoveryReason: "missing_report" | "invalid_result" | undefined,
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
  };
}

export async function supervisePi(options: SupervisePiOptions): Promise<AttemptStatus> {
  const started = performance.now();
  const startedAt = isoNow();
  // Cleanup-inclusive soft deadline: when an absolute deadline is given, a
  // termination budget is reserved out of it before route work starts, so
  // the supervision cutoff lands early enough that graceful or forced
  // termination and group cleanup still finish inside the deadline. The
  // reserve never drops below the mandatory tail, so even a sub-interval
  // share keeps room for forced-kill verification and final cleanup.
  const cleanupReserveMs = options.deadline === undefined
    ? 0
    : Math.max(
      MANDATORY_CLEANUP_RESERVE_MS,
      Math.min(options.graceMs, Math.max(0, Math.floor((options.deadline - started) / 2))),
    );
  const softDeadlineMs = Math.min(
    started + options.timeoutMs,
    (options.deadline ?? Number.POSITIVE_INFINITY) - cleanupReserveMs,
  );
  // Termination gets its own bounded tail of the absolute deadline: the
  // final stderr/status/progress cleanup stays inside the route share, and
  // the graceful window is clamped so forced kill and its verification still
  // fit before the absolute deadline.
  const terminationDeadline = options.deadline === undefined
    ? undefined
    : options.deadline - FINAL_CLEANUP_RESERVE_MS;
  const terminationGraceMs = () => options.deadline === undefined
    ? options.graceMs
    : Math.max(
      0,
      Math.min(
        options.graceMs,
        terminationDeadline! - performance.now() - FORCED_KILL_VERIFY_RESERVE_MS,
      ),
    );
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
    routeUnavailableSeen: snapshot.routeUnavailableSeen,
    providerFailureCategory: snapshot.providerFailureCategory,
    reportNudgeCount,
    reportRecoveryReason,
    reportRound: snapshot.reportRound,
    reportRecoveryAccepted,
    streamErrors: snapshot.errors,
  });

  if (
    options.deadline !== undefined
    && options.deadline - performance.now() <= MANDATORY_CLEANUP_RESERVE_MS
  ) {
    // The remaining share cannot fit the mandatory forced-kill verification
    // and final stderr/status/progress cleanup, so spawning could only end
    // past the absolute deadline. Record the soft timeout without spawning;
    // the runner advances to the next route because timed_out stays
    // operational, and each later route rechecks its own remaining share.
    stderrStream.end();
    await new Promise<void>((resolve) => stderrStream.once("finish", resolve));
    await chmod(stderrPath, 0o600);
    const noSpawnStatus = buildStatus("timed_out", null, monitor.snapshot(), false);
    await atomicWriteJson(statusPath, noSpawnStatus);
    try {
      options.onProgress?.(progressFromMonitor(
        options,
        "timed_out",
        started,
        monitor,
        reportNudgeCount,
        reportRecoveryReason,
      ));
    } catch (error) {
      // No child exists, so there is nothing left to clean up: reject with
      // the caller's original sink error after the artifacts above finished.
      throw error;
    }
    return noSpawnStatus;
  }

  const args = [
    ...options.piInvocation.prefixArgs,
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
    terminationPromise = terminateProcessGroup(child, terminationGraceMs(), terminationDeadline);
    // The settlement wait races this against the close event, so a bounded
    // termination outcome is consumed without any close wait first.
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
      || performance.now() >= softDeadlineMs
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

  // One-shot timer scheduled directly for the soft deadline: a share shorter
  // than the interval is still enforced at its own deadline, not at the next
  // 100 ms tick. The interval below only covers progress, idle, and output
  // checks.
  const deadlineTimer = setTimeout(() => {
    // Terminate while close is unconfirmed even if the leader no longer
    // appears running: after the leader exits, inherited stdio can keep the
    // close event blocked indefinitely, so liveness alone must not gate the
    // soft deadline.
    if (terminalRequested || closed) return;
    requestTermination("timed_out");
  }, Math.max(0, softDeadlineMs - performance.now()));

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
    const cleanupOutcome = await (terminationPromise
      ?? terminateProcessGroup(child, terminationGraceMs(), terminationDeadline));
    // A negative proof can leave a noisy child alive. Detach it before ending
    // stderr and settling artifacts so later output cannot reach closed state.
    removeChildListeners();
    options.signal?.removeEventListener("abort", abort);
    if (!terminalRequested || completionCleanupPerformed) protocol.finish(handleProtocolRecord);
    child.stdin?.end();
    stderrStream.end();
    await new Promise<void>((resolve) => stderrStream.once("finish", resolve));
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
      // The positive cleanup proof failed: group liveness survived SIGKILL or
      // the leader close stayed unconfirmed. Fail closed with the sanitized
      // terminal state regardless of what the stream had classified; the
      // runner treats it as terminal and never starts another route.
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
