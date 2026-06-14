/**
 * Agentmemory extension-status formatter.
 *
 * This plugin recognizes the status text produced by the agentmemory extension
 * and converts it to the compact disk/memory indicator used by gc-footer's
 * middle status segment.
 */

import type { ExtensionStatusFormatter } from "./types";

const AGENTMEMORY_FALLBACK = "mem";
const AGENTMEMORY_GLYPH = "\uf0c7";

/**
 * Formats `🧠 agentmemory` and `🧠 agentmemory off` status entries.
 *
 * @example
 * ```ts
 * formatter.format({ text: "🧠 agentmemory", plainText: "🧠 agentmemory", theme, nerdFont: true });
 * ```
 */
export const formatter: ExtensionStatusFormatter = {
	name: "agentmemory",
	format({ plainText, theme, nerdFont }) {
		const agentMemoryMatch = plainText.match(/^🧠\s*agentmemory(?:\s+(off))?$/i);
		if (!agentMemoryMatch) return undefined;

		const active = agentMemoryMatch[1] === undefined;
		const compactText = nerdFont ? AGENTMEMORY_GLYPH : AGENTMEMORY_FALLBACK;
		return {
			keepInCompact: true,
			text: theme.fg(active ? "accent" : "muted", compactText),
		};
	},
};
