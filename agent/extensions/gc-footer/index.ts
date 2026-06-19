/**
 * gc-footer Pi extension entrypoint.
 *
 * This file preserves the public extension discovery path while delegating config,
 * rendering, prompt timing, git status, and formatting details to focused modules
 * in this directory. It remains the public facade/orchestrator and is not a
 * re-export-only shim.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatCommandStatus } from "./command-status";
import { loadConfig } from "./config";
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
 * Register the gc-footer extension with Pi.
 *
 * @param pi - Pi extension API used to register commands and lifecycle handlers.
 */
export default function gcFooter(pi: ExtensionAPI): void {
	const config = loadConfig();
	const promptTimer = createPromptTimerState();
	const gitStatus = createGitStatusState();
	let currentBranch: string | null | undefined;
	let fastlaneDisplay = createInactiveFastlaneDisplayState();
	let unsubscribeFastlaneState: (() => void) | undefined;

	pi.registerCommand("gc-footer", {
		description: "Show gc footer status",
		handler: async (args, ctx) => {
			const command = args.trim();
			// TODO(gc-footer): Add mutating subcommands after config writes are stable:
			// /gc-footer toggle <segment>, /gc-footer nerd-font <on|off>.
			if (command && command !== "status") {
				ctx.ui.notify("Usage: /gc-footer", "error");
				return;
			}

			ctx.ui.notify(formatCommandStatus(config, ctx, pi.getThinkingLevel(), currentBranch, fastlaneDisplay), "info");
		},
	});

	unsubscribeFastlaneState = pi.events.on(FASTLANE_STATE_EVENT, (data) => {
		fastlaneDisplay = parseFastlaneDisplayState(data);
		requestFooterRender();
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const getBranch = () => {
				currentBranch = footerData.getGitBranch();
				return currentBranch;
			};
			const render = () => tui.requestRender();
			const renderBranchChange = () => {
				const branch = getBranch();
				if (config.segments.branch) scheduleGitStatusRefresh(gitStatus, ctx.cwd, branch, true);
				render();
			};
			setRequestRender(render);
			const initialBranch = getBranch();
			if (config.segments.branch) scheduleGitStatusRefresh(gitStatus, ctx.cwd, initialBranch, true);

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
					if (config.segments.branch) scheduleGitStatusRefresh(gitStatus, ctx.cwd, branch);
					return [renderFooterLine(
						width,
						pi,
						ctx,
						theme,
						footerData,
						config,
						promptTimer,
						branch,
						config.segments.branch ? getGitStatusForRender(gitStatus, ctx.cwd, branch) : undefined,
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
		currentBranch = undefined;
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
