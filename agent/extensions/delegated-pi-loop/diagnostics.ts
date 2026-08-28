import { chmod, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, safeLabel } from "./artifacts.ts";
import { BLOCKED_REASON_CODES, DELEGATE_REASON_UNSPECIFIED, FAILED_REASON_CODES, PROVIDER_FAILURE_CATEGORY_SET } from "./types.ts";
import type { ChainAttempt, DelegateRunResult } from "./types.ts";

/** Schema version for every newly written run-telemetry record (failure and success). Historical schema 3-6 files are never migrated. */
export const SCHEMA_VERSION = 7;
/** Maximum number of exact extension-owned `success-v7-*.json` records retained. */
export const SUCCESS_RECORD_LIMIT = 4096;
/** Exact filename prefix for successful-run schema-7 telemetry records. */
export const SUCCESS_FILE_PREFIX = "success-v7-";

/** Concurrent lstat calls per batch while gathering retention metadata. */
const RETENTION_LSTAT_BATCH_SIZE = 64;

const MAX_ATTEMPTS = 10;
const MAX_STREAM_ERRORS = 20;
const MAX_ERROR_LENGTH = 200;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const DEADLINE_CAUSES = new Set(["idle_deadline", "catalog_preflight"]);
const STALL_CAUSES = new Set([
  "rpc_silent",
  "activity_idle",
  "active_tool_idle",
  "progress_stagnation",
  "repeated_cycle",
  "report_recovery_idle",
]);
const CLEANUP_REASONS = new Set(["group_alive", "close_unconfirmed"]);
const INTERRUPTION_SOURCES = new Set(["delegate_stop", "session_shutdown", "tool_call_abort", "unknown"]);
const DELEGATE_STATES = new Set([
  "catalog_check", "running", "completed", "routes_unavailable", "stalled", "timed_out", "output_limit",
  "blocked", "delegate_failed", "provider_failed", "prompt_rejected", "invalid_result", "invalid_stream",
  "missing_report", "child_failed", "spawn_failed", "cleanup_failed", "interrupted", "catalog_unavailable",
]);
const TERMINAL_REASONS = new Set([...BLOCKED_REASON_CODES, ...FAILED_REASON_CODES, DELEGATE_REASON_UNSPECIFIED]);
const SAFE_ROUTE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}:(?:off|minimal|low|medium|high|xhigh|max)$/;

function boundedIdentifier(value: string | undefined, limit = MAX_ERROR_LENGTH): string | undefined {
  if (value === undefined || !SAFE_IDENTIFIER.test(value)) return undefined;
  return value.length <= limit ? value : value.slice(0, limit);
}

function boundedRoute(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_ROUTE.test(value) ? value : undefined;
}

function finiteNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * Finite non-negative liveness age only: zero survives, negative, NaN, and
 * infinite values fail closed by omission, and invalid data is never
 * silently converted to zero.
 */
