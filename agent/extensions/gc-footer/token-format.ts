/**
 * Token and context-usage formatting for gc-footer.
 *
 * This module aggregates assistant usage from the session and formats both token
 * totals and context-window percentages for full and compact footer layouts.
 */

import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ContextUsageSnapshot, SessionTokenTotals } from "./types";

/**
 * Aggregate token totals from assistant messages in the current session.
 *
 * @param ctx - Current Pi extension context.
 * @returns Token totals, or `undefined` when no usage exists yet.
 */
export function getSessionTokenTotals(ctx: ExtensionContext): SessionTokenTotals | undefined {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = entry.message.usage;
		input += usage.input;
		output += usage.output;
		cacheRead += usage.cacheRead;
		cacheWrite += usage.cacheWrite;
	}

	const hasUsage = input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0;
	return hasUsage ? { cacheRead, cacheWrite, input, output } : undefined;
}

/**
 * Format aggregated session token totals.
 *
 * @param totals - Aggregated token totals.
 * @param theme - Active Pi theme.
 * @param profile - Full output includes cache read/write details; compact omits them.
 * @returns The themed token segment, or `undefined` when no totals exist.
 */
export function formatSessionTokenTotals(
	totals: SessionTokenTotals | undefined,
	theme: Theme,
	profile: "full" | "compact" = "full",
): string | undefined {
	if (!totals) return undefined;

	const inputPart = `↑${formatTokens(totals.input)}${profile === "full" && totals.cacheRead ? `/R${formatTokens(totals.cacheRead)}` : ""}`;
	const outputPart = `↓${formatTokens(totals.output)}${profile === "full" && totals.cacheWrite ? `/W${formatTokens(totals.cacheWrite)}` : ""}`;
	return theme.fg("muted", `${inputPart} ${outputPart}`);
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
		: [percentText, theme.fg("muted", `(${formatTokens(usage.tokens)}/${formatTokens(contextWindow)})`)].join(" ");
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
	if (count < 1000) return count.toString();
	if (count < 10000) {
		const thousands = count / 1000;
		return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`;
	}
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) {
		const millions = count / 1000000;
		return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
	}
	return `${Math.round(count / 1000000)}M`;
}
