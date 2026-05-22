import type { JsonEventState } from "./types.ts";

export function emptyEventState(): JsonEventState {
	return { finalText: "", streamingText: "", lastError: "", toolCallCount: 0 };
}

function textFromMessage(message: any): string {
	if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content
		.filter((part: any) => part && part.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n")
		.trim();
}

function updateUsageMetadata(state: JsonEventState, message: any): void {
	if (!message || message.role !== "assistant") return;
	if (typeof message.model === "string") state.model = message.model;
	if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
	if (typeof message.errorMessage === "string") {
		state.errorMessage = message.errorMessage;
		state.lastError = message.errorMessage;
	}
}

export function applyJsonEventLine(line: string, state: JsonEventState): void {
	const trimmed = line.trim();
	if (!trimmed) return;

	let event: any;
	try {
		event = JSON.parse(trimmed);
	} catch {
		return;
	}

	if (event.type === "tool_execution_start") {
		state.toolCallCount += 1;
		return;
	}

	if (event.type === "message_update") {
		const delta = event.assistantMessageEvent?.delta;
		if (typeof delta === "string") state.streamingText += delta;
		return;
	}

	if (event.type === "message_end" && event.message) {
		const text = textFromMessage(event.message);
		if (text) state.finalText = text;
		updateUsageMetadata(state, event.message);
		return;
	}

	if (event.type === "agent_end" && Array.isArray(event.messages)) {
		for (let index = event.messages.length - 1; index >= 0; index -= 1) {
			const message = event.messages[index];
			const text = textFromMessage(message);
			if (text && !state.finalText) state.finalText = text;
			updateUsageMetadata(state, message);
			if (state.finalText) break;
		}
		return;
	}

	if (event.type === "auto_retry_end" && event.success === false && typeof event.finalError === "string") {
		state.lastError = event.finalError;
		return;
	}

	if (typeof event.errorMessage === "string") state.lastError = event.errorMessage;
}
