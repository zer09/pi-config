import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	THINKING_LEVELS,
	type AgentConfig,
	type ChildProcessResult,
	type DiscoveredAgents,
	type FrontmatterParseResult,
	type JsonEventState,
	type NormalizedSubagentParams,
	type ResolvedInvocation,
	type SubagentParams,
	type SubagentToolResult,
	type TempRunFiles,
	type ThinkingLevel,
} from "./types.ts";

export const CHILD_MARKER = "PI_SIMPLE_SUBAGENT_CHILD";
export const DEFAULT_MODEL = "openai-codex/gpt-5.3-codex";
export const DEFAULT_THINKING: ThinkingLevel = "medium";
export const DEFAULT_TIMEOUT_MS = 600_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 3_600_000;
export const DEFAULT_MAX_RESULT_BYTES = 24_000;
export const MIN_MAX_RESULT_BYTES = 1_000;
export const MAX_MAX_RESULT_BYTES = 1_000_000;
export const STDERR_TAIL_BYTES = 4_000;

export const READ_TOOLS = [
	"ctx_execute",
	"ctx_execute_file",
	"ctx_batch_execute",
	"ctx_search",
	"ctx_fetch_and_index",
	"ctx_index",
	"context_mode_ctx_execute",
	"context_mode_ctx_execute_file",
	"context_mode_ctx_batch_execute",
	"context_mode_ctx_search",
	"context_mode_ctx_fetch_and_index",
	"context_mode_ctx_index",
];

