import { createHash } from "node:crypto";

import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

export type MutationSource = "bash" | "ctx_execute" | "ctx_batch_execute" | "mcp";
export type AuthorizationSource = "prompt" | "command";
export type MutationTier = 1 | 2 | 3;

export interface MutationIntent {
	service: string;
	action: string;
	tier: MutationTier;
	target?: string;
	repo?: string;
	body?: string;
	fields?: Record<string, string>;
	source: MutationSource;
	reason: string;
	toolName?: string;
}

export interface HostedMutationAuthorization {
	service: string;
	action: string;
	target?: string;
	repo?: string;
	body?: string;
	bodySha256?: string;
	source: AuthorizationSource;
	createdAt: number;
	expiresAt?: number;
	consumed?: boolean;
}

interface ShellCommand {
	command: string;
	source: MutationSource;
}

interface AuditEntry {
	timestamp: string;
	toolName: string;
	service: string;
	action: string;
	target?: string;
	reason: string;
}

const ONE_TIME_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const MAX_AUDIT_ENTRIES = 50;
const MAX_CODE_SCAN_CHARS = 50_000;
const MAX_QUOTED_STRINGS = 80;
const MAX_JSON_STRING_LENGTH = 50_000;
const JSON_STRING_FIELDS = new Set(["args", "payload", "request", "body", "input", "data", "variables"]);

const HOSTED_SERVICE_WORDS = [
	"github",
	"gitlab",
	"bitbucket",
	"linear",
	"figma",
	"firebase",
	"gcloud",
	"gcp",
	"googlecloud",
	"posthog",
	"notion",
	"directus",
	"slack",
	"stripe",
	"sentry",
	"jira",
	"aws",
	"azure",
];

const MUTATION_WORDS = [
	"create",
	"update",
	"delete",
	"remove",
	"merge",
	"deploy",
	"publish",
	"post",
	"comment",
	"reply",
	"react",
	"assign",
	"label",
	"close",
	"reopen",
	"invite",
	"upload",
	"write",
	"set",
	"patch",
	"put",
	"mutate",
	"execute",
	"dispatch",
	"rerun",
	"cancel",
	"run",
	"review",
	"push",
];

const READONLY_WORDS = new Set([
	"get",
	"list",
	"search",
	"view",
	"read",
	"describe",
	"inspect",
	"status",
	"logs",
	"log",
	"diff",
	"query",
	"checks",
]);

const MUTATING_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function normalizeBody(body: string): string {
	return body.replace(/\r\n/g, "\n");
}

function normalizeWord(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeTarget(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	return value.trim().replace(/^#/, "").toLowerCase();
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function cleanTarget(target: string | undefined): string | undefined {
	if (!target) return undefined;
	return target
		.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@?#]+@|[^\s/@?#]+:[^\s/@?#]+@)/gi, "$1<redacted>@")
		.replace(/(\bhttps?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1")
		.slice(0, 160);
}

function safeStringify(input: unknown): string {
	try {
		return JSON.stringify(input ?? {}).slice(0, 20_000);
	} catch {
		return "";
	}
}

export function shellSplit(input: string): string[] {
	const tokens: string[] = [];
	let token = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;

	for (const char of input) {
		if (escaping) {
			token += char;
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			else token += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (token.length > 0) {
				tokens.push(token);
				token = "";
			}
			continue;
		}
		token += char;
	}
	if (escaping) token += "\\";
	if (token.length > 0) tokens.push(token);
	return tokens;
}

function splitCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		const next = command[i + 1];
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			current += char;
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		if (char === "\n" || char === ";" || (char === "&" && next === "&") || (char === "|" && next === "|")) {
			const trimmed = current.trim();
			if (trimmed) segments.push(trimmed);
			current = "";
			if ((char === "&" && next === "&") || (char === "|" && next === "|")) i++;
			continue;
		}
		current += char;
	}
	const trimmed = current.trim();
	if (trimmed) segments.push(trimmed);
	return segments;
}

function stripShellWrappers(tokens: string[]): string[] {
	let current = [...tokens];
	while (current.length > 0) {
		if (current[0] === "rtk" || current[0] === "sudo" || current[0] === "command") {
			current = current.slice(1);
			continue;
		}
		if (current[0] === "env") {
			current = current.slice(1);
			while (current[0] && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(current[0])) current = current.slice(1);
			continue;
		}
		if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(current[0])) {
			current = current.slice(1);
			continue;
		}
		break;
	}
	return current;
}

function getShellWrapperCommand(tokens: string[]): string | undefined {
	const executable = tokens[0]?.split("/").pop();
	if (!executable || !["bash", "sh", "zsh", "fish", "dash"].includes(executable)) return undefined;
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "-c" || token === "-lc" || token === "-ic") return tokens[i + 1];
		if (/^-[A-Za-z]*c[A-Za-z]*$/.test(token)) return tokens[i + 1];
	}
	return undefined;
}

