import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

// Curated from the generated RTK instructions section:
// "RTK (Rust Token Killer) - Token-Optimized Commands".
// This hook intentionally fails closed: only known read-only/status commands are auto-wrapped.
const READONLY_COMMAND_PATTERNS: RegExp[] = [
	// Git
	/^git\s+status(?:\s|$)/,
	/^git\s+diff(?:\s|$)/,
	/^git\s+log(?:\s|$)/,
	/^git\s+show(?:\s|$)/,
	/^git\s+branch(?:\s+(?:--show-current|--list|-a|-r|-v|-vv|--merged|--no-merged|--contains|--points-at)\s*\S*)*\s*$/,
	/^git\s+ls-files(?:\s|$)/,
	/^git\s+remote(?:\s+-v)?\s*$/,
	/^git\s+rev-parse(?:\s|$)/,
	/^git\s+describe(?:\s|$)/,

	// GitHub CLI
	/^gh\s+pr\s+(?:view|list|checks|diff)(?:\s|$)/,
	/^gh\s+issue\s+(?:view|list)(?:\s|$)/,
	/^gh\s+run\s+(?:view|list)(?:\s|$)/,
	/^gh\s+repo\s+view(?:\s|$)/,
	/^gh\s+workflow\s+(?:view|list)(?:\s|$)/,
	/^gh\s+release\s+(?:view|list)(?:\s|$)/,

	// GitLab CLI
	/^glab\s+mr\s+(?:view|list|diff)(?:\s|$)/,
	/^glab\s+issue\s+(?:view|list)(?:\s|$)/,
	/^glab\s+(?:ci|pipeline)\s+(?:list|status|trace)(?:\s|$)/,
	/^glab\s+release\s+(?:view|list)(?:\s|$)/,

	// Files and search
	/^ls(?:\s|$)/,
	/^tree(?:\s|$)/,
	/^wc(?:\s|$)/,
	/^grep(?:\s|$)/,
	/^rg(?:\s|$)/,
	/^find(?:\s|$)/,
	/^cat\s+\S/,
	/^head\s+(?:-n\s+\d+|-\d+|--lines(?:=|\s+)\d+)\s+\S/,
	/^tail\s+(?:-n\s+\d+|-\d+|--lines(?:=|\s+)\d+)\s+\S/,
	/^json(?:\s|$)/,

	// Docker
	/^docker\s+(?:ps|images|logs)(?:\s|$)/,
	/^docker\s+compose\s+(?:ps|logs)(?:\s|$)/,

	// Kubernetes
	/^kubectl\s+(?:get|describe|logs)(?:\s|$)/,

	// Build, compile, lint, test
	/^cargo\s+(?:build|check|clippy|test|metadata|tree|nextest)(?:\s|$)/,
	/^cargo\s+fmt\s+--check(?:\s|$)/,
	/^dotnet\s+(?:build|test)(?:\s|$)/,
	/^dotnet\s+format(?:\s|$)/,
	/^go\s+(?:test|build|vet)(?:\s|$)/,
	/^(?:golangci-lint|golangci)\s+run(?:\s|$)/,
	/^jest(?:\s|$)/,
	/^(?:python[0-9.]*\s+-m\s+)?mypy(?:\s|$)/,
	/^next\s+build(?:\s|$)/,
	/^(?:python[0-9.]*\s+-m\s+)?pytest(?:\s|$)/,
	/^ruff\s+check(?:\s|$)/,
	/^tsc(?:\s|$)/,
	/^vitest(?:\s|$)/,
	/^prettier\s+--check(?:\s|$)/,
	/^playwright\s+test(?:\s|$)/,
	/^(?:bundle\s+exec\s+)?rspec(?:\s|$)/,
	/^(?:bundle\s+exec\s+)?rubocop(?:\s|$)/,
	/^(?:bundle\s+exec\s+)?(?:bin\/)?(?:rake|rails)\s+test(?:\s|$)/,

	// Package managers
	/^npm\s+(?:test|list|outdated|view|info|explain)(?:\s|$)/,
	/^npm\s+(?:run|run-script)\s+(?:test|build|lint|typecheck|check|tsc|jest|vitest|playwright|next)(?:\s|$)/,
	/^npx\s+(?:tsc|eslint|biome|jest|vitest)(?:\s|$)/,
	/^npx\s+prettier\s+--check(?:\s|$)/,
	/^npx\s+next\s+build(?:\s|$)/,
	/^npx\s+playwright\s+test(?:\s|$)/,
	/^pnpm\s+(?:test|list|ls|outdated|why|view|info|typecheck)(?:\s|$)/,
	/^pnpm\s+(?:run|run-script)\s+(?:test|build|lint|typecheck|check|tsc|jest|vitest|playwright|next)(?:\s|$)/,
	/^(?:pip3?|uv\s+pip)\s+(?:list|outdated|show)(?:\s|$)/,

	// Prisma
	/^prisma\s+migrate\s+status(?:\s|$)/,

	// System and cloud read-only/status commands
	/^df(?:\s|$)/,
	/^du(?:\s|$)/,
	/^ps(?:\s|$)/,
	/^systemctl\s+status(?:\s|$)/,
	/^aws\s+sts\s+get-caller-identity(?:\s|$)/,
	/^aws\s+s3\s+ls(?:\s|$)/,
	/^aws\s+ec2\s+describe-[a-z0-9-]+(?:\s|$)/,
	/^aws\s+(?:ecs|rds|cloudformation|logs|lambda|iam|dynamodb|s3api|eks|sqs)\s+(?:list|describe|get|filter|scan|query)[a-z0-9-]*(?:\s|$)/,
];