function finiteNonNegativeSeconds(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function fixedValue(value: string | undefined, allowed: ReadonlySet<string>): string | undefined {
  return value !== undefined && allowed.has(value) ? value : undefined;
}

function isoTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

/**
 * Bounded attempt selection: histories at or under MAX_ATTEMPTS serialize
 * unchanged; longer histories keep the first MAX_ATTEMPTS - 1 attempts plus
 * the terminal attempt. A long fallback chain's final completion always
 * survives truncation, and the record never exceeds the attempt cap.
 */
function boundedAttemptList(attempts: readonly ChainAttempt[]): readonly ChainAttempt[] {
  if (attempts.length <= MAX_ATTEMPTS) return attempts;
  return [...attempts.slice(0, MAX_ATTEMPTS - 1), attempts[attempts.length - 1]!];
}

/** `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop` */
export function diagnosticsDirectory(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  return path.join(agentDir, "logs", "delegated-pi-loop");
}

/**
 * Sanitized bounded schema-7 run record, shared by failure diagnostics and
 * best-effort successful-run telemetry. Excludes prompts, delegate reports,
 * raw stdout/stderr, tool arguments and results, checkpoint digests and HMAC
 * keys, Git state, credentials, provider bodies, delegate-authored reason
 * text, and every file path. Temporary supervision artifacts are removed by
 * the caller after this record is persisted.
 */
export function schemaSevenRecord(result: DelegateRunResult): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    writtenAt: new Date().toISOString(),
    label: boundedIdentifier(result.label, 80),
    role: boundedIdentifier(result.role, 40),
    state: fixedValue(result.state, DELEGATE_STATES),
    delegateOutcome: fixedValue(result.progress.delegateOutcome, new Set(["completed", "blocked", "failed"])),
    terminalReason: fixedValue(result.progress.terminalReason, TERMINAL_REASONS),
    reasonStatus: fixedValue(result.progress.reasonStatus, new Set(["accepted", "missing", "rejected"])),
    blockedMisuseSuspected: result.progress.blockedMisuseSuspected,
    startedAt: isoTimestamp(result.startedAt),
    endedAt: isoTimestamp(result.endedAt),
    elapsedSeconds: finiteNumber(result.elapsedSeconds),
    selectedRoute: boundedRoute(result.selectedRoute),
    deadlineCause: fixedValue(result.deadlineCause, DEADLINE_CAUSES),
    stallCause: fixedValue(result.stallCause ?? result.progress.stallCause, STALL_CAUSES),
    cleanupFailureReason: fixedValue(result.cleanupFailureReason, CLEANUP_REASONS),
    interruptionSource: fixedValue(result.interruptionSource, INTERRUPTION_SOURCES),
    phase: boundedIdentifier(result.progress.phase, 80),
    lastEvent: boundedIdentifier(result.progress.lastEvent, 80),
    lastEventDetail: boundedIdentifier(result.progress.lastEventDetail, 80),
    lastEventAt: isoTimestamp(result.progress.lastEventAt),
    rpcIdleSeconds: finiteNumber(result.progress.rpcIdleSeconds),
    activityIdleSeconds: finiteNumber(result.progress.activityIdleSeconds),
    progressIdleSeconds: finiteNumber(result.progress.progressIdleSeconds),
    maxProgressIdleSeconds: finiteNonNegativeSeconds(result.progress.maxProgressIdleSeconds),
    activityEventCount: finiteNumber(result.progress.activityEventCount),
    structuralProgressCount: finiteNumber(result.progress.structuralProgressCount),
    duplicateCheckpointCount: finiteNumber(result.progress.duplicateCheckpointCount),
    activityWarningCount: finiteNumber(result.progress.activityWarningCount),
    progressWarningCount: finiteNumber(result.progress.progressWarningCount),
    toolExecutionCount: finiteNumber(result.progress.toolExecutionCount),
    activeToolCount: finiteNumber(result.progress.activeToolCount),
    activeToolName: boundedIdentifier(result.progress.activeToolName, 80),
    activeToolElapsedSeconds: finiteNumber(result.progress.activeToolElapsedSeconds),
    activeToolIdleSeconds: finiteNumber(result.progress.activeToolIdleSeconds),
    restartAfterWorkCount: result.progress.restartAfterWorkCount,
    recoveryAttempted: result.progress.reportNudgeCount === 1,
    reportRecoveryReason: fixedValue(result.progress.reportRecoveryReason, new Set(["missing_report", "invalid_result"])),
    finalRound: result.progress.reportRound,
    providerFailureCategory: fixedValue(result.progress.providerFailureCategory, PROVIDER_FAILURE_CATEGORY_SET),
    attempts: boundedAttemptList(result.attempts).map((attempt) => ({
      route: boundedRoute(attempt.route),
      state: fixedValue(attempt.state, DELEGATE_STATES),
      elapsedSeconds: finiteNumber(attempt.elapsedSeconds),
      deadlineCause: fixedValue(attempt.deadlineCause, DEADLINE_CAUSES),
      stallCause: fixedValue(attempt.stallCause, STALL_CAUSES),
      // Full supervised-attempt liveness evidence (plan §13.2): settled finite
      // values survive on the attempt record; catalog-only attempts omit
      // them and malformed non-finite internals fail closed by omission.
      rpcIdleSeconds: finiteNumber(attempt.rpcIdleSeconds),
      activityIdleSeconds: finiteNumber(attempt.activityIdleSeconds),
      progressIdleSeconds: finiteNumber(attempt.progressIdleSeconds),
      maxProgressIdleSeconds: finiteNonNegativeSeconds(attempt.maxProgressIdleSeconds),
      activityEventCount: finiteNumber(attempt.activityEventCount),
      structuralProgressCount: finiteNumber(attempt.structuralProgressCount),
      duplicateCheckpointCount: finiteNumber(attempt.duplicateCheckpointCount),
      activityWarningCount: finiteNumber(attempt.activityWarningCount),
      progressWarningCount: finiteNumber(attempt.progressWarningCount),
      cleanupFailureReason: fixedValue(attempt.cleanupFailureReason, CLEANUP_REASONS),
      interruptionSource: fixedValue(attempt.interruptionSource, INTERRUPTION_SOURCES),
      activeToolCount: finiteNumber(attempt.activeToolCount),
      activeToolName: boundedIdentifier(attempt.activeToolName, 80),
      activeToolElapsedSeconds: finiteNumber(attempt.activeToolElapsedSeconds),
      activeToolIdleSeconds: finiteNumber(attempt.activeToolIdleSeconds),
      ...(attempt.restartAfterWork === undefined ? {} : { restartAfterWork: attempt.restartAfterWork }),
    })),
    streamErrors: result.streamErrors
      .slice(0, MAX_STREAM_ERRORS)
      .map((error) => boundedIdentifier(error, MAX_ERROR_LENGTH))
      .filter(Boolean),
  };
}

let writeCounter = 0;

/** Failure-specific view of the shared schema-7 record builder; unsuccessful runs only. */
export function failureDiagnostic(result: DelegateRunResult): Record<string, unknown> {
  return schemaSevenRecord(result);
}

