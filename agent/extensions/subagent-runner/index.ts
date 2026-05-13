import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const AGENTS = ["investigator", "reviewer", "tester", "docs-researcher", "oracle"] as const;
const MODES = ["read", "write"] as const;
const STATUSES = new Set(["ok", "blocked", "error"]);
const CONFIDENCE = new Set(["low", "medium", "high"]);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_JSON_LINE_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 2 * 1024 * 1024;
const MAX_SUMMARY_CHARS = 800;
const MAX_FINDING_CHARS = 2_000;
const MAX_FIELD_CHARS = 1_200;
const MAX_ARRAY_ITEMS = 40;
const MAX_EVIDENCE_ITEMS = 20;
const MAX_MODEL_SUGGESTIONS = 8;
const MODEL_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const SUBAGENT_ROOT = join(homedir(), ".pi", "agent", "subagent-sessions");
const AGENT_ROOT = join(homedir(), ".pi", "agent", "agents");
const LOG_DIR = join(homedir(), ".pi", "logs");
const LOG_FILE = join(LOG_DIR, "subagent-runner.log");
const HOME_PREFIX = homedir();

const SECRET_KEY_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|API_KEY|PRIVATE)/i;
const SECRET_ASSIGNMENT_PATTERN = /\b((?!Authorization\b)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|API_KEY|PRIVATE)[A-Z0-9_]*)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN_PATTERN = /\b(Authorization\s*:\s*Bearer\s+)[^\s,;]+/gi;
const PROVIDER_TOKEN_PATTERN = /\b(?:gh[pousr]_|xox[baprs]-|AIza)[0-9A-Za-z_-]+\b/g;

type AgentName = (typeof AGENTS)[number];
type Mode = (typeof MODES)[number];
type Status = "ok" | "blocked" | "error";
type Confidence = "low" | "medium" | "high";

type AvailableModel = {
	provider: string;
	model: string;
};

type ModelSelector = {
	raw: string;
	provider?: string;
	model: string;
	thinkingSuffix: string;
};

type ModelResolution = {
	ok: true;
	requested: string;
	model: string;
	suggestions: string[];
} | {
	ok: false;
	requested: string;
	diagnostic: string;
	blockers: string[];
	suggestions: string[];
	command?: string;
};

type Evidence = {
	file?: string;
	line?: number;
	symbol?: string;
	command?: string;
	reason: string;
};

type SubagentParams = {
	agent: AgentName;
	task: string;
	cwd?: string;
	workstream?: string;
	mode?: Mode;
	timeoutMs?: number;
	model?: string;
	reset?: boolean;
	allowRecursive?: boolean;
};

type SubagentResult = {
	status: Status;
	agent: AgentName;
	summary: string;
	finding: string;
	evidence: Evidence[];
	toolsUsed: string[];
	filesRead: string[];
	filesChanged: string[];
	confidence: Confidence;
	blockers: string[];
	recommendedNextStep: string;
	workstream?: string;
	sessionDir?: string;
	sessionId?: string;
	durationMs?: number;
};

export type ObservedChildState = {
	finalText: string;
	currentAssistantText: string;
	inAssistantMessage: boolean;
	sessionId?: string;
	toolsUsed: Set<string>;
	parseErrors: number;
	skippedLargeLines: number;
};

export function sanitizeSlug(value: string, fallback = "default"): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/\.{2,}/g, ".")
		.replace(/^[._-]+|[._-]+$/g, "")
		.slice(0, 80);
	return slug && slug !== "." && slug !== ".." ? slug : fallback;
}

export function deriveWorkstream(cwd: string, task: string, explicit?: string): string {
	if (explicit?.trim()) return sanitizeSlug(explicit.trim(), "default");
	const cwdName = sanitizeSlug(basename(cwd).replace(/^\.+/, "") || "root", "root");
	const taskSlug = sanitizeSlug(task.split(/\s+/).slice(0, 6).join("-"), "task");
	return sanitizeSlug(`${cwdName}-${taskSlug}`, "default");
}

