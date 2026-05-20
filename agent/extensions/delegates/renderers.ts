import { Text } from "@earendil-works/pi-tui";

import { previewTask } from "./progress.ts";
import type { ReaderToolResult, WriterToolResult } from "./types.ts";

function color(theme: any, name: string, value: string): string {
	return typeof theme?.fg === "function" ? theme.fg(name, value) : value;
}

function bold(theme: any, value: string): string {
	return typeof theme?.bold === "function" ? theme.bold(value) : value;
}

function statusLabel(status: string): string {
	if (status === "completed") return "completed";
	if (status === "timeout") return "timeout";
	if (status === "aborted") return "aborted";
	return "failed";
}

function renderToolCall(tool: "reader" | "writer", args: any, theme: any, context: any): Text {
	const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	const agent = typeof args?.agent === "string" ? args.agent : "unknown";
	const task = typeof args?.task === "string" ? previewTask(args.task) : "";
	text.setText(`${color(theme, "toolTitle", bold(theme, tool))} ${color(theme, "muted", agent)}${task ? ` ${color(theme, "dim", task)}` : ""}`);
	return text;
}

function renderToolResult(
	tool: "reader" | "writer",
	result: ReaderToolResult | WriterToolResult,
	options: { expanded?: boolean; isPartial?: boolean },
	theme: any,
	context: any,
): Text {
	const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	if (options?.isPartial) {
		text.setText(color(theme, "warning", `${tool} running`));
		return text;
	}

	const details = result?.details;
	if (!details) {
		text.setText(color(theme, "muted", `${tool} finished`));
		return text;
	}

	const status = statusLabel(details.status);
	const statusColor = status === "completed" ? "success" : status === "timeout" || status === "aborted" ? "warning" : "error";
	let output = `${color(theme, statusColor, `${tool} ${status}`)} ${color(theme, "muted", details.agent)}`;
	if (options?.expanded) {
		output += `\nmodel: ${details.model}`;
		output += `\nthinking: ${details.thinking}`;
		output += `\ncwd: ${details.cwd}`;
		output += `\ntools: ${details.toolCallCount}`;
		output += `\nduration: ${details.durationMs}ms`;
		if (details.truncated) output += "\ntruncated: true";
		if (details.error) output += `\nerror: ${details.error}`;
	}
	text.setText(output);
	return text;
}

export function renderDelegateCall(args: any, theme: any, context: any): Text {
	return renderToolCall("reader", args, theme, context);
}

export function renderWriterCall(args: any, theme: any, context: any): Text {
	return renderToolCall("writer", args, theme, context);
}

export function renderDelegateResult(result: ReaderToolResult, options: { expanded?: boolean; isPartial?: boolean }, theme: any, context: any): Text {
	return renderToolResult("reader", result, options, theme, context);
}

export function renderWriterResult(result: WriterToolResult, options: { expanded?: boolean; isPartial?: boolean }, theme: any, context: any): Text {
	return renderToolResult("writer", result, options, theme, context);
}
