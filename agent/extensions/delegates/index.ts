import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export {
	DEFAULT_MAX_RESULT_BYTES,
	DEFAULT_READER_MODEL,
	DEFAULT_THINKING,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_WRITER_MODEL,
	DELEGATE_CHILD_MARKER,
	WRITER_DIFF_MAX_CHANGED_FILES,
	WRITER_DIFF_MAX_FILE_BYTES,
} from "./constants.ts";
export { getReaderSessionDir } from "./paths.ts";
export { normalizeReaderParams, normalizeWriterParams, resolveInvocation } from "./params.ts";
export { readerProfile } from "./profiles/reader.ts";
export { writerProfile } from "./profiles/writer.ts";
export { buildReaderSystemPrompt, buildReaderTaskPrompt, buildWriterSystemPrompt, buildWriterTaskPrompt } from "./prompts.ts";
export { renderDelegateCall, renderDelegateResult, renderWriterCall, renderWriterResult } from "./renderers.ts";
export { runReader, runWriter } from "./runner.ts";
export { buildWriterDiffPreview, captureWriterFileSnapshots } from "./writer-diff.ts";

import { registerDelegateChildGuards } from "./child-guards.ts";
import { DEFAULT_MAX_RESULT_BYTES, DEFAULT_READER_MODEL, DEFAULT_THINKING, DEFAULT_TIMEOUT_MS, DELEGATE_CHILD_MARKER } from "./constants.ts";
import { readerProfile } from "./profiles/reader.ts";
import { writerProfile } from "./profiles/writer.ts";
import { redactSensitiveText } from "./redaction.ts";
import { renderDelegateCall, renderDelegateResult, renderWriterCall, renderWriterResult } from "./renderers.ts";
import { runReader, runWriter } from "./runner.ts";
import type { ReaderParams, WriterParams } from "./types.ts";

export default function delegatesExtension(pi: ExtensionAPI): void {
	if (process.env[DELEGATE_CHILD_MARKER]) {
		registerDelegateChildGuards(pi);
		return;
	}

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
				const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
				return {
					content: [{ type: "text", text: message }],
					details: {
						agent: typeof (params as ReaderParams).agent === "string" ? (params as ReaderParams).agent : "unknown",
						model: DEFAULT_READER_MODEL,
						thinking: DEFAULT_THINKING,
						cwd: redactSensitiveText(ctx.cwd),
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

	pi.registerTool({
		name: writerProfile.name,
		label: writerProfile.label,
		description: writerProfile.description,
		promptSnippet: writerProfile.promptSnippet,
		promptGuidelines: writerProfile.promptGuidelines,
		parameters: writerProfile.parameters,
		renderCall: renderWriterCall,
		renderResult: renderWriterResult,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			try {
				return await runWriter(params as WriterParams, ctx.cwd, signal, onUpdate);
			} catch (error) {
				const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
				return {
					content: [{ type: "text", text: message }],
					details: {
						agent: typeof (params as WriterParams).agent === "string" ? (params as WriterParams).agent : "unknown",
						model: writerProfile.defaultModel,
						thinking: writerProfile.defaultThinking,
						cwd: redactSensitiveText(ctx.cwd),
						status: "failed",
						exitCode: null,
						durationMs: 0,
						toolCallCount: 0,
						truncated: false,
						error: message,
					},
				};
			}
		},
	});
}
