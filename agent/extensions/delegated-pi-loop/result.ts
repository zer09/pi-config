import { DELEGATE_TOOL_OUTPUT_LIMIT, removeDirectory, truncateUtf8 } from "./artifacts.ts";
import { writeFailureDiagnosticQuietly } from "./diagnostics.ts";
import type { DelegateRunResult, DelegateToolResultEvent, ToolResult } from "./types.ts";

const HEADER_RESERVE_BYTES = 1024;
const FIELD_LIMIT = 80;

const STATE_SUMMARIES: Readonly<Record<string, string>> = {
  routes_unavailable: "No route in the ordered chain could start the delegate before the shared deadline.",
  stalled: "The delegate stopped emitting accepted activity and was terminated at the event-idle deadline.",
  timed_out: "The delegate exceeded its shared wall deadline and was terminated.",
  output_limit: "The delegate exceeded its output limit and was terminated.",
  blocked: "The delegate ended with DELEGATE_RESULT: BLOCKED.",
  delegate_failed: "The delegate ended with DELEGATE_RESULT: FAILED.",
  invalid_result: "The delegate finished without exactly one valid terminal DELEGATE_RESULT marker.",
  invalid_stream: "The delegate event stream violated the required lifecycle; its result was not accepted.",
  missing_report: "The delegate completed its lifecycle without a final assistant report.",
  child_failed: "The delegate process exited with a non-zero status.",
  spawn_failed: "The delegate process could not be started.",
  interrupted: "The delegate was cancelled before completion.",
};
const FALLBACK_SUMMARY = "The delegate did not reach a terminal supervision state.";

const TERMINAL_MARKER_PATTERN = /[ \t]*DELEGATE_RESULT:[ \t]*COMPLETED[ \t\r\n]*$/;

function bounded(value: string | undefined, limit = FIELD_LIMIT): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= limit ? value : value.slice(0, limit);
}

function safeSummary(state: string): string {
  return STATE_SUMMARIES[state] ?? FALLBACK_SUMMARY;
}

function attemptText(result: DelegateRunResult): string | undefined {
  if (result.attempts.length === 0) return undefined;
  return result.attempts
    .map((attempt) => attempt.fallbackReason === undefined
      ? `${attempt.route} -> ${attempt.state}`
      : `${attempt.route} -> ${attempt.state} (${attempt.fallbackReason})`)
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
    + `route: ${result.selectedRoute ?? "unknown"} · elapsed: ${result.elapsedSeconds.toFixed(1)}s`;
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
    `- backend: ${result.backend}`,
  ];
  if (result.selectedRoute !== undefined) lines.push(`- route: ${result.selectedRoute}`);
  lines.push(`- phase: ${bounded(result.progress.phase) ?? "unknown"}`);
  const lastEvent = bounded(result.progress.lastEvent) ?? "unknown";
  const lastEventDetail = bounded(result.progress.lastEventDetail);
  lines.push(`- last event: ${lastEventDetail === undefined ? lastEvent : `${lastEvent} (${lastEventDetail})`}`);
  lines.push(`- last event at: ${result.progress.lastEventAt}`);
  lines.push(`- elapsed: ${result.elapsedSeconds.toFixed(1)}s`);
  const attempts = attemptText(result);
  if (attempts !== undefined) lines.push(`- attempts: ${attempts}`);
  lines.push("", safeSummary(result.state));
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
      backend: result.backend,
      selectedRoute: result.selectedRoute,
      attempts: result.attempts,
      elapsedSeconds: result.elapsedSeconds,
      progress: result.progress,
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
 * compact failure diagnostic (unsuccessful runs only), assembles the final
 * ToolResult, and removes the temporary supervision artifact directory for
 * every terminal outcome. The finally also runs when diagnostic persistence
 * fails, so a failed write still returns sanitized failure content with no
 * diagnostic path. Directory removal stays best-effort.
 */
export async function finalizeDelegateRun(result: DelegateRunResult): Promise<ToolResult> {
  try {
    const diagnosticPath = result.state === "completed"
      ? undefined
      : await writeFailureDiagnosticQuietly(result);
    return finalToolResult(result, diagnosticPath);
  } finally {
    await removeDirectory(result.artifactDir);
  }
}
