import { chmod, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, safeLabel } from "./artifacts.ts";
import { BLOCKED_REASON_CODES, DELEGATE_REASON_UNSPECIFIED, FAILED_REASON_CODES, PROVIDER_FAILURE_CATEGORY_SET } from "./types.ts";
import type { DelegateRunResult } from "./types.ts";

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

function fixedValue(value: string | undefined, allowed: ReadonlySet<string>): string | undefined {
  return value !== undefined && allowed.has(value) ? value : undefined;
}

function isoTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

/** `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop` */
export function diagnosticsDirectory(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  return path.join(agentDir, "logs", "delegated-pi-loop");
}

/**
 * Sanitized bounded failure record. Excludes prompts, delegate reports, raw
 * stdout/stderr, tool arguments and results, checkpoint digests and HMAC
 * keys, Git state, credentials, provider bodies, delegate-authored reason
 * text, and every file path. Temporary supervision artifacts are removed by
 * the caller after this record is persisted.
 */
export function failureDiagnostic(result: DelegateRunResult): Record<string, unknown> {
  return {
    schemaVersion: 6,
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
    attempts: result.attempts.slice(0, MAX_ATTEMPTS).map((attempt) => ({
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
