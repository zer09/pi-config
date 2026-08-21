import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  atomicWriteJson,
  atomicWriteText,
  captureTreeFingerprint,
  createArtifactDir,
  createPrivateDirectory,
  fingerprintsEqual,
  readPrivateText,
} from "./artifacts.ts";
import { buildDelegatePrompt, roleIsReadOnly, roleLabel, routeKey, routesFor } from "./routes.ts";
import {
  DEFAULT_GRACE_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_IDLE_WARNING_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  delegateEnvironment,
  resolvePiInvocation,
  superviseClaude,
  supervisePi,
  terminateProcessGroup,
} from "./supervisor.ts";
import type {
  AttemptStatus,
  ChainAttempt,
  DelegateProgress,
  DelegateRunResult,
  DelegateState,
  PiInvocation,
  PiRoute,
  RunOptions,
} from "./types.ts";

const TOOL_OUTPUT_LIMIT = 50 * 1024;

function roundedSeconds(milliseconds: number): number {
  return Math.round(milliseconds / 100) / 10;
}

async function routeIsCatalogued(
  invocation: PiInvocation,
  route: PiRoute,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const args = [...invocation.prefixArgs, "--list-models", `${route.provider}/${route.model}`];
  const child = spawn(invocation.command, args, {
    cwd,
    env: delegateEnvironment("pi"),
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closePromise = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let spawnFailed = false;
  child.once("error", () => {
    spawnFailed = true;
  });
  let stdout = "";
  const stdoutDecoder = new StringDecoder("utf8");
  let outputBytes = 0;
  child.stdout?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes <= 1024 * 1024) stdout += stdoutDecoder.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    void terminateProcessGroup(child, 1000);
  };
  const timer = setTimeout(stop, Math.min(15_000, timeoutMs));
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  await closePromise;
  clearTimeout(timer);
  signal?.removeEventListener("abort", stop);
  stdout += stdoutDecoder.end();
  if (stopped || spawnFailed || child.exitCode !== 0 || outputBytes > 1024 * 1024) return false;

  return stdout.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/);
    return fields.length >= 2 && fields[0] === route.provider && fields[1] === route.model;
  });
}

function fallbackReason(status: AttemptStatus): ChainAttempt["fallbackReason"] | undefined {
  if (status.delegateOutcome !== undefined || status.toolExecutionCount !== 0) return undefined;
  if (status.state === "stalled") return "event_idle_before_tools";
  const terminalStates: readonly DelegateState[] = [
    "completed",
    "blocked",
    "delegate_failed",
    "timed_out",
    "output_limit",
    "interrupted",
  ];
  if (status.routeUnavailableSeen && !terminalStates.includes(status.state)) {
    return "provider_unavailable_before_tools";
  }
  return undefined;
}

function progressFromStatus(status: AttemptStatus, attempt: number): DelegateProgress {
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
  };
}

function initialProgress(label: string, options: RunOptions): DelegateProgress {
  const now = new Date().toISOString();
  return {
    label,
    role: options.role,
    state: "catalog_check",
    protocol: "pi-json",
    attempt: 0,
    phase: "catalog",
    lastEvent: "catalog_check",
    lastEventAt: now,
    idleSeconds: 0,
    elapsedSeconds: 0,
    toolExecutionCount: 0,
    idleWarningCount: 0,
  };
}

