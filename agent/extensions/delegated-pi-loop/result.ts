import { DELEGATE_TOOL_OUTPUT_LIMIT, removeDirectory, truncateUtf8 } from "./artifacts.ts";
import { writeFailureDiagnosticQuietly, writeSuccessTelemetryQuietly } from "./diagnostics.ts";
import { PROVIDER_FAILURE_CATEGORIES } from "./types.ts";
import type { ChainAttempt, DelegateProgress, DelegateRunResult, DelegateToolResultEvent, ToolResult } from "./types.ts";

const HEADER_RESERVE_BYTES = 1024;
const FIELD_LIMIT = 80;

const STATE_SUMMARIES: Readonly<Record<string, string>> = {
  routes_unavailable: "No route in the ordered chain could complete the delegate.",
  stalled: "The delegate stopped producing required liveness evidence and was terminated.",
  timed_out: "The catalog preflight child exceeded its fixed 15-second cap and was terminated.",
  output_limit: "The delegate exceeded its output limit and was terminated.",
  blocked: "The delegate ended with DELEGATE_RESULT: BLOCKED.",
  delegate_failed: "The delegate ended with DELEGATE_RESULT: FAILED.",
  provider_failed: "The selected provider failed during the delegate session.",
  prompt_rejected: "The child rejected the RPC prompt command before accepting the report round.",
  invalid_result: "The delegate finished without exactly one valid terminal DELEGATE_RESULT marker.",
  invalid_stream: "The delegate event stream violated the required lifecycle; its result was not accepted.",
  missing_report: "The delegate completed its lifecycle without a final assistant report.",
  child_failed: "The delegate process exited with a non-zero status.",
  spawn_failed: "The delegate process could not be started.",
  cleanup_failed: "The delegate process group could not be proven dead, so the chain stopped without fallback.",
  interrupted: "The delegate was cancelled before completion.",
};
const FALLBACK_SUMMARY = "The delegate did not reach a terminal supervision state.";

/** Fixed cause-aware summaries for liveness stalls; never report text. */
const STALL_CAUSE_SUMMARIES: Readonly<Record<string, string>> = {
  rpc_silent: "No valid RPC record arrived from the child within the activity-idle interval.",
  activity_idle: "The child kept communicating but produced no accepted task activity within the activity-idle interval.",
  active_tool_idle: "An executing tool produced no novel update within the activity-idle interval.",
  progress_stagnation: "The delegate produced no novel completed structural checkpoint within the renewable progress lease.",
  repeated_cycle: "The delegate repeated already-seen structural checkpoints without novel progress until the progress lease expired.",
  report_recovery_idle: "The report-recovery round went silent within its fixed five-minute idle lease.",
};
const STALL_CAUSE_CODES = [
  "rpc_silent",
  "activity_idle",
  "active_tool_idle",
  "progress_stagnation",
  "repeated_cycle",
  "report_recovery_idle",
] as const;

/** Fixed actionable summaries for accepted terminal reason codes; never report text. */
const REASON_SUMMARIES: Readonly<Record<string, string>> = {
  evidence_inaccessible: "The delegate could not access evidence the assignment required.",
  user_decision_required: "The delegate stopped because a user decision is required.",
  assignment_conflict: "The assignment conflicts with itself or with project rules.",
  policy_restriction: "A policy restriction prevents the assigned work.",
  budget_exhausted: "The attempt budget was exhausted before a required result was available.",
  external_dependency: "An external dependency is unavailable.",
  finding_reported: "A finding should have been returned with DELEGATE_RESULT: COMPLETED; reviews with findings must use COMPLETED, never BLOCKED.",
  execution_failure: "Executing the assigned work failed.",
  verification_failure: "A required verification did not pass.",
  internal_inconsistency: "The result contradicts itself or the observed state.",
  policy_violation: "A policy rule was violated during execution.",
};
const REASON_MISSING_SUMMARY = "No terminal reason code was provided; the outcome stands.";
const REASON_REJECTED_SUMMARY = "The terminal reason line was invalid and was discarded; the outcome stands.";

const TERMINAL_MARKER_PATTERN = /[ \t]*DELEGATE_RESULT:[ \t]*COMPLETED[ \t\r\n]*$/;