export function buildSessionDir(workstream: string, agent: AgentName): string {
	const safeWorkstream = sanitizeSlug(workstream, "default");
	const safeAgent = sanitizeSlug(agent, "agent");
	const dir = resolve(SUBAGENT_ROOT, safeWorkstream, safeAgent);
	const root = resolve(SUBAGENT_ROOT);
	if (dir !== root && dir.startsWith(`${root}/`)) return dir;
	throw new Error("Invalid sub-agent session directory");
}

function readRolePrompt(agent: AgentName): string {
	const file = join(AGENT_ROOT, `${agent}.md`);
	return readFileSync(file, "utf8");
}

export function buildBootstrapPrompt(params: Required<Pick<SubagentParams, "agent" | "task">> & SubagentParams, rolePrompt: string): string {
	const mode = params.mode ?? "read";
	const recursiveRule = params.allowRecursive
		? "Recursive sub-agent calls are allowed only if the parent task explicitly requires them. Keep recursion bounded."
		: "Do not call sub-agent tools recursively.";

	return `# Pi Sub-agent Bootstrap

You are a scoped Pi sub-agent. The parent agent will use only your final structured JSON result.

## Mandatory startup

Before any work:
1. Read and internalize \`~/.pi/agent/AGENTS.md\` (resolve \`~\` locally; do not print the resolved path).
2. Read and internalize \`~/.pi/agent/skills/context-watcher/SKILL.md\` (resolve \`~\` locally; do not print the resolved path).
3. Read any approach-specific rule files required by the task from \`~/.pi/agent/rules/\` (resolve \`~\` locally; do not look for these rule files in the subject repository unless the task explicitly asks).
4. Follow Context Watcher routing exactly.

## Mandatory tool routing

- Use Context Mode for shell commands, read-only command execution, large output, logs, tests, builds, and data processing.
- Context Mode file-processing tools do not expand literal \`~\`. When a Context Mode tool asks for a path, pass an absolute filesystem path that you resolved locally, then redact that path back to \`~\` in your final JSON.
- Use Code Review Graph before grep, find, read, or broad file inspection for code exploration, code review, blast-radius analysis, caller/callee lookup, test discovery, architecture review, or refactor analysis.
- An empty, stale, or incomplete graph is not automatically a graph error. If build/update is authorized by your mode and appropriate for the task, build or update the graph and retry the graph query before using Context Mode fallback. In read-only mode, do not build/update; use Context Mode fallback only after stating that fallback is because build/update was not authorized or would be wasteful for a one-off check.
- Use RTK through Context Mode for read-only shell work when applicable.
- Use direct bash only for whitelisted safe operations.
- Keep raw command output inside Context Mode or this child session. Do not return raw large output to the parent.
- Do not expose secrets, credentials, tokens, or environment variable values.
- In read-only mode, you are already authorized to run read-only Context Mode and Code Review Graph checks. Do not ask the parent for permission before doing required read-only inspection.
- Do not return \`blocked\` merely because no tool query has run yet; run the required read-only query instead. For code tasks, make at least one Code Review Graph or Context Mode tool call before final output unless the parent explicitly says not to use tools.
- Never return an empty object. If genuinely blocked after attempting the required read-only query, return a schema-compliant JSON object with status \`blocked\` and explain the blocker.
- Do not write tool-call syntax, pseudo-code, or commentary in assistant text. Use actual tools when needed, then make your final assistant message only the required JSON object.
- Only cite files, symbols, commands, and line numbers that were verified by actual tool output in this turn. Do not invent paths from memory. Before adding a file to evidence or filesRead, verify that it exists or was returned by a tool.
- ${recursiveRule}

## Mode

The parent selected mode: ${mode}.
${mode === "write"
	? "Write mode is explicitly authorized, but keep changes surgical and report every file changed."
	: "Read-only mode is active. Do not edit files and do not run mutating commands."}

## Role

${rolePrompt.trim()}

## Final output contract

Return only a JSON object. Do not wrap it in markdown. Do not include raw logs, full diffs, broad search output, browser snapshots, or test dumps.

Schema requirements:
- status must be exactly one of ok, blocked, or error. If checks pass, use ok; never use pass, passed, success, or booleans.
- summary, finding, and recommendedNextStep are required strings. Do not use arrays or objects for these fields.
- evidence must be an array of objects, and every evidence object must include a string reason.
- confidence must be exactly one of low, medium, or high.
- Keep every field compact. Do not include raw command output.

Required shape:
{
  "status": "ok | blocked | error",
  "agent": "${params.agent}",
  "summary": "string",
  "finding": "string",
  "evidence": [
    {
      "file": "string, optional",
      "line": "number, optional",
      "symbol": "string, optional",
      "command": "string, optional",
      "reason": "string"
    }
  ],
  "toolsUsed": ["string"],
  "filesRead": ["string"],
  "filesChanged": ["string"],
  "confidence": "low | medium | high",
  "blockers": ["string"],
  "recommendedNextStep": "string"
}`;
}

