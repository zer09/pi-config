import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ExecResult } from "@earendil-works/pi-coding-agent";

export const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 60 * 60 * 1000;
const CLEANUP_TIMEOUT_MS = 120_000;
const SCRIPT_RELATIVE_PATH = "agent/extensions/session-cleanup/cleanup-sessions.sh";
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

type Env = Record<string, string | undefined>;
type Now = () => number;
type ReleaseLock = () => Promise<void>;

export interface CleanupPaths {
	piDir: string;
	script: string;
	stamp: string;
	lockDir: string;
	log: string;
}

export type CleanupStatus =
	| "skipped-delegate"
	| "skipped-fresh"
	| "skipped-lock"
	| "skipped-missing-script"
	| "skipped-unsafe-script"
	| "success"
	| "failed";

export interface CleanupOutcome {
	status: CleanupStatus;
	result?: ExecResult;
}

export interface CleanupOptions {
	env?: Env;
	homeDir?: string;
	now?: Now;
	paths?: CleanupPaths;
	timeoutMs?: number;
}

export function getCleanupPaths(homeDir = homedir(), extensionDir = EXTENSION_DIR): CleanupPaths {
	const piDir = join(homeDir, ".pi");
	return {
		piDir,
		script: join(extensionDir, "cleanup-sessions.sh"),
		stamp: join(piDir, "tmp", "cleanup-sessions.last-run"),
		lockDir: join(piDir, "tmp", "cleanup-sessions.lock"),
		log: join(piDir, "tmp", "session-cleanup.log"),
	};
}

export function isDelegateChild(env: Env = process.env): boolean {
	return Boolean(env.PI_DELEGATE_CHILD);
}

export function shouldHandleReason(reason: string): boolean {
	return reason === "startup";
}

export async function isStampFresh(path: string, now = Date.now()): Promise<boolean> {
	const text = await readFile(path, "utf8").catch(() => "");
	const lastMs = Date.parse(text.trim());
	return Number.isFinite(lastMs) && now >= lastMs && now - lastMs < DAY_MS;
}

function isErrorWithCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function fileExists(path: string): Promise<boolean> {
	const info = await stat(path).catch(() => undefined);
	return Boolean(info?.isFile());
}

async function acquireLock(lockDir: string, now: number): Promise<ReleaseLock | undefined> {
	await mkdir(dirname(lockDir), { recursive: true });

	const tryCreate = async (): Promise<ReleaseLock | undefined> => {
		try {
			await mkdir(lockDir);
			await writeFile(join(lockDir, "created-at"), new Date(now).toISOString(), "utf8").catch(() => undefined);
			return async () => {
				await rm(lockDir, { recursive: true, force: true });
			};
		} catch (error) {
			if (isErrorWithCode(error, "EEXIST")) return undefined;
			throw error;
		}
	};

	const release = await tryCreate();
	if (release) return release;

	const lockInfo = await stat(lockDir).catch(() => undefined);
	if (!lockInfo || now - lockInfo.mtimeMs <= LOCK_STALE_MS) return undefined;

	await rm(lockDir, { recursive: true, force: true });
	return tryCreate();
}

async function isScriptTrackedAndUnmodified(pi: Pick<ExtensionAPI, "exec">, paths: CleanupPaths): Promise<boolean> {
	if (!(await fileExists(paths.script))) return false;

	const gitTimeoutMs = 10_000;
	try {
		const tracked = await pi.exec("git", ["-C", paths.piDir, "ls-files", "--error-unmatch", "--", SCRIPT_RELATIVE_PATH], {
			timeout: gitTimeoutMs,
		});
		if (tracked.code !== 0 || tracked.killed) return false;

		const status = await pi.exec("git", ["-C", paths.piDir, "status", "--porcelain", "--", SCRIPT_RELATIVE_PATH], {
			timeout: gitTimeoutMs,
		});
		return status.code === 0 && !status.killed && status.stdout.trim() === "";
	} catch {
		return false;
	}
}

function firstLine(value: string | undefined): string | undefined {
	const line = value?.trim().split(/\r?\n/, 1)[0]?.trim();
	return line || undefined;
}

