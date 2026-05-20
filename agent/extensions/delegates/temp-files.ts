import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildReaderSystemPrompt, buildReaderTaskPrompt } from "./prompts.ts";
import type { ResolvedInvocation, TempRunFiles } from "./types.ts";

export async function createTempRunFiles(invocation: ResolvedInvocation): Promise<TempRunFiles> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-delegate-reader-"));
	const promptPath = path.join(dir, "system-prompt.md");
	const taskPath = path.join(dir, "task.md");
	await fs.promises.writeFile(promptPath, buildReaderSystemPrompt(invocation.agent), "utf8");
	await fs.promises.writeFile(taskPath, buildReaderTaskPrompt(invocation), "utf8");
	return { dir, promptPath, taskPath };
}

export async function cleanupTempRunFiles(files: TempRunFiles | undefined): Promise<void> {
	if (!files) return;
	await fs.promises.rm(files.dir, { recursive: true, force: true });
}