const SubagentParamsSchema = Type.Object({
	agent: Type.String({ description: "Name of a user-level agent in ~/.pi/agent/agents/*.md" }),
	task: Type.String({ description: "Self-contained read-only task to delegate to the child agent" }),
	model: Type.Optional(Type.String({ description: "Optional Pi model override, passed as --model" })),
	thinking: Type.Optional(
		StringEnum(THINKING_LEVELS, {
			description: "Optional thinking level override, passed as --thinking",
			default: DEFAULT_THINKING,
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the child Pi process" })),
	timeoutMs: Type.Optional(
		Type.Number({
			description: "Child timeout in milliseconds. Default 600000. Clamped to 1000..3600000.",
			minimum: MIN_TIMEOUT_MS,
			maximum: MAX_TIMEOUT_MS,
		}),
	),
	maxResultBytes: Type.Optional(
		Type.Number({
			description: "Maximum bytes returned from the child final result. Default 24000.",
			minimum: MIN_MAX_RESULT_BYTES,
			maximum: MAX_MAX_RESULT_BYTES,
		}),
	),
	includeDiagnostics: Type.Optional(
		Type.Boolean({ description: "Include bounded child diagnostics in failure results. Default false.", default: false }),
	),
});

function getAgentRoot(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function stripOptionalQuotes(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

export function parseFrontmatter(content: string): FrontmatterParseResult {
	if (!content.startsWith("---")) {
		return { frontmatter: {}, body: content.trim() };
	}

	const lines = content.split(/\r?\n/);
	if (lines[0].trim() !== "---") {
		return { frontmatter: {}, body: content.trim() };
	}

	let endIndex = -1;
	for (let index = 1; index < lines.length; index += 1) {
		if (lines[index].trim() === "---") {
			endIndex = index;
			break;
		}
	}

	if (endIndex === -1) {
		return { frontmatter: {}, body: content.trim() };
	}

	const frontmatter: Record<string, string> = {};
	for (const line of lines.slice(1, endIndex)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf(":");
		if (separator === -1) continue;
		const key = trimmed.slice(0, separator).trim();
		const value = stripOptionalQuotes(trimmed.slice(separator + 1));
		if (key) frontmatter[key] = value;
	}

	return { frontmatter, body: lines.slice(endIndex + 1).join("\n").trim() };
}

function parseModel(value: string | undefined): string | undefined {
	const model = value?.trim();
	if (!model || model === "default") return undefined;
	return model;
}

function parseThinking(value: string | undefined, filePath: string): ThinkingLevel | undefined {
	if (!value) return undefined;
	if ((THINKING_LEVELS as readonly string[]).includes(value)) return value as ThinkingLevel;
	throw new Error(`Invalid thinking level in ${redactSensitiveText(filePath)}: ${value}`);
}

function parseSystemPromptMode(value: string | undefined, filePath: string): "append" | "replace" {
	if (!value) return "append";
	if (value === "append" || value === "replace") return value;
	throw new Error(`Invalid systemPromptMode in ${redactSensitiveText(filePath)}: ${value}`);
}

export function parseAgentFile(filePath: string, content: string): AgentConfig {
	const { frontmatter, body } = parseFrontmatter(content);
	const name = frontmatter.name?.trim();
	if (!name) throw new Error(`Agent file ${redactSensitiveText(filePath)} is missing required frontmatter field "name".`);
	if (!body.trim()) throw new Error(`Agent file ${redactSensitiveText(filePath)} has an empty prompt body.`);

	return {
		name,
		description: frontmatter.description?.trim() || undefined,
		model: parseModel(frontmatter.model),
		thinking: parseThinking(frontmatter.thinking?.trim(), filePath),
		systemPromptMode: parseSystemPromptMode(frontmatter.systemPromptMode?.trim(), filePath),
		systemPrompt: body,
		filePath,
	};
}

export function discoverAgents(agentRoot = getAgentRoot()): DiscoveredAgents {
	const agentsDir = path.join(agentRoot, "agents");
	const agents: AgentConfig[] = [];
	if (!fs.existsSync(agentsDir)) return { agents, agentsDir };

	const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const filePath = path.join(agentsDir, entry.name);
		const content = fs.readFileSync(filePath, "utf8");
		agents.push(parseAgentFile(filePath, content));
	}

	const byName = new Map<string, AgentConfig>();
	for (const agent of agents) {
		const previous = byName.get(agent.name);
		if (previous) {
			throw new Error(
				`Duplicate agent name "${agent.name}" in ${redactSensitiveText(previous.filePath)} and ${redactSensitiveText(agent.filePath)}.`,
			);
		}
		byName.set(agent.name, agent);
	}

	return { agents: agents.sort((a, b) => a.name.localeCompare(b.name)), agentsDir };
}

function normalizeNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Parameter "${field}" must be a non-empty string.`);
	}
	return value.trim();
}

function normalizeThinking(value: unknown): ThinkingLevel | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value)) return value as ThinkingLevel;
	throw new Error(`Parameter "thinking" must be one of: ${THINKING_LEVELS.join(", ")}.`);
}

function normalizeOptionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	return normalizeNonEmptyString(value, field);
}

function normalizeBoolean(value: unknown, field: string, defaultValue: boolean): boolean {
	if (value === undefined) return defaultValue;
	if (typeof value === "boolean") return value;
	throw new Error(`Parameter "${field}" must be a boolean.`);
}

function normalizeBoundedNumber(value: unknown, field: string, defaultValue: number, min: number, max: number): number {
	if (value === undefined) return defaultValue;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Parameter "${field}" must be a finite number.`);
	}
	return Math.max(min, Math.min(max, Math.floor(value)));
}

export function normalizeParams(params: SubagentParams, defaultCwd: string): NormalizedSubagentParams {
	const cwdInput = normalizeOptionalString(params.cwd, "cwd");
	const cwd = path.resolve(defaultCwd, cwdInput ?? ".");
	let stat: fs.Stats;
	try {
		stat = fs.statSync(cwd);
	} catch {
		throw new Error(`Parameter "cwd" does not exist: ${redactSensitiveText(cwd)}.`);
	}
	if (!stat.isDirectory()) throw new Error(`Parameter "cwd" is not a directory: ${redactSensitiveText(cwd)}.`);

	return {
		agent: normalizeNonEmptyString(params.agent, "agent"),
		task: normalizeNonEmptyString(params.task, "task"),
		model: normalizeOptionalString(params.model, "model"),
		thinking: normalizeThinking(params.thinking),
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
	};
}

export function resolveTools(): string[] {
	return READ_TOOLS;
}

export function resolveInvocation(params: NormalizedSubagentParams, agents: AgentConfig[]): ResolvedInvocation | string {
	const agent = agents.find((candidate) => candidate.name === params.agent);
	if (!agent) {
		const available = agents.map((candidate) => candidate.name).join(", ") || "none";
		return `Unknown agent "${params.agent}". Available agents: ${available}.`;
	}

	return {
		agent,
		params,
		model: params.model ?? agent.model ?? DEFAULT_MODEL,
		thinking: params.thinking ?? agent.thinking ?? DEFAULT_THINKING,
		tools: resolveTools(),
	};
}

export function buildSystemPrompt(agent: AgentConfig): string {
	const readOnlyContract = [
		"Mode: read-only.",
		"You may inspect files, run read-only checks, and report findings.",
		"Do not edit files.",
		"Do not create files.",
		"Do not mutate external hosted services.",
		"Use Context Mode tools for shell commands, logs, tests, builds, and large output.",
		"Direct bash, edit, and write tools are not available.",
		"If a mutation appears necessary, return a recommended patch or checklist instead.",
	].join("\n");

	return [
		"# Pi Simple Subagent Boundary",
		"You are a child Pi agent launched by the parent subagent tool.",
		"Do not call subagent, delegate_subagent, or any recursive delegation tool even if one appears available.",
		"Load and follow ~/.pi/agent/AGENTS.md and the Context Watcher skill before tool use.",
		"Use Context Mode for shell commands, read-only operations, logs, tests, builds, and large output when those tools are available.",
		"Use RTK as the default prefix for read-only shell work when available.",
		"Use Code Review Graph first for supported code exploration and review tasks.",
		"Use gh-cli and authenticated gh through Context Mode/RTK for GitHub repo, PR, issue, workflow, release, review, comment, or private GitHub data.",
		"Treat external hosted services as read-only unless this delegated task explicitly authorizes the exact mutation.",
		"Return compact structured findings only. Do not include raw logs, broad dumps, or secrets.",
		"",
		"# Read-only Contract",
		readOnlyContract,
		"",
		"# Agent Role Prompt",
		agent.systemPrompt.trim(),
		"",
		"# Output Contract",
		"Final response must be compact markdown with these headings:",
		"",
		"## Result",
		"## Evidence",
		"## Changes",
		"## Validation",
		"## Risks",
		"## Next step",
		"",
		"Use None for sections that do not apply.",
		"Do not include raw command output over 20 lines.",
		"Do not include secrets.",
		"Redact user-specific home paths to ~.",
	].join("\n");
}

export function buildTaskPrompt(invocation: ResolvedInvocation): string {
	return [
		"# Delegated Read-only Task",
		`Agent: ${invocation.agent.name}`,
		"The parent did not authorize file edits. Return findings only.",
		"",
		"## Task",
		invocation.params.task,
	].join("\n");
}

export async function createTempRunFiles(invocation: ResolvedInvocation): Promise<TempRunFiles> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-simple-subagent-"));
	const promptPath = path.join(dir, "system-prompt.md");
	const taskPath = path.join(dir, "task.md");
	await fs.promises.writeFile(promptPath, buildSystemPrompt(invocation.agent), {
		encoding: "utf8",
		mode: 0o600,
	});
	await fs.promises.writeFile(taskPath, buildTaskPrompt(invocation), { encoding: "utf8", mode: 0o600 });
	return { dir, promptPath, taskPath };
}

