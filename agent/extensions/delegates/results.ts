import { DEFAULT_READER_MODEL, DEFAULT_THINKING, DEFAULT_WRITER_MODEL } from "./constants.ts";
import { redactSensitiveText } from "./redaction.ts";
import { truncateMiddleByBytes } from "./truncation.ts";
import { compactWriterChangeSummary, writerDiffDetailFields } from "./writer-diff.ts";
import type {
	ChildProcessResult,
	NormalizedReaderParams,
	NormalizedWriterParams,
	ReaderToolResult,
	ResolvedReaderInvocation,
	ResolvedWriterInvocation,
	WriterDiffPreview,
	WriterToolResult,
} from "./types.ts";

function resultTextFromChild(child: ChildProcessResult): string {
	return child.state.finalText || child.state.streamingText.trim();
}

function buildFailureText(child: ChildProcessResult, includeDiagnostics: boolean, label: "Reader" | "Writer"): string {
	const parts = [
		`${label} delegate ${child.status}.`,
		`Exit code: ${child.exitCode ?? "unknown"}.`,
		"Child stdout/stderr were intentionally not imported into parent context.",
	];
	const finalText = resultTextFromChild(child);
	if (finalText) parts.push("", "Child final message:", finalText);
	const diagnostic = child.error || child.state.errorMessage || child.state.lastError || child.stderrTail;
	if (includeDiagnostics && diagnostic) parts.push("", "Bounded diagnostics:", diagnostic);
	return parts.join("\n");
}

export function makeReaderToolResult(invocation: ResolvedReaderInvocation, child: ChildProcessResult, durationMs: number, sessionPreserved = false): ReaderToolResult {
	const rawText = child.status === "completed" ? resultTextFromChild(child) || "(no output)" : buildFailureText(child, invocation.params.includeDiagnostics, "Reader");
	const redacted = redactSensitiveText(rawText);
	const truncated = truncateMiddleByBytes(redacted, invocation.params.maxResultBytes);
	const stderr = child.stderrTail ? redactSensitiveText(child.stderrTail) : undefined;
	return {
		content: [{ type: "text", text: truncated.text }],
		details: {
			agent: invocation.agent.name,
			model: child.state.model ?? invocation.model,
			thinking: invocation.thinking,
			cwd: redactSensitiveText(invocation.params.cwd),
			status: child.status,
			exitCode: child.exitCode,
			durationMs,
			toolCallCount: child.state.toolCallCount,
			truncated: truncated.truncated,
			sessionMode: invocation.sessionMode,
			continueSession: invocation.params.continueSession,
			...(invocation.sessionMode === "continued" && invocation.params.sessionKey ? { sessionKey: "<redacted>" } : {}),
			...(invocation.sessionMode === "fresh" ? { sessionPreserved } : {}),
			...(invocation.sessionMode === "fresh" && sessionPreserved ? { diagnosticSessionDir: redactSensitiveText(invocation.sessionDir) } : {}),
			...(invocation.params.includeDiagnostics && stderr ? { stderrTail: stderr } : {}),
			...(child.error ? { error: redactSensitiveText(child.error) } : {}),
		},
	};
}

export function makeWriterToolResult(
	invocation: ResolvedWriterInvocation,
	child: ChildProcessResult,
	durationMs: number,
	writerDiff?: WriterDiffPreview,
): WriterToolResult {
	const rawText =
		child.status === "completed"
			? compactWriterChangeSummary(writerDiff)
			: `${buildFailureText(child, invocation.params.includeDiagnostics, "Writer")}\n\n${compactWriterChangeSummary(writerDiff, "Writer file changes")}`;
	const redacted = redactSensitiveText(rawText);
	const truncated = truncateMiddleByBytes(redacted, invocation.params.maxResultBytes);
	const stderr = child.stderrTail ? redactSensitiveText(child.stderrTail) : undefined;
	return {
		content: [{ type: "text", text: truncated.text }],
		details: {
			agent: invocation.agent.name,
			model: child.state.model ?? invocation.model,
			thinking: invocation.thinking,
			cwd: redactSensitiveText(invocation.params.cwd),
			status: child.status,
			exitCode: child.exitCode,
			durationMs,
			toolCallCount: child.state.toolCallCount,
			truncated: truncated.truncated,
			...writerDiffDetailFields(writerDiff),
			...(invocation.params.includeDiagnostics && stderr ? { stderrTail: stderr } : {}),
			...(child.error ? { error: redactSensitiveText(child.error) } : {}),
		},
	};
}

export function makeImmediateFailure(
	params: NormalizedReaderParams,
	agentName: string,
	message: string,
	durationMs: number,
	session?: { sessionMode: "fresh" | "continued"; sessionDir?: string; sessionPreserved?: boolean },
): ReaderToolResult {
	const redacted = redactSensitiveText(message);
	const truncated = truncateMiddleByBytes(redacted, params.maxResultBytes);
	return {
		content: [{ type: "text", text: truncated.text }],
		details: {
			agent: agentName,
			model: params.model ?? DEFAULT_READER_MODEL,
			thinking: params.thinking ?? DEFAULT_THINKING,
			cwd: redactSensitiveText(params.cwd),
			status: "failed",
			exitCode: null,
			durationMs,
			toolCallCount: 0,
			truncated: truncated.truncated,
			...(session ? { sessionMode: session.sessionMode, continueSession: params.continueSession } : {}),
			...(session?.sessionMode === "continued" && params.sessionKey ? { sessionKey: "<redacted>" } : {}),
			...(session?.sessionMode === "fresh" ? { sessionPreserved: session.sessionPreserved ?? false } : {}),
			...(session?.sessionMode === "fresh" && session.sessionPreserved && session.sessionDir ? { diagnosticSessionDir: redactSensitiveText(session.sessionDir) } : {}),
			error: redacted,
		},
	};
}

export function makeImmediateWriterFailure(params: NormalizedWriterParams, agentName: string, message: string, durationMs: number): WriterToolResult {
	const redacted = redactSensitiveText(message);
	const truncated = truncateMiddleByBytes(redacted, params.maxResultBytes);
	return {
		content: [{ type: "text", text: truncated.text }],
		details: {
			agent: agentName,
			model: params.model ?? DEFAULT_WRITER_MODEL,
			thinking: params.thinking ?? DEFAULT_THINKING,
			cwd: redactSensitiveText(params.cwd),
			status: "failed",
			exitCode: null,
			durationMs,
			toolCallCount: 0,
			truncated: truncated.truncated,
			error: redacted,
		},
	};
}
