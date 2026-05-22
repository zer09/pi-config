import * as fs from "node:fs";
import * as path from "node:path";

import { discoverAgents } from "./agent-files.ts";
import { runChildProcess } from "./child-process.ts";
import { DELEGATE_ALLOWED_PATHS_ENV } from "./constants.ts";
import { buildReaderPiArgs, buildWriterPiArgs, getPiInvocation } from "./pi-invocation.ts";
import { normalizeReaderParams, normalizeWriterParams, resolveInvocation, resolveWriterInvocation } from "./params.ts";
import { getWriterSessionBaseDir } from "./paths.ts";
import { emitDelegateProgress, type DelegateUpdate } from "./progress.ts";
import { makeImmediateFailure, makeImmediateWriterFailure, makeReaderToolResult, makeWriterToolResult } from "./results.ts";
import { cleanupTempRunFiles, createTempRunFiles, createWriterTempRunFiles } from "./temp-files.ts";
import { buildWriterDiffPreview, captureWriterFileSnapshots, summarizeWriterDiff, writerDiffDetailFields } from "./writer-diff.ts";
import type { ReaderParams, ReaderToolResult, TempRunFiles, WriterParams, WriterToolResult } from "./types.ts";

async function makeFreshWriterSessionDir(cwd: string): Promise<string> {
	const base = getWriterSessionBaseDir(cwd);
	await fs.promises.mkdir(base, { recursive: true });
	return await fs.promises.mkdtemp(path.join(base, "run-"));
}

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

export async function runWriter(
	params: WriterParams,
	defaultCwd: string,
	signal?: AbortSignal,
	onUpdate?: DelegateUpdate,
): Promise<WriterToolResult> {
	const started = Date.now();
	const normalized = normalizeWriterParams(params, defaultCwd);
	emitDelegateProgress(onUpdate, "starting", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd, tool: "writer" });
	const discovery = await discoverAgents();
	const sessionDir = await makeFreshWriterSessionDir(normalized.cwd);
	const resolved = resolveWriterInvocation(normalized, discovery.agents, sessionDir);
	if (typeof resolved === "string") {
		await fs.promises.rm(sessionDir, { recursive: true, force: true });
		return makeImmediateWriterFailure(normalized, normalized.agent, resolved, Date.now() - started);
	}

	let tempFiles: TempRunFiles | undefined;
	let cleanupSession = true;
	try {
		const beforeFiles = await captureWriterFileSnapshots(normalized.allowedPaths, normalized.cwd);
		tempFiles = await createWriterTempRunFiles(resolved);
		const args = buildWriterPiArgs(resolved, tempFiles);
		const invocation = getPiInvocation(args);
		emitDelegateProgress(onUpdate, "launching_child", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd, tool: "writer" });
		let emittedChildEvent = false;
		const child = await runChildProcess(
			invocation,
			normalized.cwd,
			signal,
			normalized.timeoutMs,
			() => {
				if (emittedChildEvent) return;
				emittedChildEvent = true;
				emitDelegateProgress(onUpdate, "child_event", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd, tool: "writer" });
			},
			"writer",
			{ [DELEGATE_ALLOWED_PATHS_ENV]: JSON.stringify(normalized.allowedPaths) },
		);
		cleanupSession = child.status === "completed" || !normalized.includeDiagnostics;
		const writerDiff = await buildWriterDiffPreview(beforeFiles, normalized.allowedPaths, normalized.cwd);
		emitDelegateProgress(onUpdate, "diff_ready", {
			agent: normalized.agent,
			task: normalized.task,
			cwd: normalized.cwd,
			tool: "writer",
			message: summarizeWriterDiff(writerDiff),
			details: writerDiffDetailFields(writerDiff),
		});
		emitDelegateProgress(onUpdate, "finishing", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd, tool: "writer" });
		return makeWriterToolResult(resolved, child, Date.now() - started, writerDiff);
	} finally {
		await cleanupTempRunFiles(tempFiles);
		if (cleanupSession) await fs.promises.rm(sessionDir, { recursive: true, force: true });
	}
}
