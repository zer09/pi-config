/**
 * Token and context-usage formatting for gc-footer.
 *
 * This module aggregates assistant usage from the session and formats both token
 * totals and context-window percentages for full and compact footer layouts.
 */

import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ContextUsageSnapshot } from "./types";

const TOKEN_FORMATTERS = {
	compactFraction: new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" }),
	compactInteger: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, notation: "compact" }),
	plain: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
};

/**
 * Format session token totals from assistant messages.
 *
 * @param ctx - Current Pi extension context.
 * @param theme - Active Pi theme.
 * @param profile - Full output includes cache read/write details; compact omits them.
 * @returns The themed token segment, or `undefined` when no usage exists yet.
 */
export function formatSessionTokenTotals(
	ctx: ExtensionContext,
	theme: Theme,
	profile: "full" | "compact" = "full",
): string | undefined {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let latestCacheHitRate: number | undefined;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = entry.message.usage;
		input += usage.input;
		output += usage.output;
		cacheRead += usage.cacheRead;
		cacheWrite += usage.cacheWrite;

		const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
		latestCacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
	}

	if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return undefined;

	const inputPart = `↑${formatTokens(input)}${profile === "full" && cacheRead ? `/R${formatTokens(cacheRead)}` : ""}`;
	const outputPart = `↓${formatTokens(output)}${profile === "full" && cacheWrite ? `/W${formatTokens(cacheWrite)}` : ""}`;
	const hitRatePart = latestCacheHitRate === undefined ? undefined : `(${Math.floor(latestCacheHitRate)}%)`;
	const tokenPart = `(${inputPart} · ${outputPart})`;
	return theme.fg("muted", [hitRatePart, tokenPart].filter(Boolean).join(" "));
}

/**
 * Format active context-window usage.
 *
 * @param usage - Context usage snapshot from Pi.
 * @param modelContextWindow - Context window from the current model, used as fallback.
 * @param theme - Active Pi theme.
 * @param profile - Full output includes token/window counts; compact returns percent only.
 * @returns The themed context segment, or `undefined` when usage is unknown.
 */
export function formatContextUsage(
	usage: ContextUsageSnapshot,
	modelContextWindow: number | undefined,
	theme: Theme,
	profile: "full" | "compact" = "full",
): string | undefined {
	if (!usage || usage.tokens === null) return undefined;

	const contextWindow = usage.contextWindow || modelContextWindow;
	if (!contextWindow) return undefined;

	const percent = getTokenPercent(usage.tokens, contextWindow, usage.percent);
	const displayedPercent = getDisplayedTokenPercent(percent);
	const percentText = theme.fg(contextUsageColor(displayedPercent.value), `(${displayedPercent.text})`);
	return profile === "compact"
		? percentText
		: [percentText, theme.fg("accent", `(${formatTokens(usage.tokens)}/${formatTokens(contextWindow)})`)].join(" ");
}

function getTokenPercent(tokens: number, contextWindow: number, percent: number | null | undefined): number {
	return typeof percent === "number" && Number.isFinite(percent)
		? percent
		: (tokens / contextWindow) * 100;
}

function getDisplayedTokenPercent(percent: number): { text: string; value: number } {
	if (percent < 10 && !Number.isInteger(percent)) {
		const text = percent.toFixed(1);
		return { text: `${text}%`, value: Number(text) };
	}

	const value = Math.round(percent);
	return { text: `${value}%`, value };
}

function contextUsageColor(percent: number): ThemeColor {
	if (percent >= 90) return "error";
	if (percent >= 70) return "warning";
	return "muted";
}

function formatTokens(count: number): string {
	let formatter = TOKEN_FORMATTERS.compactInteger;
	if (count < 1000) {
		formatter = TOKEN_FORMATTERS.plain;
	} else if (count < 10000 || (count >= 1000000 && count < 10000000)) {
		formatter = TOKEN_FORMATTERS.compactFraction;
	}
	return formatter.format(count).replace("K", "k");
}