export function splitModelSelector(value: string): ModelSelector {
	const raw = value.trim();
	let base = raw;
	let thinkingSuffix = "";
	const suffixIndex = raw.lastIndexOf(":");
	if (suffixIndex > 0) {
		const suffix = raw.slice(suffixIndex + 1).trim();
		if (MODEL_THINKING_LEVELS.has(suffix)) {
			base = raw.slice(0, suffixIndex).trim();
			thinkingSuffix = `:${suffix}`;
		}
	}

	const slashIndex = base.indexOf("/");
	if (slashIndex > 0 && slashIndex < base.length - 1) {
		return {
			raw,
			provider: base.slice(0, slashIndex).trim(),
			model: base.slice(slashIndex + 1).trim(),
			thinkingSuffix,
		};
	}

	return { raw, model: base, thinkingSuffix };
}

function formatModelSuggestion(model: AvailableModel, thinkingSuffix = ""): string {
	return `${model.provider}/${model.model}${thinkingSuffix}`;
}

function uniqueSuggestions(models: AvailableModel[], thinkingSuffix = ""): string[] {
	return [...new Set(models.map((model) => formatModelSuggestion(model, thinkingSuffix)))].slice(0, MAX_MODEL_SUGGESTIONS);
}

export function parseListModelsOutput(output: string): AvailableModel[] {
	const models: AvailableModel[] = [];
	let inTable = false;
	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (/^provider\s+model\s+/i.test(line)) {
			inTable = true;
			continue;
		}
		if (!inTable || line.startsWith("[") || /^No models matching/i.test(line)) continue;
		const match = line.match(/^(\S+)\s+(\S+)\s+/);
		if (!match) continue;
		models.push({ provider: match[1], model: match[2] });
	}
	return models;
}

export function resolveModelFromListOutput(requestedModel: string, listModelsOutput: string): ModelResolution {
	const selector = splitModelSelector(requestedModel);
	if (!selector.raw || !selector.model) {
		return { ok: false, requested: requestedModel, diagnostic: "Sub-agent model is blank.", blockers: ["invalid_model"], suggestions: [] };
	}

	const candidates = parseListModelsOutput(listModelsOutput);
	const sameModel = candidates.filter((candidate) => candidate.model === selector.model);
	const matching = selector.provider
		? sameModel.filter((candidate) => candidate.provider === selector.provider)
		: sameModel;

	if (matching.length === 1) {
		return {
			ok: true,
			requested: requestedModel,
			model: formatModelSuggestion(matching[0], selector.thinkingSuffix),
			suggestions: uniqueSuggestions(candidates, selector.thinkingSuffix),
		};
	}

	if (matching.length > 1) {
		const suggestions = uniqueSuggestions(matching, selector.thinkingSuffix);
		return {
			ok: false,
			requested: requestedModel,
			diagnostic: `Sub-agent model "${requestedModel}" is ambiguous. Use a provider-qualified model id such as ${suggestions.join(", ")}.`,
			blockers: ["ambiguous_model"],
			suggestions,
		};
	}

	const suggestions = uniqueSuggestions(sameModel.length ? sameModel : candidates, selector.thinkingSuffix);
	const diagnostic = suggestions.length
		? `Sub-agent model "${requestedModel}" is not an exact available model. Use a provider-qualified model id such as ${suggestions.join(", ")}.`
		: `Sub-agent model "${requestedModel}" is not available according to Pi's model list.`;
	return { ok: false, requested: requestedModel, diagnostic, blockers: ["invalid_model"], suggestions };
}

