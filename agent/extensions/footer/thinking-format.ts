/**
 * Thinking-level display helpers for footer.
 *
 * The footer renders colored Unicode shapes whose color and glyph follow Pi's
 * active thinking level. These glyphs intentionally do not require Nerd Font.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Format the thinking-level indicator glyph.
 *
 * @param level - Active thinking level from Pi.
 * @param theme - Active Pi theme.
 * @param glyphCount - Number of times to repeat the active glyph.
 * @returns The themed thinking shape segment.
 */
export function formatThinkingDot(level: string, theme: Theme, glyphCount = 1): string {
	return theme.fg(thinkingColor(level), thinkingGlyph(level).repeat(glyphCount));
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
		case "max":
			return "thinkingMax";
		default:
			return "thinkingText";
	}
}

function thinkingGlyph(level: string): string {
	switch (level) {
		case "off":
			return "○";
		case "minimal":
			return "·";
		case "low":
			return "◦";
		case "medium":
			return "◇";
		case "high":
			return "◆";
		case "xhigh":
			return "●";
		case "max":
			return "✦";
		default:
			return "●";
	}
}