/** Writes the failure diagnostic with a 0700 directory and a 0600 atomic file. */
export async function writeFailureDiagnostic(result: DelegateRunResult): Promise<string> {
  if (result.state !== "completed") {
    return writeRunDiagnostic("failure", result);
  }
  throw new Error("failure diagnostics are written only for unsuccessful runs");
}

/**
 * Shared record writer for one terminal run. Both failure and success names
 * stay bounded and carry no prompt or report content.
 */
async function writeRunDiagnostic(kind: "failure" | "success", result: DelegateRunResult): Promise<string> {
  const directory = diagnosticsDirectory();
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  writeCounter += 1;
  const prefix = kind === "success" ? SUCCESS_FILE_PREFIX : "failure-";
  const fileName = `${prefix}${safeLabel(result.label)}-${Date.now()}-${process.pid}-${writeCounter}.json`;
  const filePath = path.join(directory, fileName);
  await atomicWriteJson(filePath, schemaSevenRecord(result));
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

/** True only for exact extension-owned success-telemetry filenames. */
function isSuccessTelemetryName(name: string): boolean {
  return name.startsWith(SUCCESS_FILE_PREFIX) && name.endsWith(".json");
}

/**
 * Serializes telemetry operations inside this extension process: each
 * write-plus-prune pair runs alone, so concurrent finalizations cannot race
 * the retention sweep against each other in-process.
 */
let telemetryChain: Promise<unknown> = Promise.resolve();

function enqueueTelemetry<T>(operation: () => Promise<T>): Promise<T> {
  const next = telemetryChain.then(operation, operation);
  telemetryChain = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Prunes the oldest exact `success-v7-*.json` regular files beyond the
 * retention limit. Never touches failures, historical schema 3-6 files,
 * unknown names, directories, or symlinks: candidates pass a no-follow
 * `lstat` regular-file check immediately before deletion. An `ENOENT` from
 * another local Pi process pruning the same file is ignored; every other
 * error propagates to the best-effort caller. When the exact-name candidate
 * count is at or below the limit the sweep exits before any metadata
 * gathering; otherwise candidate metadata is collected with bounded
 * concurrent `lstat` batches instead of one call per candidate.
 */
async function pruneSuccessTelemetry(directory: string, limit: number): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const exactNames = entries.filter(isSuccessTelemetryName);
  // Early exit: at or under the limit nothing can be pruned and the write
  // already happened, so the sweep performs no lstat work at all.
  if (exactNames.length <= limit) return;
  const candidates: { readonly name: string; readonly writtenAt: number }[] = [];
  for (let start = 0; start < exactNames.length; start += RETENTION_LSTAT_BATCH_SIZE) {
    // Only metadata gathering inside this one sweep is parallel; the
    // write-plus-prune serialization in enqueueTelemetry is unchanged.
    const batch = exactNames.slice(start, start + RETENTION_LSTAT_BATCH_SIZE);
    const infos = await Promise.all(batch.map(async (name) => {
      try {
        // No-follow check: a symlink or directory with a success-looking name
        // is never a pruning candidate, and a vanished file is simply gone.
        return await lstat(path.join(directory, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    }));
    for (let index = 0; index < batch.length; index += 1) {
      const info = infos[index];
      if (info !== undefined && info.isFile()) {
        candidates.push({ name: batch[index]!, writtenAt: info.mtimeMs });
      }
    }
  }
  if (candidates.length <= limit) return;
  // Deterministic order: write time ascending with the filename as the
  // tie-breaker, so the newest `limit` files survive deterministically.
  candidates.sort((left, right) =>
    left.writtenAt - right.writtenAt || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const candidate of candidates.slice(0, candidates.length - limit)) {
    try {
      await rm(path.join(directory, candidate.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

/**
 * Writes one metadata-only schema-7 record for a completed invocation, then
 * prunes to the newest `limit` exact success files. The retention limit is
 * injectable only so tests can exercise pruning without 4,097 physical
 * files; production always passes `SUCCESS_RECORD_LIMIT`.
 */
export async function writeSuccessTelemetry(
  result: DelegateRunResult,
  limit: number = SUCCESS_RECORD_LIMIT,
): Promise<string> {
  if (result.state !== "completed") {
    throw new Error("success telemetry is written only for completed runs");
  }
  return enqueueTelemetry(async () => {
    const filePath = await writeRunDiagnostic("success", result);
    await pruneSuccessTelemetry(path.dirname(filePath), limit);
    return filePath;
  });
}

/**
 * Best-effort successful-run telemetry: a create, write, chmod, or prune
 * failure is swallowed and never changes a completed result into an error.
 */
export async function writeSuccessTelemetryQuietly(result: DelegateRunResult): Promise<void> {
  if (result.state !== "completed") return;
  try {
    await writeSuccessTelemetry(result);
  } catch {
    // Telemetry is observational only; the delegate outcome stands.
  }
}

/** Verifies the on-disk permissions contract; exposed for tests and maintenance. */
export async function diagnosticPermissions(filePath: string): Promise<{ file: number; directory: number }> {
  const fileStat = await stat(filePath);
  const directoryStat = await stat(path.dirname(filePath));
  return { file: fileStat.mode & 0o777, directory: directoryStat.mode & 0o777 };
}
