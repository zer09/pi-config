import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildReaderSystemPrompt, buildReaderTaskPrompt, buildWriterSystemPrompt, buildWriterTaskPrompt } from "./prompts.ts";
import type { ResolvedReaderInvocation, ResolvedWriterInvocation, TempRunFiles } from "./types.ts";

export async function createTempRunFiles(invocation: ResolvedReaderInvocation): Promise<TempRunFiles> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-delegate-reader-"));
	const promptPath = path.join(dir, "system-prompt.md");
	const taskPath = path.join(dir, "task.md");
	await fs.promises.writeFile(promptPath, buildReaderSystemPrompt(invocation.agent), "utf8");
	await fs.promises.writeFile(taskPath, buildReaderTaskPrompt(invocation), "utf8");
	return { dir, promptPath, taskPath };
}

export async function createWriterTempRunFiles(invocation: ResolvedWriterInvocation): Promise<TempRunFiles> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-delegate-writer-"));
	const promptPath = path.join(dir, "system-prompt.md");
	const taskPath = path.join(dir, "task.md");
	await fs.promises.writeFile(promptPath, buildWriterSystemPrompt(invocation.agent), "utf8");
	await fs.promises.writeFile(taskPath, buildWriterTaskPrompt(invocation), "utf8");
	return { dir, promptPath, taskPath };
}

export async function cleanupTempRunFiles(files: TempRunFiles | undefined): Promise<void> {
	if (!files) return;
	await fs.promises.rm(files.dir, { recursive: true, force: true });
}