export async function runDelegate(options: RunOptions): Promise<DelegateRunResult> {
  const backend = options.backend;
  const label = roleLabel(options.role, backend);
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

  const artifactDir = await createArtifactDir(label);
  const promptPath = path.join(artifactDir, "prompt.md");
  const reportPath = path.join(artifactDir, "report.md");
  const statusPath = path.join(artifactDir, "status.json");
  const prompt = buildDelegatePrompt(options.role, options.cwd, options.prompt);
  await atomicWriteText(promptPath, prompt);
  await chmod(promptPath, 0o600);

  const fingerprintBefore = roleIsReadOnly(options.role)
    ? await captureTreeFingerprint(options.cwd)
    : undefined;
  const attempts: ChainAttempt[] = [];
  const routes = routesFor(options.role, backend);
  const piInvocation = options.piInvocation ?? resolvePiInvocation();
  let selectedRoute: string | undefined;
  let report = "";
  let finalState: DelegateState = "routes_unavailable";
  let finalProgress = initialProgress(label, options);
  options.onProgress?.(finalProgress);

  for (let index = 0; index < routes.length; index += 1) {
    if (options.signal?.aborted) {
      finalState = "interrupted";
      break;
    }
    const route = routes[index]!;
    const remainingMs = timeoutMs - (performance.now() - started);
    if (remainingMs <= 0) {
      finalState = "timed_out";
      break;
    }

    if (route.kind === "pi") {
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
      const available = await routeIsCatalogued(piInvocation, route, options.cwd, remainingMs, options.signal);
      if (options.signal?.aborted) {
        finalState = "interrupted";
        break;
      }
      if (!available) {
        attempts.push({
          route: routeKey(route),
          state: "catalog_unavailable",
          elapsedSeconds: roundedSeconds(performance.now() - catalogStarted),
        });
        continue;
      }
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
      signal: options.signal,
      timeoutMs: remainingMs,
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
    const attemptStatus = route.kind === "pi"
      ? await supervisePi({ ...common, route, piInvocation })
      : await superviseClaude({ ...common, route, prompt });
    const attempt: ChainAttempt = {
      route: routeKey(route),
      state: attemptStatus.state,
      elapsedSeconds: roundedSeconds(performance.now() - attemptStarted),
      artifactDir: attemptDir,
    };
    attempts.push(attempt);

    if (attemptStatus.state === "completed") {
      selectedRoute = routeKey(route);
      finalState = "completed";
      report = await readPrivateText(attemptStatus.reportPath);
      await atomicWriteText(reportPath, report);
      finalProgress = progressFromStatus(attemptStatus, index + 1);
      break;
    }

    const reason = route.kind === "pi" ? fallbackReason(attemptStatus) : undefined;
    if (reason !== undefined) {
      attempts[attempts.length - 1] = { ...attempt, fallbackReason: reason };
      if (index < routes.length - 1) continue;
      finalState = "routes_unavailable";
      break;
    }

    selectedRoute = routeKey(route);
    finalState = attemptStatus.state;
    if (attemptStatus.reportPresent) {
      report = await readPrivateText(attemptStatus.reportPath);
      await atomicWriteText(reportPath, report);
    }
    finalProgress = progressFromStatus(attemptStatus, index + 1);
    break;
  }

  const fingerprintAfter = roleIsReadOnly(options.role)
    ? await captureTreeFingerprint(options.cwd)
    : undefined;
  if (roleIsReadOnly(options.role) && !fingerprintsEqual(fingerprintBefore, fingerprintAfter)) {
    finalState = "read_only_mutation";
    finalProgress = {
      ...finalProgress,
      state: finalState,
      phase: "complete",
      lastEvent: "tree_fingerprint_changed",
      lastEventAt: new Date().toISOString(),
    };
  }

  const elapsed = roundedSeconds(performance.now() - started);
  const chainStatus = {
    schemaVersion: 1,
    label,
    role: options.role,
    backend,
    state: finalState,
    startedAt,
    endedAt: new Date().toISOString(),
    elapsedSeconds: elapsed,
    selectedRoute,
    attempts,
    reportPath,
    fingerprintBefore,
    fingerprintAfter,
  };
  await atomicWriteJson(statusPath, chainStatus);
  finalProgress = { ...finalProgress, state: finalState, elapsedSeconds: elapsed };
  options.onProgress?.(finalProgress);

  return {
    label,
    role: options.role,
    backend,
    state: finalState,
    report,
    reportPath,
    statusPath,
    artifactDir,
    selectedRoute,
    attempts,
    elapsedSeconds: elapsed,
    progress: finalProgress,
    fingerprintBefore,
    fingerprintAfter,
  };
}

export const DELEGATE_TOOL_OUTPUT_LIMIT = TOOL_OUTPUT_LIMIT;
