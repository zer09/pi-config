import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { BuildSystemPromptOptions, ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

export type MutationSource = "bash" | "ctx_execute" | "ctx_batch_execute" | "ctx_execute_file" | "mcp";
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
const MAX_SHELL_RECURSION_DEPTH = 50;
const MAX_JSON_STRING_LENGTH = 50_000;
const MAX_BODY_FILE_BYTES = 50_000;
const JSON_STRING_FIELDS = new Set(["args", "payload", "request", "body", "input", "data", "variables"]);
const CONTEXT_MODE_EXECUTE_TOOL_NAMES = new Set(["ctx_execute", "context_mode_ctx_execute"]);
const CONTEXT_MODE_BATCH_TOOL_NAMES = new Set(["ctx_batch_execute", "context_mode_ctx_batch_execute"]);
const CONTEXT_MODE_EXECUTE_FILE_TOOL_NAMES = new Set(["ctx_execute_file", "context_mode_ctx_execute_file"]);
const CONTEXT_MODE_TOOL_NAMES = new Set([
	...CONTEXT_MODE_EXECUTE_TOOL_NAMES,
	...CONTEXT_MODE_BATCH_TOOL_NAMES,
	...CONTEXT_MODE_EXECUTE_FILE_TOOL_NAMES,
]);
const LOCAL_FILE_TOOL_NAMES = new Set(["read", "write", "edit"]);

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

const POSTHOG_SQL_FORBIDDEN_WORDS = new Set([
	"insert",
	"update",
	"delete",
	"drop",
	"create",
	"alter",
	"truncate",
	"optimize",
	"attach",
	"detach",
	"rename",
	"grant",
	"revoke",
	"kill",
	"copy",
	"load",
	"replace",
	"upsert",
]);
const POSTHOG_SQL_FORBIDDEN_START_WORDS = new Set(["set", "system", "use"]);

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

function formatDisplayPath(value: string | undefined): string {
	if (!value) return "unknown";
	const home = process.env.HOME;
	if (home && value === home) return "~";
	return home && value.startsWith(`${home}/`) ? `~${value.slice(home.length)}` : value;
}

function formatPromptContextSummary(options: BuildSystemPromptOptions | undefined): string[] {
	if (!options) return [];
	const selectedTools = options.selectedTools?.length ? String(options.selectedTools.length) : "default";
	return [
		`cwd: ${formatDisplayPath(options.cwd)}`,
		`tools in prompt: ${selectedTools}`,
		`context files: ${options.contextFiles?.length ?? 0}`,
		`skills: ${options.skills?.length ?? 0}`,
	];
}

function executableName(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return value.split(/[\\/]/).pop() || value;
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
		const previous = command[i - 1];
		const isSeparator = char === "\n" || char === ";" || char === "|" || (char === "&" && previous !== ">" && next !== ">");
		if (isSeparator) {
			const trimmed = current.trim();
			if (trimmed) segments.push(trimmed);
			current = "";
			if ((char === "&" && next === "&") || (char === "|" && (next === "|" || next === "&"))) i++;
			continue;
		}
		current += char;
	}
	const trimmed = current.trim();
	if (trimmed) segments.push(trimmed);
	return segments;
}

function stripShellOptionTerminator(tokens: string[]): string[] {
	return tokens[0] === "--" ? tokens.slice(1) : tokens;
}

function stripShellWrappers(tokens: string[]): string[] {
	let current = [...tokens];
	while (current.length > 0) {
		const executable = executableName(current[0]);
		if (executable === "rtk" || executable === "sudo" || executable === "command") {
			current = stripShellOptionTerminator(current.slice(1));
			continue;
		}
		if (executable === "env") {
			current = stripShellOptionTerminator(current.slice(1));
			while (current[0] && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(current[0])) current = current.slice(1);
			current = stripShellOptionTerminator(current);
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
	const executable = executableName(tokens[0]);
	if (!executable || !["bash", "sh", "zsh", "fish", "dash"].includes(executable)) return undefined;
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "-c" || token === "-lc" || token === "-ic") return tokens[i + 1];
		if (/^-[A-Za-z]*c[A-Za-z]*$/.test(token)) return tokens[i + 1];
	}
	return undefined;
}

