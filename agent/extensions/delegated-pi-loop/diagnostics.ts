import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, DELEGATE_TOOL_OUTPUT_LIMIT, safeLabel, truncateUtf8 } from "./artifacts.ts";
import { parseDelegateTerminal } from "./monitor.ts";
import { BLOCKED_REASON_CODES, DELEGATE_REASON_UNSPECIFIED, FAILED_REASON_CODES, PROVIDER_FAILURE_CATEGORY_SET } from "./types.ts";
import type { ChainAttempt, DelegateRunResult } from "./types.ts";

/** Schema version for every newly written run-telemetry record (failure and success). Historical schema 3-7 files are never migrated. */
export const SCHEMA_VERSION = 8;
/** Maximum number of exact extension-owned `success-v8-*.json` records retained. */
export const SUCCESS_RECORD_LIMIT = 4096;
/** Exact filename prefix for successful-run schema-8 telemetry records. */
export const SUCCESS_FILE_PREFIX = "success-v8-";

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
 * Sanitized bounded schema-8 run record, shared by failure diagnostics and
 * best-effort successful-run telemetry. Excludes prompts, raw stdout/stderr,
 * tool arguments and results, checkpoint digests and HMAC keys, Git state,
 * credentials, provider bodies, delegate-authored reason text, and every
 * file path. Only the failure view (failureDiagnostic) adds the bounded
 * exact delegate report; successful-run telemetry never carries it.
 * Temporary supervision artifacts are removed by the caller after this
 * record is persisted.
 */
