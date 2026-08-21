import { keyText } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { diagnosticLine } from "./result.ts";
import type {
  DelegateProgress,
  DelegateToolParams,
  RenderTheme,
  ToolRenderContext,
  ToolResult,
} from "./types.ts";

const COLLAPSED_REPORT_LINES = 20;

function reuseText(context: ToolRenderContext): Text {
  return context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
}

function textOutput(result: ToolResult): string {
  return result.content.map((item) => item.text).join("\n");
}

function progressFrom(result: ToolResult): DelegateProgress | undefined {
  const progress = result.details?.progress;
  if (!progress || typeof progress !== "object") return undefined;
  return progress as unknown as DelegateProgress;
}

function ageText(timestamp: string): string {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) return timestamp;
  const seconds = Math.max(0, Math.round((Date.now() - milliseconds) / 1000));
  return `${timestamp} · ${seconds}s ago`;
}

function eventText(progress: DelegateProgress): string {
  return progress.lastEventDetail
    ? `${progress.lastEvent} (${progress.lastEventDetail})`
    : progress.lastEvent;
}

export function renderDelegateCall(
  args: DelegateToolParams,
  theme: RenderTheme,
  context: ToolRenderContext,
): Text {
  const text = reuseText(context);
  const backend = args.backend && args.backend !== "default" ? ` backend=${args.backend}` : "";
  text.setText(
    theme.fg("toolTitle", theme.bold("Delegate "))
      + theme.fg("accent", args.role)
      + theme.fg("muted", backend),
  );
  return text;
}

export function renderDelegateResult(
  result: ToolResult,
  options: { readonly expanded: boolean; readonly isPartial: boolean },
  theme: RenderTheme,
  context: ToolRenderContext,
): Text {
  const text = reuseText(context);
  const progress = progressFrom(result);

  if (options.isPartial && progress) {
    const route = progress.route ?? "selecting route";
    const event = eventText(progress);
    text.setText([
      theme.fg("warning", `⏳ ${progress.label}`) + theme.fg("muted", `  ${route}`),
      theme.fg("muted", `phase: ${progress.phase}  state: ${progress.state}  attempt: ${progress.attempt}`),
      theme.fg("toolOutput", `last: ${event}`),
      theme.fg("dim", `at: ${ageText(progress.lastEventAt)}  elapsed: ${progress.elapsedSeconds.toFixed(1)}s`),
    ].join("\n"));
    return text;
  }

  const output = textOutput(result).trimEnd();
  const lines = output.split("\n");
  const state = typeof result.details?.state === "string" ? result.details.state : "completed";
  const successful = state === "completed";
  const icon = successful ? theme.fg("success", "✓") : theme.fg("error", "✗");
  let rendered = `${icon} ${theme.fg("toolTitle", theme.bold(String(state)))}`;
  if (progress) {
    rendered += theme.fg("muted", `  ${progress.route ?? "no route"}  ${progress.elapsedSeconds.toFixed(1)}s`);
    rendered += `\n${theme.fg("dim", `last: ${eventText(progress)} at ${ageText(progress.lastEventAt)}`)}`;
  }
  // TUI-only: the private diagnostic path for unsuccessful runs never enters
  // model-visible tool content. Shown without any read prompt.
  if (!successful && typeof result.details?.diagnosticPath === "string") {
    rendered += `\n${theme.fg("dim", diagnosticLine(result.details.diagnosticPath))}`;
  }

  const visible = options.expanded ? lines : lines.slice(0, COLLAPSED_REPORT_LINES);
  if (visible.some((line) => line.length > 0)) {
    rendered += `\n\n${visible.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
  }
  if (!options.expanded && lines.length > COLLAPSED_REPORT_LINES) {
    const key = keyText("app.tools.expand") || "ctrl+o";
    rendered += theme.fg("muted", `\n... (${lines.length - COLLAPSED_REPORT_LINES} more lines, ${key} to expand)`);
  }
  text.setText(rendered);
  return text;
}
