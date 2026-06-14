/**
 * High-level footer rendering for gc-footer.
 *
 * The entrypoint passes live Pi state into this module, which snapshots the data
 * needed for one render, attempts full/compact/minimal layouts, and delegates
 * segment-specific text formatting to focused modules.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FOOTER_PROFILES } from "./constants";
import { hasSegmentProfileOverride, resolveSegmentProfile } from "./config";
import { formatExtensionStatusEntries, formatExtensionStatuses } from "./extension-status";
import { formatGitBranch } from "./git-format";
import { footerSectionsFit, joinFooterSections, measureFooterParts } from "./layout";
import { formatModelName } from "./model-format";
import { formatCwd } from "./path-format";
import { formatPromptQueue, formatPromptTimer } from "./prompt-timer";
import { formatThinkingDot } from "./thinking-format";
import { formatContextUsage, formatSessionTokenTotals, getSessionTokenTotals } from "./token-format";
import type {
	FooterConfig,
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
 * @param config - Active footer configuration.
 * @param promptTimer - Prompt timer state.
 * @param branch - Current git branch from Pi footer data.
 * @param gitStatus - Optional richer async git status snapshot.
 * @returns One footer line that fits the requested width.
 */
export function renderFooterLine(
	width: number,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	footerData: FooterData,
	config: FooterConfig,
	promptTimer: PromptTimerState,
	branch: string | null,
	gitStatus: GitStatus | undefined,
): string {
	if (width <= 0) return "";

	const snapshot = createRenderSnapshot(pi, ctx, theme, footerData, config);
	let fallback: { parts: FooterParts; widths: FooterPartWidths } | undefined;
	for (const profile of FOOTER_PROFILES) {
		const parts = buildFooterParts(profile, theme, config, promptTimer, branch, gitStatus, snapshot);
		const widths = measureFooterParts(parts);
		fallback = { parts, widths };
		if (footerSectionsFit(widths, width)) return joinFooterSections(parts, width, widths);
	}

	return fallback ? joinFooterSections(fallback.parts, width, fallback.widths) : "";
}

function createRenderSnapshot(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	footerData: FooterData,
	config: FooterConfig,
): RenderSnapshot {
	return {
		contextUsage: config.segments.context ? ctx.getContextUsage() : undefined,
		cwd: ctx.cwd,
		formattedStatuses: config.segments.statuses
			? formatExtensionStatusEntries(footerData.getExtensionStatuses(), theme, config.nerdFont)
			: [],
		modelContextWindow: ctx.model?.contextWindow,
		modelId: ctx.model?.id,
		modelProvider: ctx.model?.provider,
		now: Date.now(),
		sessionTokenTotals: config.segments.tokens ? getSessionTokenTotals(ctx) : undefined,
		thinkingLevel: config.segments.thinking ? pi.getThinkingLevel() : "off",
	};
}

function buildFooterParts(
	profile: FooterProfile,
	theme: Theme,
	config: FooterConfig,
	promptTimer: PromptTimerState,
	branch: string | null,
	gitStatus: GitStatus | undefined,
	snapshot: RenderSnapshot,
): FooterParts {
	const minimal = profile === "minimal";
	const contextProfile = resolveSegmentProfile(config, "context", profile);
	const cwdProfile = resolveSegmentProfile(config, "cwd", profile);
	const modelProfile = resolveSegmentProfile(config, "model", profile);
	const statusesProfile = resolveSegmentProfile(config, "statuses", profile);
	const tokensProfile = resolveSegmentProfile(config, "tokens", profile);
	const showModel = config.segments.model && !minimal;
	const showTokens = config.segments.tokens && tokensProfile !== "minimal" && (!minimal || hasSegmentProfileOverride(config, "tokens"));
	const left = joinSegments([
		config.segments.cwd ? theme.fg("dim", formatCwd(snapshot.cwd, cwdProfile)) : undefined,
		config.segments.branch ? formatGitBranch(branch, theme, gitStatus) : undefined,
	]);
	const middle = config.segments.statuses
		? formatExtensionStatuses(snapshot.formattedStatuses, statusesProfile === "full" ? "full" : "active")
		: undefined;
	const right = joinSegments([
		config.segments.timer ? formatPromptTimer(promptTimer, theme, config.nerdFont, snapshot.now) : undefined,
		config.segments.queue ? formatPromptQueue(promptTimer, theme, config.nerdFont) : undefined,
		showTokens ? formatSessionTokenTotals(snapshot.sessionTokenTotals, theme, tokensProfile === "full" ? "full" : "compact") : undefined,
		config.segments.context ? formatContextUsage(snapshot.contextUsage, snapshot.modelContextWindow, theme, contextProfile === "full" ? "full" : "compact") : undefined,
		showModel ? theme.fg("muted", formatModelName(snapshot.modelProvider, snapshot.modelId, modelProfile)) : undefined,
		config.segments.thinking && !minimal ? formatThinkingDot(snapshot.thinkingLevel, theme) : undefined,
	]);

	return { left, middle, right };
}

function joinSegments(segments: Array<string | undefined>): string {
	return segments.filter((segment) => segment && visibleWidth(segment) > 0).join(" ");
}