const SHELL_META_PATTERN = /[|;&<>`]/;
const COMMAND_SUBSTITUTION_PATTERN = /\$\(/;
const DANGEROUS_FIND_FLAGS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"]);
const MUTATING_FLAGS = new Set(["--fix", "--write"]);
const RUBOCOP_MUTATING_FLAGS = new Set(["-a", "-A", "--auto-correct", "--auto-correct-all", "--autocorrect", "--autocorrect-all"]);

function isDisabled(): boolean {
	return ["0", "false", "off", "no"].includes((process.env.PI_RTK_HOOK ?? "1").toLowerCase());
}

function splitCommand(command: string): string[] {
	return command.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) ?? [];
}

function countLeadingEnvAssignments(parts: string[]): number {
	let index = 0;
	while (index < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[index])) {
		index += 1;
	}
	return index;
}

function stripLeadingEnvAssignments(parts: string[]): string[] {
	return parts.slice(countLeadingEnvAssignments(parts));
}

function unquote(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

function normalizeCommand(parts: string[]): string {
	return parts.map(unquote).join(" ");
}

function hasAnyArg(args: string[], blocked: Set<string>): boolean {
	return args.some((arg) => blocked.has(unquote(arg)));
}

function hasFlagValue(args: string[], flag: string): boolean {
	return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function isReadonlyGhApi(parts: string[]): boolean {
	if (unquote(parts[0]) !== "gh" || unquote(parts[1] ?? "") !== "api") return false;

	const args = parts.slice(2).map(unquote);
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-X" || arg === "--method") {
			return (args[index + 1] ?? "").toUpperCase() === "GET";
		}
		if (arg.startsWith("-X") && arg.length > 2) {
			return arg.slice(2).toUpperCase() === "GET";
		}
		if (arg.startsWith("--method=")) {
			return arg.slice("--method=".length).toUpperCase() === "GET";
		}
	}

	return true;
}

function rtkRewrite(command: string): string | null {
	try {
		const output = execFileSync("rtk", ["rewrite", command], {
			encoding: "utf8",
			maxBuffer: 64 * 1024,
			timeout: 2_000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return output.startsWith("rtk ") ? output : null;
	} catch (error) {
		const output = typeof (error as { stdout?: unknown }).stdout === "string"
			? (error as { stdout: string }).stdout.trim()
			: Buffer.isBuffer((error as { stdout?: unknown }).stdout)
				? ((error as { stdout: Buffer }).stdout).toString("utf8").trim()
				: "";
		return output.startsWith("rtk ") ? output : null;
	}
}

function getRtkRewrite(command: string): string | null {
	const trimmed = command.trim();
	if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("rtk ")) return null;
	if (trimmed.includes("\n")) return null;
	if (SHELL_META_PATTERN.test(trimmed) || COMMAND_SUBSTITUTION_PATTERN.test(trimmed)) return null;

	const rawParts = splitCommand(trimmed);
	if (countLeadingEnvAssignments(rawParts) > 0) return null;

	const parts = stripLeadingEnvAssignments(rawParts);
	if (parts.length === 0) return null;

	const executable = unquote(parts[0]);
	const args = parts.slice(1).map(unquote);
	const normalized = normalizeCommand(parts);
	if (executable === "find" && hasAnyArg(args, DANGEROUS_FIND_FLAGS)) return null;
	if (hasAnyArg(args, MUTATING_FLAGS)) return null;
	if (executable === "rubocop" && hasAnyArg(args, RUBOCOP_MUTATING_FLAGS)) return null;
	if (normalized.startsWith("bundle exec rubocop") && hasAnyArg(args.slice(2), RUBOCOP_MUTATING_FLAGS)) return null;
	if (executable === "git" && hasFlagValue(args, "--output")) return null;
	if (executable === "dotnet" && args[0] === "format" && !args.includes("--verify-no-changes")) return null;
	const approved = READONLY_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized)) || isReadonlyGhApi(parts);
	return approved ? rtkRewrite(trimmed) : null;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (isDisabled()) return;
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;
		if (typeof command !== "string") return;

		const rewritten = getRtkRewrite(command);
		if (rewritten) {
			event.input.command = rewritten;
		}
	});
}
