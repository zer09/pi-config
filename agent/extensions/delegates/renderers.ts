import { Text } from "@earendil-works/pi-tui";

import { previewTask } from "./progress.ts";
import type { ReaderToolResult } from "./types.ts";

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

export function renderDelegateCall(args: any, theme: any, context: any): Text {
	const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	const agent = typeof args?.agent === "string" ? args.agent : "unknown";
	const task = typeof args?.task === "string" ? previewTask(args.task) : "";
	text.setText(`${color(theme, "toolTitle", bold(theme, "reader"))} ${color(theme, "muted", agent)}${task ? ` ${color(theme, "dim", task)}` : ""}`);
	return text;
}

export function renderDelegateResult(result: ReaderToolResult, options: { expanded?: boolean; isPartial?: boolean }, theme: any, context: any): Text {
	const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	if (options?.isPartial) {
		text.setText(color(theme, "warning", "reader running"));
		return text;
	}

	const details = result?.details;
	if (!details) {
		text.setText(color(theme, "muted", "reader finished"));
		return text;
	}

	const status = statusLabel(details.status);
	const statusColor = status === "completed" ? "success" : status === "timeout" || status === "aborted" ? "warning" : "error";
	let output = `${color(theme, statusColor, `reader ${status}`)} ${color(theme, "muted", details.agent)}`;
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