function bounded(value: string | undefined, limit = FIELD_LIMIT): string | undefined {
  if (value === undefined || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) return undefined;
  return value.length <= limit ? value : value.slice(0, limit);
}

function safeRoute(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}:(?:off|minimal|low|medium|high|xhigh|max)$/.test(value)
    ? value
    : undefined;
}

function fixed(value: string | undefined, allowed: readonly string[]): string | undefined {
  return value !== undefined && allowed.includes(value) ? value : undefined;
}

/** Finite numbers only: a malformed internal non-finite value fails closed by omission. */
function finite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * Finite non-negative liveness age only: zero survives, negative, NaN, and
 * infinite values fail closed by omission, never by conversion to zero.
 */
function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
    ? value
    : "unknown";
}

function sanitizedProgress(progress: DelegateProgress): DelegateProgress {
  return {
    ...progress,
    route: safeRoute(progress.route),
    phase: bounded(progress.phase) ?? "unknown",
    lastEvent: bounded(progress.lastEvent) ?? "unknown",
    lastEventDetail: bounded(progress.lastEventDetail),
    lastEventAt: safeTimestamp(progress.lastEventAt),
    activeToolName: bounded(progress.activeToolName),
    deadlineCause: fixed(progress.deadlineCause, ["idle_deadline", "catalog_preflight"]) as DelegateProgress["deadlineCause"],
    stallCause: fixed(progress.stallCause, STALL_CAUSE_CODES) as DelegateProgress["stallCause"],
    leaseWarning: fixed(progress.leaseWarning, ["activity", "progress"]) as DelegateProgress["leaseWarning"],
    cleanupFailureReason: fixed(progress.cleanupFailureReason, ["group_alive", "close_unconfirmed"]) as DelegateProgress["cleanupFailureReason"],
    interruptionSource: fixed(progress.interruptionSource, ["delegate_stop", "session_shutdown", "tool_call_abort", "unknown"]) as DelegateProgress["interruptionSource"],
    // The provider category is a fixed enum on every model-visible surface;
    // an invalid value fails closed by omission, never by passthrough.
    providerFailureCategory: fixed(progress.providerFailureCategory, PROVIDER_FAILURE_CATEGORIES) as DelegateProgress["providerFailureCategory"],
    // The maximum gap is a bounded liveness age: negative, NaN, and infinite
    // values fail closed by omission; zero is a valid measurement.
    maxProgressIdleSeconds: finiteNonNegative(progress.maxProgressIdleSeconds),
  };
}

