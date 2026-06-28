import type { Component, PiRenderContext, PiRenderTheme, ToolResult } from "./types.js";

const ANSI_ESCAPE_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]_][\s\S]*?(?:\x07|\x1b\\)/y;

function nextAnsiEscape(text: string, index: number): string | null {
  ANSI_ESCAPE_RE.lastIndex = index;
  const match = ANSI_ESCAPE_RE.exec(text);
  return match && match.index === index ? match[0] : null;
}

export function truncateAnsiLine(line: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let out = "";
  let visible = 0;
  for (let i = 0; i < line.length;) {
    const escape = nextAnsiEscape(line, i);
    if (escape) {
      out += escape;
      i += escape.length;
      continue;
    }

    const codePoint = line.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const width = codePoint >= 0x1100 ? 2 : 1;
    if (visible + width > maxWidth) return out;
    out += char;
    visible += width;
    i += char.length;
  }
  return out;
}

function wrapPlainLine(line: string, width: number): string[] {
  if (width <= 0) return [""];
  if (line.length <= width) return [line];
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += width) chunks.push(line.slice(i, i + width));
  return chunks.length > 0 ? chunks : [""];
}

export class LeanTextComponent implements Component {
  constructor(
    private text = "",
    private readonly mode: "line" | "block" = "line",
  ) {}

  setText(text: string): void {
    this.text = text;
  }

  invalidate(): void {
    // Stateless; no cached render to clear.
  }

  render(width: number): string[] {
    if (!this.text || this.text.trim().length === 0) return [];
    const safeWidth = Math.max(1, width);
    if (this.mode === "line") return [truncateAnsiLine(this.text.replace(/\r?\n/g, " "), safeWidth)];

    const lines: string[] = [];
    for (const line of this.text.replace(/\t/g, "   ").split(/\r?\n/)) {
      lines.push(...wrapPlainLine(line, safeWidth));
    }
    return lines;
  }
}

export function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  const maybe = result as ToolResult | undefined;
  if (Array.isArray(maybe?.content)) {
    return maybe.content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n");
  }
  if (result === undefined || result === null) return "";
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return "[Unserializable result]";
  }
}

export function firstNonEmptyLine(text: string): string | null {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;
}

function reuseTextComponent(context: PiRenderContext | undefined, mode: "line" | "block"): LeanTextComponent {
  return context?.lastComponent instanceof LeanTextComponent
    ? context.lastComponent
    : new LeanTextComponent("", mode);
}

const MAX_CALL_SUMMARY_CHARS = 480;

function summarizeArg(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value.length > MAX_CALL_SUMMARY_CHARS ? `${value.slice(0, MAX_CALL_SUMMARY_CHARS - 3)}...` : value;
}

export function createCallRenderer(toolName: string, toolLabel = toolName) {
  return (args: Record<string, unknown> | null | undefined, theme: PiRenderTheme, context?: PiRenderContext): Component => {
    const safeArgs = args && typeof args === "object" ? args : {};
    const component = reuseTextComponent(context, "line");
    let suffix = "";
    if (toolName === "ctx_execute_file" && typeof safeArgs.path === "string" && safeArgs.path.length > 0) {
      suffix = ` ${summarizeArg(safeArgs.path, "")}`;
    }
    if (toolName === "ctx_batch_execute" && Array.isArray(safeArgs.commands)) suffix = ` ${safeArgs.commands.length} command(s)`;
    if (toolName === "ctx_search" && Array.isArray(safeArgs.queries)) suffix = ` ${summarizeArg(safeArgs.queries[0], "")}`;
    component.setText(theme.fg("toolTitle", theme.bold(toolLabel)) + theme.fg("muted", suffix));
    return component;
  };
}

export function createResultRenderer(toolName: string, partialText: string) {
  return (
    result: ToolResult,
    { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
    theme: PiRenderTheme,
    context: PiRenderContext,
  ): Component => {
    if (isPartial) {
      const component = reuseTextComponent(context, "line");
      component.setText(theme.fg("warning", partialText));
      return component;
    }

    const text = extractText(result);
    if (expanded) {
      return new LeanTextComponent(text || `${toolName} completed`, "block");
    }

    const component = reuseTextComponent(context, "line");
    component.setText(theme.fg("toolOutput", firstNonEmptyLine(text) ?? `${toolName} completed`));
    return component;
  };
}
