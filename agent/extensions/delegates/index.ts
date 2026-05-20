import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export {
	DEFAULT_MAX_RESULT_BYTES,
	DEFAULT_READER_MODEL,
	DEFAULT_THINKING,
	DEFAULT_TIMEOUT_MS,
	DELEGATE_CHILD_MARKER,
} from "./constants.ts";
export { getReaderSessionDir } from "./paths.ts";
export { normalizeReaderParams, resolveInvocation } from "./params.ts";
export { readerProfile } from "./profiles/reader.ts";
export { buildReaderSystemPrompt, buildReaderTaskPrompt } from "./prompts.ts";
export { renderDelegateCall, renderDelegateResult } from "./renderers.ts";
export { runReader } from "./runner.ts";

import { DEFAULT_MAX_RESULT_BYTES, DEFAULT_READER_MODEL, DEFAULT_THINKING, DEFAULT_TIMEOUT_MS, DELEGATE_CHILD_MARKER } from "./constants.ts";
import { readerProfile } from "./profiles/reader.ts";
import { renderDelegateCall, renderDelegateResult } from "./renderers.ts";
import { runReader } from "./runner.ts";
import type { ReaderParams } from "./types.ts";

export default function delegatesExtension(pi: ExtensionAPI): void {
	if (process.env[DELEGATE_CHILD_MARKER]) return;

	pi.registerTool({
		name: readerProfile.name,
		label: readerProfile.label,
		description: readerProfile.description,
		promptSnippet: readerProfile.promptSnippet,
		promptGuidelines: readerProfile.promptGuidelines,
		parameters: readerProfile.parameters,
		renderCall: renderDelegateCall,
		renderResult: renderDelegateResult,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			try {
				return await runReader(params as ReaderParams, ctx.cwd, signal, onUpdate);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: message }],
					details: {
						agent: typeof (params as ReaderParams).agent === "string" ? (params as ReaderParams).agent : "unknown",
						model: DEFAULT_READER_MODEL,
						thinking: DEFAULT_THINKING,
						cwd: ctx.cwd,
						status: "failed",
						exitCode: null,
						durationMs: 0,
						toolCallCount: 0,
						truncated: false,
						error: message,
						timeoutMs: DEFAULT_TIMEOUT_MS,
						maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
					},
				};
			}
		},
	});
}
