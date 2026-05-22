import { Text } from "@earendil-works/pi-tui";

import { WRITER_DIFF_COLLAPSED_PREVIEW_LINES } from "./constants.ts";
import { previewTask, progressPhaseLabel } from "./progress.ts";
import type { ReaderToolResult, WriterFileChange, WriterToolDetails, WriterToolResult } from "./types.ts";

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

function agentLabel(agent: unknown, fallback: "reader" | "writer"): string {
	const value = typeof agent === "string" && agent.trim() ? agent.trim() : fallback;
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function renderAgentLabel(agent: unknown, fallback: "reader" | "writer", theme: any): string {
	return color(theme, "toolTitle", bold(theme, agentLabel(agent, fallback)));
}

function renderToolCall(tool: "reader" | "writer", args: any, theme: any, context: any): Text {
	const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	const task = typeof args?.task === "string" ? previewTask(args.task) : "";
	text.setText(`${renderAgentLabel(args?.agent, tool, theme)}${task ? ` ${color(theme, "dim", task)}` : ""}`);
	return text;
}

function changedCount(files: WriterFileChange[] | undefined): number {
	return (files ?? []).filter((file) => file.status === "created" || file.status === "modified" || file.status === "deleted").length;
}

function skippedCount(files: WriterFileChange[] | undefined): number {
	return (files ?? []).filter((file) => file.status === "skipped").length;
}

function formatWriterChangeSummary(details: WriterToolDetails): string {
	const changed = details.changedFileCount ?? changedCount(details.changedFiles);
	const skipped = details.skippedDiffCount ?? skippedCount(details.changedFiles);
	if (changed === 0 && skipped === 0) return "no file changes";
	const parts: string[] = [];
	if (changed > 0) parts.push(`${changed} changed`);
	if (skipped > 0) parts.push(`${skipped} skipped`);
	return parts.join(", ");
}

function clippedDiffPreview(preview: string, maxLines: number): string {
	const lines = preview.split("\n");
	if (lines.length <= maxLines) return preview;
	return [...lines.slice(0, maxLines - 1), "[writer diff preview clipped; expand for more]"].join("\n");
}

function colorDiffPreview(preview: string, theme: any): string {
	return preview
		.split("\n")
		.map((line) => {
			if (line.startsWith("+")) return color(theme, "success", line);
			if (line.startsWith("-")) return color(theme, "error", line);
			if (line.startsWith("write ") || line.startsWith("edit ") || line.startsWith("delete ")) return color(theme, "toolTitle", line);
			if (line.startsWith("skip ") || line.startsWith("[writer diff preview truncated]")) return color(theme, "warning", line);
			return color(theme, "dim", line);
		})
		.join("\n");
}

function appendWriterExpandedDetails(output: string, details: WriterToolDetails, theme: any): string {
	if (details.changedFiles?.length) {
		output += "\nfiles:";
		for (const file of details.changedFiles) {
			const marker = file.status === "skipped" ? ` (${file.reason ?? "diff unavailable"})` : "";
			output += `\n  ${file.status} ${file.path}${marker}`;
		}
		if (details.changedFilesTruncated) output += "\n  ... additional files omitted from UI details";
	}
	if (details.diffPreview) {
		output += `\n${colorDiffPreview(details.diffPreview, theme)}`;
		if (details.diffTruncated) output += `\n${color(theme, "warning", "diff preview truncated")}`;
	}
	return output;
}

function renderToolResult(
	tool: "reader" | "writer",
	result: ReaderToolResult | WriterToolResult,
	options: { expanded?: boolean; isPartial?: boolean },
	theme: any,
	context: any,
): Text {
	const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	const details = result?.details;
	if (options?.isPartial) {
		const phase = typeof (details as any)?.phase === "string" ? progressPhaseLabel((details as any).phase) : "running...";
		let partial = `${renderAgentLabel((details as any)?.agent, tool, theme)} ${color(theme, "warning", phase)}`;
		if (tool === "writer" && typeof (details as any)?.diffPreview === "string" && (details as any).diffPreview) {
			partial += `\n${colorDiffPreview((details as any).diffPreview, theme)}`;
		}
		text.setText(partial);
		return text;
	}

	if (!details) {
		text.setText(`${renderAgentLabel(undefined, tool, theme)} ${color(theme, "muted", "finished")}`);
		return text;
	}

	const status = statusLabel(details.status);
	const statusColor = status === "completed" ? "success" : status === "timeout" || status === "aborted" ? "warning" : "error";
	let output = `${renderAgentLabel(details.agent, tool, theme)} ${color(theme, statusColor, status)}`;
	if (tool === "writer") {
		const writerDetails = details as WriterToolDetails;
		output += ` ${color(theme, "dim", formatWriterChangeSummary(writerDetails))}`;
		if (!options?.expanded && writerDetails.diffPreview) {
			output += `\n${colorDiffPreview(clippedDiffPreview(writerDetails.diffPreview, WRITER_DIFF_COLLAPSED_PREVIEW_LINES), theme)}`;
			if (writerDetails.diffTruncated) output += `\n${color(theme, "warning", "diff preview truncated")}`;
		}
	}
	if (options?.expanded) {
		output += `\nmodel: ${details.model}`;
		output += `\nthinking: ${details.thinking}`;
		output += `\ncwd: ${details.cwd}`;
		output += `\ntools: ${details.toolCallCount}`;
		output += `\nduration: ${details.durationMs}ms`;
		if (details.truncated) output += "\ntruncated: true";
		if (details.error) output += `\nerror: ${details.error}`;
		if (tool === "writer") output = appendWriterExpandedDetails(output, details as WriterToolDetails, theme);
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
