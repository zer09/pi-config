/**
 * `/gc-footer` command status formatting.
 *
 * The extension entrypoint delegates command output composition here so command
 * handling stays separate from footer rendering and lifecycle wiring.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SEGMENT_KEYS } from "./constants";
import { areExperimentalFeaturesEnabled } from "./experimental-format";
import { formatModelName } from "./model-format";
import type { FastlaneDisplayState, FooterConfig } from "./types";

/**
 * Build the diagnostic status message shown by `/gc-footer`.
 *
 * @param config - Active footer configuration.
 * @param ctx - Current Pi extension context.
 * @param thinkingLevel - Active thinking level reported by Pi.
 * @param branch - Last branch value observed by the footer renderer.
 * @param fastlane - Current Fastlane display state.
 * @returns Multiline status text for a Pi notification.
 */
export function formatCommandStatus(
	config: FooterConfig,
	ctx: ExtensionContext,
	thinkingLevel: string,
	branch: string | null | undefined,
	fastlane: FastlaneDisplayState,
): string {
	const enabledSegments = SEGMENT_KEYS.filter((key) => config.segments[key]).join(", ");
	const segmentProfiles = formatSegmentProfileOverrides(config);
	return [
		"gc-footer",
		`mode: ${ctx.mode}`,
		`footer: ${ctx.mode === "tui" ? "active" : "TUI-only"}`,
		`segments: ${enabledSegments || "none"}`,
		...(segmentProfiles ? [`segmentProfiles: ${segmentProfiles}`] : []),
		`theme: ${getActiveThemeName(ctx)}`,
		`model: ${formatModelName(ctx.model?.provider, ctx.model?.id)}`,
		`thinking: ${thinkingLevel}`,
		`fastlaneGlyphs: ${formatFastlaneStatus(fastlane)}`,
		`experimental: ${areExperimentalFeaturesEnabled() ? "on" : "off"}`,
		`branch: ${formatBranchStatus(branch)}`,
		`nerdFont: ${config.nerdFont ? "on" : "off"}`,
	].join("\n");
}

function formatSegmentProfileOverrides(config: FooterConfig): string {
	return SEGMENT_KEYS.map((key) => {
		const override = config.segmentProfiles[key];
		return override && override !== "inherit" ? `${key}=${override}` : undefined;
	}).filter(Boolean).join(", ");
}

function formatFastlaneStatus(fastlane: FastlaneDisplayState): string {
	return fastlane.active ? `active x${fastlane.thinkingGlyphCount}` : "inactive";
}

function getActiveThemeName(ctx: ExtensionContext): string {
	if (ctx.mode !== "tui") return `unavailable in ${ctx.mode}`;

	const currentTheme = ctx.ui.theme;
	for (const theme of ctx.ui.getAllThemes()) {
		if (ctx.ui.getTheme(theme.name) === currentTheme) return theme.name;
	}
	return "unknown";
}

function formatBranchStatus(branch: string | null | undefined): string {
	if (branch === undefined) return "unknown";
	return branch ?? "none";
}
