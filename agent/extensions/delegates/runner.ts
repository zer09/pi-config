import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
	changedPaths: Map<string, string>;
}

const MAX_SCOPE_FINGERPRINT_BYTES = 10 * 1024 * 1024;

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

function fingerprintGitPath(filePath: string): string {
	try {
		const stats = fs.lstatSync(filePath);
		if (stats.isSymbolicLink()) return `symlink:${fs.readlinkSync(filePath)}`;
		if (stats.isFile()) {
			if (stats.size <= MAX_SCOPE_FINGERPRINT_BYTES) {
				return `file:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
			}
			return `large-file:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
		}
		const type = stats.isDirectory() ? "dir" : "other";
		return `${type}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
	} catch {
		return "missing";
	}
}

function addGitStatusPath(changedPaths: Map<string, string>, root: string, relativePath: string, status: string): void {
	if (!relativePath) return;
	const resolved = resolveGitPath(root, relativePath);
	changedPaths.set(resolved, `${status}:${fingerprintGitPath(resolved)}`);
}

function parseGitStatusPaths(output: string, root: string): Map<string, string> {
	const changedPaths = new Map<string, string>();
	const entries = output.split("\0").filter(Boolean);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const status = entry.slice(0, 2);
		addGitStatusPath(changedPaths, root, entry.slice(3), status);
		if ((status[0] === "R" || status[0] === "C") && entries[index + 1]) {
			index += 1;
			addGitStatusPath(changedPaths, root, entries[index], status);
		}
	}
	return changedPaths;
}

async function captureGitScope(cwd: string): Promise<GitScopeSnapshot | undefined> {
	const rootOutput = await gitOutput(cwd, ["rev-parse", "--show-toplevel"], 64 * 1024);
	const root = rootOutput?.trim();
	if (!root) return undefined;
	const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
	let statusOutput = await gitOutput(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
	statusOutput ??= await gitOutput(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"]);
	if (statusOutput === undefined) return undefined;
	return { root: realRoot, changedPaths: parseGitStatusPaths(statusOutput, realRoot) };
}

function newOutsideAllowedPathChanges(before: GitScopeSnapshot | undefined, after: GitScopeSnapshot | undefined, allowedPaths: string[]): string[] {
	if (!before || !after || before.root !== after.root) return [];
	const allowed = new Set(allowedPaths);
	const outside: string[] = [];
	for (const [changedPath, afterFingerprint] of after.changedPaths) {
		if (allowed.has(changedPath)) continue;
		if (before.changedPaths.get(changedPath) === afterFingerprint) continue;
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
		emitDelegateProgress(onUpdate, "launching_subagent", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd });
		let emittedChildEvent = false;
		const child = await runChildProcess(invocation, normalized.cwd, signal, normalized.timeoutMs, () => {
			if (emittedChildEvent) return;
			emittedChildEvent = true;
			emitDelegateProgress(onUpdate, "working", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd });
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
		emitDelegateProgress(onUpdate, "launching_subagent", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd, tool: "writer" });
		let emittedChildEvent = false;
		const child = await runChildProcess(
			invocation,
			normalized.cwd,
			signal,
			normalized.timeoutMs,
			() => {
				if (emittedChildEvent) return;
				emittedChildEvent = true;
				emitDelegateProgress(onUpdate, "working", { agent: normalized.agent, task: normalized.task, cwd: normalized.cwd, tool: "writer" });
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