function getOptionValue(tokens: string[], names: string[]): string | undefined {
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		for (const name of names) {
			if (token === name) return tokens[i + 1];
			if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
		}
	}
	return undefined;
}

function getFieldValue(tokens: string[], fieldName: string): string | undefined {
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if ((token === "-f" || token === "-F" || token === "--field" || token === "--raw-field") && tokens[i + 1]) {
			const field = tokens[i + 1];
			if (field.startsWith(`${fieldName}=`)) return field.slice(fieldName.length + 1);
		}
		if (token.startsWith(`--field=${fieldName}=`)) return token.slice(`--field=${fieldName}=`.length);
		if (token.startsWith(`--raw-field=${fieldName}=`)) return token.slice(`--raw-field=${fieldName}=`.length);
	}
	return undefined;
}

function firstNonOption(tokens: string[], startIndex: number): string | undefined {
	for (let i = startIndex; i < tokens.length; i++) {
		if (!tokens[i].startsWith("-")) return tokens[i];
		if (["--body", "-b", "--title", "--repo", "-R", "--method", "-X"].includes(tokens[i])) i++;
	}
	return undefined;
}

function makeIntent(intent: Omit<MutationIntent, "target"> & { target?: string }): MutationIntent {
	return { ...intent, target: cleanTarget(intent.target) };
}

function classifyGhCommand(tokens: string[], source: MutationSource): MutationIntent[] {
	const group = tokens[1];
	const sub = tokens[2];
	if (!group) return [];

	if (group === "pr") {
		if (["view", "list", "checks", "diff"].includes(sub ?? "")) return [];
		const target = firstNonOption(tokens, 3);
		if (sub === "comment") {
			return [makeIntent({ service: "github", action: "pr-comment", tier: 1, target, body: getOptionValue(tokens, ["--body", "-b"]), source, reason: "GitHub PR comment" })];
		}
		if (sub === "merge") {
			return [makeIntent({ service: "github", action: "pr-merge", tier: 3, target, source, reason: "GitHub PR merge" })];
		}
		if (["review", "edit", "close", "reopen", "ready", "lock", "unlock"].includes(sub ?? "")) {
			const tier: MutationTier = sub === "review" || sub === "edit" ? 2 : 3;
			return [makeIntent({ service: "github", action: `pr-${sub}`, tier, target, body: getOptionValue(tokens, ["--body", "-b"]), source, reason: `GitHub PR ${sub}` })];
		}
	}

	if (group === "issue") {
		if (["view", "list"].includes(sub ?? "")) return [];
		const target = firstNonOption(tokens, 3);
		if (sub === "comment") {
			return [makeIntent({ service: "github", action: "issue-comment", tier: 1, target, body: getOptionValue(tokens, ["--body", "-b"]), source, reason: "GitHub issue comment" })];
		}
		if (["create", "edit", "close", "reopen", "delete", "transfer", "pin", "unpin"].includes(sub ?? "")) {
			const tier: MutationTier = ["create", "edit"].includes(sub ?? "") ? 2 : 3;
			return [makeIntent({ service: "github", action: `issue-${sub}`, tier, target, body: getOptionValue(tokens, ["--body", "-b"]), source, reason: `GitHub issue ${sub}` })];
		}
	}

	if (group === "api") {
		const method = (getOptionValue(tokens, ["-X", "--method"]) ?? "GET").toUpperCase();
		if (!MUTATING_HTTP_METHODS.has(method)) return [];
		const endpoint = firstNonOption(tokens, 2);
		const body = getFieldValue(tokens, "body");
		const issueComments = endpoint?.match(/issues\/(\d+)\/comments/);
		if (method === "POST" && issueComments) {
			return [makeIntent({ service: "github", action: "issue-comment", tier: 1, target: issueComments[1], body, source, reason: "GitHub issue comment API mutation" })];
		}
		return [makeIntent({ service: "github", action: `api-${method.toLowerCase()}`, tier: method === "DELETE" ? 3 : 2, target: endpoint, body, source, reason: `GitHub API ${method}` })];
	}

	if (group === "release" && ["create", "edit", "delete", "upload"].includes(sub ?? "")) {
		return [makeIntent({ service: "github", action: `release-${sub}`, tier: 3, target: firstNonOption(tokens, 3), source, reason: `GitHub release ${sub}` })];
	}
	if (group === "workflow" && sub === "run") {
		return [makeIntent({ service: "github", action: "workflow-run", tier: 3, target: firstNonOption(tokens, 3), source, reason: "GitHub workflow run" })];
	}
	if (group === "run" && ["rerun", "cancel", "delete"].includes(sub ?? "")) {
		return [makeIntent({ service: "github", action: `run-${sub}`, tier: 3, target: firstNonOption(tokens, 3), source, reason: `GitHub run ${sub}` })];
	}
	if (group === "repo" && ["create", "edit", "delete"].includes(sub ?? "")) {
		return [makeIntent({ service: "github", action: `repo-${sub}`, tier: 3, target: firstNonOption(tokens, 3), source, reason: `GitHub repo ${sub}` })];
	}
	return [];
}

