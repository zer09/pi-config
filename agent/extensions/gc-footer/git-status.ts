/**
 * Async git-status polling and cache management for gc-footer.
 *
 * Footer rendering stays synchronous; this module schedules short-lived
 * `git status --porcelain=v2 --branch` reads, caches the result, and asks the
 * footer to rerender when fresh status data arrives.
 */

import { spawn } from "node:child_process";
import { GIT_STATUS_TIMEOUT_MS, GIT_STATUS_TTL_MS } from "./constants";
import { requestFooterRender } from "./render-request";
import type { GitStatus, GitStatusState } from "./types";

/**
 * Create the mutable git-status cache for one extension instance.
 *
 * @returns Empty git-status state.
 */
export function createGitStatusState(): GitStatusState {
	return {
		cached: undefined,
		cwd: undefined,
		refreshedAt: 0,
		refreshing: false,
		scheduled: undefined,
	};
}

/**
 * Read the best git status currently safe to use while rendering.
 *
 * @param state - Git-status cache state.
 * @param cwd - Current working directory.
 * @param branch - Current branch from Pi footer data.
 * @returns Cached rich status, a branch-only fallback, or `undefined` outside git repos.
 */
export function getGitStatusForRender(
	state: GitStatusState,
	cwd: string,
	branch: string | null,
): GitStatus | undefined {
	if (!branch) return undefined;
	if (state.cwd !== cwd || state.cached?.branch !== branch) {
		return { branch, dirty: false, ahead: 0, behind: 0 };
	}
	return state.cached;
}

/**
 * Schedule an async git-status refresh when the cache is stale.
 *
 * @param state - Git-status cache state.
 * @param cwd - Current working directory.
 * @param branch - Current branch from Pi footer data.
 * @param force - Whether to bypass the cache TTL.
 */
export function scheduleGitStatusRefresh(
	state: GitStatusState,
	cwd: string,
	branch: string | null,
	force = false,
): void {
	if (!branch) {
		clearScheduledGitStatusRefresh(state);
		state.cached = undefined;
		state.cwd = cwd;
		state.refreshedAt = 0;
		return;
	}

	const now = Date.now();
	const cwdChanged = state.cwd !== cwd;
	const branchChanged = Boolean(state.cached?.branch && state.cached.branch !== branch);
	if (cwdChanged) {
		state.cwd = cwd;
		state.cached = branch ? { branch, dirty: false, ahead: 0, behind: 0 } : undefined;
		state.refreshedAt = 0;
	} else if (branchChanged) {
		state.refreshedAt = 0;
	}

	if (!force && !cwdChanged && !branchChanged && now - state.refreshedAt < GIT_STATUS_TTL_MS) return;
	if (state.refreshing || state.scheduled !== undefined) return;

	state.scheduled = setImmediate(() => {
		state.scheduled = undefined;
		void refreshGitStatus(state, cwd, branch);
	});
	(state.scheduled as ReturnType<typeof setImmediate> & { unref?: () => void }).unref?.();
}

/**
 * Clear all scheduled and cached git-status state.
 *
 * @param state - Git-status cache state to reset.
 */
export function clearGitStatus(state: GitStatusState): void {
	clearScheduledGitStatusRefresh(state);
	state.cached = undefined;
	state.cwd = undefined;
	state.refreshedAt = 0;
	state.refreshing = false;
}

/**
 * Cancel a pending git-status refresh that has not started yet.
 *
 * @param state - Git-status cache state.
 */
export function clearScheduledGitStatusRefresh(state: GitStatusState): void {
	if (state.scheduled === undefined) return;
	clearImmediate(state.scheduled);
	state.scheduled = undefined;
}

async function refreshGitStatus(state: GitStatusState, cwd: string, branch: string | null): Promise<void> {
	state.refreshing = true;
	state.refreshedAt = Date.now();
	const status = await readGitStatus(cwd, branch);
	state.refreshing = false;
	if (state.cwd !== cwd) return;

	if (status) {
		state.cached = status;
	} else if (!state.cached && branch) {
		state.cached = { branch, dirty: false, ahead: 0, behind: 0 };
	}
	requestFooterRender();
}

function readGitStatus(cwd: string, fallbackBranch: string | null): Promise<GitStatus | undefined> {
	return new Promise((resolve) => {
		let resolved = false;
		let status: GitStatus = {
			branch: fallbackBranch,
			dirty: false,
			ahead: 0,
			behind: 0,
		};
		let pendingLine = "";
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let child: ReturnType<typeof spawn>;

		const finish = (result: GitStatus | undefined) => {
			if (resolved) return;
			resolved = true;
			if (timeout !== undefined) clearTimeout(timeout);
			resolve(result);
		};

		const parseLine = (line: string) => {
			status = parseGitStatusLine(line, status);
		};

		try {
			child = spawn("git", ["status", "--porcelain=v2", "--branch"], {
				cwd,
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			finish(undefined);
			return;
		}

		timeout = setTimeout(() => {
			child.kill();
			finish(undefined);
		}, GIT_STATUS_TIMEOUT_MS);
		(timeout as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			pendingLine += chunk;
			let newlineIndex = pendingLine.indexOf("\n");
			while (newlineIndex !== -1) {
				parseLine(pendingLine.slice(0, newlineIndex).replace(/\r$/, ""));
				pendingLine = pendingLine.slice(newlineIndex + 1);
				if (status.dirty && status.branch) {
					child.kill();
					finish(status);
					return;
				}
				newlineIndex = pendingLine.indexOf("\n");
			}
		});
		child.on("error", () => finish(undefined));
		child.on("close", (code) => {
			if (pendingLine) parseLine(pendingLine.replace(/\r$/, ""));
			finish(code === 0 && status.branch ? status : undefined);
		});
		child.unref?.();
	});
}

function parseGitStatusLine(line: string, status: GitStatus): GitStatus {
	if (!line) return status;
	if (line.startsWith("# branch.head ")) {
		return {
			...status,
			branch: normalizeGitBranch(line.slice("# branch.head ".length).trim(), status.branch),
		};
	}
	if (line.startsWith("# branch.ab ")) {
		const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
		return match ? { ...status, ahead: Number(match[1]), behind: Number(match[2]) } : status;
	}
	return line.startsWith("#") ? status : { ...status, dirty: true };
}

function normalizeGitBranch(head: string, fallbackBranch: string | null): string | null {
	if (!head || head === "(unknown)") return fallbackBranch;
	return head === "(detached)" ? "detached" : head;
}