function resolveSubagentModel(model: string | undefined): ModelResolution | null {
	if (!model?.trim()) return null;
	const selector = splitModelSelector(model);
	const command = process.env.PI_SUBAGENT_PI_BIN || "pi";
	const args = ["--list-models", selector.model];
	const result = spawnSync(command, args, {
		encoding: "utf8",
		env: process.env,
		maxBuffer: 1024 * 1024,
		timeout: 30_000,
	});
	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
	if (result.error) {
		return {
			ok: false,
			requested: model,
			diagnostic: `Could not validate sub-agent model "${model}": ${replaceHome(result.error.message)}`,
			blockers: ["model_validation_failed"],
			suggestions: [],
			command: `${command} --list-models ${selector.model}`,
		};
	}
	if (typeof result.status === "number" && result.status !== 0) {
		return {
			ok: false,
			requested: model,
			diagnostic: `Could not validate sub-agent model "${model}" because \`${command} --list-models ${selector.model}\` exited with code ${result.status}.`,
			blockers: ["model_validation_failed"],
			suggestions: [],
			command: `${command} --list-models ${selector.model}`,
		};
	}

	const resolution = resolveModelFromListOutput(model, output);
	if (!resolution.ok) return { ...resolution, command: `${command} --list-models ${selector.model}` };
	return resolution;
}

export function buildPiArgs(params: SubagentParams, sessionDir: string, bootstrapPrompt: string): string[] {
	const args = ["--mode", "json", "--session-dir", sessionDir];
	if (!params.reset) args.push("--continue");
	args.push("--append-system-prompt", bootstrapPrompt);
	if (params.model?.trim()) args.push("--model", params.model.trim());
	args.push(`Sub-agent task:\n${params.task}`);
	return args;
}

function extractAssistantText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const candidate = message as { content?: unknown };
	if (typeof candidate.content === "string") return candidate.content;
	if (!Array.isArray(candidate.content)) return "";
	return candidate.content
		.filter((part): part is { type: string; text: string } => Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")
		.map((part) => part.text)
		.join("");
}

export function observeJsonLine(line: string, state: ObservedChildState): void {
	const trimmed = line.trim();
	if (!trimmed) return;
	let event: any;
	try {
		event = JSON.parse(trimmed);
	} catch {
		state.parseErrors += 1;
		return;
	}

	if (event?.type === "session" && typeof event.id === "string") state.sessionId = event.id;
	if (typeof event?.toolName === "string") state.toolsUsed.add(event.toolName);
	if (event?.toolCall && typeof event.toolCall.name === "string") state.toolsUsed.add(event.toolCall.name);

	if (event?.type === "message" && event.message?.role === "assistant") {
		const text = extractAssistantText(event.message);
		if (text.trim()) {
			state.finalText = text;
			state.currentAssistantText = text;
		}
		state.inAssistantMessage = false;
	}

	if (event?.type === "message_start") {
		state.inAssistantMessage = event.message?.role === "assistant";
		if (state.inAssistantMessage) state.currentAssistantText = "";
	}

	if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
		state.inAssistantMessage = true;
		state.currentAssistantText += event.assistantMessageEvent.delta;
		if (state.currentAssistantText.trim()) state.finalText = state.currentAssistantText;
	}

	if (Array.isArray(event?.toolResults)) {
		for (const result of event.toolResults) {
			if (typeof result?.toolName === "string") state.toolsUsed.add(result.toolName);
		}
	}

	if (event?.type === "message_end" && event.message?.role === "assistant") {
		const text = extractAssistantText(event.message) || state.currentAssistantText;
		if (text.trim()) state.finalText = text;
		state.inAssistantMessage = false;
	}

	if (event?.type === "turn_end") {
		const text = extractAssistantText(event.message) || state.currentAssistantText;
		if (text.trim()) state.finalText = text;
	}

	if (event?.type === "agent_end" && Array.isArray(event.messages)) {
		for (let index = event.messages.length - 1; index >= 0; index -= 1) {
			const message = event.messages[index];
			if (message?.role === "assistant") {
				const text = extractAssistantText(message);
				if (text.trim()) state.finalText = text;
				break;
			}
		}
	}
}

