/**
 * Agentmemory extension-status formatter.
 *
 * This plugin recognizes the status text produced by the agentmemory extension
 * and converts it to the compact disk/memory indicator used by footer's
 * middle status segment.
 */

import type { ExtensionStatusFormatter } from "./types";

const AGENTMEMORY_GLYPH = "\uf0c7";

/**
 * Formats `🧠 agentmemory` and `🧠 agentmemory off` status entries.
 *
 * @example
 * ```ts
 * formatter.format({ text: "🧠 agentmemory", plainText: "🧠 agentmemory", theme });
 * ```
 */
export const formatter: ExtensionStatusFormatter = {
	name: "agentmemory",
	format({ plainText, theme }) {
		const agentMemoryMatch = plainText.match(/^🧠\s*agentmemory(?:\s+(off))?$/i);
		if (!agentMemoryMatch) return undefined;

		const active = agentMemoryMatch[1] === undefined;
		return {
			keepInCompact: true,
			text: theme.fg(active ? "accent" : "muted", AGENTMEMORY_GLYPH),
		};
	},
};
