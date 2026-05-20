import {
	DEFAULT_MAX_RESULT_BYTES,
	DEFAULT_READER_MODEL,
	DEFAULT_THINKING,
	DEFAULT_TIMEOUT_MS,
	MAX_MAX_RESULT_BYTES,
	MAX_TIMEOUT_MS,
	MIN_MAX_RESULT_BYTES,
	MIN_TIMEOUT_MS,
} from "./constants.ts";
import { getReaderSessionDir } from "./paths.ts";
import { READER_TOOLS } from "./toolsets.ts";
import { THINKING_LEVELS, type AgentConfig, type NormalizedReaderParams, type ReaderParams, type ResolvedInvocation, type ThinkingLevel } from "./types.ts";

function normalizeNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value;
}

function normalizeThinking(value: unknown): ThinkingLevel | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !(THINKING_LEVELS as readonly string[]).includes(value)) {
		throw new Error(`thinking must be one of ${THINKING_LEVELS.join(", ")}`);
	}
	return value as ThinkingLevel;
}

function normalizeOptionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} must be a non-empty string when provided`);
	}
	return value;
}

function normalizeBoolean(value: unknown, field: string, defaultValue: boolean): boolean {
	if (value === undefined) return defaultValue;
	if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
	return value;
}

function normalizeBoundedNumber(value: unknown, field: string, defaultValue: number, min: number, max: number): number {
	if (value === undefined) return defaultValue;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
	if (value < min) return min;
	if (value > max) return max;
	return Math.trunc(value);
}

export function normalizeReaderParams(params: ReaderParams, defaultCwd: string): NormalizedReaderParams {
	const model = normalizeOptionalString(params.model, "model");
	const thinking = normalizeThinking(params.thinking);
	const normalized: NormalizedReaderParams = {
		agent: normalizeNonEmptyString(params.agent, "agent"),
		task: normalizeNonEmptyString(params.task, "task"),
		cwd: normalizeOptionalString(params.cwd, "cwd") ?? defaultCwd,
		timeoutMs: normalizeBoundedNumber(params.timeoutMs, "timeoutMs", DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
		maxResultBytes: normalizeBoundedNumber(
			params.maxResultBytes,
			"maxResultBytes",
			DEFAULT_MAX_RESULT_BYTES,
			MIN_MAX_RESULT_BYTES,
			MAX_MAX_RESULT_BYTES,
		),
		includeDiagnostics: normalizeBoolean(params.includeDiagnostics, "includeDiagnostics", false),
	};
	if (model !== undefined) normalized.model = model;
	if (thinking !== undefined) normalized.thinking = thinking;
	return normalized;
}

export function resolveInvocation(params: NormalizedReaderParams, agents: AgentConfig[]): ResolvedInvocation | string {
	const agent = agents.find((candidate) => candidate.name === params.agent);
	if (!agent) {
		const available = agents.map((candidate) => candidate.name).join(", ") || "none";
		return `Unknown agent '${params.agent}'. Available agents: ${available}`;
	}

	return {
		agent,
		params,
		model: params.model ?? agent.model ?? DEFAULT_READER_MODEL,
		thinking: params.thinking ?? agent.thinking ?? DEFAULT_THINKING,
		tools: [...READER_TOOLS],
		sessionDir: getReaderSessionDir(params.cwd),
	};
}
