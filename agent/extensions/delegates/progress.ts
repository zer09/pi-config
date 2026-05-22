import { DEFAULT_TASK_PREVIEW_CHARS } from "./constants.ts";
import { redactSensitiveText } from "./redaction.ts";

export type DelegateProgressPhase = "starting" | "launching_child" | "child_event" | "diff_ready" | "finishing";
export type DelegateUpdate = (update: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void;

export function previewTask(task: string, maxChars = DEFAULT_TASK_PREVIEW_CHARS): string {
	const compact = redactSensitiveText(task).replace(/\s+/g, " ").trim();
	if (compact.length <= maxChars) return compact;
	if (maxChars <= 3) return compact.slice(0, maxChars);
	return `${compact.slice(0, maxChars - 3)}...`;
}

export function progressPhaseLabel(phase: string): string {
	return `${phase.replace(/_/g, " ")}...`;
}

export function emitDelegateProgress(
	onUpdate: DelegateUpdate | undefined,
	phase: DelegateProgressPhase,
	info: { agent: string; task: string; cwd: string; tool?: "reader" | "writer"; message?: string; details?: Record<string, unknown> },
): void {
	if (!onUpdate) return;
	const tool = info.tool ?? "reader";
	const message = info.message ?? `${info.agent} - ${previewTask(info.task)}`;
	onUpdate({
		content: [{ type: "text", text: `${tool} ${progressPhaseLabel(phase)}: ${message}` }],
		details: {
			tool,
			phase,
			agent: info.agent,
			cwd: redactSensitiveText(info.cwd),
			taskPreview: previewTask(info.task),
			...(info.details ?? {}),
		},
	});
}
