import * as fs from "node:fs";
import * as path from "node:path";

import { DELEGATE_ALLOWED_PATHS_ENV, DELEGATE_CHILD_MARKER, DELEGATE_KIND_ENV, MAX_STRINGIFIED_EDITS_GUARD_BYTES } from "./constants.ts";
import { containsBinaryLookingText } from "./text-files.ts";

interface ToolCallEvent {
	toolName?: string;
	input?: Record<string, unknown>;
}

interface BlockResult {
	block: true;
	reason: string;
}

function block(reason: string): BlockResult {
	return { block: true, reason };
}

function loadAllowedPaths(): Set<string> {
	try {
		const parsed = JSON.parse(process.env[DELEGATE_ALLOWED_PATHS_ENV] || "[]");
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((value): value is string => typeof value === "string").map((value) => path.resolve(value)));
	} catch {
		return new Set();
	}
}

function targetPathFromInput(input: Record<string, unknown> | undefined): string | undefined | "ambiguous" {
	if (!input) return undefined;
	const candidates = [input.path, input.file_path].filter((value): value is string => typeof value === "string" && value.trim() !== "");
	if (candidates.length === 0) return undefined;
	if (new Set(candidates).size > 1) return "ambiguous";
	return candidates[0];
}

function normalizeTarget(target: string): string {
	const resolved = path.resolve(target);
	return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

function inputHasBinaryLookingText(input: Record<string, unknown> | undefined): boolean {
	if (!input) return false;
	for (const field of ["content", "oldText", "newText"] as const) {
		const value = input[field];
		if (typeof value === "string" && containsBinaryLookingText(value)) return true;
	}
	if (input.edits !== undefined) {
		const serialized = JSON.stringify(input.edits);
		if (serialized && serialized.length <= MAX_STRINGIFIED_EDITS_GUARD_BYTES && containsBinaryLookingText(serialized)) return true;
	}
	return false;
}

function writerToolGuard(event: ToolCallEvent): BlockResult | undefined {
	const toolName = event.toolName;
	if (toolName === "reader" || toolName === "writer" || toolName === "subagent" || toolName === "delegate_subagent") {
		return block("writer cannot call delegate tools");
	}
	if (toolName === "bash" || toolName?.startsWith("ctx_") || toolName?.startsWith("context_mode_ctx_")) {
		return block("writer cannot run shell or Context Mode tools");
	}
	if (toolName === "rm" || toolName === "delete" || toolName === "unlink") return block("writer cannot delete files");
	if (toolName !== "read" && toolName !== "edit" && toolName !== "write") return undefined;

	const target = targetPathFromInput(event.input);
	if (!target || target === "ambiguous") return block("writer file tool calls require one exact target path");

	const normalizedTarget = normalizeTarget(target);
	const allowed = loadAllowedPaths();
	if (!allowed.has(normalizedTarget)) return block("writer may access only exact allowed files");
	if ((toolName === "write" || toolName === "edit") && inputHasBinaryLookingText(event.input)) return block("writer is text-only");
	if (toolName === "write" && fs.existsSync(normalizedTarget)) return block("writer must use edit for existing files");
	return undefined;
}

export function registerDelegateChildGuards(pi: { on?: (eventName: string, handler: (event: ToolCallEvent) => unknown) => void }): void {
	if (!process.env[DELEGATE_CHILD_MARKER]) return;
	if (process.env[DELEGATE_KIND_ENV] !== "writer") return;
	pi.on?.("tool_call", writerToolGuard);
}

export { writerToolGuard };
