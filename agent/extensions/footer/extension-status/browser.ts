/**
 * Pi Browser Harness extension-status formatter.
 *
 * This plugin recognizes the status text produced by pi-browser-harness and
 * keeps only its connection-state dot for footer's middle status segment.
 */

import type { ExtensionStatusFormatter } from "./types";

/**
 * Formats pi-browser-harness statuses like `🟢 Browser connected` as `🟢`.
 *
 * @example
 * ```ts
 * formatter.format({ text: "🔴 Browser disconnected", plainText: "🔴 Browser disconnected", theme });
 * ```
 */
export const formatter: ExtensionStatusFormatter = {
	name: "browser",
	format({ plainText }) {
		const dot = getBrowserStatusDot(plainText);
		if (!dot) return undefined;

		return {
			keepInCompact: true,
			text: dot,
		};
	},
};

function getBrowserStatusDot(plainText: string): string | undefined {
	const leadingDotMatch = plainText.match(
		/^([⚪🔴🟢])\s+Browser(?:\s+(?:connected|disconnected|enabled(?:\s+lazily)?|disabled)\b|\s*[—-]\s*run\s+\/browser-setup\b)/iu,
	);
	if (leadingDotMatch) return leadingDotMatch[1];

	const labelFirstMatch = plainText.match(/^Browser:\s*([⚪🔴🟢])\s*(?:Connected|Disconnected)\b/iu);
	return labelFirstMatch?.[1];
}