function classifyFirebaseCommand(tokens: string[], source: MutationSource): MutationIntent[] {
	const commandText = tokens.slice(1).join(" ");
	const mutation = tokens.slice(1).find((token) => /^(deploy|hosting:channel:deploy|functions:delete|firestore:delete|database:remove|delete|remove|create|update)$/.test(token));
	if (!mutation) return [];
	const action = mutation.includes("deploy") ? "deploy" : mutation.replace(/:/g, "-");
	return [makeIntent({ service: "firebase", action, tier: 3, target: commandText || action, source, reason: `Firebase ${action}` })];
}

function classifyCloudCommand(tokens: string[], source: MutationSource, service: "gcloud" | "aws"): MutationIntent[] {
	const mutation = tokens.find((token, index) => index > 0 && /^(create|put|update|delete|deploy|terminate|run-instances|start|stop|tag-resource|untag-resource|set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding)$/.test(token));
	if (!mutation) return [];
	return [makeIntent({ service, action: mutation, tier: 3, target: tokens.slice(1).join(" "), source, reason: `${service} ${mutation}` })];
}

function classifyLinearCommand(tokens: string[], source: MutationSource): MutationIntent[] {
	if (tokens[1] !== "issue") return [];
	const sub = tokens[2];
	if (["view", "list", "search"].includes(sub ?? "")) return [];
	const target = firstNonOption(tokens, 3);
	if (sub === "comment") {
		const body = getOptionValue(tokens, ["--body", "-b"]) ?? (tokens.slice(4).join(" ") || undefined);
		return [makeIntent({ service: "linear", action: "issue-comment", tier: 1, target, body, source, reason: "Linear issue comment" })];
	}
	if (["create", "update", "assign", "close", "reopen", "delete"].includes(sub ?? "")) {
		const tier: MutationTier = ["close", "reopen", "delete"].includes(sub ?? "") ? 3 : 2;
		return [makeIntent({ service: "linear", action: `issue-${sub}`, tier, target, source, reason: `Linear issue ${sub}` })];
	}
	return [];
}

function methodFromHttpCommand(tokens: string[]): string | undefined {
	if (tokens[0] === "http" && tokens[1] && MUTATING_HTTP_METHODS.has(tokens[1].toUpperCase())) return tokens[1].toUpperCase();
	return (getOptionValue(tokens, ["-X", "--request", "--method"]) ?? undefined)?.toUpperCase();
}

function serviceFromUrl(url: string | undefined): { service: string; target: string } | undefined {
	if (!url) return undefined;
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (["localhost", "127.0.0.1", "::1"].includes(host)) return undefined;
		const service = host.includes("github") ? "github"
			: host.includes("linear") ? "linear"
			: host.includes("figma") ? "figma"
			: host.includes("firebase") || host.includes("googleapis") ? "gcp"
			: host.includes("posthog") ? "posthog"
			: host.includes("notion") ? "notion"
			: host.includes("slack") ? "slack"
			: host.includes("stripe") ? "stripe"
			: host.includes("sentry") ? "sentry"
			: host.includes("atlassian") || host.includes("jira") ? "jira"
			: "http";
		return { service, target: host };
	} catch {
		return undefined;
	}
}