function sanitizedAttempts(attempts: readonly ChainAttempt[]): readonly ChainAttempt[] {
  return attempts.map((attempt) => {
    const activeToolName = bounded(attempt.activeToolName);
    const deadlineCause = fixed(attempt.deadlineCause, ["idle_deadline", "catalog_preflight"]) as ChainAttempt["deadlineCause"];
    const stallCause = fixed(attempt.stallCause, STALL_CAUSE_CODES) as ChainAttempt["stallCause"];
    const cleanupFailureReason = fixed(attempt.cleanupFailureReason, ["group_alive", "close_unconfirmed"]) as ChainAttempt["cleanupFailureReason"];
    const interruptionSource = fixed(attempt.interruptionSource, ["delegate_stop", "session_shutdown", "tool_call_abort", "unknown"]) as ChainAttempt["interruptionSource"];
    // Supervised liveness evidence survives fallback: every §13.2 field that
    // settled finite on the attempt travels on; unavailable, catalog-only,
    // or non-finite values stay omitted instead of being fabricated.
    const supervised = {
      rpcIdleSeconds: finite(attempt.rpcIdleSeconds),
      activityIdleSeconds: finite(attempt.activityIdleSeconds),
      progressIdleSeconds: finite(attempt.progressIdleSeconds),
      maxProgressIdleSeconds: finiteNonNegative(attempt.maxProgressIdleSeconds),
      activityEventCount: finite(attempt.activityEventCount),
      structuralProgressCount: finite(attempt.structuralProgressCount),
      duplicateCheckpointCount: finite(attempt.duplicateCheckpointCount),
      activityWarningCount: finite(attempt.activityWarningCount),
      progressWarningCount: finite(attempt.progressWarningCount),
      activeToolIdleSeconds: finite(attempt.activeToolIdleSeconds),
    };
    return {
      route: safeRoute(attempt.route) ?? "unknown/unknown:off",
      state: attempt.state,
      elapsedSeconds: attempt.elapsedSeconds,
      ...(attempt.restartAfterWork === undefined ? {} : { restartAfterWork: attempt.restartAfterWork }),
      ...(supervised.rpcIdleSeconds === undefined ? {} : { rpcIdleSeconds: supervised.rpcIdleSeconds }),
      ...(supervised.activityIdleSeconds === undefined ? {} : { activityIdleSeconds: supervised.activityIdleSeconds }),
      ...(supervised.progressIdleSeconds === undefined ? {} : { progressIdleSeconds: supervised.progressIdleSeconds }),
      ...(supervised.maxProgressIdleSeconds === undefined ? {} : { maxProgressIdleSeconds: supervised.maxProgressIdleSeconds }),
      ...(supervised.activityEventCount === undefined ? {} : { activityEventCount: supervised.activityEventCount }),
      ...(supervised.structuralProgressCount === undefined ? {} : { structuralProgressCount: supervised.structuralProgressCount }),
      ...(supervised.duplicateCheckpointCount === undefined ? {} : { duplicateCheckpointCount: supervised.duplicateCheckpointCount }),
      ...(supervised.activityWarningCount === undefined ? {} : { activityWarningCount: supervised.activityWarningCount }),
      ...(supervised.progressWarningCount === undefined ? {} : { progressWarningCount: supervised.progressWarningCount }),
      ...(attempt.activeToolCount === undefined ? {} : { activeToolCount: attempt.activeToolCount }),
      ...(attempt.activeToolElapsedSeconds === undefined ? {} : { activeToolElapsedSeconds: attempt.activeToolElapsedSeconds }),
      ...(supervised.activeToolIdleSeconds === undefined ? {} : { activeToolIdleSeconds: supervised.activeToolIdleSeconds }),
      ...(activeToolName === undefined ? {} : { activeToolName }),
      ...(deadlineCause === undefined ? {} : { deadlineCause }),
      ...(stallCause === undefined ? {} : { stallCause }),
      ...(cleanupFailureReason === undefined ? {} : { cleanupFailureReason }),
      ...(interruptionSource === undefined ? {} : { interruptionSource }),
    };
  });
}

function safeSummary(state: string): string {
  return STATE_SUMMARIES[state] ?? FALLBACK_SUMMARY;
}

/**
 * Fixed model-visible reason bullet for a non-completed terminal outcome.
 * Shows only the accepted enum code or the fixed unspecified label for a
 * missing or rejected reason; raw delegate-authored reason text never
 * reaches this surface.
 */
function terminalReasonBullet(reason: string | undefined, status: string | undefined): string | undefined {
  if (reason === undefined || status === undefined) return undefined;
  if (status === "accepted" && reason !== "unspecified") return `- terminal reason: ${reason}`;
  if (status === "rejected") return "- terminal reason: unspecified (rejected)";
  return "- terminal reason: unspecified (missing)";
}

/** Fixed actionable reason summary; never carries report or reason text. */
function terminalReasonSummary(reason: string | undefined, status: string | undefined): string | undefined {
  if (reason === undefined || status === undefined) return undefined;
  if (status === "accepted" && reason !== "unspecified") return REASON_SUMMARIES[reason] ?? undefined;
  if (status === "rejected") return REASON_REJECTED_SUMMARY;
  return REASON_MISSING_SUMMARY;
}

function attemptText(result: DelegateRunResult): string | undefined {
  if (result.attempts.length === 0) return undefined;
  return result.attempts
    .map((attempt) => attempt.restartAfterWork === true
      ? `${safeRoute(attempt.route) ?? "unknown"} -> ${attempt.state} (restart after work)`
      : `${safeRoute(attempt.route) ?? "unknown"} -> ${attempt.state}`)
    .join("; ");
}

/**
 * Strips the terminal DELEGATE_RESULT: COMPLETED marker that the supervisor
 * already validated. Keeps the report Markdown intact above the marker.
 */
export function stripCompletedMarker(body: string): string {
  return body.replace(TERMINAL_MARKER_PATTERN, "").trimEnd();
}

