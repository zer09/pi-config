/**
 * Shared TUI renderers for CodeGraph Pi tools.
 *
 * Pi only toggles `expanded`; custom tools must render compact vs full output
 * themselves. These helpers give every CodeGraph tool the standard Ctrl+O
 * collapse/expand behavior while keeping each tool's execution logic focused on
 * CodeGraph queries.
 */

import { keyText, type Theme, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ToolDefinition, ToolRenderContext, ToolResult } from "./types.ts";

const COLLAPSED_RESULT_LINES = 20;
const MAX_CALL_SUMMARY_CHARS = 480;
const CALL_ARG_PRIORITY = [
  "query",
  "symbol",
  "file",
  "path",
  "pattern",
  "kind",
  "format",
  "language",
  "errorsOnly",
  "includeStats",
  "includeMetadata",
  "symbolsOnly",
  "includeCode",
  "offset",
  "limit",
  "maxNodes",
  "maxDepth",
  "depth",
  "projectPath",
] as const;

/**
 * Register a CodeGraph tool with shared compact/expanded TUI rendering.
 *
 * @param pi - Pi extension API.
 * @param tool - CodeGraph tool definition.
 * @returns Nothing.
 */
export function registerCodeGraphTool<Params extends object>(pi: ExtensionAPI, tool: ToolDefinition<Params>): void {
  pi.registerTool({
    ...tool,
    renderCall: tool.renderCall ?? ((args, theme, context) => renderCodeGraphCall(tool.label, args, theme, context)),
    renderResult: tool.renderResult ?? renderCodeGraphResult,
  });
}

function renderCodeGraphCall<Params extends object>(
  toolLabel: string,
  args: Params | undefined,
  theme: Theme,
  context: ToolRenderContext<unknown, Params>,
): Text {
  const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  const summary = formatCallSummary(args);
  text.setText(
    theme.fg("toolTitle", theme.bold(toolLabel)) +
      (summary ? ` ${theme.fg("accent", summary)}` : ""),
  );
  return text;
}

function renderCodeGraphResult(
  result: ToolResult,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: ToolRenderContext,
): Text {
  const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  const output = getTextOutput(result).trimEnd();
  if (!output) {
    text.setText("");
    return text;
  }

  const lines = output.split("\n");
  const shouldCollapse = !options.expanded && !options.isPartial && lines.length > COLLAPSED_RESULT_LINES;
  const visibleLines = shouldCollapse ? lines.slice(0, COLLAPSED_RESULT_LINES) : lines;
  let rendered = colorToolOutput(visibleLines.join("\n"), theme);

  if (shouldCollapse) {
    rendered +=
      theme.fg("muted", `\n... (${lines.length - COLLAPSED_RESULT_LINES} more lines, `) +
      expandKeyHint(theme, "to expand") +
      theme.fg("muted", ")");
  } else if (options.expanded && !options.isPartial && lines.length > COLLAPSED_RESULT_LINES) {
    rendered += `\n${expandKeyHint(theme, "to collapse")}`;
  }

  text.setText(rendered);
  return text;
}

function expandKeyHint(theme: Theme, description: string): string {
  const key = keyText("app.tools.expand") || "ctrl+o";
  return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}

function getTextOutput(result: ToolResult): string {
  return result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function colorToolOutput(value: string, theme: Theme): string {
  return value
    .split("\n")
    .map((line) => line ? theme.fg("toolOutput", line) : "")
    .join("\n");
}

function formatCallSummary(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of CALL_ARG_PRIORITY) {
    const part = formatArg(key, record[key]);
    if (!part) continue;
    parts.push(part);
  }

  if (parts.length === 0) {
    for (const [key, value] of Object.entries(record)) {
      const part = formatArg(key, value);
      if (!part) continue;
      parts.push(part);
      if (parts.length >= 3) break;
    }
  }

  return truncateSummary(parts.join(" "));
}

function formatArg(key: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return `${key}=${JSON.stringify(value)}`;
  if (typeof value === "number" || typeof value === "boolean") return `${key}=${String(value)}`;
  return undefined;
}

function truncateSummary(value: string): string {
  if (value.length <= MAX_CALL_SUMMARY_CHARS) return value;
  return `${value.slice(0, MAX_CALL_SUMMARY_CHARS - 1)}…`;
}