function classifyHttpCommand(tokens: string[], source: MutationSource): MutationIntent[] {
	const method = methodFromHttpCommand(tokens);
	if (!method || !MUTATING_HTTP_METHODS.has(method)) return [];
	const url = tokens.find((token) => /^https?:\/\//i.test(token));
	const target = serviceFromUrl(url);
	if (!target) return [];
	return [makeIntent({ service: target.service, action: `http-${method.toLowerCase()}`, tier: method === "DELETE" ? 3 : 2, target: target.target, source, reason: `HTTP ${method}` })];
}

function extractQuotedStrings(text: string, maxCount = MAX_QUOTED_STRINGS): string[] {
	const values: string[] = [];
	let quote: "'" | '"' | "`" | undefined;
	let current = "";
	let escaping = false;
	for (const char of text) {
		if (values.length >= maxCount) break;
		if (!quote) {
			if (char === "'" || char === '"' || char === "`") {
				quote = char;
				current = "";
			}
			continue;
		}
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if (char === quote) {
			if (current.trim()) values.push(current);
			quote = undefined;
			current = "";
			continue;
		}
		current += char;
	}
	return values;
}

function sampleCodeText(code: string): string {
	if (code.length <= MAX_CODE_SCAN_CHARS) return code;
	const half = Math.floor(MAX_CODE_SCAN_CHARS / 2);
	return `${code.slice(0, half)}\n${code.slice(-half)}`;
}

function shouldScanCodeText(code: string): boolean {
	return /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|fetch|axios|request|graphql|mutation|curl|gh|firebase|gcloud|aws|linear)\b|https?:\/\//i.test(code);
}

function hasNetworkSink(code: string): boolean {
	return /\b(fetch|axios|request|graphql)\b|\bhttps?\.request\b/i.test(code);
}

function extractExecutionSinkStrings(code: string): string[] {
	const values: string[] = [];
	const sinkPattern = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/g;
	let match: RegExpExecArray | null;
	while ((match = sinkPattern.exec(code)) && values.length < MAX_QUOTED_STRINGS) {
		const window = code.slice(match.index, Math.min(code.length, match.index + 4_000));
		const quoted = extractQuotedStrings(window, MAX_QUOTED_STRINGS - values.length);
		if (quoted.length > 1 && values.length < MAX_QUOTED_STRINGS) values.push(quoted.join(" "));
		for (const value of quoted) {
			if (values.length >= MAX_QUOTED_STRINGS) break;
			values.push(value);
		}
	}
	return values;
}

function classifyCodeText(code: string, source: MutationSource): MutationIntent[] {
	if (!shouldScanCodeText(code)) return [];
	const scanText = sampleCodeText(code);
	const intents: MutationIntent[] = [];
	const method = code.match(/\bmethod\s*[:=]\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i)?.[1]?.toUpperCase();
	if (method && includesHostedService(code) && hasNetworkSink(code)) {
		const service = serviceFromWords(wordParts(scanText), code);
		intents.push(makeIntent({ service, action: `http-${method.toLowerCase()}`, tier: method === "DELETE" ? 3 : 2, source, reason: `embedded hosted HTTP ${method}` }));
	}
	if (/\bmutation\b/i.test(code) && includesHostedService(code) && hasNetworkSink(code)) {
		const service = serviceFromWords(wordParts(scanText), code);
		intents.push(makeIntent({ service, action: "graphql-mutation", tier: 2, source, reason: "embedded GraphQL mutation" }));
	}
	for (const quoted of extractExecutionSinkStrings(code)) {
		intents.push(...classifyShellCommand(quoted, source, false));
	}
	return intents;
}