/**
 * Model-visible Markdown for a successful run: a minimal status header
 * followed by the delegate's final Markdown body. Contains no artifact,
 * report, status, or diagnostic paths.
 */
export function completedMarkdown(result: DelegateRunResult): string {
  const body = stripCompletedMarker(result.report.trim());
  const header = `## Delegate ${result.label} completed\n\n`
    + `route: ${safeRoute(result.selectedRoute) ?? "unknown"} · elapsed: ${result.elapsedSeconds.toFixed(1)}s`;
  if (!body) return `${header}\n\n(No report body beyond the terminal marker.)`;
  const { text, truncatedBytes } = truncateUtf8(body, DELEGATE_TOOL_OUTPUT_LIMIT - HEADER_RESERVE_BYTES);
  const truncation = truncatedBytes > 0 ? `\n\n[Report truncated: ${truncatedBytes} bytes omitted.]` : "";
  return `${header}\n\n${text}${truncation}`;
}

/**
 * Model-visible Markdown for an unsuccessful run: a compact sanitized status
 * header and fields the parent can act on without reading any diagnostics.
 * Never includes the report, raw output, prompts, or any file paths.
 */
export function failureMarkdown(result: DelegateRunResult): string {
  const lines = [
    `## Delegate ${result.label} failed: ${result.state}`,
    "",
    `- state: ${result.state}`,
    `- role: ${result.role}`,
  ];
  const selectedRoute = safeRoute(result.selectedRoute);
  if (selectedRoute !== undefined) lines.push(`- route: ${selectedRoute}`);
  if (result.progress.restartAfterWorkCount > 0) {
    lines.push(`- restarts after work: ${result.progress.restartAfterWorkCount}`);
  }
  lines.push(`- phase: ${bounded(result.progress.phase) ?? "unknown"}`);
  const lastEvent = bounded(result.progress.lastEvent) ?? "unknown";
  const lastEventDetail = bounded(result.progress.lastEventDetail);
  lines.push(`- last event: ${lastEventDetail === undefined ? lastEvent : `${lastEvent} (${lastEventDetail})`}`);
  lines.push(`- last event at: ${safeTimestamp(result.progress.lastEventAt)}`);
  lines.push(`- elapsed: ${result.elapsedSeconds.toFixed(1)}s`);
  const deadlineCause = fixed(result.deadlineCause, ["idle_deadline", "catalog_preflight"]);
  const stallCause = fixed(result.stallCause ?? result.progress.stallCause, STALL_CAUSE_CODES);
  const cleanupFailureReason = fixed(result.cleanupFailureReason, ["group_alive", "close_unconfirmed"]);
  const interruption = fixed(result.interruptionSource, ["delegate_stop", "session_shutdown", "tool_call_abort", "unknown"]);
  if (deadlineCause !== undefined) lines.push(`- deadline cause: ${deadlineCause}`);
  if (stallCause !== undefined) lines.push(`- stall cause: ${stallCause}`);
  if (cleanupFailureReason !== undefined) lines.push(`- cleanup failure: ${cleanupFailureReason}`);
  if (interruption !== undefined) lines.push(`- interruption source: ${interruption}`);
  if ((result.progress.activeToolCount ?? 0) > 0) {
    lines.push(`- active tools: ${result.progress.activeToolCount}`);
    const toolName = bounded(result.progress.activeToolName);
    if (toolName !== undefined) lines.push(`- active tool: ${toolName}`);
    if (result.progress.activeToolElapsedSeconds !== undefined) {
      lines.push(`- active tool elapsed: ${result.progress.activeToolElapsedSeconds.toFixed(1)}s`);
    }
  }
  const attempts = attemptText(result);
  if (attempts !== undefined) lines.push(`- attempts: ${attempts}`);
  const reasonBullet = terminalReasonBullet(result.terminalReason, result.reasonStatus);
  if (reasonBullet !== undefined) lines.push(reasonBullet);
  const stallSummary = stallCause === undefined ? undefined : STALL_CAUSE_SUMMARIES[stallCause];
  const summary = safeSummary(result.state);
  const reasonSummary = terminalReasonSummary(result.terminalReason, result.reasonStatus);
  const summaryText = reasonSummary === undefined ? summary : `${summary}\n${reasonSummary}`;
  lines.push("", stallSummary === undefined ? summaryText : `${summaryText}\n${stallSummary}`);
  return lines.join("\n");
}

