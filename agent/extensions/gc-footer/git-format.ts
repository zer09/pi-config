/**
 * Git branch display formatting for gc-footer.
 *
 * This module is intentionally pure: async git polling and cache management live
 * in `git-status.ts`, while this file only turns status snapshots into footer
 * text.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { GitStatus } from "./types";

/**
 * Format a branch plus dirty/ahead/behind state for the footer.
 *
 * @param branch - Current branch reported by Pi footer data.
 * @param theme - Active Pi theme.
 * @param gitStatus - Optional richer async git status snapshot.
 * @returns The themed branch segment, or `undefined` outside git repositories.
 */
export function formatGitBranch(
	branch: string | null,
	theme: Theme,
	gitStatus: GitStatus | undefined,
): string | undefined {
	const status = gitStatus ?? (branch ? { branch, dirty: false, ahead: 0, behind: 0 } : undefined);
	if (!status?.branch) return undefined;

	const sync = formatGitSyncStatus(status.ahead, status.behind);
	const dirty = status.dirty ? "*" : "";
	const text = `(${status.branch}${sync ? ` ${sync}` : ""}${dirty})`;
	return theme.fg(status.dirty ? "warning" : "muted", text);
}

function formatGitSyncStatus(ahead: number, behind: number): string {
	return [ahead ? `+${ahead}` : undefined, behind ? `-${behind}` : undefined].filter(Boolean).join("/");
}
