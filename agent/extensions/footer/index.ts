/**
 * Footer Pi extension entrypoint.
 *
 * This file preserves the public extension discovery path while orchestrating
 * rendering, prompt timing, git status, and Fastlane glyph state.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderFooterLine } from "./footer-renderer";
import {
	clearGitStatus,
	clearScheduledGitStatusRefresh,
	createGitStatusState,
	getGitStatusForRender,
	scheduleGitStatusRefresh,
} from "./git-status";
import {
	clearPromptTimer,
	createPromptTimerState,
	recordPendingPromptStart,
	startPromptTimer,
	stopPromptTimer,
	takePendingPromptStart,
} from "./prompt-timer";
import { clearRequestRender, requestFooterRender, setRequestRender } from "./render-request";
import type { FastlaneDisplayState } from "./types";

const FASTLANE_STATE_EVENT = "fastlane:state";

/**
 * Register the footer extension with Pi.
 *
 * @param pi - Pi extension API used to register lifecycle handlers.
 */
export default function footer(pi: ExtensionAPI): void {
	const promptTimer = createPromptTimerState();
	const gitStatus = createGitStatusState();
	let fastlaneDisplay = createInactiveFastlaneDisplayState();
	let unsubscribeFastlaneState: (() => void) | undefined;

	unsubscribeFastlaneState = pi.events.on(FASTLANE_STATE_EVENT, (data) => {
		fastlaneDisplay = parseFastlaneDisplayState(data);
		requestFooterRender();
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const getBranch = () => footerData.getGitBranch();
			const render = () => tui.requestRender();
			const renderBranchChange = () => {
				const branch = getBranch();
				scheduleGitStatusRefresh(gitStatus, ctx.cwd, branch, true);
				render();
			};
			setRequestRender(render);
			scheduleGitStatusRefresh(gitStatus, ctx.cwd, getBranch(), true);

			const unsubscribeBranch = footerData.onBranchChange(renderBranchChange);

			return {
				dispose() {
					unsubscribeBranch();
					clearScheduledGitStatusRefresh(gitStatus);
					clearRequestRender(render);
				},
				invalidate() {},
				render(width: number): string[] {
					const branch = getBranch();
					scheduleGitStatusRefresh(gitStatus, ctx.cwd, branch);
					return [renderFooterLine(
						width,
						pi,
						ctx,
						theme,
						footerData,
						promptTimer,
						branch,
						getGitStatusForRender(gitStatus, ctx.cwd, branch),
						fastlaneDisplay,
					)];
				},
			};
		});
	});

	pi.on("input", async (event, ctx) => {
		if (ctx.mode !== "tui") return;
		recordPendingPromptStart(promptTimer, event.source, event.text, event.images, event.streamingBehavior);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		startPromptTimer(promptTimer, takePendingPromptStart(promptTimer) ?? Date.now());
	});

	pi.on("thinking_level_select", async () => {
		requestFooterRender();
	});

	pi.on("model_select", async () => {
		requestFooterRender();
	});

	pi.on("agent_end", async () => {
		if (!stopPromptTimer(promptTimer)) requestFooterRender();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		unsubscribeFastlaneState?.();
		unsubscribeFastlaneState = undefined;
		clearPromptTimer(promptTimer);
		clearGitStatus(gitStatus);
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
		clearRequestRender();
		fastlaneDisplay = createInactiveFastlaneDisplayState();
	});
}

function createInactiveFastlaneDisplayState(): FastlaneDisplayState {
	return { active: false, thinkingGlyphCount: 1 };
}

function parseFastlaneDisplayState(data: unknown): FastlaneDisplayState {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return createInactiveFastlaneDisplayState();
	}

	const event = data as { active?: unknown; thinkingGlyphCount?: unknown };
	return {
		active: event.active === true,
		thinkingGlyphCount: normalizeThinkingGlyphCount(event.thinkingGlyphCount),
	};
}

function normalizeThinkingGlyphCount(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(12, Math.trunc(value)));
}