/**
 * Builds the final ToolResult envelope: raw Markdown in content[0].text and
 * renderer metadata in details. The diagnostic path travels only in details
 * for the TUI renderer, never in model-visible content.
 */
export function finalToolResult(result: DelegateRunResult, diagnosticPath?: string): ToolResult {
  const completed = result.state === "completed";
  return {
    content: [{
      type: "text",
      text: completed ? completedMarkdown(result) : failureMarkdown(result),
    }],
    details: {
      state: result.state,
      role: result.role,
      selectedRoute: safeRoute(result.selectedRoute),
      attempts: sanitizedAttempts(result.attempts),
      elapsedSeconds: result.elapsedSeconds,
      progress: sanitizedProgress(result.progress),
      restartAfterWorkCount: result.progress.restartAfterWorkCount,
      reportNudgeCount: result.progress.reportNudgeCount,
      reportRecoveryReason: result.progress.reportRecoveryReason,
      reportRound: result.progress.reportRound,
      // Fixed enum only: invalid provider categories are omitted, not passed through.
      providerFailureCategory: fixed(result.progress.providerFailureCategory, PROVIDER_FAILURE_CATEGORIES),
      deadlineCause: fixed(result.deadlineCause, ["idle_deadline", "catalog_preflight"]),
      stallCause: fixed(result.stallCause ?? result.progress.stallCause, STALL_CAUSE_CODES),
      cleanupFailureReason: fixed(result.cleanupFailureReason, ["group_alive", "close_unconfirmed"]),
      interruptionSource: fixed(result.interruptionSource, ["delegate_stop", "session_shutdown", "tool_call_abort", "unknown"]),
      activeToolCount: result.progress.activeToolCount,
      activeToolName: bounded(result.progress.activeToolName),
      activeToolElapsedSeconds: result.progress.activeToolElapsedSeconds,
      delegateOutcome: result.delegateOutcome,
      terminalReason: result.terminalReason,
      reasonStatus: result.reasonStatus,
      blockedMisuseSuspected: result.blockedMisuseSuspected,
      ...(diagnosticPath === undefined ? {} : { diagnosticPath }),
    },
  };
}

/**
 * Native tool_result lifecycle patch: marks an unsuccessful delegate_run
 * result as a Pi tool error while preserving its content and details.
 */
export function delegateToolResultPatch(
  event: Pick<DelegateToolResultEvent, "toolName" | "details">,
): { isError: true } | undefined {
  if (event.toolName !== "delegate_run") return undefined;
  if (typeof event.details !== "object" || event.details === null) return undefined;
  const state = (event.details as Record<string, unknown>).state;
  if (typeof state !== "string" || state === "completed") return undefined;
  return { isError: true };
}

/**
 * One-line TUI footer for unsuccessful results. Rendered by render.ts only;
 * the diagnostic path never enters model-visible tool content.
 */
export function diagnosticLine(diagnosticPath: string): string {
  return `diagnostic log: ${diagnosticPath}`;
}

/**
 * Execute-level finalization for one terminal delegate run. Persists the
 * compact schema-8 run telemetry: the private failure diagnostic for
 * unsuccessful runs (path travels only in ToolResult details for the TUI
 * renderer) and one best-effort metadata-only success record for completed
 * runs (never model-visible and never in ToolResult content or details).
 * Then assembles the final ToolResult and removes the temporary supervision
 * artifact directory for every terminal outcome. The finally also runs when
 * telemetry persistence fails, so a failed write still returns sanitized
 * content with no diagnostic path. Directory removal stays best-effort.
 */
export async function finalizeDelegateRun(result: DelegateRunResult): Promise<ToolResult> {
  try {
    let diagnosticPath: string | undefined;
    if (result.state === "completed") {
      // Best-effort success telemetry: failures never alter the completed
      // outcome and never expose any path to the model or ToolResult.
      await writeSuccessTelemetryQuietly(result);
    } else {
      diagnosticPath = await writeFailureDiagnosticQuietly(result);
    }
    return finalToolResult(result, diagnosticPath);
  } finally {
    await removeDirectory(result.artifactDir);
  }
}
