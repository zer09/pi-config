import { Text } from "@earendil-works/pi-tui";

import { WRITER_DIFF_COLLAPSED_PREVIEW_LINES } from "./constants.ts";
import { displayLabel, previewTask, progressPhaseLabel } from "./progress.ts";
import type { ReaderToolResult, WriterFileChange, WriterToolDetails, WriterToolResult } from "./types.ts";

function color(theme: any, name: string, value: string): string {
	return typeof theme?.fg === "function" ? theme.fg(name, value) : value;
}

function bold(theme: any, value: string): string {
	return typeof theme?.bold === "function" ? theme.bold(value) : value;
}

function ansi256(colorCode: number, value: string): string {
	return `\x1b[38;5;${colorCode}m${value}\x1b[0m`;
}

function supportsAnsi256Color(theme: any): boolean {
	if (typeof theme?.getColorMode !== "function") return false;
	try {
		const colorMode = theme.getColorMode();
		return colorMode === "256color" || colorMode === "truecolor";
	} catch {
		return false;
	}
}

function colorOrAnsi(theme: any, themeColor: string | undefined, ansi256Color: number | undefined, value: string): string {
	if (typeof ansi256Color === "number" && supportsAnsi256Color(theme)) return ansi256(ansi256Color, value);
	return themeColor ? color(theme, themeColor, value) : value;
}

function renderStatusWithIcon(
	label: string,
	icon: string,
	theme: any,
	style: { themeColor?: string; ansi256Color?: number },
): string {
	return colorOrAnsi(theme, style.themeColor, style.ansi256Color, `${icon} ${label}`);
}

const LOADING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LOADING_INTERVAL_MS = 80;
const LOADING_STATE_KEY = "delegateLoadingText";

class AnimatedLoadingText extends Text {
	private frameIndex = 0;
	private intervalId: ReturnType<typeof setInterval> | undefined;
	private renderText: (frame: string) => string = () => "";
	private requestInvalidate: () => void = () => undefined;

	constructor() {
		super("", 0, 0);
	}

	configure(renderText: (frame: string) => string, requestInvalidate: () => void): void {
		this.renderText = renderText;
		this.requestInvalidate = requestInvalidate;
		this.updateText();
		this.start();
	}

	stop(): void {
		if (!this.intervalId) return;
		clearInterval(this.intervalId);
		this.intervalId = undefined;
	}

	private start(): void {
		if (this.intervalId) return;
		this.intervalId = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % LOADING_FRAMES.length;
			this.updateText();
			this.requestInvalidate();
		}, LOADING_INTERVAL_MS);
		(this.intervalId as { unref?: () => void }).unref?.();
	}

	private updateText(): void {
		this.setText(this.renderText(LOADING_FRAMES[this.frameIndex] ?? ""));
	}
}

function getLoadingState(context: any): Record<string, unknown> | undefined {
	if (context?.state && typeof context.state === "object") return context.state;
	if (!context || typeof context !== "object") return undefined;
	try {
		context.state = {};
		return context.state;
	} catch {
		return undefined;
	}
}

function getLoadingComponent(context: any): AnimatedLoadingText | undefined {
	const state = getLoadingState(context);
	if (!state) return undefined;
	let component = state[LOADING_STATE_KEY] as AnimatedLoadingText | undefined;
	if (!component) {
		component = new AnimatedLoadingText();
		state[LOADING_STATE_KEY] = component;
	}
	return component;
}

function stopLoadingComponent(context: any): void {
	const state = context?.state;
	if (!state || typeof state !== "object") return;
	const component = state[LOADING_STATE_KEY] as AnimatedLoadingText | undefined;
	component?.stop();
	delete state[LOADING_STATE_KEY];
}

function normalizedStatus(status: string): "completed" | "timeout" | "aborted" | "failed" {
	if (status === "completed") return "completed";
	if (status === "timeout") return "timeout";
	if (status === "aborted") return "aborted";
	return "failed";
}

