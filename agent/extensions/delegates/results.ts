import { DEFAULT_READER_MODEL, DEFAULT_THINKING } from "./constants.ts";
import { redactSensitiveText } from "./redaction.ts";
import { truncateMiddleByChars } from "./truncation.ts";
import type { ChildProcessResult, NormalizedReaderParams, ReaderToolResult, ResolvedInvocation } from "./types.ts";

function resultTextFromChild(child: ChildProcessResult): string {
	return child.state.finalText || child.state.streamingText.trim();
}

function buildFailureText(child: ChildProcessResult, includeDiagnostics: boolean): string {
	const parts = [
		`Reader delegate ${child.status}.`,
		`Exit code: ${child.exitCode ?? "unknown"}.`,
		"Child stdout/stderr were intentionally not imported into parent context.",
	];
	const finalText = resultTextFromChild(child);
	if (finalText) parts.push("", "Child final message:", finalText);
	const diagnostic = child.error || child.state.errorMessage || child.state.lastError || child.stderrTail;
	if (includeDiagnostics && diagnostic) parts.push("", "Bounded diagnostics:", diagnostic);
	return parts.join("\n");
}

export function makeReaderToolResult(invocation: ResolvedInvocation, child: ChildProcessResult, durationMs: number): ReaderToolResult {
	const rawText = child.status === "completed" ? resultTextFromChild(child) || "(no output)" : buildFailureText(child, invocation.params.includeDiagnostics);
	const redacted = redactSensitiveText(rawText);
	const truncated = truncateMiddleByChars(redacted, invocation.params.maxResultBytes);
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
			...(invocation.params.includeDiagnostics && stderr ? { stderrTail: stderr } : {}),
			...(child.error ? { error: redactSensitiveText(child.error) } : {}),
		},
	};
}

export function makeImmediateFailure(params: NormalizedReaderParams, agentName: string, message: string, durationMs: number): ReaderToolResult {
	const redacted = redactSensitiveText(message);
	const truncated = truncateMiddleByChars(redacted, params.maxResultBytes);
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
			error: redacted,
		},
	};
}
