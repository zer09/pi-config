/**
 * Thinking-level display helpers for gc-footer.
 *
 * The footer renders a colored Unicode shape whose color and glyph follow Pi's
 * active thinking level. These glyphs intentionally do not require Nerd Font.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

const THINKING_GLYPHS = {
	off: "○",
	minimal: "·",
	low: "◦",
	medium: "◇",
	high: "◆",
	xhigh: "●",
} as const;

/**
 * Format the thinking-level indicator dot.
 *
 * @param level - Active thinking level from Pi.
 * @param theme - Active Pi theme.
 * @returns The themed thinking shape segment.
 */
export function formatThinkingDot(level: string, theme: Theme): string {
	return theme.fg(thinkingColor(level), thinkingGlyph(level));
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

function thinkingGlyph(level: string): string {
	if (isThinkingGlyphLevel(level)) return THINKING_GLYPHS[level];
	return THINKING_GLYPHS.xhigh;
}

function isThinkingGlyphLevel(level: string): level is keyof typeof THINKING_GLYPHS {
	return level in THINKING_GLYPHS;
}