function statusLabel(status: string): string {
	return displayLabel(normalizedStatus(status));
}

function renderFinalStatus(status: string, theme: any): string {
	const normalized = normalizedStatus(status);
	if (normalized === "completed") return renderStatusWithIcon(statusLabel(status), "󰸞", theme, { themeColor: "success" });
	if (normalized === "timeout") return renderStatusWithIcon(statusLabel(status), "󰔟", theme, { themeColor: "warning" });
	if (normalized === "aborted") return renderStatusWithIcon(statusLabel(status), "󰅖", theme, { themeColor: "warning", ansi256Color: 208 });
	return renderStatusWithIcon(statusLabel(status), "󰅙", theme, { themeColor: "error" });
}

function renderWriterFileStatus(status: WriterFileChange["status"], theme: any): string {
	if (status === "created") return renderStatusWithIcon(displayLabel(status), "󰝒", theme, { themeColor: "success" });
	if (status === "modified") return renderStatusWithIcon(displayLabel(status), "󰷈", theme, { themeColor: "accent", ansi256Color: 33 });
	if (status === "deleted") return renderStatusWithIcon(displayLabel(status), "󰩹", theme, { themeColor: "error" });
	if (status === "skipped") return renderStatusWithIcon(displayLabel(status), "󰒭", theme, { themeColor: "muted" });
	return color(theme, "muted", displayLabel(status));
}

function agentLabel(agent: unknown, fallback: "reader" | "writer"): string {
	const value = typeof agent === "string" && agent.trim() ? agent.trim() : fallback;
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function renderAgentLabel(agent: unknown, fallback: "reader" | "writer", theme: any): string {
	return color(theme, "toolTitle", bold(theme, agentLabel(agent, fallback)));
}

function delegateSessionMode(tool: "reader" | "writer", args: any): "fresh" | "continued" {
	if (tool === "reader" && args?.continueSession === true) return "continued";
	return "fresh";
}

function renderDelegateModeDot(tool: "reader" | "writer", args: any, theme: any): string {
	const mode = delegateSessionMode(tool, args);
	const dot = mode === "continued" ? "●" : "○";
	const colorName = mode === "continued" ? "accent" : "muted";
	return color(theme, colorName, dot);
}

function renderToolCall(tool: "reader" | "writer", args: any, theme: any, context: any): Text {
	const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	const task = typeof args?.task === "string" ? previewTask(args.task) : "";
	const label = renderAgentLabel(args?.agent, tool, theme);
	const dot = renderDelegateModeDot(tool, args, theme);
	text.setText(`${label} ${dot}${task ? ` ${color(theme, "dim", task)}` : ""}`);
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
			output += `\n  ${renderWriterFileStatus(file.status, theme)} ${file.path}${marker}`;
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
	const details = result?.details;
	if (options?.isPartial) {
		const phase = typeof (details as any)?.phase === "string" ? progressPhaseLabel((details as any).phase) : "Running...";
		const diffPreview = tool === "writer" && typeof (details as any)?.diffPreview === "string" ? (details as any).diffPreview : "";
		const renderPartial = (frame: string) => {
			let partial = `${color(theme, "accent", frame)} ${color(theme, "warning", phase)}`;
			if (diffPreview) partial += `\n${colorDiffPreview(diffPreview, theme)}`;
			return partial;
		};
		const loading = getLoadingComponent(context);
		if (!loading) return new Text(renderPartial(LOADING_FRAMES[0] ?? ""), 0, 0);
		loading.configure(renderPartial, () => {
			if (typeof context?.invalidate === "function") context.invalidate();
		});
		return loading;
	}

	stopLoadingComponent(context);
	const text = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);

	if (!details) {
		text.setText(`${renderAgentLabel(undefined, tool, theme)} ${color(theme, "muted", "finished")}`);
		return text;
	}

	let output = renderFinalStatus(details.status, theme);
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