export function classifyShellCommand(command: string, source: MutationSource = "bash", scanEmbedded = true): MutationIntent[] {
	const intents: MutationIntent[] = [];
	for (const segment of splitCommandSegments(command)) {
		const tokens = stripShellWrappers(shellSplit(segment));
		if (tokens.length === 0) continue;
		const wrappedCommand = getShellWrapperCommand(tokens);
		if (wrappedCommand) {
			intents.push(...classifyShellCommand(wrappedCommand, source));
			continue;
		}
		const executable = tokens[0];
		if (executable === "git" && tokens[1] === "push") {
			intents.push(makeIntent({ service: "git", action: "git-push", tier: 3, target: tokens.slice(2).join(" ") || "remote", source, reason: "git push mutates a remote repository" }));
			continue;
		}
		if (executable === "gh") {
			intents.push(...classifyGhCommand(tokens, source));
			continue;
		}
		if (executable === "firebase") {
			intents.push(...classifyFirebaseCommand(tokens, source));
			continue;
		}
		if (executable === "gcloud" || executable === "aws") {
			intents.push(...classifyCloudCommand(tokens, source, executable));
			continue;
		}
		if (executable === "linear") {
			intents.push(...classifyLinearCommand(tokens, source));
			continue;
		}
		if (executable === "curl" || executable === "http" || executable === "wget") {
			intents.push(...classifyHttpCommand(tokens, source));
			continue;
		}
		if (scanEmbedded) intents.push(...classifyCodeText(segment, source));
	}
	return intents;
}

export function extractShellCommands(toolName: string, input: unknown): ShellCommand[] {
	const value = input as any;
	if (toolName === "bash" && typeof value?.command === "string") return [{ command: value.command, source: "bash" }];
	if ((toolName === "ctx_execute" || toolName === "context_mode_ctx_execute") && value?.language === "shell" && typeof value?.code === "string") {
		return [{ command: value.code, source: "ctx_execute" }];
	}
	if ((toolName === "ctx_batch_execute" || toolName === "context_mode_ctx_batch_execute") && Array.isArray(value?.commands)) {
		return value.commands
			.map((command: any) => (typeof command?.command === "string" ? { command: command.command, source: "ctx_batch_execute" as const } : undefined))
			.filter((command: ShellCommand | undefined): command is ShellCommand => command !== undefined);
	}
	return [];
}

function wordParts(value: string): string[] {
	return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function includesHostedService(value: string): boolean {
	const lowered = value.toLowerCase();
	return HOSTED_SERVICE_WORDS.some((word) => new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, "i").test(lowered));
}

function parseInspectionJson(key: string, value: string): unknown | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_JSON_STRING_LENGTH) return undefined;
	if (!JSON_STRING_FIELDS.has(key.toLowerCase()) && !trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
	if (!((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function findInputString(input: unknown, names: string[]): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const stack: unknown[] = [input];
	const seen = new WeakSet<object>();
	const loweredNames = new Set(names.map((name) => name.toLowerCase()));
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || typeof current !== "object") continue;
		if (seen.has(current)) continue;
		seen.add(current);
		for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
			const loweredKey = key.toLowerCase();
			if (loweredNames.has(loweredKey) && typeof value === "string") return value;
			if (typeof value === "string") {
				const parsed = parseInspectionJson(key, value);
				if (parsed && typeof parsed === "object") stack.push(parsed);
				continue;
			}
			if (value && typeof value === "object") stack.push(value);
		}
	}
	return undefined;
}

function findInputMethod(input: unknown): string | undefined {
	const method = findInputString(input, ["method"]);
	return method?.toUpperCase();
}

function hasGraphqlMutation(input: unknown): boolean {
	const query = findInputString(input, ["query", "mutation"]);
	return /\bmutation\b/i.test(query ?? "");
}

function serviceFromWords(words: string[], serialized: string): string {
	for (const service of HOSTED_SERVICE_WORDS) {
		if (words.includes(service) || new RegExp(`(^|[^a-z0-9])${service}([^a-z0-9]|$)`, "i").test(serialized)) return service === "gcloud" || service === "googlecloud" ? "gcp" : service;
	}
	return "hosted-service";
}

function tierForAction(action: string): MutationTier {
	if (/comment|message|reply/.test(action)) return 1;
	if (/delete|remove|merge|deploy|publish|push|release|workflow|rerun|cancel|invite|upload/.test(action)) return 3;
	return 2;
}

function actionFromMcp(service: string, words: string[], input: unknown): string {
	if (service === "github" && words.includes("pr") && words.includes("comment")) return "pr-comment";
	if (service === "github" && words.includes("issue") && words.includes("comment")) return "issue-comment";
	if (service === "linear" && words.includes("issue") && words.includes("comment")) return "issue-comment";
	if (service === "slack" && (words.includes("message") || words.includes("post"))) return "message";
	const method = findInputMethod(input);
	if (method && MUTATING_HTTP_METHODS.has(method)) return `api-${method.toLowerCase()}`;
	if (hasGraphqlMutation(input)) return "graphql-mutation";
	return words.find((word) => MUTATION_WORDS.includes(word)) ?? "mutation";
}