function cleanupCountFields(stdout: string | undefined): string[] {
	if (!stdout) return [];

	const metricNames: Record<string, string> = {
		"files deleted": "files_deleted",
		"files that would be deleted": "files_would_delete",
		"empty dirs removed": "empty_dirs_removed",
		"empty dirs that would be removed": "empty_dirs_would_remove",
	};
	const fields: string[] = [];

	for (const line of stdout.split(/\r?\n/)) {
		const match = line.trim().match(/^([A-Za-z][A-Za-z ]*?) (files deleted|files that would be deleted|empty dirs removed|empty dirs that would be removed):\s*(\d+)$/);
		if (!match) continue;

		const [, rawLabel, rawMetric, count] = match;
		if (!rawLabel || !rawMetric || !count) continue;

		const label = rawLabel.toLowerCase().replace(/\s+/g, "_");
		fields.push(`${label}_${metricNames[rawMetric]}=${count}`);
	}

	return fields;
}

function formatCleanupLogLine(outcome: CleanupOutcome, startedMs: number, finishedMs: number): string {
	const durationMs = Math.max(0, Math.round(finishedMs - startedMs));
	const fields = [
		`ts=${new Date(startedMs).toISOString()}`,
		`status=${outcome.status}`,
		`duration_ms=${durationMs}`,
	];

	if (outcome.result) {
		fields.push(`exit_code=${outcome.result.code}`);
		fields.push(`killed=${outcome.result.killed}`);
		fields.push(...cleanupCountFields(outcome.result.stdout));
	}

	const detail = outcome.status === "failed" ? (firstLine(outcome.result?.stderr) ?? firstLine(outcome.result?.stdout)) : undefined;
	if (detail) fields.push(`detail=${JSON.stringify(detail)}`);

	return `${fields.join(" ")}\n`;
}

async function appendCleanupLog(paths: CleanupPaths, outcome: CleanupOutcome, startedMs: number, finishedMs: number): Promise<void> {
	try {
		await mkdir(dirname(paths.log), { recursive: true });
		await appendFile(paths.log, formatCleanupLogLine(outcome, startedMs, finishedMs), "utf8");
	} catch {
		// Cleanup logging is best-effort and must not block startup cleanup.
	}
}

export async function runSessionCleanup(pi: Pick<ExtensionAPI, "exec">, options: CleanupOptions = {}): Promise<CleanupOutcome> {
	const env = options.env ?? process.env;
	if (isDelegateChild(env)) return { status: "skipped-delegate" };

	const now = options.now ?? Date.now;
	const paths = options.paths ?? getCleanupPaths(options.homeDir);
	const startedMs = now();
	const finish = async (outcome: CleanupOutcome): Promise<CleanupOutcome> => {
		await appendCleanupLog(paths, outcome, startedMs, now());
		return outcome;
	};

	if (await isStampFresh(paths.stamp, now())) return finish({ status: "skipped-fresh" });

	const release = await acquireLock(paths.lockDir, now());
	if (!release) return finish({ status: "skipped-lock" });

	try {
		if (await isStampFresh(paths.stamp, now())) return finish({ status: "skipped-fresh" });

		if (!(await fileExists(paths.script))) return finish({ status: "skipped-missing-script" });
		if (!(await isScriptTrackedAndUnmodified(pi, paths))) return finish({ status: "skipped-unsafe-script" });

		const result = await pi.exec("bash", [paths.script, "--safe"], { timeout: options.timeoutMs ?? CLEANUP_TIMEOUT_MS });
		if (result.code !== 0 || result.killed) return finish({ status: "failed", result });

		await mkdir(dirname(paths.stamp), { recursive: true });
		await writeFile(paths.stamp, `${new Date(now()).toISOString()}\n`, "utf8");
		return finish({ status: "success", result });
	} finally {
		await release();
	}
}

function notifyCleanupWarning(ctx: ExtensionContext, message: string): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify(message, "warning");
}

export default function sessionCleanupExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (event, ctx) => {
		if (!shouldHandleReason(event.reason)) return;

		try {
			const outcome = await runSessionCleanup(pi);
			if (outcome.status === "failed") {
				const detail = firstLine(outcome.result?.stderr) ?? firstLine(outcome.result?.stdout);
				notifyCleanupWarning(ctx, `Session cleanup failed${detail ? `: ${detail}` : "."}`);
			} else if (outcome.status === "skipped-unsafe-script") {
				notifyCleanupWarning(ctx, "Session cleanup skipped because cleanup-sessions.sh is not tracked and unmodified.");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notifyCleanupWarning(ctx, `Session cleanup extension failed: ${message}`);
		}
	});
}
