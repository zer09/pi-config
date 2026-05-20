import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

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
import type { ChildProcessResult, ReaderParams, ReaderToolResult, TempRunFiles, WriterParams, WriterToolResult } from "./types.ts";

const execFileAsync = promisify(execFile);

interface GitScopeSnapshot {
	root: string;
	changedPaths: Set<string>;
}

async function makeFreshWriterSessionDir(cwd: string): Promise<string> {
	const base = getWriterSessionBaseDir(cwd);
	await fs.promises.mkdir(base, { recursive: true });
	return await fs.promises.mkdtemp(path.join(base, "run-"));
}

async function gitOutput(cwd: string, args: string[], maxBuffer = 1024 * 1024): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { timeout: 5_000, maxBuffer });
		return String(stdout);
	} catch {
		return undefined;
	}
}

function resolveGitPath(root: string, relativePath: string): string {
	const resolved = path.resolve(root, relativePath);
	return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

function parseGitStatusPaths(output: string, root: string): Set<string> {
	const changedPaths = new Set<string>();
	const entries = output.split("\0").filter(Boolean);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const status = entry.slice(0, 2);
		const relativePath = entry.slice(3);
		if (relativePath) changedPaths.add(resolveGitPath(root, relativePath));
		if ((status[0] === "R" || status[0] === "C") && entries[index + 1]) {
			index += 1;
			changedPaths.add(resolveGitPath(root, entries[index]));
		}
	}
	return changedPaths;
}

async function captureGitScope(cwd: string): Promise<GitScopeSnapshot | undefined> {
	const rootOutput = await gitOutput(cwd, ["rev-parse", "--show-toplevel"], 64 * 1024);
	const root = rootOutput?.trim();
	if (!root) return undefined;
	const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
	const statusOutput = await gitOutput(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
	if (statusOutput === undefined) return undefined;
	return { root: realRoot, changedPaths: parseGitStatusPaths(statusOutput, realRoot) };
}

function newOutsideAllowedPathChanges(before: GitScopeSnapshot | undefined, after: GitScopeSnapshot | undefined, allowedPaths: string[]): string[] {
	if (!before || !after || before.root !== after.root) return [];
	const allowed = new Set(allowedPaths);
	const outside: string[] = [];
	for (const changedPath of after.changedPaths) {
		if (before.changedPaths.has(changedPath) || allowed.has(changedPath)) continue;
		outside.push(path.relative(after.root, changedPath) || changedPath);
	}
	return outside;
}

function withOutsideScopeFailure(child: ChildProcessResult, outsideChanges: string[]): ChildProcessResult {
	if (outsideChanges.length === 0) return child;
	const listed = outsideChanges.slice(0, 10).join(", ");
	const more = outsideChanges.length > 10 ? `, and ${outsideChanges.length - 10} more` : "";
	const message = `Writer modified files outside allowedPaths: ${listed}${more}`;
	return { ...child, status: "failed", state: { ...child.state, finalText: message, errorMessage: message }, error: message };
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
		const beforeScope = await captureGitScope(normalized.cwd);
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
		const afterScope = await captureGitScope(normalized.cwd);
		const outsideScopeChanges = newOutsideAllowedPathChanges(beforeScope, afterScope, normalized.allowedPaths);
		const scopedChild = withOutsideScopeFailure(child, outsideScopeChanges);
		cleanupSession = scopedChild.status === "completed" || !normalized.includeDiagnostics;
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
		return makeWriterToolResult(resolved, scopedChild, Date.now() - started, writerDiff);
	} finally {
		await cleanupTempRunFiles(tempFiles);
		if (cleanupSession) await fs.promises.rm(sessionDir, { recursive: true, force: true });
	}
}