function targetFromMcp(service: string, input: unknown): string | undefined {
	if (service === "github") return findInputString(input, ["prNumber", "pullNumber", "pull_request_number", "issueNumber", "number", "target", "path", "url", "endpoint", "id"]);
	if (service === "linear") return findInputString(input, ["issueId", "issueKey", "key", "id", "target", "path", "url"]);
	if (service === "slack") return findInputString(input, ["channel", "channelId", "target"]);
	return findInputString(input, ["target", "path", "url", "endpoint", "id", "nodeId", "project", "name"]);
}

function bodyFromMcp(input: unknown): string | undefined {
	return findInputString(input, ["body", "comment", "message", "text", "content"]);
}

function classifyMcpTool(toolName: string, input: unknown): MutationIntent[] {
	const value = input as any;
	const effectiveName = toolName === "mcp" && typeof value?.tool === "string" ? `${value?.server ?? "mcp"}_${value.tool}` : toolName;
	const serialized = safeStringify(input);
	const words = wordParts(effectiveName);
	const hosted = includesHostedService(effectiveName) || includesHostedService(serialized);
	if (!hosted) return [];

	const method = findInputMethod(input);
	const graphqlMutation = hasGraphqlMutation(input);
	const mutationWord = words.find((word) => MUTATION_WORDS.includes(word));
	const firstNonServiceWord = words.find((word) => !HOSTED_SERVICE_WORDS.includes(word) && word !== "mcp");
	const readOnly = firstNonServiceWord !== undefined && READONLY_WORDS.has(firstNonServiceWord);
	if (!method && !graphqlMutation && !mutationWord && readOnly) return [];
	if (method && !MUTATING_HTTP_METHODS.has(method) && !graphqlMutation && !mutationWord) return [];
	if (!method && !graphqlMutation && !mutationWord) return [];

	const service = serviceFromWords(words, serialized);
	const action = actionFromMcp(service, words, input);
	return [makeIntent({ service, action, tier: tierForAction(action), target: targetFromMcp(service, input), body: bodyFromMcp(input), source: "mcp", reason: `${service} ${action} tool`, toolName: effectiveName })];
}

export function classifyToolCall(toolName: string, input: unknown): MutationIntent[] {
	const shellCommands = extractShellCommands(toolName, input);
	if (shellCommands.length > 0) {
		return shellCommands.flatMap((command) => classifyShellCommand(command.command, command.source));
	}
	const value = input as any;
	if ((toolName === "ctx_execute" || toolName === "context_mode_ctx_execute") && typeof value?.code === "string") {
		return classifyCodeText(value.code, "ctx_execute");
	}
	return classifyMcpTool(toolName, input);
}

