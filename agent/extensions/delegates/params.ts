import * as fs from "node:fs";
import * as path from "node:path";

import {
	DEFAULT_MAX_RESULT_BYTES,
	DEFAULT_READER_MODEL,
	DEFAULT_THINKING,
	DEFAULT_WRITER_MODEL,
	DEFAULT_TIMEOUT_MS,
	MAX_MAX_RESULT_BYTES,
	MAX_TIMEOUT_MS,
	MIN_MAX_RESULT_BYTES,
	MIN_TIMEOUT_MS,
} from "./constants.ts";
import { getReaderSessionDir } from "./paths.ts";
import { assertTextFile } from "./text-files.ts";
import { READER_TOOLS, WRITER_TOOLS } from "./toolsets.ts";
import {
	THINKING_LEVELS,
	type AgentConfig,
	type NormalizedReaderParams,
	type NormalizedWriterParams,
	type ReaderParams,
	type ResolvedInvocation,
	type ResolvedWriterInvocation,
	type ThinkingLevel,
	type WriterParams,
} from "./types.ts";

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

function stripPathReferencePrefix(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

function normalizeBoundedNumber(value: unknown, field: string, defaultValue: number, min: number, max: number): number {
	if (value === undefined) return defaultValue;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
	if (value < min) return min;
	if (value > max) return max;
	return Math.trunc(value);
}

function isPathInside(base: string, candidate: string): boolean {
	const relative = path.relative(base, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveCwd(value: unknown, defaultCwd: string): string {
	const base = path.resolve(defaultCwd);
	const raw = normalizeOptionalString(value, "cwd");
	return raw === undefined ? base : path.resolve(base, raw);
}

function normalizeReaderCwd(value: unknown, defaultCwd: string): string {
	const resolved = resolveCwd(value, defaultCwd);
	if (!fs.existsSync(resolved)) return resolved;
	const stats = fs.statSync(resolved);
	if (!stats.isDirectory()) throw new Error("cwd must resolve to an existing directory");
	return fs.realpathSync(resolved);
}

function normalizeExistingCwd(value: unknown, defaultCwd: string): string {
	const resolved = resolveCwd(value, defaultCwd);
	let stats: fs.Stats;
	try {
		stats = fs.statSync(resolved);
	} catch {
		throw new Error("cwd must resolve to an existing directory");
	}
	if (!stats.isDirectory()) throw new Error("cwd must resolve to an existing directory");
	return fs.realpathSync(resolved);
}

function assertMissingPathAncestorInsideCwd(resolvedPath: string, cwd: string): void {
	let ancestor = path.dirname(resolvedPath);
	while (!fs.existsSync(ancestor)) {
		const parent = path.dirname(ancestor);
		if (parent === ancestor) return;
		ancestor = parent;
	}
	const ancestorRealPath = fs.realpathSync(ancestor);
	if (!isPathInside(cwd, ancestorRealPath)) throw new Error("symlink escapes outside cwd");
}

function normalizeAllowedPaths(value: unknown, cwd: string): string[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("allowedPaths must contain at least one exact file path");
	const normalized: string[] = [];
	for (const entry of value) {
		const raw = stripPathReferencePrefix(normalizeNonEmptyString(entry, "allowedPaths entry"));
		if (raw.trim() === "") throw new Error("allowedPaths entry must be a non-empty string");
		const resolved = path.resolve(cwd, raw);
		if (!isPathInside(cwd, resolved)) throw new Error("allowedPaths entries must stay inside cwd");
		let exactPath = resolved;
		if (fs.existsSync(resolved)) {
			exactPath = fs.realpathSync(resolved);
			const stats = fs.statSync(exactPath);
			if (stats.isDirectory()) throw new Error("allowedPaths entries must be exact file paths, not directories");
			if (stats.isFile()) assertTextFile(exactPath);
		} else {
			assertMissingPathAncestorInsideCwd(resolved, cwd);
		}
		if (!isPathInside(cwd, exactPath)) throw new Error("allowedPaths entries must stay inside cwd");
		normalized.push(exactPath);
	}
	return [...new Set(normalized)];
}

export function normalizeReaderParams(params: ReaderParams, defaultCwd: string): NormalizedReaderParams {
	const model = normalizeOptionalString(params.model, "model");
	const thinking = normalizeThinking(params.thinking);
	const normalized: NormalizedReaderParams = {
		agent: normalizeNonEmptyString(params.agent, "agent"),
		task: normalizeNonEmptyString(params.task, "task"),
		cwd: normalizeReaderCwd(params.cwd, defaultCwd),
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

export function normalizeWriterParams(params: WriterParams, defaultCwd: string): NormalizedWriterParams {
	const model = normalizeOptionalString(params.model, "model");
	const thinking = normalizeThinking(params.thinking);
	const cwd = normalizeExistingCwd(params.cwd, defaultCwd);
	const normalized: NormalizedWriterParams = {
		agent: normalizeNonEmptyString(params.agent, "agent"),
		task: normalizeNonEmptyString(params.task, "task"),
		cwd,
		timeoutMs: normalizeBoundedNumber(params.timeoutMs, "timeoutMs", DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
		maxResultBytes: normalizeBoundedNumber(
			params.maxResultBytes,
			"maxResultBytes",
			DEFAULT_MAX_RESULT_BYTES,
			MIN_MAX_RESULT_BYTES,
			MAX_MAX_RESULT_BYTES,
		),
		includeDiagnostics: normalizeBoolean(params.includeDiagnostics, "includeDiagnostics", false),
		allowedPaths: normalizeAllowedPaths(params.allowedPaths, cwd),
	};
	if (model !== undefined) normalized.model = model;
	if (thinking !== undefined) normalized.thinking = thinking;
	return normalized;
}

function findAgent(name: string, agents: AgentConfig[]): AgentConfig | string {
	const agent = agents.find((candidate) => candidate.name === name);
	if (agent) return agent;
	const available = agents.map((candidate) => candidate.name).join(", ") || "none";
	return `Unknown agent '${name}'. Available agents: ${available}`;
}

export function resolveInvocation(params: NormalizedReaderParams, agents: AgentConfig[]): ResolvedInvocation | string {
	const agent = findAgent(params.agent, agents);
	if (typeof agent === "string") return agent;

	return {
		agent,
		params,
		model: params.model ?? agent.model ?? DEFAULT_READER_MODEL,
		thinking: params.thinking ?? agent.thinking ?? DEFAULT_THINKING,
		tools: [...READER_TOOLS],
		sessionDir: getReaderSessionDir(params.cwd),
	};
}

export function resolveWriterInvocation(params: NormalizedWriterParams, agents: AgentConfig[], sessionDir: string): ResolvedWriterInvocation | string {
	const agent = findAgent(params.agent, agents);
	if (typeof agent === "string") return agent;

	return {
		agent,
		params,
		model: params.model ?? agent.model ?? DEFAULT_WRITER_MODEL,
		thinking: params.thinking ?? agent.thinking ?? DEFAULT_THINKING,
		tools: [...WRITER_TOOLS],
		sessionDir,
	};
}
