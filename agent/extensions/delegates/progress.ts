import { DEFAULT_TASK_PREVIEW_CHARS } from "./constants.ts";
import { redactSensitiveText } from "./redaction.ts";

export type DelegateProgressPhase = "starting" | "launching_child" | "child_event" | "finishing";
export type DelegateUpdate = (update: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void;

export function previewTask(task: string, maxChars = DEFAULT_TASK_PREVIEW_CHARS): string {
	const compact = redactSensitiveText(task).replace(/\s+/g, " ").trim();
	if (compact.length <= maxChars) return compact;
	if (maxChars <= 3) return compact.slice(0, maxChars);
	return `${compact.slice(0, maxChars - 3)}...`;
}

export function emitDelegateProgress(
	onUpdate: DelegateUpdate | undefined,
	phase: DelegateProgressPhase,
	info: { agent: string; task: string; cwd: string; tool?: "reader" | "writer" },
): void {
	if (!onUpdate) return;
	const tool = info.tool ?? "reader";
	onUpdate({
		content: [{ type: "text", text: `${tool} ${phase}: ${info.agent} - ${previewTask(info.task)}` }],
		details: {
			tool,
			phase,
			agent: info.agent,
			cwd: redactSensitiveText(info.cwd),
			taskPreview: previewTask(info.task),
		},
	});
}
