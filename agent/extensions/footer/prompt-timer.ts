/**
 * Prompt timing and queued follow-up tracking for footer.
 *
 * This module records when interactive prompts are submitted, carries that start
 * time through Pi's input/agent lifecycle, and formats running or completed
 * durations for the footer.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { QUEUE_GLYPH, TIMER_DONE_GLYPH, TIMER_RUNNING_GLYPH } from "./constants";
import { requestFooterRender } from "./render-request";
import type { PromptTimerState } from "./types";

/**
 * Create empty prompt timer state for one extension instance.
 *
 * @returns Mutable prompt timer state.
 */
export function createPromptTimerState(): PromptTimerState {
	return {
		pendingStartedAt: undefined,
		pendingClearImmediate: undefined,
		queuedStartedAts: [],
		queuedCount: 0,
		startedAt: undefined,
		lastDurationMs: undefined,
		interval: undefined,
	};
}

/**
 * Record the submit time for an interactive prompt before the agent starts.
 *
 * @param timer - Prompt timer state.
 * @param source - Pi input source.
 * @param text - Submitted prompt text.
 * @param images - Submitted prompt images, if any.
 * @param streamingBehavior - Queue behavior for prompts submitted while streaming.
 */
export function recordPendingPromptStart(
	timer: PromptTimerState,
	source: "interactive" | "rpc" | "extension",
	text: string,
	images: readonly unknown[] | undefined,
	streamingBehavior: "steer" | "followUp" | undefined,
): void {
	const hasContent = text.trim().length > 0 || Boolean(images?.length);
	if (source !== "interactive" || !hasContent) {
		clearPendingPromptStart(timer);
		return;
	}

	const startedAt = Date.now();
	if (streamingBehavior === "steer" || streamingBehavior === "followUp") {
		clearPendingPromptStart(timer);
		timer.queuedCount += 1;
		if (streamingBehavior === "followUp") timer.queuedStartedAts.push(startedAt);
		requestFooterRender();
		return;
	}

	timer.pendingStartedAt = startedAt;
	schedulePendingPromptStartClear(timer, startedAt);
}

/**
 * Consume the pending or queued prompt start time for a new agent run.
 *
 * @param timer - Prompt timer state.
 * @returns The recorded submit timestamp, if available.
 */
export function takePendingPromptStart(timer: PromptTimerState): number | undefined {
	const startedAt = timer.pendingStartedAt;
	clearPendingPromptStart(timer);
	return startedAt ?? timer.queuedStartedAts.shift();
}

/**
 * Start the visible running prompt timer.
 *
 * @param timer - Prompt timer state.
 * @param startedAt - Prompt submit timestamp.
 */
export function startPromptTimer(timer: PromptTimerState, startedAt: number): void {
	clearPromptTimerInterval(timer);
	timer.startedAt = startedAt;
	timer.lastDurationMs = undefined;
	timer.interval = setInterval(() => requestFooterRender(), 250);
	(timer.interval as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
	requestFooterRender();
}

/**
 * Stop the running prompt timer and retain the last duration for display.
 *
 * @param timer - Prompt timer state.
 * @returns `true` when a running timer was stopped.
 */
export function stopPromptTimer(timer: PromptTimerState): boolean {
	if (timer.startedAt === undefined) return false;

	timer.lastDurationMs = Date.now() - timer.startedAt;
	timer.startedAt = undefined;
	clearPromptTimerInterval(timer);
	requestFooterRender();
	return true;
}

/**
 * Reset all prompt timer and queue state.
 *
 * @param timer - Prompt timer state.
 */
export function clearPromptTimer(timer: PromptTimerState): void {
	clearPendingPromptStart(timer);
	timer.queuedStartedAts = [];
	timer.queuedCount = 0;
	timer.startedAt = undefined;
	timer.lastDurationMs = undefined;
	clearPromptTimerInterval(timer);
}

/**
 * Format the running or last completed prompt duration for the footer.
 *
 * @param timer - Prompt timer state.
 * @param theme - Active Pi theme.
 * @param now - Current timestamp, injectable for tests.
 * @returns The themed timer segment, or `undefined` before any prompt has run.
 */
export function formatPromptTimer(
	timer: PromptTimerState,
	theme: Theme,
	now = Date.now(),
): string | undefined {
	const running = timer.startedAt !== undefined;
	const durationMs = running ? now - timer.startedAt : timer.lastDurationMs;
	if (durationMs === undefined) return undefined;

	const glyph = running ? TIMER_RUNNING_GLYPH : TIMER_DONE_GLYPH;
	const glyphColor: ThemeColor = running ? "accent" : "success";
	return `${theme.fg(glyphColor, glyph)} ${theme.fg("muted", formatDuration(durationMs))}`;
}

/**
 * Format the queued prompt count for the footer.
 *
 * @param timer - Prompt timer state.
 * @param theme - Active Pi theme.
 * @returns The themed queue segment, or `undefined` when no prompts are queued.
 */
export function formatPromptQueue(timer: PromptTimerState, theme: Theme): string | undefined {
	if (!timer.queuedCount) return undefined;
	return theme.fg("warning", `${QUEUE_GLYPH} ${timer.queuedCount}`);
}

/**
 * Mark one queued prompt as started so the displayed queue count decreases.
 *
 * @param timer - Prompt timer state.
 */
export function markQueuedPromptStarted(timer: PromptTimerState): void {
	if (!timer.queuedCount) return;
	timer.queuedCount -= 1;
	requestFooterRender();
}

function schedulePendingPromptStartClear(timer: PromptTimerState, startedAt: number): void {
	clearPendingPromptStartClear(timer);
	timer.pendingClearImmediate = setImmediate(() => {
		timer.pendingClearImmediate = undefined;
		if (timer.pendingStartedAt === startedAt && timer.startedAt === undefined) {
			timer.pendingStartedAt = undefined;
		}
	});
	(timer.pendingClearImmediate as ReturnType<typeof setImmediate> & { unref?: () => void }).unref?.();
}

function clearPendingPromptStart(timer: PromptTimerState): void {
	timer.pendingStartedAt = undefined;
	clearPendingPromptStartClear(timer);
}

function clearPendingPromptStartClear(timer: PromptTimerState): void {
	if (timer.pendingClearImmediate === undefined) return;
	clearImmediate(timer.pendingClearImmediate);
	timer.pendingClearImmediate = undefined;
}

function clearPromptTimerInterval(timer: PromptTimerState): void {
	if (timer.interval === undefined) return;
	clearInterval(timer.interval);
	timer.interval = undefined;
}

function formatDuration(durationMs: number): string {
	const safeMs = Math.max(0, durationMs);
	const totalSeconds = Math.round(safeMs / 1000);
	if (totalSeconds < 60) return `${(safeMs / 1000).toFixed(1)}s`;

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = String(totalSeconds % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
}
