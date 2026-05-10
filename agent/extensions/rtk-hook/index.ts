import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const DEFAULT_ALLOWLIST = new Set([
	"aws",
	"cargo",
	"docker",
	"dotnet",
	"find",
	"gh",
	"git",
	"grep",
	"jest",
	"json",
	"kubectl",
	"lint",
	"ls",
	"mypy",
	"next",
	"npm",
	"npx",
	"pnpm",
	"prettier",
	"prisma",
	"psql",
	"pytest",
	"ruff",
	"test",
	"tree",
	"tsc",
	"vitest",
	"wc",
]);

const MUTATING_GIT_SUBCOMMANDS = new Set([
	"add",
	"am",
	"apply",
	"bisect",
	"checkout",
	"cherry-pick",
	"clean",
	"clone",
	"commit",
	"fetch",
	"merge",
	"mv",
	"pull",
	"push",
	"rebase",
	"reset",
	"restore",
	"revert",
	"rm",
	"stash",
	"submodule",
	"switch",
	"tag",
	"worktree",
]);

const MUTATING_NPM_SUBCOMMANDS = new Set([
	"add",
	"audit",
	"ci",
	"dedupe",
	"exec",
	"install",
	"link",
	"publish",
	"rebuild",
	"remove",
	"uninstall",
	"update",
]);

const MUTATING_CARGO_SUBCOMMANDS = new Set([
	"add",
	"clean",
	"fix",
	"install",
	"login",
	"new",
	"publish",
	"remove",
	"rm",
	"update",
]);

const SHELL_META_PATTERN = /[|;&<>`]/;
const COMMAND_SUBSTITUTION_PATTERN = /\$\(/;
const DANGEROUS_FIND_FLAGS = new Set(["-delete", "-exec", "-execdir"]);

function isDisabled(): boolean {
	return ["0", "false", "off", "no"].includes((process.env.PI_RTK_HOOK ?? "1").toLowerCase());
}

function splitCommand(command: string): string[] {
	return command.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) ?? [];
}

function stripLeadingEnvAssignments(parts: string[]): string[] {
	let index = 0;
	while (index < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[index])) {
		index += 1;
	}
	return parts.slice(index);
}

function unquote(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

function hasSubcommand(parts: string[], blocked: Set<string>): boolean {
	const subcommand = parts.find((part) => !part.startsWith("-"));
	return subcommand ? blocked.has(unquote(subcommand)) : false;
}

function shouldWrapWithRtk(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("rtk ")) return false;
	if (trimmed.includes("\n")) return false;
	if (SHELL_META_PATTERN.test(trimmed) || COMMAND_SUBSTITUTION_PATTERN.test(trimmed)) return false;

	const parts = stripLeadingEnvAssignments(splitCommand(trimmed));
	if (parts.length === 0) return false;

	const executable = unquote(parts[0]);
	if (!DEFAULT_ALLOWLIST.has(executable)) return false;

	const args = parts.slice(1).map(unquote);
	if (executable === "git" && hasSubcommand(args, MUTATING_GIT_SUBCOMMANDS)) return false;
	if (["npm", "npx", "pnpm"].includes(executable) && hasSubcommand(args, MUTATING_NPM_SUBCOMMANDS)) return false;
	if (executable === "cargo" && hasSubcommand(args, MUTATING_CARGO_SUBCOMMANDS)) return false;
	if (executable === "find" && args.some((arg) => DANGEROUS_FIND_FLAGS.has(arg))) return false;

	return true;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (isDisabled()) return;
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;
		if (typeof command !== "string") return;

		if (shouldWrapWithRtk(command)) {
			event.input.command = `rtk ${command}`;
		}
	});
}
