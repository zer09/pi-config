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
import { getContinuedReaderSessionDir } from "./paths.ts";
import { containsSecretValue } from "./redaction.ts";
import { assertTextFile } from "./text-files.ts";
import { READER_TOOLS, WRITER_TOOLS } from "./toolsets.ts";
import {
	THINKING_LEVELS,
	type AgentConfig,
	type NormalizedReaderParams,
	type NormalizedWriterParams,
	type ReaderParams,
	type ResolvedInvocation,
	type ResolvedReaderInvocation,
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

function normalizeReaderContinueSession(value: unknown): boolean {
	return normalizeBoolean(value, "continueSession", false);
}

const MAX_READER_SESSION_KEY_LENGTH = 512;
const SECRET_LOOKING_SESSION_KEY_PATTERN = /(?:TOKEN|API_KEY|SECRET|PASSWORD|PRIVATE|BEARER|AUTH)\s*=/i;

function normalizeReaderSessionKey(value: unknown, continueSession: boolean): string | undefined {
	if (value === undefined) {
		if (continueSession) throw new Error("sessionKey is required when continueSession is true");
		return undefined;
	}
	if (typeof value !== "string") throw new Error("sessionKey must be a string");
	if (value.length > MAX_READER_SESSION_KEY_LENGTH) throw new Error(`sessionKey must be at most ${MAX_READER_SESSION_KEY_LENGTH} characters`);
	const trimmed = value.trim();
	if (trimmed === "") throw new Error("sessionKey must be a non-empty string");
	if (SECRET_LOOKING_SESSION_KEY_PATTERN.test(trimmed)) throw new Error("sessionKey must not contain secret-looking key/value material");
	if (containsSecretValue(trimmed)) throw new Error("sessionKey must not contain secret-looking credential material");
	if (!continueSession) throw new Error("sessionKey requires continueSession to be true");
	return trimmed;
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
	const continueSession = normalizeReaderContinueSession(params.continueSession);
	const sessionKey = normalizeReaderSessionKey(params.sessionKey, continueSession);
	const normalized: NormalizedReaderParams = {
		agent: normalizeNonEmptyString(params.agent, "agent"),
		task: normalizeNonEmptyString(params.task, "task"),
		cwd: normalizeExistingCwd(params.cwd, defaultCwd),
		timeoutMs: normalizeBoundedNumber(params.timeoutMs, "timeoutMs", DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
		maxResultBytes: normalizeBoundedNumber(
			params.maxResultBytes,
			"maxResultBytes",
			DEFAULT_MAX_RESULT_BYTES,
			MIN_MAX_RESULT_BYTES,
			MAX_MAX_RESULT_BYTES,
		),
		includeDiagnostics: normalizeBoolean(params.includeDiagnostics, "includeDiagnostics", false),
		continueSession,
	};
	if (model !== undefined) normalized.model = model;
	if (thinking !== undefined) normalized.thinking = thinking;
	if (sessionKey !== undefined) normalized.sessionKey = sessionKey;
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

export function resolveReaderInvocation(params: NormalizedReaderParams, agents: AgentConfig[], sessionDir: string): ResolvedReaderInvocation | string {
	const agent = findAgent(params.agent, agents);
	if (typeof agent === "string") return agent;

	return {
		agent,
		params,
		model: params.model ?? agent.model ?? DEFAULT_READER_MODEL,
		thinking: params.thinking ?? agent.thinking ?? DEFAULT_THINKING,
		tools: [...READER_TOOLS],
		sessionDir,
		sessionMode: params.continueSession ? "continued" : "fresh",
	};
}

export function resolveInvocation(params: NormalizedReaderParams, agents: AgentConfig[], sessionDir?: string): ResolvedInvocation | string {
	if (!params.continueSession && sessionDir === undefined) return "Fresh reader invocation requires an explicit sessionDir";
	return resolveReaderInvocation(
		params,
		agents,
		sessionDir ?? getContinuedReaderSessionDir(params.cwd, params.agent, params.sessionKey ?? ""),
	);
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
