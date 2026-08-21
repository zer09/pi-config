import { chmod, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, safeLabel } from "./artifacts.ts";
import type { DelegateRunResult } from "./types.ts";

const MAX_ATTEMPTS = 10;
const MAX_STREAM_ERRORS = 20;
const MAX_ERROR_LENGTH = 200;

function boundedText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= MAX_ERROR_LENGTH ? value : value.slice(0, MAX_ERROR_LENGTH);
}

/** `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop` */
export function diagnosticsDirectory(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  return path.join(agentDir, "logs", "delegated-pi-loop");
}

/**
 * Sanitized bounded failure record. Excludes prompts, delegate reports, raw
 * stdout/stderr, tool arguments and results, Git status and fingerprints,
 * credentials, provider bodies, and every file path. Temporary supervision
 * artifacts are removed by the caller after this record is persisted.
 */
export function failureDiagnostic(result: DelegateRunResult): Record<string, unknown> {
  return {
    schemaVersion: 1,
    writtenAt: new Date().toISOString(),
    label: result.label,
    role: result.role,
    backend: result.backend,
    state: result.state,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    elapsedSeconds: result.elapsedSeconds,
    selectedRoute: result.selectedRoute,
    phase: result.progress.phase,
    lastEvent: result.progress.lastEvent,
    lastEventDetail: result.progress.lastEventDetail,
    lastEventAt: result.progress.lastEventAt,
    idleSeconds: result.progress.idleSeconds,
    toolExecutionCount: result.progress.toolExecutionCount,
    idleWarningCount: result.progress.idleWarningCount,
    attempts: result.attempts.slice(0, MAX_ATTEMPTS).map((attempt) => ({
      route: attempt.route,
      state: attempt.state,
      elapsedSeconds: attempt.elapsedSeconds,
      ...(attempt.fallbackReason === undefined ? {} : { fallbackReason: attempt.fallbackReason }),
    })),
    streamErrors: result.streamErrors.slice(0, MAX_STREAM_ERRORS).map(boundedText).filter(Boolean),
  };
}

let writeCounter = 0;

/** Writes the failure diagnostic with a 0700 directory and a 0600 atomic file. */
export async function writeFailureDiagnostic(result: DelegateRunResult): Promise<string> {
  if (result.state === "completed") {
    throw new Error("failure diagnostics are written only for unsuccessful runs");
  }
  const directory = diagnosticsDirectory();
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  writeCounter += 1;
  const fileName = `failure-${safeLabel(result.label)}-${Date.now()}-${process.pid}-${writeCounter}.json`;
  const filePath = path.join(directory, fileName);
  await atomicWriteJson(filePath, failureDiagnostic(result));
  return filePath;
}

/**
 * Never lets a diagnostic write failure mask the delegate outcome. Returns
 * undefined when the diagnostic could not be persisted.
 */
export async function writeFailureDiagnosticQuietly(result: DelegateRunResult): Promise<string | undefined> {
  try {
    return await writeFailureDiagnostic(result);
  } catch {
    return undefined;
  }
}

/** Verifies the on-disk permissions contract; exposed for tests and maintenance. */
export async function diagnosticPermissions(filePath: string): Promise<{ file: number; directory: number }> {
  const fileStat = await stat(filePath);
  const directoryStat = await stat(path.dirname(filePath));
  return { file: fileStat.mode & 0o777, directory: directoryStat.mode & 0o777 };
}
