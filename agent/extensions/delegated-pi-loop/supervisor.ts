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
  PiInvocation,
  PiRoute,
} from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
export const DEFAULT_GRACE_MS = 15 * 1000;
export const DEFAULT_IDLE_WARNING_MS = 5 * 60 * 1000;
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 1_000;

interface SuperviseBaseOptions {
  readonly label: string;
  readonly role: DelegateRole;
  readonly attempt: number;
  readonly cwd: string;
  readonly artifactDir: string;
  readonly promptPath: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly idleWarningMs: number;
  readonly idleTimeoutMs: number;
  readonly maxOutputBytes: number;
  readonly graceMs: number;
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

async function waitForClose(child: ChildProcess, timeoutMs?: number): Promise<void> {
  if (!processIsRunning(child)) return;
  await new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const done = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    child.once("close", done);
    if (timeoutMs !== undefined) timer = setTimeout(done, timeoutMs);
  });
}

export async function terminateProcessGroup(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    if (!processIsRunning(child)) return;
    child.kill("SIGTERM");
    await waitForClose(child, graceMs);
    if (processIsRunning(child)) child.kill("SIGKILL");
    return;
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
  if (!groupExists()) return;
  signalGroup("SIGTERM");
  const deadline = performance.now() + graceMs;
  while (groupExists() && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (groupExists()) signalGroup("SIGKILL");
  await waitForClose(child, Math.max(1000, graceMs));
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
    reportNudgeCount,
    reportRecoveryReason,
    reportRound: snapshot.reportRound,
    providerFailureCategory: snapshot.providerFailureCategory,
  };
}

export async function supervisePi(options: SupervisePiOptions): Promise<AttemptStatus> {
  const started = performance.now();
  const startedAt = isoNow();
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
  let terminationPromise: Promise<void> | undefined;
  let reportNudgeCount: 0 | 1 = 0;
  let reportRecoveryReason: "missing_report" | "invalid_result" | undefined;
  let reportRecoveryAccepted = false;

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
    options.onProgress?.(progressFromMonitor(
      options,
      state,
      started,
      monitor,
      reportNudgeCount,
      reportRecoveryReason,
    ));
  }

  function requestTermination(nextState: DelegateState, cleanup = false): void {
    if (terminalRequested) return;
    terminalRequested = true;
    state = nextState;
    completionCleanupPerformed = cleanup;
    terminationPromise = terminateProcessGroup(child, options.graceMs);
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
      || performance.now() - started >= options.timeoutMs
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

  const closePromise = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.stdin?.on("error", () => {});
  child.stdout?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > options.maxOutputBytes) {
      requestTermination("output_limit");
      return;
    }
    protocol.feed(chunk, handleProtocolRecord);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > options.maxOutputBytes) requestTermination("output_limit");
    else stderrStream.write(chunk);
  });
  writeProtocol(initialCommand);

  const abort = () => requestTermination("interrupted");
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  const ticker = setInterval(() => {
    if (terminalRequested || !processIsRunning(child)) return;
    const now = performance.now();
    const snapshot = monitor.snapshot();
    const idleMs = now - snapshot.lastActivityMonotonic;
    emitProgress(false);
    if (outputBytes > options.maxOutputBytes) requestTermination("output_limit");
    else if (idleMs >= options.idleTimeoutMs) requestTermination("stalled");
    else if (now - started >= options.timeoutMs) requestTermination("timed_out");
    else if (idleMs >= options.idleWarningMs && !idleWarningIssued) {
      idleWarningIssued = true;
      monitor.issueIdleWarning();
      emitProgress(true);
    }
  }, 100);

  await closePromise;
  clearInterval(ticker);
  if (terminationPromise) await terminationPromise;
  else await terminateProcessGroup(child, options.graceMs);
  options.signal?.removeEventListener("abort", abort);
  if (!terminalRequested || completionCleanupPerformed) protocol.finish(handleProtocolRecord);
  child.stdin?.end();
  stderrStream.end();
  await new Promise<void>((resolve) => stderrStream.once("finish", resolve));
  await chmod(stderrPath, 0o600);

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

  const finalReport = monitor.finalReport(snapshot.reportRound);
  if (finalReport !== undefined) await atomicWriteText(reportPath, finalReport);
  const reportPresent = Boolean(finalReport?.trim());
  const status: AttemptStatus = {
    schemaVersion: 1,
    label: options.label,
    role: options.role,
    route: routeKey(options.route),
    protocol: "pi-rpc",
    state,
    delegateOutcome: monitor.outcome(snapshot.reportRound),
    startedAt,
    endedAt: isoNow(),
    elapsedSeconds: elapsedSeconds(started),
    exitCode: child.exitCode,
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
  };
  await atomicWriteJson(statusPath, status);
  emitProgress(true);
  return status;
}

export async function attemptOutputBytes(status: AttemptStatus): Promise<number> {
  return status.outputBytes || await fileSize(status.stderrPath);
}