export function parseJsonObject(text: string): unknown | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	const candidate = fenced ? fenced[1].trim() : trimmed;

	try {
		return JSON.parse(candidate);
	} catch {
		const first = candidate.indexOf("{");
		const last = candidate.lastIndexOf("}");
		if (first === -1 || last === -1 || last <= first) return null;
		try {
			return JSON.parse(candidate.slice(first, last + 1));
		} catch {
			return null;
		}
	}
}

function compactString(value: unknown, fallback: string, maxChars = MAX_FIELD_CHARS): string {
	let text = "";
	if (typeof value === "string") {
		text = value.trim();
	} else if (value !== undefined && value !== null) {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}
	if (!text) text = fallback;
	text = replaceHome(text);
	return text.length > maxChars ? `${text.slice(0, maxChars)}...[truncated]` : text;
}

function normalizeStatus(value: unknown): Status | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === "ok" || normalized === "pass" || normalized === "passed" || normalized === "success" || normalized === "succeeded") return "ok";
	if (normalized === "blocked" || normalized === "block") return "blocked";
	if (normalized === "error" || normalized === "fail" || normalized === "failed" || normalized === "failure") return "error";
	return null;
}

function normalizeConfidence(value: unknown): Confidence {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (CONFIDENCE.has(normalized)) return normalized as Confidence;
		if (normalized === "certain") return "high";
		if (normalized === "unknown") return "low";
	}
	return "medium";
}

function asStringArray(value: unknown, maxItems = MAX_ARRAY_ITEMS): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.slice(0, maxItems)
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => compactString(item, "", MAX_FIELD_CHARS));
}

function evidenceReason(item: unknown): string {
	if (typeof item === "string") return compactString(item, "Evidence item", MAX_FIELD_CHARS);
	if (!item || typeof item !== "object") return compactString(item, "Evidence item", MAX_FIELD_CHARS);
	const record = item as Record<string, unknown>;
	if (typeof record.reason === "string" && record.reason.trim()) return compactString(record.reason, "Evidence item", MAX_FIELD_CHARS);
	if (typeof record.detail === "string" && record.detail.trim()) return compactString(record.detail, "Evidence item", MAX_FIELD_CHARS);
	const check = typeof record.check === "string" ? record.check : undefined;
	const result = typeof record.result === "string" ? record.result : undefined;
	if (check || result) return compactString([check, result].filter(Boolean).join(": "), "Evidence item", MAX_FIELD_CHARS);
	return compactString(record, "Evidence item", MAX_FIELD_CHARS);
}

function normalizeEvidence(value: unknown): Evidence[] {
	const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
	return items.slice(0, MAX_EVIDENCE_ITEMS).map((item) => {
		if (!item || typeof item !== "object") return { reason: evidenceReason(item) };
		const record = item as Record<string, unknown>;
		return {
			...(typeof record.file === "string" ? { file: compactString(record.file, "", MAX_FIELD_CHARS) } : typeof record.path === "string" ? { file: compactString(record.path, "", MAX_FIELD_CHARS) } : {}),
			...(typeof record.line === "number" ? { line: record.line } : {}),
			...(typeof record.symbol === "string" ? { symbol: compactString(record.symbol, "", MAX_FIELD_CHARS) } : {}),
			...(typeof record.command === "string" ? { command: compactString(record.command, "", MAX_FIELD_CHARS) } : {}),
			reason: evidenceReason(record),
		};
	});
}