async function cleanupTempRunFiles(files: TempRunFiles | undefined): Promise<void> {
	if (!files) return;
	await fs.promises.rm(files.dir, { recursive: true, force: true });
}

export function buildPiArgs(invocation: ResolvedInvocation, files: TempRunFiles): string[] {
	return [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--model",
		invocation.model,
		"--thinking",
		invocation.thinking,
		"--append-system-prompt",
		files.promptPath,
		"--tools",
		invocation.tools.join(","),
		`@${files.taskPath}`,
	];
}

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const override = process.env.PI_SIMPLE_SUBAGENT_BIN;
	if (override) return { command: override, args };

	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) return { command: process.execPath, args };

	return { command: "pi", args };
}

function emptyEventState(): JsonEventState {
	return {
		finalText: "",
		streamingText: "",
		lastError: "",
		toolCallCount: 0,
	};
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

function appendTail(current: string, next: string, maxBytes: number): string {
	const combined = current + next;
	const buffer = Buffer.from(combined, "utf8");
	if (buffer.byteLength <= maxBytes) return combined;
	return buffer.subarray(buffer.byteLength - maxBytes).toString("utf8");
}

function killChild(proc: ReturnType<typeof spawn>): void {
	if (proc.exitCode !== null || proc.signalCode !== null) return;
	try {
		proc.kill("SIGTERM");
	} catch {
		return;
	}
	setTimeout(() => {
		if (proc.exitCode === null && proc.signalCode === null) {
			try {
				proc.kill("SIGKILL");
			} catch {
				/* ignore */
			}
		}
	}, 5_000).unref?.();
}

async function runChildProcess(
	invocation: { command: string; args: string[] },
	cwd: string,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<ChildProcessResult> {
	const state = emptyEventState();
	let stderrTail = "";
	let lineBuffer = "";
	let forcedStatus: RunStatus | undefined;

	if (signal?.aborted) {
		return { status: "aborted", exitCode: null, stderrTail: "", state };
	}

	return new Promise((resolve) => {
		let settled = false;
		const proc = spawn(invocation.command, invocation.args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, [CHILD_MARKER]: "1" },
		});

		const timeout = setTimeout(() => {
			forcedStatus = "timeout";
			killChild(proc);
		}, timeoutMs);
		timeout.unref?.();

		const abortHandler = () => {
			forcedStatus = "aborted";
			killChild(proc);
		};
		if (signal) signal.addEventListener("abort", abortHandler, { once: true });

		const finish = (result: ChildProcessResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (signal) signal.removeEventListener("abort", abortHandler);
			resolve(result);
		};

		proc.stdout?.on("data", (chunk) => {
			lineBuffer += chunk.toString("utf8");
			if (Buffer.byteLength(lineBuffer, "utf8") > 128_000) {
				lineBuffer = appendTail("", lineBuffer, 128_000);
			}
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) applyJsonEventLine(line, state);
		});

		proc.stderr?.on("data", (chunk) => {
			stderrTail = appendTail(stderrTail, chunk.toString("utf8"), STDERR_TAIL_BYTES);
		});

		proc.on("error", (error) => {
			finish({
				status: forcedStatus ?? "failed",
				exitCode: null,
				stderrTail,
				error: error.message,
				state,
			});
		});

		proc.on("close", (code) => {
			if (lineBuffer.trim()) applyJsonEventLine(lineBuffer, state);
			const hasModelError = state.stopReason === "error" || state.stopReason === "aborted" || Boolean(state.errorMessage);
			const status = forcedStatus ?? (code === 0 && !hasModelError ? "completed" : "failed");
			finish({ status, exitCode: code, stderrTail, state });
		});
	});
}

