import { Text } from "@earendil-works/pi-tui";
import type { ToolResult } from "./types.js";

type WebSearchToolName = "web_search" | "fetch_grounding" | "fetch_contents";
type RenderTheme = {
  fg?: (name: string, value: string) => string;
  bold?: (value: string) => string;
};
type RenderContext = { lastComponent?: unknown };
type RenderOptions = { expanded?: boolean; isPartial?: boolean };

const COLLAPSED_RESULT_LINES = 20;
const MAX_CALL_SUMMARY_CHARS = 120;

function reuseText(context?: RenderContext): Text {
  return context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
}

function fg(theme: RenderTheme, name: string, value: string): string {
  return typeof theme.fg === "function" ? theme.fg(name, value) : value;
}

function bold(theme: RenderTheme, value: string): string {
  return typeof theme.bold === "function" ? theme.bold(value) : value;
}

function truncate(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractText(result: ToolResult): string {
  return result.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function colorOutputBlock(value: string, theme: RenderTheme): string {
  return value
    .split("\n")
    .map((line) => (line ? fg(theme, "toolOutput", line) : ""))
    .join("\n");
}

function formatCallSummary(toolName: WebSearchToolName, args: unknown): string {
  const record = asRecord(args);
  if (toolName === "web_search") {
    const query = asString(record.query);
    const mode = asString(record.mode);
    return truncate([query ? `query=${JSON.stringify(query)}` : "", mode ? `mode=${mode}` : ""].filter(Boolean).join(" "), MAX_CALL_SUMMARY_CHARS);
  }

  if (toolName === "fetch_grounding") {
    const responseId = asString(record.responseId);
    const ids = Array.isArray(record.groundingIds) ? record.groundingIds.length : undefined;
    return [responseId ? `responseId=${responseId}` : "", ids !== undefined ? `ids=${ids}` : ""].filter(Boolean).join(" ");
  }

  const urls = Array.isArray(record.uris) ? record.uris.length : undefined;
  const maxCharacters = asNumber(record.maxCharacters);
  return [urls !== undefined ? `urls=${urls}` : "", maxCharacters !== undefined ? `maxChars=${maxCharacters}` : ""]
    .filter(Boolean)
    .join(" ");
}

function resultDetailsSummary(toolName: WebSearchToolName, result: ToolResult): string {
  const details = asRecord(result.details);
  if (toolName === "web_search") {
    const responseId = asString(details.responseId) ?? "unknown";
    const sourceCount = asNumber(details.sourceCount) ?? 0;
    const supportCount = asNumber(details.supportCount) ?? 0;
    const fallback = details.fallbackUsed ? asString(details.fallbackProvider) ?? "unknown" : undefined;
    return [`sources=${sourceCount}`, `supports=${supportCount}`, `responseId=${responseId}`, fallback ? `fallback=${fallback}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  if (toolName === "fetch_grounding") {
    const responseId = asString(details.responseId) ?? "unknown";
    const sources = Array.isArray(details.sources) ? details.sources.length : 0;
    return `${sources} sources for responseId=${responseId}`;
  }

  const results = Array.isArray(details.results) ? details.results : [];
  const cacheHits = results.filter((item) => asRecord(item).fromCache === true).length;
  const chars = results.reduce((sum, item) => sum + (asNumber(asRecord(item).characterCount) ?? 0), 0);
  return `${results.length} URLs, cache hits ${cacheHits}/${results.length}, chars=${chars}`;
}

export function createWebSearchCallRenderer(toolName: WebSearchToolName) {
  return (args: unknown, theme: RenderTheme, context?: RenderContext): Text => {
    const component = reuseText(context);
    const summary = formatCallSummary(toolName, args);
    component.setText(fg(theme, "toolTitle", bold(theme, toolName)) + (summary ? ` ${fg(theme, "accent", summary)}` : ""));
    return component;
  };
}

export function createWebSearchResultRenderer(toolName: WebSearchToolName) {
  return (result: ToolResult, options: RenderOptions, theme: RenderTheme, context?: RenderContext): Text => {
    const component = reuseText(context);
    if (options.isPartial) {
      component.setText(fg(theme, "warning", "running..."));
      return component;
    }

    const output = extractText(result).trimEnd();
    const detailsSummary = resultDetailsSummary(toolName, result);

    if (options.expanded) {
      const detailsLine = detailsSummary ? `\n\n${fg(theme, "dim", `Details: ${detailsSummary}`)}` : "";
      component.setText(fg(theme, "toolOutput", output || `${toolName} completed`) + detailsLine);
      return component;
    }

    const fullOutput = output || `${toolName} completed`;
    const lines = fullOutput.split("\n");
    const shouldCollapse = lines.length > COLLAPSED_RESULT_LINES;
    const visibleLines = shouldCollapse ? lines.slice(0, COLLAPSED_RESULT_LINES) : lines;
    let rendered = colorOutputBlock(visibleLines.join("\n"), theme);
    if (detailsSummary) rendered += fg(theme, "muted", `\nDetails: ${detailsSummary}`);
    if (shouldCollapse) {
      rendered += fg(theme, "muted", `\n... (${lines.length - COLLAPSED_RESULT_LINES} more lines, Ctrl+O/Ctrl+0 to expand)`);
    }
    component.setText(rendered);
    return component;
  };
}
