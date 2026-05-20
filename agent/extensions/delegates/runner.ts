import * as fs from "node:fs";

import { discoverAgents } from "./agent-files.ts";
import { runChildProcess } from "./child-process.ts";
import { buildReaderPiArgs, getPiInvocation } from "./pi-invocation.ts";
import { normalizeReaderParams, resolveInvocation } from "./params.ts";
import { emitDelegateProgress, type DelegateUpdate } from "./progress.ts";
import { makeImmediateFailure, makeReaderToolResult } from "./results.ts";
import { cleanupTempRunFiles, createTempRunFiles } from "./temp-files.ts";
import type { ReaderParams, ReaderToolResult, TempRunFiles } from "./types.ts";

export async function runReader(
	params: ReaderParams,
	defaultCwd: string,
	signal?: AbortSignal,
	onUpdate?: DelegateUpdate,
): Promise<ReaderToolResult> {
	const started = Date.now();
	const normalized = normalizeReaderParams(params, defaultCwd);
	emitDelegateProgress(onUpdate, "starting", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd });
	const discovery = await discoverAgents();
	const resolved = resolveInvocation(normalized, discovery.agents);
	if (typeof resolved === "string") return makeImmediateFailure(normalized, normalized.agent, resolved, Date.now() - started);

	let tempFiles: TempRunFiles | undefined;
	try {
		await fs.promises.mkdir(resolved.sessionDir, { recursive: true });
		tempFiles = await createTempRunFiles(resolved);
		const args = buildReaderPiArgs(resolved, tempFiles);
		const invocation = getPiInvocation(args);
		emitDelegateProgress(onUpdate, "launching_child", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd });
		let emittedChildEvent = false;
		const child = await runChildProcess(invocation, normalized.cwd, signal, normalized.timeoutMs, () => {
			if (emittedChildEvent) return;
			emittedChildEvent = true;
			emitDelegateProgress(onUpdate, "child_event", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd });
		});
		emitDelegateProgress(onUpdate, "finishing", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd });
		return makeReaderToolResult(resolved, child, Date.now() - started);
	} finally {
		await cleanupTempRunFiles(tempFiles);
	}
}
