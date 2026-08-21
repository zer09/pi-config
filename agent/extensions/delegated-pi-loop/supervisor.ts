import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { atomicWriteJson, atomicWriteText } from "./artifacts.ts";
import { parseDelegateOutcome, PiJsonMonitor } from "./monitor.ts";
import { roleIsReadOnly, routeKey } from "./routes.ts";
import type {
  AttemptStatus,
  ClaudeRoute,
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

export interface SuperviseClaudeOptions extends SuperviseBaseOptions {
  readonly route: ClaudeRoute;
  readonly prompt: string;
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
  if (!/^(node|bun)(\.exe)?$/.test(executable)) {
    return { command: process.execPath, prefixArgs: [] };
  }
  return { command: "pi", prefixArgs: [] };
}

export function delegateEnvironment(kind: "pi" | "claude"): NodeJS.ProcessEnv {
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
  if (kind === "claude") {
    delete environment.AI_AGENT;
    delete environment.PI_CODING_AGENT;
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
  stdin?: "pipe" | "ignore";
}): ChildProcess {
  return spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
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
  monitor: PiJsonMonitor,
): DelegateProgress {
  const snapshot = monitor.snapshot();
  return {
    label: options.label,
    role: options.role,
    state,
    protocol: "pi-json",
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
  };
}

export async function supervisePi(options: SupervisePiOptions): Promise<AttemptStatus> {
  const started = performance.now();
  const startedAt = isoNow();
  const reportPath = path.join(options.artifactDir, "report.md");
  const stderrPath = path.join(options.artifactDir, "stderr.log");
  const statusPath = path.join(options.artifactDir, "status.json");
  const stderrStream = createWriteStream(stderrPath, { flags: "wx", mode: 0o600 });
  let outputBytes = 0;
  let stdoutBuffer = "";
  const stdoutDecoder = new StringDecoder("utf8");
  let state: DelegateState = "running";
  let completionCleanupPerformed = false;
  let idleWarningIssued = false;
  let lastProgressAt = 0;
  let terminalRequested = false;
  let terminationPromise: Promise<void> | undefined;

  const monitor = new PiJsonMonitor(started, startedAt, () => performance.now(), isoNow, () => {
    idleWarningIssued = false;
    emitProgress(false);
  });
  const args = [
    ...options.piInvocation.prefixArgs,
    "--mode",
    "json",
    "--no-session",
    "--approve",
    "--provider",
    options.route.provider,
    "--model",
    options.route.model,
    "--thinking",
    options.route.thinking,
    `@${options.promptPath}`,
  ];
  const child = spawnDetached(options.piInvocation.command, args, {
    cwd: options.cwd,
    env: delegateEnvironment("pi"),
  });

  function emitProgress(force: boolean): void {
    const now = performance.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    options.onProgress?.(progressFromMonitor(options, state, started, monitor));
  }

  const closePromise = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > options.maxOutputBytes) return;
    stdoutBuffer += stdoutDecoder.write(chunk);
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) monitor.consumeLine(line);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    stderrStream.write(chunk);
  });

  const abort = () => {
    if (terminalRequested) return;
    terminalRequested = true;
    state = "interrupted";
    terminationPromise = terminateProcessGroup(child, options.graceMs);
  };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  const ticker = setInterval(() => {
    if (terminalRequested || !processIsRunning(child)) return;
    const now = performance.now();
    const snapshot = monitor.snapshot();
    const idleMs = now - snapshot.lastActivityMonotonic;
    emitProgress(false);

    if (outputBytes > options.maxOutputBytes) {
      terminalRequested = true;
      state = "output_limit";
      terminationPromise = terminateProcessGroup(child, options.graceMs);
      return;
    }
    if (snapshot.outcome === "blocked" || snapshot.outcome === "failed") {
      terminalRequested = true;
      state = snapshot.outcome === "blocked" ? "blocked" : "delegate_failed";
      terminationPromise = terminateProcessGroup(child, options.graceMs);
      return;
    }
    if (
      snapshot.outcome === "completed"
      && snapshot.agentEndSeen
      && snapshot.agentSettledSeen
      && snapshot.errors.length === 0
    ) {
      terminalRequested = true;
      state = "completed";
      completionCleanupPerformed = true;
      terminationPromise = terminateProcessGroup(child, options.graceMs);
      return;
    }
    if (idleMs >= options.idleWarningMs && !idleWarningIssued) {
      idleWarningIssued = true;
      monitor.issueIdleWarning();
      emitProgress(true);
    }
    if (idleMs >= options.idleTimeoutMs) {
      terminalRequested = true;
      state = "stalled";
      terminationPromise = terminateProcessGroup(child, options.graceMs);
      return;
    }
    if (now - started >= options.timeoutMs) {
      terminalRequested = true;
      state = "timed_out";
      terminationPromise = terminateProcessGroup(child, options.graceMs);
    }
  }, 100);

  await closePromise;
  clearInterval(ticker);
  if (terminationPromise) await terminationPromise;
  else await terminateProcessGroup(child, options.graceMs);
  options.signal?.removeEventListener("abort", abort);
  stdoutBuffer += stdoutDecoder.end();
  if (stdoutBuffer.trim()) monitor.finish(true);
  else monitor.finish(false);
  stderrStream.end();
  await new Promise<void>((resolve) => stderrStream.once("finish", resolve));
  await chmod(stderrPath, 0o600);

  const snapshot = monitor.snapshot();
  if (outputBytes > options.maxOutputBytes) state = "output_limit";
  else if (!terminalRequested) {
    if (spawnError) state = "spawn_failed";
    else if (child.exitCode !== 0) state = "child_failed";
    else if (snapshot.errors.length > 0 || !snapshot.agentEndSeen) state = "invalid_stream";
    else state = "completed";
  }
  if (state === "completed" && snapshot.errors.length > 0) state = "invalid_stream";

  if (snapshot.finalReport !== undefined) await atomicWriteText(reportPath, snapshot.finalReport);
  const reportPresent = snapshot.finalReport?.trim().length ? true : false;
  if (state === "completed" && !reportPresent) state = "missing_report";
  else if (state === "completed") {
    if (snapshot.outcome === "blocked") state = "blocked";
    else if (snapshot.outcome === "failed") state = "delegate_failed";
    else if (snapshot.outcome !== "completed") state = "invalid_result";
  }

  const status: AttemptStatus = {
    schemaVersion: 1,
    label: options.label,
    role: options.role,
    route: routeKey(options.route),
    protocol: "pi-json",
    state,
    delegateOutcome: snapshot.outcome,
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
    streamErrors: snapshot.errors,
  };
  await atomicWriteJson(statusPath, status);
  emitProgress(true);
  return status;
}