function extractExactBody(raw: string): string | undefined {
	const text = raw.trim();
	const fenced = text.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n?```\s*$/);
	if (fenced) return normalizeBody(fenced[1]);
	const doubleQuoted = text.match(/^"([\s\S]*)"\s*$/);
	if (doubleQuoted) return normalizeBody(doubleQuoted[1]);
	const singleQuoted = text.match(/^'([\s\S]*)'\s*$/);
	if (singleQuoted) return normalizeBody(singleQuoted[1]);
	return undefined;
}

function promptAuthorization(service: string, action: string, target: string, body: string | undefined, createdAt: number): HostedMutationAuthorization | undefined {
	if (body === undefined) return undefined;
	return { service, action, target, body, source: "prompt", createdAt };
}

export function parsePromptAuthorizations(prompt: string, now = Date.now()): HostedMutationAuthorization[] {
	const authorizations: Array<HostedMutationAuthorization | undefined> = [];
	const githubPr = prompt.match(/post\s+this\s+exact\s+github\s+pr\s+comment\s+on\s+pr\s+#?(\d+)\s*:\s*([\s\S]*)$/i);
	if (githubPr) authorizations.push(promptAuthorization("github", "pr-comment", githubPr[1], extractExactBody(githubPr[2]), now));

	const githubIssue = prompt.match(/post\s+this\s+exact\s+github\s+issue\s+comment\s+on\s+issue\s+#?(\d+)\s*:\s*([\s\S]*)$/i);
	if (githubIssue) authorizations.push(promptAuthorization("github", "issue-comment", githubIssue[1], extractExactBody(githubIssue[2]), now));

	const linear = prompt.match(/create\s+a\s+linear\s+comment\s+on\s+([A-Z][A-Z0-9]+-\d+)\s+with\s+exactly\s*:\s*([\s\S]*)$/i);
	if (linear) authorizations.push(promptAuthorization("linear", "issue-comment", linear[1].toUpperCase(), extractExactBody(linear[2]), now));

	const slack = prompt.match(/send\s+this\s+exact\s+slack\s+message\s+to\s+(#[A-Za-z0-9_-]+)\s*:\s*([\s\S]*)$/i);
	if (slack) authorizations.push(promptAuthorization("slack", "message", slack[1], extractExactBody(slack[2]), now));

	return authorizations.filter((authorization): authorization is HostedMutationAuthorization => authorization !== undefined);
}

export function parseOneTimeAuthorization(args: string, now = Date.now()): HostedMutationAuthorization | { error: string } {
	const tokens = shellSplit(args);
	if (tokens.length < 3) return { error: "Usage: /authorize-hosted-mutation <service> <action> <target> [body-sha256:<hash>]" };
	const [service, action, ...rest] = tokens;
	let bodySha256: string | undefined;
	const targetParts: string[] = [];
	for (const token of rest) {
		const hash = token.match(/^(?:body-sha256|payload-sha256):([a-f0-9]{64})$/i);
		if (hash) bodySha256 = hash[1].toLowerCase();
		else targetParts.push(token);
	}
	const target = targetParts.join(" ").trim();
	if (!target) return { error: "Missing target for hosted-service mutation authorization" };
	return {
		service: normalizeWord(service),
		action: normalizeWord(action),
		target,
		bodySha256,
		source: "command",
		createdAt: now,
		expiresAt: now + ONE_TIME_AUTHORIZATION_TTL_MS,
	};
}

function servicesMatch(authService: string, intentService: string): boolean {
	const auth = normalizeWord(authService);
	const intent = normalizeWord(intentService);
	if (auth === intent) return true;
	return intent === "git" && (auth === "git" || auth === "github" || auth === "gitlab" || auth === "bitbucket");
}

function targetsMatch(authTarget: string | undefined, intentTarget: string | undefined): boolean {
	if (!authTarget) return true;
	const auth = normalizeTarget(authTarget);
	const intent = normalizeTarget(intentTarget);
	if (!intent) return false;
	return auth === intent || auth?.endsWith(`#${intent}`) || auth?.endsWith(`/${intent}`);
}

export function matchesAuthorization(intent: MutationIntent, authorization: HostedMutationAuthorization, now = Date.now()): boolean {
	if (authorization.consumed) return false;
	if (authorization.expiresAt !== undefined && authorization.expiresAt < now) return false;
	if (!servicesMatch(authorization.service, intent.service)) return false;
	if (normalizeWord(authorization.action) !== normalizeWord(intent.action)) return false;
	if (!targetsMatch(authorization.target, intent.target)) return false;
	if (authorization.repo && normalizeTarget(authorization.repo) !== normalizeTarget(intent.repo)) return false;

	if (authorization.source === "prompt") {
		if (intent.tier !== 1) return false;
		if (authorization.body === undefined) return false;
		return intent.body !== undefined && normalizeBody(intent.body) === normalizeBody(authorization.body);
	}

	if (authorization.body !== undefined) {
		return intent.body !== undefined && normalizeBody(intent.body) === normalizeBody(authorization.body);
	}
	if (authorization.bodySha256 !== undefined) {
		return intent.body !== undefined && sha256(normalizeBody(intent.body)) === authorization.bodySha256;
	}
	return true;
}

function findAuthorization(intent: MutationIntent, authorizations: HostedMutationAuthorization[], used: Set<number>, now: number): number | undefined {
	for (let i = 0; i < authorizations.length; i++) {
		if (used.has(i)) continue;
		if (matchesAuthorization(intent, authorizations[i], now)) return i;
	}
	return undefined;
}

function formatAction(action: string): string {
	return action.replace(/-/g, " ");
}

function blockReason(intent: MutationIntent): string {
	const service = intent.service === "gcloud" ? "GCP" : intent.service.charAt(0).toUpperCase() + intent.service.slice(1);
	const target = intent.target ? ` on ${intent.target}` : "";
	if (intent.tier === 3) {
		return `Hosted-service mutation blocked: ${service} ${formatAction(intent.action)}${target} is high risk and requires /authorize-hosted-mutation ${intent.service} ${intent.action} <target>.`;
	}
	if (intent.tier === 1) {
		return `Hosted-service mutation blocked: ${service} ${formatAction(intent.action)}${target} requires exact user authorization for target and body.`;
	}
	return `Hosted-service mutation blocked: ${service} ${formatAction(intent.action)}${target} requires exact user authorization for target and fields.`;
}

