/**
 * High-level footer rendering for the footer extension.
 *
 * The entrypoint passes live Pi state into this module, which snapshots the data
 * needed for one render, attempts full/compact/minimal layouts, and delegates
 * segment-specific text formatting to focused modules.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FOOTER_PROFILES } from "./constants";
import { formatExtensionStatusEntries, formatExtensionStatuses } from "./extension-status";
import { areExperimentalFeaturesEnabled, formatExperimentalMarker } from "./experimental-format";
import { formatGitBranch } from "./git-format";
import { joinFooterSections, measureFooterParts } from "./layout";
import { formatModelName } from "./model-format";
import { formatCwd } from "./path-format";
import { formatPromptQueue, formatPromptTimer } from "./prompt-timer";
import { formatThinkingDot } from "./thinking-format";
import { formatContextUsage, formatSessionTokenTotals } from "./token-format";
import type {
	FastlaneDisplayState,
	FooterData,
	FooterPartWidths,
	FooterParts,
	FooterProfile,
	GitStatus,
	PromptTimerState,
	RenderSnapshot,
} from "./types";

/**
 * Render the complete footer line for the current terminal width.
 *
 * @param width - Available terminal width.
 * @param pi - Pi extension API for model-independent runtime state.
 * @param ctx - Current extension context.
 * @param theme - Active Pi theme.
 * @param footerData - Footer-only data supplied by Pi.
 * @param promptTimer - Prompt timer state.
 * @param branch - Current git branch from Pi footer data.
 * @param gitStatus - Optional richer async git status snapshot.
 * @param fastlane - Fastlane glyph display state.
 * @returns One footer line that fits the requested width.
 */
export function renderFooterLine(
	width: number,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	footerData: FooterData,
	promptTimer: PromptTimerState,
	branch: string | null,
	gitStatus: GitStatus | undefined,
	fastlane: FastlaneDisplayState,
): string {
	if (width <= 0) return "";

	const snapshot = createRenderSnapshot(pi, ctx, theme, footerData, fastlane);
	let fallback: { parts: FooterParts; widths: FooterPartWidths } | undefined;
	for (const profile of FOOTER_PROFILES) {
		const parts = buildFooterParts(profile, ctx, theme, promptTimer, branch, gitStatus, snapshot);
		const widths = measureFooterParts(parts);
		fallback = { parts, widths };
		if (widths.total <= width) return joinFooterSections(parts, width, widths);
	}

	return fallback ? joinFooterSections(fallback.parts, width, fallback.widths) : "";
}

function createRenderSnapshot(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	footerData: FooterData,
	fastlane: FastlaneDisplayState,
): RenderSnapshot {
	return {
		contextUsage: ctx.getContextUsage(),
		cwd: ctx.cwd,
		experimentalFeaturesEnabled: areExperimentalFeaturesEnabled(),
		fastlane,
		formattedStatuses: formatExtensionStatusEntries(footerData.getExtensionStatuses(), theme),
		modelContextWindow: ctx.model?.contextWindow,
		modelId: ctx.model?.id,
		modelProvider: ctx.model?.provider,
		now: Date.now(),
		thinkingLevel: pi.getThinkingLevel(),
	};
}

function buildFooterParts(
	profile: FooterProfile,
	ctx: ExtensionContext,
	theme: Theme,
	promptTimer: PromptTimerState,
	branch: string | null,
	gitStatus: GitStatus | undefined,
	snapshot: RenderSnapshot,
): FooterParts {
	const minimal = profile === "minimal";
	const showTokens = profile !== "minimal";
	const left = joinSegments([
		formatGitBranch(branch, theme, gitStatus),
		theme.fg("dim", formatCwd(snapshot.cwd, profile)),
	]);
	const middle = formatExtensionStatuses(snapshot.formattedStatuses, profile === "full" ? "full" : "active");
	const right = joinSegments([
		formatPromptTimer(promptTimer, theme, snapshot.now),
		formatPromptQueue(promptTimer, theme),
		showTokens ? formatSessionTokenTotals(ctx, theme, profile === "full" ? "full" : "compact") : undefined,
		formatContextUsage(snapshot.contextUsage, snapshot.modelContextWindow, theme, profile === "full" ? "full" : "compact"),
		!minimal ? theme.fg("muted", formatModelName(snapshot.modelProvider, snapshot.modelId, profile)) : undefined,
		!minimal ? formatThinkingDot(snapshot.thinkingLevel, theme, snapshot.fastlane.active ? 3 : 1) : undefined,
		snapshot.experimentalFeaturesEnabled ? formatExperimentalMarker(theme) : undefined,
	]);

	return { left, middle, right };
}

function joinSegments(segments: Array<string | undefined>): string {
	return segments.filter((segment) => segment && visibleWidth(segment) > 0).join(" ");
}
