/**
 * MCP extension-status formatter.
 *
 * This plugin recognizes MCP server-count statuses and renders them as a compact
 * server-glyph/count segment while preserving active upstream styling where that
 * styling is meaningful.
 */

import type { ExtensionStatusFormatter } from "./types";

const MCP_SERVER_GLYPH = "\uf233";

/**
 * Formats `MCP: n/m servers` status entries.
 *
 * @example
 * ```ts
 * formatter.format({ text: "MCP: 2/9 servers", plainText: "MCP: 2/9 servers", theme, nerdFont: true });
 * ```
 */
export const formatter: ExtensionStatusFormatter = {
	name: "mcp",
	format({ text, plainText, theme, nerdFont }) {
		const mcpMatch = plainText.match(/^MCP:\s*(\d+)\s*\/\s*(\d+)\s+servers?$/i);
		if (!mcpMatch) return undefined;

		const [visibleText, connected, total] = mcpMatch;
		const active = Number(connected) > 0;
		const compactText = `${nerdFont ? MCP_SERVER_GLYPH : "MCP"} ${connected}/${total}`;
		return {
			keepInCompact: active,
			text: active
				? preserveVisibleTextStyle(text, visibleText, compactText)
				: theme.fg("muted", compactText),
		};
	},
};

function preserveVisibleTextStyle(text: string, visibleText: string, compactText: string): string {
	return text.includes(visibleText) ? text.replace(visibleText, compactText) : compactText;
}
