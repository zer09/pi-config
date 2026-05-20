import * as fs from "node:fs";
import * as path from "node:path";

import { DELEGATE_BIN_ENV } from "./constants.ts";
import type { ResolvedInvocation, ResolvedWriterInvocation, TempRunFiles } from "./types.ts";

export function buildReaderPiArgs(invocation: ResolvedInvocation, files: TempRunFiles): string[] {
	return [
		"--mode",
		"json",
		"-p",
		"--session-dir",
		invocation.sessionDir,
		"--continue",
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

export function buildWriterPiArgs(invocation: ResolvedWriterInvocation, files: TempRunFiles): string[] {
	return [
		"--mode",
		"json",
		"-p",
		"--session-dir",
		invocation.sessionDir,
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
	const override = process.env[DELEGATE_BIN_ENV];
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