export function redactSensitiveText(text: string): string {
	let redacted = text;
	const home = os.homedir();
	if (home && home !== "/") {
		redacted = redacted.split(home).join("~");
	}
	redacted = redacted.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>");
	redacted = redacted.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "<redacted>");
	redacted = redacted.replace(
		/\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|API_KEY|PRIVATE)[A-Za-z0-9_]*)\s*[:=]\s*([^\s"'`]+)/gi,
		"$1=<redacted>",
	);
	return redacted;
}

export function truncateMiddleByBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.byteLength <= maxBytes) return { text, truncated: false };

	const marker = `\n\n[truncated child result to ${maxBytes} bytes]\n\n`;
	const markerBytes = Buffer.byteLength(marker, "utf8");
	const available = Math.max(0, maxBytes - markerBytes);
	const headBytes = Math.floor(available * 0.7);
	const tailBytes = available - headBytes;
	const head = buffer.subarray(0, headBytes).toString("utf8");
	const tail = buffer.subarray(buffer.byteLength - tailBytes).toString("utf8");
	return { text: head + marker + tail, truncated: true };
}

function resultTextFromChild(child: ChildProcessResult): string {
	return child.state.finalText || child.state.streamingText.trim();
}

function buildFailureText(child: ChildProcessResult, includeDiagnostics: boolean): string {
	const parts = [
		`Subagent ${child.status}.`,
		`Exit code: ${child.exitCode ?? "unknown"}.`,
		"Child stdout/stderr were intentionally not imported into parent context.",
	];
	const finalText = resultTextFromChild(child);
	if (finalText) {
		parts.push("", "Child final message:", finalText);
	}
	const diagnostic = child.error || child.state.errorMessage || child.state.lastError || child.stderrTail;
	if ((includeDiagnostics || !finalText) && diagnostic) {
		parts.push("", "Bounded diagnostics:", diagnostic);
	}
	return parts.join("\n");
}