export function schemaEightRecord(result: DelegateRunResult): Record<string, unknown> {
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

/**
 * Recognized terminal tail of a delegate report: an optional exact
 * `DELEGATE_REASON` line directly above the final `DELEGATE_RESULT` line,
 * followed only by whitespace through the end of the report. The reason
 * line may carry the same Unicode whitespace the parser's `line.trim()`
 * and `value.trim()` accept before the marker and around the code, kept
 * line-bounded because `[^\S\n]` is any Unicode whitespace except the
 * line-ending LF. `\s` around the outcome keeps the parser's Unicode
 * whitespace semantics, while `DELEGATE_RESULT` itself must sit directly
 * after its line separator: result-line indentation stays prohibited,
 * matching the parser. The pattern is tail-structural byte extraction
 * only; report-wide eligibility is decided by the shared strict parser
 * at the start of terminalDelegateSuffix, and the captured outcome and
 * reason must agree with that parse before the tail is returned.
 */
const TERMINAL_SUFFIX_PATTERN =
  /(?:^|\r?\n)(?:[^\S\n]*DELEGATE_REASON:[^\S\n]*([a-z][a-z0-9_]*)[^\S\n]*\r?\n)?DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*$/;

/**
 * Exact recognized terminal suffix of a delegate report: the verbatim
 * text from the complete original line separator (a lone LF or a full
 * CRLF) before the terminal `DELEGATE_REASON`/`DELEGATE_RESULT` lines (or
 * the report start) through the absolute end of the report, or undefined
 * for every other tail. Eligibility is the shared strict terminal parser
 * applied to the whole report (parseDelegateTerminal, including its
 * report-wide exactly-one-marker predicate): the suffix survives only
 * for a valid COMPLETED terminal, a BLOCKED or FAILED terminal with an
 * accepted reason, or a BLOCKED or FAILED terminal with a genuinely
 * missing reason (no reason line anywhere in the report). Every other
 * parse yields no outcome or a rejected reason status (unknown,
 * malformed, misplaced, duplicate, or outcome-mismatched reason values,
 * a reason line paired with COMPLETED, or an earlier recognized
 * duplicate result marker), and recognition is rejected so the oversized
 * report keeps the UTF-8-safe whole-report prefix fallback: preserving a
 * tail after cutting the body could otherwise hide the invalid or
 * rejected reason evidence behind one valid-looking terminal. The raw
 * matcher above then extracts only the tail bytes, and its captured
 * outcome and reason code must agree with the parse. Including the
 * complete separator keeps the terminal lines on their own line, with
 * their original CRLF boundary bytes intact, after the body prefix is
 * cut; blank lines above it stay body content.
 */
function terminalDelegateSuffix(report: string): string | undefined {
  // Report-wide eligibility gate: the shared strict parser reads the whole
  // report, so a COMPLETED terminal above a misplaced earlier reason line,
  // a duplicate reason, or a duplicate result marker is rejected exactly
  // as the monitor rejects it, not by a tail-local approximation.
  const terminal = parseDelegateTerminal(report);
  if (terminal.outcome === undefined) return undefined;
  if (
    terminal.outcome !== "completed"
    && terminal.reason?.status !== "accepted"
    && terminal.reason?.status !== "missing"
  ) {
    return undefined;
  }
  const match = TERMINAL_SUFFIX_PATTERN.exec(report);
  if (match === null) return undefined;
  // Byte-exact extraction with parser agreement: the captured outcome must
  // be the parsed outcome, and a captured reason code is allowed only for
  // an accepted parse carrying the same code. Any disagreement rejects
  // recognition and the whole-report prefix fallback applies.
  if (match[2]!.toLowerCase() !== terminal.outcome) return undefined;
  const reason = terminal.reason;
  if (reason?.status === "accepted") {
    if (match[1] !== reason.code) return undefined;
  } else if (match[1] !== undefined) {
    return undefined;
  }
  // Index 0 is the empty `^` branch; otherwise the match starts at the
  // separator's first byte, LF or the CR of a CRLF pair, which all belongs
  // to the suffix so the junction between a cut body prefix and the
  // terminal lines stays an exact original line boundary.
  return report.slice(match.index);
}

/**
 * Failure-only persistence of the exact final delegate report, bounded to
 * DELEGATE_TOOL_OUTPUT_LIMIT. A report within the limit survives
 * byte-for-byte. An oversized report whose whole-report strict parse is a
 * valid COMPLETED terminal, a BLOCKED or FAILED terminal with an accepted
 * reason, or a BLOCKED or FAILED terminal with a genuinely missing reason
 * keeps that parser-recognized terminal suffix verbatim at the end and
 * spends the remaining budget on a UTF-8-safe body prefix; every other
 * oversized report, including one whose parse yields no outcome or a
 * rejected reason status (misplaced, duplicate, malformed, or
 * COMPLETED-paired reason lines, or an earlier recognized duplicate result
 * marker), keeps only a UTF-8-safe prefix of the whole report, as does a
 * recognized suffix that alone exceeds the limit because its trailing
 * whitespace is unbounded. Stored text always stays valid UTF-8 within
 * the limit; `totalBytes` is the original UTF-8 byte count and
 * `truncatedBytes` the omitted bytes. An empty report omits the field.
 */
function failureDelegateReport(result: DelegateRunResult): { text: string; totalBytes: number; truncatedBytes: number } | undefined {
  if (result.report === "") return undefined;
  const totalBytes = Buffer.byteLength(result.report, "utf8");
  const suffix = totalBytes > DELEGATE_TOOL_OUTPUT_LIMIT ? terminalDelegateSuffix(result.report) : undefined;
  // A recognized suffix is not bounded: its trailing whitespace can push it
  // past the limit. A suffix larger than the limit can never fit, so the
  // whole report takes the UTF-8-safe prefix cut instead of a negative body
  // budget being handed to truncateUtf8.
  const suffixBytes = suffix === undefined ? 0 : Buffer.byteLength(suffix, "utf8");
  if (suffix === undefined || suffixBytes > DELEGATE_TOOL_OUTPUT_LIMIT) {
    const { text, truncatedBytes } = truncateUtf8(result.report, DELEGATE_TOOL_OUTPUT_LIMIT);
    return { text, totalBytes, truncatedBytes };
  }
  // Cut only the body: the prefix lands on a whole UTF-8 character and the
  // suffix starts on an ASCII line boundary, so the joined text stays valid
  // UTF-8 and within the limit while the terminal evidence survives intact.
  const body = result.report.slice(0, result.report.length - suffix.length);
  const { text: prefix } = truncateUtf8(body, DELEGATE_TOOL_OUTPUT_LIMIT - suffixBytes);
  const text = `${prefix}${suffix}`;
  return { text, totalBytes, truncatedBytes: totalBytes - Buffer.byteLength(text, "utf8") };
}

/**
 * Failure-specific view of the shared schema-8 record builder for
 * unsuccessful runs only: the sanitized telemetry plus the bounded exact
 * delegate report when one exists.
 */
export function failureDiagnostic(result: DelegateRunResult): Record<string, unknown> {
  const delegateReport = failureDelegateReport(result);
  return { ...schemaEightRecord(result), ...(delegateReport === undefined ? {} : { delegateReport }) };
}

/** Writes the failure diagnostic with a 0700 directory and a 0600 atomic file. */
export async function writeFailureDiagnostic(result: DelegateRunResult): Promise<string> {
  if (result.state !== "completed") {
    return writeRunDiagnostic("failure", result);
  }
  throw new Error("failure diagnostics are written only for unsuccessful runs");
}

/**
 * Shared record writer for one terminal run. The failure name carries the
 * bounded delegate report; both names stay bounded and carry no prompt
 * content.
 */
async function writeRunDiagnostic(kind: "failure" | "success", result: DelegateRunResult): Promise<string> {
  const directory = diagnosticsDirectory();
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  writeCounter += 1;
  const prefix = kind === "success" ? SUCCESS_FILE_PREFIX : "failure-";
  const fileName = `${prefix}${safeLabel(result.label)}-${Date.now()}-${process.pid}-${writeCounter}.json`;
  const filePath = path.join(directory, fileName);
  await atomicWriteJson(filePath, kind === "failure" ? failureDiagnostic(result) : schemaEightRecord(result));
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

/**
 * Label shape `safeLabel` (artifacts.ts) can emit: 1 to 64 characters of
 * `[A-Za-z0-9._-]` whose first character is never `-` or `.`, because the
 * pre-slice `[-.]+` strip always removes a leading punctuation run.
 */
const SAFE_LABEL_SHAPE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
/** One or more ASCII digits: the shape of `Date.now()`, `process.pid`, and the write counter. */
const DIGIT_SEGMENT = /^[0-9]+$/;

/**
 * True only for the complete writer-generated success-telemetry filename
 * shape `success-v8-<label>-<timestamp>-<pid>-<counter>.json` produced by
 * writeRunDiagnostic. `safeLabel` output may itself contain hyphens, so the
 * three numeric segments are anchored from the right: the final three
 * hyphen-separated segments before `.json` must each be one or more ASCII
 * digits, and the label remainder must fit `SAFE_LABEL_SHAPE`. Every other
 * `success-v8-*.json`-looking name (including historical `success-v7-`
 * files) is not writer-owned and is never a pruning candidate; a foreign
 * file that exactly mimics one possible writer output remains
 * indistinguishable by name.
 */
export function isSuccessTelemetryName(name: string): boolean {
  if (!name.startsWith(SUCCESS_FILE_PREFIX) || !name.endsWith(".json")) return false;
  const segments = name.slice(SUCCESS_FILE_PREFIX.length, name.length - ".json".length).split("-");
  // The writer always emits a non-empty label plus three numeric segments.
  if (segments.length < 4) return false;
  const counter = segments.pop()!;
  const pid = segments.pop()!;
  const timestamp = segments.pop()!;
  return DIGIT_SEGMENT.test(timestamp) && DIGIT_SEGMENT.test(pid) && DIGIT_SEGMENT.test(counter)
    && SAFE_LABEL_SHAPE.test(segments.join("-"));
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
 * Test seam: replaceable deletion-check surface (the pre-deletion no-follow
 * `lstat` and the `rm` it guards) so tests can simulate a same-user process
 * replacing a retention candidate between batched validation and deletion;
 * production always keeps the real calls.
 */
export const retentionProbes: {
  lstat: (filePath: string) => Promise<Stats>;
  rm: (filePath: string) => Promise<void>;
} = {
  lstat: (filePath) => lstat(filePath),
  rm: (filePath) => rm(filePath),
};

/**
 * Prunes the oldest exact `success-v8-*.json` regular files beyond the
 * retention limit. Never touches failures, historical schema 3-7 success
 * files, unknown names, directories, or symlinks: candidates pass a no-follow
 * `lstat` regular-file check immediately before deletion, and deletion is
 * bound to the batched entry's `dev`/`ino` identity as re-verified by a
 * final no-follow `lstat` immediately before the `rm`. This narrows the
 * replacement window to the interval between that final check and the
 * `rm` itself; a replacement landing inside that window is still deleted,
 * because pathname-based fs APIs cannot eliminate it. That window is
 * inherent to the plan's prescribed lstat-then-deletion mechanism (plan
 * section 7.4 rule 3), and the designed writer population only ever creates
 * uniquely named new records and prunes, never replaces existing names.
 * An `ENOENT` from another local Pi process pruning the same file is
 * ignored, and a final-check `lstat` error of any kind skips that
 * candidate; a non-`ENOENT` deletion error propagates to the best-effort
 * caller. When the exact-name candidate count is at or below the limit the
 * sweep exits before any metadata gathering; otherwise candidate metadata
 * is collected with bounded concurrent `lstat` batches instead of one call
 * per candidate.
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
  const candidates: { readonly name: string; readonly writtenAt: number; readonly dev: number; readonly ino: number }[] = [];
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
        candidates.push({ name: batch[index]!, writtenAt: info.mtimeMs, dev: info.dev, ino: info.ino });
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
      const fresh = await retentionProbes.lstat(path.join(directory, candidate.name));
      // Bind deletion to the validated entry: a replacement with a different
      // dev/ino, or any non-regular replacement (symlink, directory), that
      // landed before this check is skipped. A replacement landing between
      // this check and the awaited `rm` below still falls inside the window
      // inherent to the plan's lstat-then-deletion mechanism (section 7.4
      // rule 3), which pathname-based fs APIs cannot close.
      if (!fresh.isFile() || fresh.dev !== candidate.dev || fresh.ino !== candidate.ino) continue;
    } catch {
      // Skip-and-continue best-effort (ENOENT included): the final check
      // cannot alter the delegate result, so one bad entry must not abort
      // the sweep.
      continue;
    }
    try {
      await retentionProbes.rm(path.join(directory, candidate.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

/**
 * Writes one metadata-only schema-8 record for a completed invocation, then
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