export function validateAndNormalize(value: unknown, params: SubagentParams, observed: ObservedChildState, metadata: { workstream: string; sessionDir: string; durationMs: number }): SubagentResult | null {
	if (!value || typeof value !== "object") return null;
	const input = value as Record<string, unknown>;
	const status = normalizeStatus(input.status);
	if (!status) return null;

	const confidence = normalizeConfidence(input.confidence);
	const recommendedCandidate = input.recommendedNextStep ?? input.recommended_next_step ?? (Array.isArray(input.recommended_next_steps) ? input.recommended_next_steps[0] : input.recommended_next_steps);
	const summary = compactString(input.summary ?? input.finding, "Sub-agent returned a structured result.", MAX_SUMMARY_CHARS);
	const finding = compactString(input.finding ?? input.summary, "No specific finding returned.", MAX_FINDING_CHARS);
	const recommendedNextStep = compactString(recommendedCandidate, "Review the sub-agent result and decide the next step.", MAX_FIELD_CHARS);

	const toolsUsed = [...new Set([...asStringArray(input.toolsUsed), ...observed.toolsUsed])].sort();
	return {
		status,
		agent: params.agent,
		summary,
		finding,
		evidence: normalizeEvidence(input.evidence),
		toolsUsed,
		filesRead: asStringArray(input.filesRead),
		filesChanged: asStringArray(input.filesChanged),
		confidence,
		blockers: asStringArray(input.blockers),
		recommendedNextStep,
		workstream: metadata.workstream,
		sessionDir: replaceHome(metadata.sessionDir),
		sessionId: observed.sessionId,
		durationMs: metadata.durationMs,
	};
}

function replaceHome(value: string): string {
	return value.startsWith(HOME_PREFIX) ? `~${value.slice(HOME_PREFIX.length)}` : value.replaceAll(HOME_PREFIX, "~");
}

export function redactForReturn(value: unknown, key = ""): unknown {
	if (SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
	if (typeof value === "string") {
		return replaceHome(value)
			.replace(BEARER_TOKEN_PATTERN, "$1[REDACTED]")
			.replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
			.replace(PROVIDER_TOKEN_PATTERN, "[REDACTED_TOKEN]");
	}
	if (Array.isArray(value)) return value.map((item) => redactForReturn(item));
	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [entryKey, entryValue] of Object.entries(value)) {
			output[entryKey] = redactForReturn(entryValue, entryKey);
		}
		return output;
	}
	return value;
}

function makeError(params: Pick<SubagentParams, "agent">, summary: string, diagnostic: string, blockers: string[], extra: Partial<SubagentResult> = {}): SubagentResult {
	return {
		status: "error",
		agent: params.agent,
		summary,
		finding: diagnostic,
		evidence: [],
		toolsUsed: [],
		filesRead: [],
		filesChanged: [],
		confidence: "low",
		blockers,
		recommendedNextStep: "Inspect the child session and rerun with a narrower task.",
		...extra,
	};
}

function logMetadata(record: Record<string, unknown>): void {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(LOG_FILE, `${JSON.stringify(redactForReturn(record))}\n`);
	} catch {
		// Logging must never break the tool.
	}
}

async function runChildPi(args: string[], options: { cwd: string; timeoutMs: number; signal?: AbortSignal; env: NodeJS.ProcessEnv }): Promise<{ state: ObservedChildState; code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; outputCapExceeded: boolean; stderr: string }> {
	const command = process.env.PI_SUBAGENT_PI_BIN || "pi";
	const state: ObservedChildState = { finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(), parseErrors: 0, skippedLargeLines: 0 };
	let stdoutBuffer = "";
	let stdoutBufferBytes = 0;
	let skippingStdoutLine = false;
	let stderrBytes = 0;
	let stderr = "";
	let timedOut = false;
	let outputCapExceeded = false;

	return await new Promise((resolvePromise) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const killChild = () => {
			if (!child.killed) child.kill("SIGTERM");
			setTimeout(() => {
				if (!child.killed) child.kill("SIGKILL");
			}, 2_000).unref();
		};

		const timeout = setTimeout(() => {
			timedOut = true;
			killChild();
		}, options.timeoutMs);
		timeout.unref();

		options.signal?.addEventListener("abort", () => {
			killChild();
		}, { once: true });

		child.stdout?.on("data", (chunk: Buffer) => {
			let remaining = chunk.toString("utf8");
			while (remaining) {
				const newlineIndex = remaining.indexOf("\n");
				const piece = newlineIndex === -1 ? remaining : remaining.slice(0, newlineIndex);
				const endedLine = newlineIndex !== -1;
				remaining = endedLine ? remaining.slice(newlineIndex + 1) : "";

				if (skippingStdoutLine) {
					if (endedLine) skippingStdoutLine = false;
					continue;
				}

				const pieceBytes = Buffer.byteLength(piece, "utf8");
				if (stdoutBufferBytes + pieceBytes > MAX_JSON_LINE_BYTES) {
					state.skippedLargeLines += 1;
					stdoutBuffer = "";
					stdoutBufferBytes = 0;
					skippingStdoutLine = !endedLine;
					continue;
				}

				stdoutBuffer += piece;
				stdoutBufferBytes += pieceBytes;
				if (endedLine) {
					observeJsonLine(stdoutBuffer, state);
					stdoutBuffer = "";
					stdoutBufferBytes = 0;
				}
			}
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.length;
			if (stderr.length < MAX_FIELD_CHARS) stderr += chunk.toString("utf8").slice(0, MAX_FIELD_CHARS - stderr.length);
			if (stderrBytes > MAX_STDERR_BYTES) {
				outputCapExceeded = true;
				killChild();
			}
		});

		child.on("error", () => {
			clearTimeout(timeout);
			resolvePromise({ state, code: 127, signal: null, timedOut, outputCapExceeded, stderr });
		});

		child.on("close", (code, signal) => {
			clearTimeout(timeout);
			if (stdoutBuffer.trim()) observeJsonLine(stdoutBuffer, state);
			resolvePromise({ state, code, signal, timedOut, outputCapExceeded, stderr });
		});
	});
}