function makeToolResult(
	invocation: ResolvedInvocation,
	child: ChildProcessResult,
	durationMs: number,
): SubagentToolResult {
	const rawText = child.status === "completed" ? resultTextFromChild(child) || "(no output)" : buildFailureText(child, invocation.params.includeDiagnostics);
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
			...(invocation.params.includeDiagnostics && stderr ? { stderrTail: stderr } : {}),
			...(child.error ? { error: redactSensitiveText(child.error) } : {}),
		},
	};
}

function makeImmediateFailure(
	params: NormalizedSubagentParams,
	agentName: string,
	message: string,
	durationMs: number,
): SubagentToolResult {
	const redacted = redactSensitiveText(message);
	const truncated = truncateMiddleByBytes(redacted, params.maxResultBytes);
	return {
		content: [{ type: "text", text: truncated.text }],
		details: {
			agent: agentName,
			model: params.model ?? DEFAULT_MODEL,
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

export async function runSubagent(
	params: SubagentParams,
	defaultCwd: string,
	signal?: AbortSignal,
): Promise<SubagentToolResult> {
	const started = Date.now();
	const normalized = normalizeParams(params, defaultCwd);
	const discovery = discoverAgents();
	const resolved = resolveInvocation(normalized, discovery.agents);
	if (typeof resolved === "string") {
		return makeImmediateFailure(normalized, normalized.agent, resolved, Date.now() - started);
	}

	let tempFiles: TempRunFiles | undefined;
	try {
		tempFiles = await createTempRunFiles(resolved);
		const args = buildPiArgs(resolved, tempFiles);
		const invocation = getPiInvocation(args);
		const child = await runChildProcess(invocation, normalized.cwd, signal, normalized.timeoutMs);
		return makeToolResult(resolved, child, Date.now() - started);
	} finally {
		await cleanupTempRunFiles(tempFiles);
	}
}

export default function (pi: ExtensionAPI) {
	if (process.env[CHILD_MARKER] === "1") return;

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate one synchronous read-only task to a user-level Pi sub-agent in an isolated child process.",
			"The child receives only Context Mode read tools and cannot edit files.",
			"Returns only the child final summary and compact metadata; raw child logs are not imported.",
		].join(" "),
		promptSnippet: "Delegate a bounded task to a user-level Pi sub-agent with isolated context.",
		promptGuidelines: [
			"Use subagent only for isolated investigation, review, testing, documentation research, or consistency checks that are worth child startup overhead.",
			"When using subagent, make the read-only task self-contained with file paths, exact questions, and expected output.",
			"Do not use subagent recursively; child sessions disable this tool with PI_SIMPLE_SUBAGENT_CHILD=1.",
		],
		parameters: SubagentParamsSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			try {
				return await runSubagent(params as SubagentParams, ctx.cwd, signal);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const fallbackParams: NormalizedSubagentParams = {
					agent: typeof (params as SubagentParams).agent === "string" ? (params as SubagentParams).agent : "unknown",
					task: typeof (params as SubagentParams).task === "string" ? (params as SubagentParams).task : "",
					cwd: ctx.cwd,
					timeoutMs: DEFAULT_TIMEOUT_MS,
					maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
					includeDiagnostics: false,
				};
				return makeImmediateFailure(fallbackParams, fallbackParams.agent, message, 0);
			}
		},
	});
}
