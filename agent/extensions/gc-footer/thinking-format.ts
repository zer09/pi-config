/**
 * Thinking-level display helpers for gc-footer.
 *
 * The footer renders a single colored dot whose color follows Pi's active
 * thinking level and whose glyph respects the Nerd Font configuration.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	FALLBACK_THINKING_FILLED_CIRCLE,
	FALLBACK_THINKING_OUTLINE_CIRCLE,
	THINKING_FILLED_CIRCLE,
	THINKING_OUTLINE_CIRCLE,
} from "./constants";

/**
 * Format the thinking-level indicator dot.
 *
 * @param level - Active thinking level from Pi.
 * @param theme - Active Pi theme.
 * @param nerdFont - Whether Nerd Font glyphs should be used.
 * @returns The themed thinking dot segment.
 */
export function formatThinkingDot(level: string, theme: Theme, nerdFont: boolean): string {
	return theme.fg(thinkingColor(level), thinkingGlyph(level, nerdFont));
}

function thinkingColor(level: string): ThemeColor {
	switch (level) {
		case "off":
			return "thinkingOff";
		case "minimal":
			return "thinkingMinimal";
		case "low":
			return "thinkingLow";
		case "medium":
			return "thinkingMedium";
		case "high":
			return "thinkingHigh";
		case "xhigh":
			return "thinkingXhigh";
		default:
			return "thinkingText";
	}
}

function thinkingGlyph(level: string, nerdFont: boolean): string {
	if (level === "off") {
		return nerdFont ? THINKING_OUTLINE_CIRCLE : FALLBACK_THINKING_OUTLINE_CIRCLE;
	}
	return nerdFont ? THINKING_FILLED_CIRCLE : FALLBACK_THINKING_FILLED_CIRCLE;
}