function readShellCommandSubstitution(text: string, openParenIndex: number): { value: string; endIndex: number } | undefined {
	let depth = 1;
	let quote: "'" | '"' | undefined;
	let escaping = false;
	for (let i = openParenIndex + 1; i < text.length; i++) {
		const char = text[i];
		if (escaping) {
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (char === "$" && text[i + 1] === "(") {
			depth++;
			i++;
			continue;
		}
		if (char === ")") {
			depth--;
			if (depth === 0) return { value: text.slice(openParenIndex + 1, i), endIndex: i };
		}
	}
	return undefined;
}

function extractShellCommandSubstitutions(text: string): string[] {
	const values: string[] = [];
	let quote: "'" | '"' | undefined;
	let escaping = false;
	for (let i = 0; i < text.length && values.length < MAX_QUOTED_STRINGS; i++) {
		const char = text[i];
		if (escaping) {
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if (quote === "'") {
			if (char === "'") quote = undefined;
			continue;
		}
		if (char === "'") {
			quote = "'";
			continue;
		}
		if (char === '"') {
			quote = quote === '"' ? undefined : '"';
			continue;
		}
		if (char === "$" && text[i + 1] === "(") {
			const substitution = readShellCommandSubstitution(text, i + 1);
			if (substitution?.value.trim()) values.push(substitution.value);
			if (substitution) i = substitution.endIndex;
			continue;
		}
		if (char === "`") {
			let current = "";
			for (let j = i + 1; j < text.length; j++) {
				const nested = text[j];
				if (nested === "\\" && j + 1 < text.length) {
					current += text[j + 1];
					j++;
					continue;
				}
				if (nested === "`") {
					if (current.trim()) values.push(current);
					i = j;
					break;
				}
				current += nested;
			}
		}
	}
	return values;
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

const OPTION_VALUE_FLAGS = new Set([
	"-a",
	"--add-assignee",
	"--add-label",
	"--add-project",
	"--assignee",
	"-b",
	"-B",
	"--base",
	"--body",
	"--body-file",
	"-c",
	"-F",
	"-f",
	"--field",
	"-H",
	"--head",
	"--hostname",
	"-J",
	"--jq",
	"--input",
	"--json",
	"-l",
	"--label",
	"-L",
	"--limit",
	"-m",
	"--milestone",
	"--method",
	"-p",
	"--project",
	"--raw-field",
	"-R",
	"--reason",
	"--remove-assignee",
	"--remove-label",
	"--remove-project",
	"--repo",
	"-r",
	"--reviewer",
	"--search",
	"--sort",
	"--state",
	"-t",
	"--template",
	"--title",
	"-X",
]);

function optionConsumesValue(token: string): boolean {
	if (token.includes("=")) return false;
	return OPTION_VALUE_FLAGS.has(token);
}

function shellRedirectionSkipCount(token: string): 0 | 1 | 2 {
	if (/^(?:\d+)?(?:<<<|<<-|<<|<>|>>|>|<)$/.test(token) || /^&>>?$/.test(token)) return 2;
	if (/^(?:\d+)?(?:<<<|<<-|<<|<>|>>|>|<).+/.test(token) || /^&>>?.+/.test(token) || /^(?:\d+)?[<>]&\d+$/.test(token)) return 1;
	return 0;
}

function positionalArgs(tokens: string[], startIndex: number, afterOptionTerminator = false): string[] {
	const args: string[] = [];
	for (let i = startIndex; i < tokens.length; i++) {
		const token = tokens[i];
		if (!afterOptionTerminator && token === "--") {
			args.push(...positionalArgs(tokens, i + 1, true));
			break;
		}
		const redirectionSkipCount = shellRedirectionSkipCount(token);
		if (redirectionSkipCount > 0) {
			if (redirectionSkipCount === 2) i++;
			continue;
		}
		if (!afterOptionTerminator && token.startsWith("-")) {
			if (optionConsumesValue(token)) i++;
			continue;
		}
		args.push(token);
	}
	return args;
}

function targetFromPositionals(tokens: string[], startIndex: number, fallback?: string): string | undefined {
	return positionalArgs(tokens, startIndex).join(" ") || fallback;
}

function readGhBodyFile(value: string | undefined): string | undefined {
	if (!value || value === "-") return undefined;
	try {
		const resolved = path.resolve(value);
		const stats = fs.statSync(resolved);
		if (!stats.isFile() || stats.size > MAX_BODY_FILE_BYTES) return undefined;
		return normalizeBody(fs.readFileSync(resolved, "utf8"));
	} catch {
		return undefined;
	}
}

function getGhBody(tokens: string[]): string | undefined {
	const inline = getOptionValue(tokens, ["--body", "-b"]);
	if (inline !== undefined) return inline;
	return readGhBodyFile(getOptionValue(tokens, ["--body-file", "-F"]));
}

function bodyFilePayloadValue(value: string | undefined): string {
	const body = readGhBodyFile(value);
	if (body !== undefined) return `body-file-sha256:${sha256(body)}`;
	return `body-file:${value ?? "<missing>"}`;
}

function inputPayloadValue(value: string | undefined): string {
	const body = readGhBodyFile(value);
	if (body !== undefined) return `input-sha256:${sha256(body)}`;
	return `input:${value ?? "<missing>"}`;
}

function ghMutationPayload(tokens: string[], startIndex: number): string {
	const payload: string[] = [];
	for (let i = startIndex; i < tokens.length; i++) {
		const token = tokens[i];
		if ((token === "--body-file" || token === "-F") && i + 1 < tokens.length) {
			payload.push(token, bodyFilePayloadValue(tokens[i + 1]));
			i++;
			continue;
		}
		if (token.startsWith("--body-file=")) {
			payload.push(`--body-file=${bodyFilePayloadValue(token.slice("--body-file=".length))}`);
			continue;
		}
		payload.push(token);
	}
	return JSON.stringify(payload);
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

function isGhApiFieldFlag(token: string): boolean {
	return token === "-f" || token === "-F" || token === "--field" || token === "--raw-field";
}

function isInlineGhApiFieldFlag(token: string): boolean {
	return token.startsWith("--field=") || token.startsWith("--raw-field=");
}

function hasGhApiRequestPayload(tokens: string[]): boolean {
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (isGhApiFieldFlag(token) && tokens[i + 1]) return true;
		if (isInlineGhApiFieldFlag(token)) return true;
		if (token === "--input" && tokens[i + 1]) return true;
		if (token.startsWith("--input=")) return true;
	}
	return false;
}

function ghApiMethod(tokens: string[]): string {
	const explicit = getOptionValue(tokens, ["-X", "--method"]);
	if (explicit) return explicit.toUpperCase();
	return hasGhApiRequestPayload(tokens) ? "POST" : "GET";
}

function ghApiRequestPayload(tokens: string[]): string | undefined {
	const payload: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (isGhApiFieldFlag(token) && i + 1 < tokens.length) {
			payload.push(token, tokens[i + 1]);
			i++;
			continue;
		}
		if (isInlineGhApiFieldFlag(token)) {
			payload.push(token);
			continue;
		}
		if (token === "--input" && i + 1 < tokens.length) {
			payload.push(token, inputPayloadValue(tokens[i + 1]));
			i++;
			continue;
		}
		if (token.startsWith("--input=")) {
			payload.push(`--input=${inputPayloadValue(token.slice("--input=".length))}`);
		}
	}
	return payload.length > 0 ? JSON.stringify(payload) : undefined;
}

function firstNonOption(tokens: string[], startIndex: number): string | undefined {
	return positionalArgs(tokens, startIndex)[0];
}

function ghCommandParts(tokens: string[]): { group: string; sub?: string; subIndex: number } | undefined {
	let index = 1;
	let group: string | undefined;
	while (index < tokens.length) {
		const token = tokens[index];
		if (token === "--") return undefined;
		if (token.startsWith("-")) {
			if (optionConsumesValue(token)) index += 2;
			else index++;
			continue;
		}
		group = token;
		index++;
		break;
	}
	if (!group) return undefined;
	while (index < tokens.length) {
		const token = tokens[index];
		if (token === "--") return { group, subIndex: index };
		if (token.startsWith("-")) {
			if (optionConsumesValue(token)) index += 2;
			else index++;
			continue;
		}
		return { group, sub: token, subIndex: index };
	}
	return { group, subIndex: index };
}

function makeIntent(intent: Omit<MutationIntent, "target"> & { target?: string }): MutationIntent {
	return { ...intent, target: cleanTarget(intent.target) };
}

function classifyGhCommand(tokens: string[], source: MutationSource): MutationIntent[] {
	const parts = ghCommandParts(tokens);
	if (!parts) return [];
	const { group, sub, subIndex } = parts;

	if (group === "pr") {
		if (["view", "list", "checks", "diff"].includes(sub ?? "")) return [];
		const target = sub === "create" ? "new pull request" : targetFromPositionals(tokens, subIndex + 1, "current pull request");
		if (sub === "create") {
			return [makeIntent({ service: "github", action: "pr-create", tier: 2, target, body: ghMutationPayload(tokens, subIndex + 1), source, reason: "GitHub PR create" })];
		}
		if (sub === "comment") {
			return [makeIntent({ service: "github", action: "pr-comment", tier: 1, target, body: getGhBody(tokens), source, reason: "GitHub PR comment" })];
		}
		if (sub === "merge") {
			return [makeIntent({ service: "github", action: "pr-merge", tier: 3, target, source, reason: "GitHub PR merge" })];
		}
		if (["review", "edit", "close", "reopen", "ready", "lock", "unlock"].includes(sub ?? "")) {
			const tier: MutationTier = sub === "review" || sub === "edit" ? 2 : 3;
			const body = tier === 2 ? ghMutationPayload(tokens, subIndex + 1) : undefined;
			return [makeIntent({ service: "github", action: `pr-${sub}`, tier, target, body, source, reason: `GitHub PR ${sub}` })];
		}
	}

	if (group === "issue") {
		if (["view", "list"].includes(sub ?? "")) return [];
		const target = sub === "create" ? "new issue" : targetFromPositionals(tokens, subIndex + 1);
		if (sub === "comment") {
			return [makeIntent({ service: "github", action: "issue-comment", tier: 1, target, body: getGhBody(tokens), source, reason: "GitHub issue comment" })];
		}
		if (["create", "edit", "close", "reopen", "delete", "transfer", "pin", "unpin", "lock", "unlock"].includes(sub ?? "")) {
			const tier: MutationTier = ["create", "edit"].includes(sub ?? "") ? 2 : 3;
			const body = tier === 2 ? ghMutationPayload(tokens, subIndex + 1) : undefined;
			return [makeIntent({ service: "github", action: `issue-${sub}`, tier, target, body, source, reason: `GitHub issue ${sub}` })];
		}
	}

	if (group === "api") {
		const method = ghApiMethod(tokens);
		if (!MUTATING_HTTP_METHODS.has(method)) return [];
		const endpoint = firstNonOption(tokens, 2);
		const payload = ghApiRequestPayload(tokens);
		const issueComments = endpoint?.match(/issues\/(\d+)\/comments/);
		if (method === "POST" && issueComments) {
			return [makeIntent({ service: "github", action: "issue-comment", tier: 1, target: issueComments[1], body: getFieldValue(tokens, "body") ?? payload, source, reason: "GitHub issue comment API mutation" })];
		}
		return [makeIntent({ service: "github", action: `api-${method.toLowerCase()}`, tier: method === "DELETE" ? 3 : 2, target: endpoint, body: payload, source, reason: `GitHub API ${method}` })];
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

const CLOUD_MUTATION_COMMANDS = new Set([
	"add-iam-policy-binding",
	"cancel",
	"copy-snapshot",
	"deploy",
	"remove-iam-policy-binding",
	"rm",
	"run-instances",
	"set-iam-policy",
	"start",
	"stop",
	"sync",
	"tag-resource",
	"terminate",
	"untag-resource",
]);
const CLOUD_MUTATION_PREFIXES = new Set(["attach", "create", "delete", "deploy", "detach", "disable", "enable", "invoke", "publish", "put", "remove", "send", "terminate", "update", "upload"]);
const CLOUD_STORAGE_TRANSFER_COMMANDS = new Set(["cp", "copy", "mv", "rm", "sync"]);

function isCloudStorageUri(value: string | undefined): boolean {
	return /^(?:s3|gs):\/\//i.test(value ?? "");
}

function isCloudStorageMutation(tokens: string[], command: string, index: number): boolean {
	if (command === "rm") return true;
	if (command === "mv") return tokens.slice(index + 1).some(isCloudStorageUri);
	if (command === "cp" || command === "copy" || command === "sync") {
		const args = positionalArgs(tokens, index + 1);
		return isCloudStorageUri(args.at(-1));
	}
	return true;
}

function findCloudMutation(tokens: string[]): string | undefined {
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i].toLowerCase();
		if (token.startsWith("-")) continue;
		if (CLOUD_STORAGE_TRANSFER_COMMANDS.has(token)) {
			if (isCloudStorageMutation(tokens, token, i)) return token;
			continue;
		}
		if (CLOUD_MUTATION_COMMANDS.has(token)) return token;
		const prefix = token.split(/[-:]/)[0];
		if (CLOUD_MUTATION_PREFIXES.has(prefix)) return token.replace(/:/g, "-");
	}
	return undefined;
}

function classifyCloudCommand(tokens: string[], source: MutationSource, service: "gcloud" | "aws"): MutationIntent[] {
	const mutation = findCloudMutation(tokens);
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

const CURL_POST_BODY_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--json", "-F", "--form", "--form-string"]);

function hasCurlPostBodyFlag(tokens: string[]): boolean {
	for (const token of tokens) {
		if (CURL_POST_BODY_FLAGS.has(token)) return true;
		if (/^-(?:d|F).+/.test(token)) return true;
		if (/^--(?:data|data-raw|data-binary|data-urlencode|json|form|form-string)=/.test(token)) return true;
	}
	return false;
}

function methodFromHttpCommand(tokens: string[]): string | undefined {
	if (tokens[0] === "http" && tokens[1] && MUTATING_HTTP_METHODS.has(tokens[1].toUpperCase())) return tokens[1].toUpperCase();
	const explicit = (getOptionValue(tokens, ["-X", "--request", "--method"]) ?? undefined)?.toUpperCase();
	if (explicit) return explicit;
	if (tokens[0] === "curl" && !tokens.includes("-G") && !tokens.includes("--get") && hasCurlPostBodyFlag(tokens)) return "POST";
	return undefined;
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
			: host.includes("directus") ? "directus"
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
	return /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|subprocess|system|shell_exec|passthru|proc_open|popen|Process|ProcessBuilder|Command|fetch|axios|request|requests|httpx|urllib|graphql|mutation|curl|git|gh|firebase|gcloud|aws|linear)\b|https?:\/\//i.test(code);
}

function hasNetworkSink(code: string): boolean {
	return /\b(fetch|axios|request|requests|httpx|urllib|graphql|reqwest|HttpClient|Net::HTTP)\b|\bhttps?\.request\b|\bcurl_(?:exec|setopt)\b/i.test(code);
}

function httpMethodFromCode(code: string): string | undefined {
	const explicit = code.match(/\bmethod\s*[:=]\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i)?.[1];
	if (explicit) return explicit.toUpperCase();
	const methodCall = code.match(/\b(?:axios|requests|httpx|reqwest|Net::HTTP)\.(post|put|patch|delete)\s*\(/i)?.[1];
	if (methodCall) return methodCall.toUpperCase();
	return code.match(/\bCURLOPT_CUSTOMREQUEST\b[\s\S]{0,120}["'`](POST|PUT|PATCH|DELETE)["'`]/i)?.[1]?.toUpperCase();
}

function pushExecutionSinkStrings(values: string[], window: string): void {
	const quoted = extractQuotedStrings(window, MAX_QUOTED_STRINGS - values.length);
	if (quoted.length > 1 && values.length < MAX_QUOTED_STRINGS) {
		const joined = quoted.join(" ");
		if (!values.includes(joined)) values.push(joined);
	}
	for (const value of quoted) {
		if (values.length >= MAX_QUOTED_STRINGS) break;
		if (!values.includes(value)) values.push(value);
	}
}

function extractExecutionSinkStrings(code: string): string[] {
	const values: string[] = [];
	const sinkPattern = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|system|shell_exec|passthru|proc_open|popen|subprocess\.(?:run|call|check_call|check_output|Popen)|os\.system|Open3\.(?:capture2|capture3|popen3)|Process\.Start|ProcessStartInfo|ProcessBuilder|exec\.Command|Command::new)\s*\(/g;
	let match: RegExpExecArray | null;
	while ((match = sinkPattern.exec(code)) && values.length < MAX_QUOTED_STRINGS) {
		const window = code.slice(match.index, Math.min(code.length, match.index + 4_000));
		pushExecutionSinkStrings(values, window);
		for (const variant of embeddedCommandVariants(window)) {
			if (values.length >= MAX_QUOTED_STRINGS) break;
			if (variant !== window) pushExecutionSinkStrings(values, variant);
		}
	}
	return values;
}

function codePointFromEscape(match: string, hex: string): string {
	const value = Number.parseInt(hex, 16);
	if (!Number.isFinite(value) || value > 0x10ffff) return match;
	return String.fromCodePoint(value);
}

function decodeEscapedCommandText(value: string): string {
	return value
		.replace(/\\+u\{([0-9a-fA-F]{1,6})\}/g, codePointFromEscape)
		.replace(/\\+u([0-9a-fA-F]{4})/g, codePointFromEscape)
		.replace(/\\+x([0-9a-fA-F]{2})/g, codePointFromEscape)
		.replace(/\\+n/g, "\n")
		.replace(/\\+r/g, "\r")
		.replace(/\\+t/g, "\t");
}

function embeddedCommandVariants(value: string): string[] {
	const variants = [value];
	let current = value;
	for (let i = 0; i < 3; i++) {
		current = decodeEscapedCommandText(current.replace(/\\(["'`\\])/g, "$1"));
		if (!variants.includes(current)) variants.push(current);
	}
	return variants;
}

function nestedIntentTargetKey(target: string | undefined): string {
	return (target ?? "").replace(/[)\\]+$/, "");
}

function nestedIntentTargetJunkLength(target: string | undefined): number {
	return (target ?? "").match(/[)\\]+$/)?.[0].length ?? 0;
}

function dedupeCodeTextIntents(intents: MutationIntent[]): MutationIntent[] {
	const deduped = new Map<string, MutationIntent>();
	for (const intent of intents) {
		const key = `${intent.service}\0${intent.action}\0${intent.source}\0${nestedIntentTargetKey(intent.target)}`;
		const existing = deduped.get(key);
		if (!existing || nestedIntentTargetJunkLength(existing.target) > nestedIntentTargetJunkLength(intent.target)) deduped.set(key, intent);
	}
	return [...deduped.values()];
}

function classifyCodeText(code: string, source: MutationSource): MutationIntent[] {
	if (!shouldScanCodeText(code)) return [];
	const scanText = sampleCodeText(code);
	const intents: MutationIntent[] = [];
	const method = httpMethodFromCode(code);
	if (method && includesHostedService(code) && hasNetworkSink(code)) {
		const service = serviceFromWords(wordParts(scanText), code);
		intents.push(makeIntent({ service, action: `http-${method.toLowerCase()}`, tier: method === "DELETE" ? 3 : 2, source, reason: `embedded hosted HTTP ${method}` }));
	}
	if (/\bmutation\b/i.test(code) && includesHostedService(code) && hasNetworkSink(code)) {
		const service = serviceFromWords(wordParts(scanText), code);
		intents.push(makeIntent({ service, action: "graphql-mutation", tier: 2, source, reason: "embedded GraphQL mutation" }));
	}
	for (const quoted of extractExecutionSinkStrings(code)) {
		for (const variant of embeddedCommandVariants(quoted)) {
			const nestedIntents = classifyShellCommand(variant, source, false);
			if (nestedIntents.length === 0) continue;
			intents.push(...nestedIntents);
			break;
		}
	}
	return dedupeCodeTextIntents(intents);
}

const GIT_GLOBAL_VALUE_OPTIONS = new Set([
	"-C",
	"-c",
	"--attr-source",
	"--config-env",
	"--exec-path",
	"--git-dir",
	"--list-cmds",
	"--namespace",
	"--path-format",
	"--super-prefix",
	"--work-tree",
]);
const GIT_GLOBAL_BOOL_OPTIONS = new Set([
	"-P",
	"-p",
	"--bare",
	"--glob-pathspecs",
	"--icase-pathspecs",
	"--literal-pathspecs",
	"--no-lazy-fetch",
	"--no-optional-locks",
	"--no-pager",
	"--no-replace-objects",
	"--noglob-pathspecs",
	"--paginate",
]);

function isInlineGitGlobalValueOption(token: string): boolean {
	return /^(?:-C.+|-c.+|--(?:attr-source|config-env|exec-path|git-dir|list-cmds|namespace|path-format|super-prefix|work-tree)=.+)$/.test(token);
}

function skipGitGlobalOptions(tokens: string[]): string[] {
	let index = 1;
	while (index < tokens.length) {
		const token = tokens[index];
		if (token === "--") {
			index++;
			continue;
		}
		if (GIT_GLOBAL_VALUE_OPTIONS.has(token)) {
			index += 2;
			continue;
		}
		if (isInlineGitGlobalValueOption(token) || GIT_GLOBAL_BOOL_OPTIONS.has(token)) {
			index++;
			continue;
		}
		break;
	}
	return [tokens[0], ...tokens.slice(index)];
}

export function classifyShellCommand(command: string, source: MutationSource = "bash", scanEmbedded = true, depth = 0): MutationIntent[] {
	const intents: MutationIntent[] = [];
	const canRecurse = depth < MAX_SHELL_RECURSION_DEPTH;
	for (const segment of splitCommandSegments(command)) {
		if (scanEmbedded && canRecurse) {
			for (const substitution of extractShellCommandSubstitutions(segment)) {
				intents.push(...classifyShellCommand(substitution, source, true, depth + 1));
			}
		}
		const tokens = stripShellWrappers(shellSplit(segment));
		if (tokens.length === 0) continue;
		const wrappedCommand = getShellWrapperCommand(tokens);
		if (wrappedCommand) {
			if (canRecurse) intents.push(...classifyShellCommand(wrappedCommand, source, scanEmbedded, depth + 1));
			continue;
		}
		const executable = executableName(tokens[0]);
		if (!executable) continue;
		const executableTokens = [executable, ...tokens.slice(1)];
		const commandTokens = executable === "git" ? skipGitGlobalOptions(executableTokens) : executableTokens;
		if (executable === "git" && commandTokens[1] === "push") {
			intents.push(makeIntent({ service: "git", action: "git-push", tier: 3, target: commandTokens.slice(2).join(" ") || "remote", source, reason: "git push mutates a remote repository" }));
			continue;
		}
		if (executable === "gh") {
			intents.push(...classifyGhCommand(executableTokens, source));
			continue;
		}
		if (executable === "firebase") {
			intents.push(...classifyFirebaseCommand(executableTokens, source));
			continue;
		}
		if (executable === "gcloud" || executable === "aws") {
			intents.push(...classifyCloudCommand(executableTokens, source, executable));
			continue;
		}
		if (executable === "linear") {
			intents.push(...classifyLinearCommand(executableTokens, source));
			continue;
		}
		if (executable === "curl" || executable === "http" || executable === "wget") {
			intents.push(...classifyHttpCommand(executableTokens, source));
			continue;
		}
		if (scanEmbedded) intents.push(...classifyCodeText(segment, source));
	}
	return intents;
}

function isContextModeTool(toolName: string): boolean {
	return CONTEXT_MODE_TOOL_NAMES.has(toolName);
}

function isLocalFileTool(toolName: string): boolean {
	return LOCAL_FILE_TOOL_NAMES.has(toolName);
}

function classifyContextModeCode(language: unknown, code: unknown, source: MutationSource): MutationIntent[] {
	if (typeof code !== "string") return [];
	const lang = typeof language === "string" ? language.toLowerCase() : "";
	if (lang === "shell" || lang === "bash" || lang === "sh") return classifyShellCommand(code, source);
	return classifyCodeText(code, source);
}

function classifyContextModeTool(toolName: string, input: unknown): MutationIntent[] {
	const value = input as any;
	if (CONTEXT_MODE_EXECUTE_TOOL_NAMES.has(toolName)) return classifyContextModeCode(value?.language, value?.code, "ctx_execute");
	if (CONTEXT_MODE_EXECUTE_FILE_TOOL_NAMES.has(toolName)) return classifyContextModeCode(value?.language, value?.code, "ctx_execute_file");
	if (CONTEXT_MODE_BATCH_TOOL_NAMES.has(toolName)) {
		if (!Array.isArray(value?.commands)) return [];
		return value.commands.flatMap((entry: unknown) => {
			const command = (entry as any)?.command;
			if (typeof command !== "string") return [];
			return classifyShellCommand(command, "ctx_batch_execute");
		});
	}
	return [];
}

export function extractShellCommands(toolName: string, input: unknown): ShellCommand[] {
	const value = input as any;
	if (toolName === "bash" && typeof value?.command === "string") return [{ command: value.command, source: "bash" }];
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

function regexEscape(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeJsonStringFragment(value: string): string {
	try {
		const parsed = JSON.parse(`"${value}"`);
		if (typeof parsed === "string") return parsed;
	} catch {
		// Fall back to a small common escape decoder for JSON-like single-quoted payloads.
	}
	return value
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\b/g, "\b")
		.replace(/\\f/g, "\f")
		.replace(/\\(["'\\\\/])/g, "$1");
}

function findJsonStringField(value: string, names: Set<string>): string | undefined {
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
	const half = Math.floor(MAX_JSON_STRING_LENGTH / 2);
	const scanText = trimmed.length <= MAX_JSON_STRING_LENGTH ? trimmed : `${trimmed.slice(0, half)}\n${trimmed.slice(-half)}`;
	for (const name of names) {
		const escapedName = regexEscape(name);
		const doubleQuoted = scanText.match(new RegExp(`["']${escapedName}["']\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, "i"));
		if (doubleQuoted) return decodeJsonStringFragment(doubleQuoted[1]);
		const singleQuoted = scanText.match(new RegExp(`["']${escapedName}["']\\s*:\\s*'([^'\\\\]*(?:\\\\.[^'\\\\]*)*)'`, "i"));
		if (singleQuoted) return decodeJsonStringFragment(singleQuoted[1]);
	}
	return undefined;
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
				if (parsed && typeof parsed === "object") {
					stack.push(parsed);
					continue;
				}
				const extracted = findJsonStringField(value, loweredNames);
				if (extracted !== undefined) return extracted;
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

function tokenizeSqlForGuard(query: string): { words: string[]; hasStatementSeparator: boolean; hasUnterminatedLiteral: boolean } {
	const words: string[] = [];
	let hasStatementSeparator = false;
	let i = 0;
	while (i < query.length) {
		const char = query[i];
		const next = query[i + 1];
		if (char === "-" && next === "-") {
			i += 2;
			while (i < query.length && query[i] !== "\n") i++;
			continue;
		}
		if (char === "/" && next === "*") {
			const end = query.indexOf("*/", i + 2);
			if (end === -1) return { words, hasStatementSeparator, hasUnterminatedLiteral: true };
			i = end + 2;
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			const quote = char;
			i++;
			let closed = false;
			while (i < query.length) {
				if (query[i] === "\\") {
					i += 2;
					continue;
				}
				if (query[i] === quote) {
					if (query[i + 1] === quote) {
						i += 2;
						continue;
					}
					i++;
					closed = true;
					break;
				}
				i++;
			}
			if (!closed) return { words, hasStatementSeparator, hasUnterminatedLiteral: true };
			continue;
		}
		if (char === ";") {
			hasStatementSeparator = true;
			i++;
			continue;
		}
		if (/[A-Za-z_]/.test(char)) {
			const start = i;
			i++;
			while (i < query.length && /[A-Za-z0-9_]/.test(query[i])) i++;
			words.push(query.slice(start, i).toLowerCase());
			continue;
		}
		i++;
	}
	return { words, hasStatementSeparator, hasUnterminatedLiteral: false };
}

function isReadOnlyPosthogSqlQuery(query: string): boolean {
	const tokens = tokenizeSqlForGuard(query);
	const firstWord = tokens.words[0];
	if (tokens.hasUnterminatedLiteral || tokens.hasStatementSeparator || firstWord === undefined) return false;
	if (POSTHOG_SQL_FORBIDDEN_START_WORDS.has(firstWord)) return false;
	if (tokens.words.some((word) => POSTHOG_SQL_FORBIDDEN_WORDS.has(word))) return false;
	if (firstWord === "select") return true;
	if (firstWord === "with") return tokens.words.includes("select");
	return false;
}

function isPosthogSqlTool(service: string, words: string[]): boolean {
	return service === "posthog" && words.includes("execute") && words.includes("sql");
}

function isNativePosthogSql(input: unknown): boolean {
	return findInputString(input, ["connectionId"]) === undefined;
}

function isGraphqlMutationQuery(value: string): boolean {
	const trimmed = value.trimStart();
	return /^mutation\b(?:\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s*\([^)]*\))?\s*\{/i.test(trimmed);
}

function hasGraphqlMutation(input: unknown): boolean {
	const query = findInputString(input, ["query", "mutation"]);
	return typeof query === "string" && isGraphqlMutationQuery(query);
}

function mutationActionFromInput(input: unknown): string | undefined {
	const action = findInputString(input, ["action", "operation", "op"]);
	if (!action) return undefined;
	const words = wordParts(action);
	if (words.length === 0) return undefined;
	if (READONLY_WORDS.has(words[0])) return undefined;
	return words.find((word) => MUTATION_WORDS.includes(word));
}

function serviceFromExplicitTarget(input: unknown): string | undefined {
	const target = findInputString(input, ["url", "endpoint"]);
	return serviceFromUrl(target)?.service;
}

function serviceFromWords(words: string[], serialized: string): string {
	for (const service of HOSTED_SERVICE_WORDS) {
		if (words.includes(service) || new RegExp(`(^|[^a-z0-9])${service}([^a-z0-9]|$)`, "i").test(serialized)) return service === "gcloud" || service === "googlecloud" ? "gcp" : service;
	}
	return "hosted-service";
}

function tierForAction(action: string): MutationTier {
	if (/comment|message|reply/.test(action)) return 1;
	if (/delete|remove|merge|deploy|publish|push|release|workflow|rerun|cancel|invite|upload|close|reopen|lock|unlock|ready|transfer|pin|unpin/.test(action)) return 3;
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
	return mutationActionFromInput(input) ?? words.find((word) => MUTATION_WORDS.includes(word)) ?? "mutation";
}

function targetFromMcp(service: string, input: unknown, words: string[] = []): string | undefined {
	if (service === "posthog" && words.includes("execute") && words.includes("sql")) {
		const connectionId = findInputString(input, ["connectionId"]);
		return connectionId ? `sql:${connectionId}` : "sql";
	}
	if (service === "github") return findInputString(input, ["prNumber", "pullNumber", "pull_request_number", "issueNumber", "number", "target", "path", "url", "endpoint", "id"]);
	if (service === "linear") return findInputString(input, ["issueId", "issueKey", "key", "id", "target", "path", "url"]);
	if (service === "slack") return findInputString(input, ["channel", "channelId", "target"]);
	return findInputString(input, ["target", "path", "url", "endpoint", "id", "nodeId", "project", "name", "collection"]);
}

function bodyFromMcp(input: unknown): string | undefined {
	return findInputString(input, ["body", "comment", "message", "text", "content"]);
}

function classifyMcpTool(toolName: string, input: unknown): MutationIntent[] {
	const value = input as any;
	const effectiveName = toolName === "mcp" && typeof value?.tool === "string" ? `${value?.server ?? "mcp"}_${value.tool}` : toolName;
	const endpointService = serviceFromExplicitTarget(input);
	const words = wordParts(effectiveName);
	const hosted = includesHostedService(effectiveName) || endpointService !== undefined;
	if (!hosted) return [];

	const service = serviceFromWords(words, endpointService ?? "");
	if (isPosthogSqlTool(service, words) && isNativePosthogSql(input)) {
		const query = findInputString(input, ["query"]);
		if (query !== undefined && isReadOnlyPosthogSqlQuery(query)) return [];
	}

	const method = findInputMethod(input);
	const graphqlMutation = hasGraphqlMutation(input);
	const mutationWord = words.find((word) => MUTATION_WORDS.includes(word));
	const inputAction = mutationActionFromInput(input);
	const firstNonServiceWord = words.find((word) => !HOSTED_SERVICE_WORDS.includes(word) && word !== "mcp");
	const readOnly = firstNonServiceWord !== undefined && READONLY_WORDS.has(firstNonServiceWord);
	if (!method && !graphqlMutation && !mutationWord && !inputAction && readOnly) return [];
	if (method && !MUTATING_HTTP_METHODS.has(method) && !graphqlMutation && !inputAction) return [];
	if (!method && !graphqlMutation && !mutationWord && !inputAction) return [];

	const action = actionFromMcp(service, words, input);
	return [makeIntent({ service, action, tier: tierForAction(action), target: targetFromMcp(service, input, words), body: bodyFromMcp(input), source: "mcp", reason: `${service} ${action} tool`, toolName: effectiveName })];
}

export function classifyToolCall(toolName: string, input: unknown): MutationIntent[] {
	if (isLocalFileTool(toolName)) return [];
	if (isContextModeTool(toolName)) return classifyContextModeTool(toolName, input);
	const shellCommands = extractShellCommands(toolName, input);
	if (shellCommands.length > 0) {
		return shellCommands.flatMap((command) => classifyShellCommand(command.command, command.source));
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
	if (tokens.length < 3) return { error: "Usage: /authorize-hosted-mutation <service> <action> <target> [body-sha256:<hash>]. Tier 1 mutations require body-sha256; tier 2 uses body-sha256 when the blocked warning includes it. Example: /authorize-hosted-mutation git git-push remote" };
	const [service, action, ...rest] = tokens;
	let bodySha256: string | undefined;
	const targetParts: string[] = [];
	for (const token of rest) {
		const hash = token.match(/^(?:body-sha256|payload-sha256):([a-f0-9]{64})$/i);
		if (hash) bodySha256 = hash[1].toLowerCase();
		else targetParts.push(token);
	}
	const target = targetParts.join(" ").trim();
	if (!target) return { error: "Missing target for hosted-service mutation authorization. Provide the exact target shown in the blocked warning. For plain git push, that target is \"remote\"." };
	const normalizedAction = normalizeWord(action);
	if (tierForAction(normalizedAction) === 1 && bodySha256 === undefined) {
		return { error: `One-time authorization for ${normalizedAction} requires body-sha256:<hash> so the exact payload is bound to the approval.` };
	}
	return {
		service: normalizeWord(service),
		action: normalizedAction,
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
	return intent.tier === 3 || (intent.tier === 2 && intent.body === undefined);
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

function authorizationCommandForIntent(intent: MutationIntent, includeBodyHash = false): string {
	const target = intent.target || "<target>";
	const bodyHash = includeBodyHash ? ` body-sha256:${intent.body === undefined ? "<hash>" : sha256(normalizeBody(intent.body))}` : "";
	return `/authorize-hosted-mutation ${intent.service} ${intent.action} ${target}${bodyHash}`;
}

function blockReason(intent: MutationIntent): string {
	const service = intent.service === "gcloud" ? "GCP" : intent.service.charAt(0).toUpperCase() + intent.service.slice(1);
	const target = intent.target ? ` on ${intent.target}` : "";
	if (intent.tier === 3) {
		return `Hosted-service mutation blocked: ${service} ${formatAction(intent.action)}${target} is high risk. Run ${authorizationCommandForIntent(intent)}, then retry the blocked command within 10 minutes.`;
	}
	if (intent.tier === 1) {
		return `Hosted-service mutation blocked: ${service} ${formatAction(intent.action)}${target} requires exact authorization for target and body. Run ${authorizationCommandForIntent(intent, true)}, then retry the blocked command within 10 minutes.`;
	}
	if (intent.body === undefined) {
		return `Hosted-service mutation blocked: ${service} ${formatAction(intent.action)}${target} requires exact authorization for target and action. Run ${authorizationCommandForIntent(intent)}, then retry the blocked command within 10 minutes.`;
	}
	return `Hosted-service mutation blocked: ${service} ${formatAction(intent.action)}${target} requires exact authorization for target and changed fields. Run ${authorizationCommandForIntent(intent, true)}, then retry the blocked command within 10 minutes.`;
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
			ctx.ui.notify(
				`Authorized for 10 minutes: one matching ${authorization.service} ${authorization.action} command can now run for target ${authorization.target}. Retry the blocked command to use this authorization.`,
				"warning",
			);
		},
	});

	pi.registerCommand("hosted-mutation-guard", {
		description: "Show hosted mutation guard status or audit log",
		handler: async (args, ctx) => {
			const command = args.trim() || "status";
			if (command === "status") {
				const activeOneTime = commandAuthorizations.filter((authorization) => !authorization.consumed && (authorization.expiresAt === undefined || authorization.expiresAt >= Date.now())).length;
				const promptOptions = ctx.getSystemPromptOptions?.();
				ctx.ui.notify(
					[
						"Hosted mutation guard active.",
						`Prompt authorizations: ${promptAuthorizations.length}`,
						`One-time authorizations: ${activeOneTime}`,
						`Blocked attempts logged: ${auditEntries.length}`,
						...formatPromptContextSummary(promptOptions),
					].join("\n"),
					"info",
				);
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
			ctx.ui.notify("Usage: /hosted-mutation-guard [status|audit|clear]. Try /hosted-mutation-guard status.", "error");
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