function auditFromIntent(toolName: string, intent: MutationIntent, reason: string): AuditEntry {
	return {
		timestamp: new Date().toISOString(),
		toolName,
		service: intent.service,
		action: intent.action,
		target: intent.target,
		reason,
	};
}

export default function hostedMutationGuard(pi: ExtensionAPI): void {
	let promptAuthorizations: HostedMutationAuthorization[] = [];
	let commandAuthorizations: HostedMutationAuthorization[] = [];
	const auditEntries: AuditEntry[] = [];

	function addAudit(toolName: string, intent: MutationIntent, reason: string): void {
		const entry = auditFromIntent(toolName, intent, reason);
		auditEntries.push(entry);
		if (auditEntries.length > MAX_AUDIT_ENTRIES) auditEntries.shift();
		try {
			pi.appendEntry("hosted-mutation-guard", entry);
		} catch {
			// appendEntry is best-effort only. Blocking must not depend on persistence.
		}
	}

	pi.registerCommand("authorize-hosted-mutation", {
		description: "Allow one exact hosted-service mutation call for 10 minutes",
		handler: async (args, ctx) => {
			const authorization = parseOneTimeAuthorization(args);
			if ("error" in authorization) {
				ctx.ui.notify(authorization.error, "error");
				return;
			}
			commandAuthorizations.push(authorization);
			ctx.ui.notify(`Authorized one ${authorization.service} ${authorization.action} mutation for target ${authorization.target}`, "warning");
		},
	});

	pi.registerCommand("hosted-mutation-guard", {
		description: "Show hosted mutation guard status or audit log",
		handler: async (args, ctx) => {
			const command = args.trim() || "status";
			if (command === "status") {
				const activeOneTime = commandAuthorizations.filter((authorization) => !authorization.consumed && (authorization.expiresAt === undefined || authorization.expiresAt >= Date.now())).length;
				ctx.ui.notify(`Hosted mutation guard active. Prompt authorizations: ${promptAuthorizations.length}. One-time authorizations: ${activeOneTime}. Blocked attempts logged: ${auditEntries.length}.`, "info");
				return;
			}
			if (command === "audit") {
				const recent = auditEntries.slice(-5).map((entry) => `${entry.timestamp} ${entry.service} ${entry.action}${entry.target ? ` ${entry.target}` : ""}`).join("\n");
				ctx.ui.notify(recent || "No hosted-service mutations blocked in this process.", "info");
				return;
			}
			if (command === "clear") {
				commandAuthorizations = [];
				auditEntries.length = 0;
				ctx.ui.notify("Hosted mutation guard one-time authorizations and audit log cleared.", "info");
				return;
			}
			ctx.ui.notify("Usage: /hosted-mutation-guard [status|audit|clear]", "error");
		},
	});

	pi.on("before_agent_start", async (event) => {
		promptAuthorizations = parsePromptAuthorizations(event.prompt);
		return undefined;
	});

	pi.on("agent_end", async () => {
		promptAuthorizations = [];
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | undefined> => {
		const intents = classifyToolCall(event.toolName, event.input);
		if (intents.length === 0) return undefined;

		const now = Date.now();
		commandAuthorizations = commandAuthorizations.filter((authorization) => !authorization.consumed && (authorization.expiresAt === undefined || authorization.expiresAt >= now));
		const authorizations = [...promptAuthorizations, ...commandAuthorizations];
		const used = new Set<number>();

		for (const intent of intents) {
			const index = findAuthorization(intent, authorizations, used, now);
			if (index === undefined) {
				const reason = blockReason(intent);
				addAudit(event.toolName, intent, reason);
				if (ctx.hasUI) ctx.ui.notify(reason, "warning");
				return { block: true, reason };
			}
			used.add(index);
		}

		for (const index of used) {
			authorizations[index].consumed = true;
		}
		promptAuthorizations = promptAuthorizations.filter((authorization) => !authorization.consumed);
		commandAuthorizations = commandAuthorizations.filter((authorization) => !authorization.consumed);
		return undefined;
	});
}
