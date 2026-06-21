/**
 * Footer Pi extension entrypoint.
 *
 * This file preserves the public extension discovery path while orchestrating
 * rendering, prompt timing, git status, and Fastlane glyph state.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FASTLANE_STATE_EVENT } from "../fastlane/constants";
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
	markQueuedPromptStarted,
	recordPendingPromptStart,
	startPromptTimer,
	stopPromptTimer,
	takePendingPromptStart,
} from "./prompt-timer";
import { clearRequestRender, requestFooterRender, setRequestRender } from "./render-request";

/**
 * Register the footer extension with Pi.
 *
 * @param pi - Pi extension API used to register lifecycle handlers.
 */
export default function footer(pi: ExtensionAPI): void {
	const promptTimer = createPromptTimerState();
	const gitStatus = createGitStatusState();
	let fastlaneActive = false;
	let unsubscribeFastlaneState: (() => void) | undefined;

	unsubscribeFastlaneState = pi.events.on(FASTLANE_STATE_EVENT, (data) => {
		if (typeof data !== "object" || data === null || Array.isArray(data)) return;

		const event = data as { active?: unknown };
		if (typeof event.active !== "boolean") return;

		fastlaneActive = event.active;
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
						fastlaneActive,
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

	pi.on("message_start", async (event, ctx) => {
		if (ctx.mode !== "tui" || event.message.role !== "user") return;
		markQueuedPromptStarted(promptTimer);
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
		fastlaneActive = false;
	});
}