function plainProgress(
  options: SuperviseClaudeOptions,
  state: DelegateState,
  started: number,
  lastEvent: string,
  lastEventAt: string,
): DelegateProgress {
  return {
    label: options.label,
    role: options.role,
    state,
    protocol: "plain",
    route: routeKey(options.route),
    attempt: options.attempt,
    phase: state === "running" ? "provider" : "complete",
    lastEvent,
    lastEventAt,
    idleSeconds: 0,
    elapsedSeconds: elapsedSeconds(started),
    toolExecutionCount: 0,
    idleWarningCount: 0,
  };
}

export async function superviseClaude(options: SuperviseClaudeOptions): Promise<AttemptStatus> {
  const started = performance.now();
  const startedAt = isoNow();
  const reportPath = path.join(options.artifactDir, "report.md");
  const stderrPath = path.join(options.artifactDir, "stderr.log");
  const statusPath = path.join(options.artifactDir, "status.json");
  let state: DelegateState = "running";
  let outputBytes = 0;
  let report = "";
  const stdoutDecoder = new StringDecoder("utf8");
  let lastEvent = "process_start";
  let lastEventAt = startedAt;
  const stderrStream = createWriteStream(stderrPath, { flags: "wx", mode: 0o600 });
  // One authoritative read-only predicate from role classification; this also
  // keeps a defensively misrouted oracle read-only even though routes reject a
  // Claude-backed oracle before spawn.
  const readOnly = roleIsReadOnly(options.role);
  const args = [
    "--print",
    "--model",
    options.route.model,
    "--effort",
    options.route.effort,
    "--no-session-persistence",
    "--permission-mode",
    readOnly ? "dontAsk" : "acceptEdits",
    "--allowedTools",
    readOnly ? "Read,Glob,Grep,Bash" : "Read,Edit,Write,Glob,Grep,Bash",
    "--disallowedTools",
    readOnly ? "Edit,Write,Agent" : "Agent",
    "--no-chrome",
    readOnly
      ? "Execute the complete read-only delegated task supplied on stdin."
      : "Execute the complete delegated task supplied on stdin.",
  ];
  const child = spawnDetached("claude", args, {
    cwd: options.cwd,
    env: delegateEnvironment("claude"),
    stdin: "pipe",
  });
  const closePromise = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.stdin?.on("error", () => {});
  child.stdin?.end(options.prompt);

  const emit = () => options.onProgress?.(plainProgress(options, state, started, lastEvent, lastEventAt));
  emit();
  child.stdout?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes <= options.maxOutputBytes) report += stdoutDecoder.write(chunk);
    lastEvent = "stdout_activity";
    lastEventAt = isoNow();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    stderrStream.write(chunk);
    lastEvent = "stderr_activity";
    lastEventAt = isoNow();
  });

  let terminalRequested = false;
  let terminationPromise: Promise<void> | undefined;
  let lastHeartbeat = started;
  const abort = () => {
    if (terminalRequested) return;
    terminalRequested = true;
    state = "interrupted";
    terminationPromise = terminateProcessGroup(child, options.graceMs);
  };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  const ticker = setInterval(() => {
    if (terminalRequested || !processIsRunning(child)) return;
    emit();
    if (outputBytes > options.maxOutputBytes) {
      terminalRequested = true;
      state = "output_limit";
      terminationPromise = terminateProcessGroup(child, options.graceMs);
    } else if (performance.now() - started >= options.timeoutMs) {
      terminalRequested = true;
      state = "timed_out";
      terminationPromise = terminateProcessGroup(child, options.graceMs);
    } else if (performance.now() - lastHeartbeat >= 60_000) {
      lastHeartbeat = performance.now();
      lastEvent = "process_heartbeat";
      lastEventAt = isoNow();
    }
  }, 1000);

  await closePromise;
  clearInterval(ticker);
  if (terminationPromise) await terminationPromise;
  else await terminateProcessGroup(child, options.graceMs);
  options.signal?.removeEventListener("abort", abort);
  report += stdoutDecoder.end();
  stderrStream.end();
  await new Promise<void>((resolve) => stderrStream.once("finish", resolve));
  await chmod(stderrPath, 0o600);

  const outcome = parseDelegateOutcome(report);
  if (outputBytes > options.maxOutputBytes) state = "output_limit";
  else if (!terminalRequested) {
    if (spawnError) state = "spawn_failed";
    else if (child.exitCode !== 0) state = "child_failed";
    else if (!report.trim()) state = "missing_report";
    else if (outcome === "completed") state = "completed";
    else if (outcome === "blocked") state = "blocked";
    else if (outcome === "failed") state = "delegate_failed";
    else state = "invalid_result";
  }
  if (report.trim()) await atomicWriteText(reportPath, report);

  const status: AttemptStatus = {
    schemaVersion: 1,
    label: options.label,
    role: options.role,
    route: routeKey(options.route),
    protocol: "plain",
    state,
    delegateOutcome: outcome,
    startedAt,
    endedAt: isoNow(),
    elapsedSeconds: elapsedSeconds(started),
    exitCode: child.exitCode,
    completionCleanupPerformed: false,
    outputBytes,
    reportPresent: Boolean(report.trim()),
    reportPath,
    stderrPath,
    activityEventCount: 0,
    lastEvent,
    lastEventAt,
    phase: "complete",
    idleSeconds: 0,
    idleWarningCount: 0,
    sessionSeen: false,
    agentStartCount: 0,
    agentEndCount: 0,
    agentEndSeen: false,
    agentSettledSeen: false,
    toolExecutionCount: 0,
    routeUnavailableSeen: false,
    streamErrors: [],
  };
  await atomicWriteJson(statusPath, status);
  emit();
  return status;
}

export async function attemptOutputBytes(status: AttemptStatus): Promise<number> {
  return status.outputBytes || await fileSize(status.stderrPath);
}
