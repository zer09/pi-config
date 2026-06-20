/**
 * Current-working-directory display helpers for footer.
 *
 * The renderer uses these helpers to switch between full and compact path labels
 * while preserving the existing home-directory abbreviation behavior.
 */

import { basename } from "node:path";
import type { FooterProfile } from "./types";

/**
 * Format a current working directory for a footer density profile.
 *
 * @param cwd - Absolute current working directory.
 * @param profile - Active footer density profile.
 * @returns A home-abbreviated full path for `full`, otherwise a compact basename.
 */
export function formatCwd(cwd: string, profile: FooterProfile = "full"): string {
	if (profile !== "full") return formatCwdBasename(cwd);

	const home = process.env.HOME;
	if (!home) return cwd;
	if (cwd === home) return "~";
	return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

function formatCwdBasename(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd === home) return "~";
	return basename(cwd) || cwd;
}