export async function runSubagent(params: SubagentParams, ctx?: ExtensionContext, signal?: AbortSignal, onUpdate?: (update: unknown) => void): Promise<SubagentResult> {
	const startedAt = Date.now();
	const cwd = resolve(params.cwd ?? ctx?.cwd ?? process.cwd());
	const mode = params.mode ?? "read";
	const timeoutMs = Math.min(Math.max(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);

	if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
		return makeError(params, "Invalid sub-agent cwd.", `cwd does not exist or is not a directory: ${replaceHome(cwd)}`, ["invalid_cwd"]);
	}

	const workstream = deriveWorkstream(cwd, params.task, params.workstream);
	const sessionDir = buildSessionDir(workstream, params.agent);
	mkdirSync(sessionDir, { recursive: true });

	let rolePrompt: string;
	try {
		rolePrompt = readRolePrompt(params.agent);
	} catch (error) {
		return makeError(params, "Missing sub-agent role prompt.", error instanceof Error ? replaceHome(error.message) : "Unknown role prompt error", ["missing_role_prompt"], { workstream, sessionDir: replaceHome(sessionDir) });
	}

	const modelResolution = resolveSubagentModel(params.model);
	if (modelResolution && !modelResolution.ok) {
		const durationMs = Date.now() - startedAt;
		return makeError(params, "Invalid sub-agent model.", modelResolution.diagnostic, modelResolution.blockers, {
			workstream,
			sessionDir: replaceHome(sessionDir),
			durationMs,
			evidence: modelResolution.command ? [{ command: modelResolution.command, reason: "Pi model list did not contain an exact usable match for the requested sub-agent model." }] : [],
			recommendedNextStep: modelResolution.suggestions.length ? `Use one of: ${modelResolution.suggestions.join(", ")}.` : "Run `pi --list-models <search>` and pass a provider-qualified model id.",
		});
	}

	const resolvedParams = { ...params, mode, timeoutMs, model: modelResolution?.model ?? params.model };
	const bootstrapPrompt = buildBootstrapPrompt({ ...resolvedParams, task: params.task, agent: params.agent }, rolePrompt);
	const args = buildPiArgs(resolvedParams, sessionDir, bootstrapPrompt);
	onUpdate?.({ content: [{ type: "text", text: `Running ${params.agent} sub-agent for ${workstream}...` }] });

	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_SUBAGENT_CHILD: "1",
		PI_SUBAGENT_PARENT_WORKSTREAM: workstream,
		PI_SUBAGENT_ALLOW_RECURSIVE: params.allowRecursive ? "1" : "0",
	};

	const child = await runChildPi(args, { cwd, timeoutMs, signal, env });
	const durationMs = Date.now() - startedAt;
	const metadata = { workstream, sessionDir: replaceHome(sessionDir), durationMs };

	const parsed = child.state.finalText.trim() ? parseJsonObject(child.state.finalText) : null;
	const normalized = validateAndNormalize(parsed, resolvedParams, child.state, metadata);

	if (child.timedOut && normalized) {
		return normalized;
	}
	if (child.timedOut) {
		return makeError(params, "Sub-agent timed out.", `Child Pi exceeded ${timeoutMs} ms.`, ["timeout"], metadata);
	}
	if (child.outputCapExceeded) {
		return makeError(params, "Sub-agent exceeded output cap.", "Child Pi emitted too much JSON stream output before finishing.", ["output_cap_exceeded"], metadata);
	}
	if (child.code !== 0) {
		const stderr = compactString(redactForReturn(child.stderr), "", MAX_FIELD_CHARS);
		const diagnostic = `Child Pi exited with code ${child.code ?? "null"}${child.signal ? ` signal ${child.signal}` : ""}.${stderr ? ` stderr: ${stderr}` : ""}`;
		return makeError(params, "Sub-agent process failed.", diagnostic, ["child_process_failed"], metadata);
	}
	if (!child.state.finalText.trim()) {
		return makeError(params, "Sub-agent returned no final text.", "No assistant final text was found in the JSON event stream.", ["missing_final_text"], metadata);
	}
	if (!parsed) {
		return makeError(params, "Child agent did not return parseable JSON.", "Final assistant text was not parseable as JSON.", ["invalid_json"], metadata);
	}
	if (!normalized) {
		return makeError(params, "Child agent JSON did not match schema.", "Final assistant JSON could not be normalized to the sub-agent result schema.", ["invalid_schema"], metadata);
	}

	return normalized;
}

function registerSubagentTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "subagent_run",
		label: "Sub-agent Run",
		description: "Run a scoped Pi child agent in an isolated persistent session and return only compact structured findings.",
		promptSnippet: "Delegate scoped investigation, review, testing, documentation research, or consistency checks to a Pi sub-agent.",
		promptGuidelines: [
			"Use subagent_run when a scoped task would otherwise require broad searches, test output, logs, or documentation research that should not enter the parent context.",
			"subagent_run defaults to read-only mode; pass mode: \"write\" only when file edits are explicitly authorized and parent review will follow.",
			"When setting model, prefer a provider-qualified id from `pi --list-models <search>` such as `openai-codex/gpt-5.3-codex`; the runner validates and normalizes exact short ids before launch.",
		],
		parameters: Type.Object({
			agent: StringEnum(AGENTS),
			task: Type.String({ description: "Scoped task for the child agent. Do not include secrets." }),
			cwd: Type.Optional(Type.String({ description: "Working directory for the child Pi process. Defaults to current cwd." })),
			workstream: Type.Optional(Type.String({ description: "Stable workstream slug for session reuse." })),
			mode: Type.Optional(StringEnum(MODES)),
			timeoutMs: Type.Optional(Type.Number({ minimum: 1_000, maximum: MAX_TIMEOUT_MS })),
			model: Type.Optional(Type.String({ description: "Optional Pi model id for the child process. Prefer provider-qualified ids from `pi --list-models <search>`, for example `openai-codex/gpt-5.3-codex`. Exact short ids are validated and normalized when unambiguous." })),
			reset: Type.Optional(Type.Boolean({ description: "Create a new session in the same isolated directory instead of continuing." })),
			allowRecursive: Type.Optional(Type.Boolean({ description: "Allow the child process to use sub-agent tools recursively." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const result = await runSubagent(params as SubagentParams, ctx, signal, onUpdate);
			const safeResult = redactForReturn(result) as SubagentResult;
			logMetadata({
				timestamp: new Date().toISOString(),
				agent: safeResult.agent,
				workstream: safeResult.workstream,
				cwd: params.cwd ?? ctx.cwd,
				mode: params.mode ?? "read",
				timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				model: params.model ?? null,
				sessionDir: safeResult.sessionDir,
				status: safeResult.status,
				toolsUsed: safeResult.toolsUsed,
				durationMs: safeResult.durationMs,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(safeResult, null, 2) }],
				details: safeResult,
			};
		},
	});
}

export default function (pi: ExtensionAPI): void {
	if (process.env.PI_SUBAGENT_CHILD === "1" && process.env.PI_SUBAGENT_ALLOW_RECURSIVE !== "1") {
		return;
	}
	registerSubagentTool(pi);
}
