/**
 * Shared internal types for the footer extension.
 *
 * These definitions describe the data contracts exchanged between the entrypoint,
 * renderer, git-status, timer, and formatting modules. The public Pi extension
 * API remains the default export from {@link ./index.ts}.
 */

import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";

/**
 * Footer density profile selected while fitting the line to terminal width.
 */
export type FooterProfile = "full" | "compact" | "minimal";

/**
 * Snapshot returned by Pi for the active context-window usage.
 */
export type ContextUsageSnapshot = ReturnType<ExtensionContext["getContextUsage"]>;

/**
 * Formatted status text plus whether it should stay visible in compact layouts.
 */
export type FormattedExtensionStatus = {
	readonly keepInCompact: boolean;
	readonly text: string;
};

/**
 * Immutable render-time data collected before composing footer segments.
 */
export type RenderSnapshot = {
	readonly contextUsage: ContextUsageSnapshot;
	readonly cwd: string;
	readonly experimentalFeaturesEnabled: boolean;
	readonly fastlaneActive: boolean;
	readonly formattedStatuses: readonly FormattedExtensionStatus[];
	readonly modelContextWindow: number | undefined;
	readonly modelId: string | undefined;
	readonly modelProvider: string | undefined;
	readonly now: number;
	readonly thinkingLevel: string;
};

/**
 * Pi footer data made available only inside a custom footer renderer.
 */
export type FooterData = ReadonlyFooterDataProvider;

/**
 * Mutable prompt timer state owned by one extension instance.
 */
export type PromptTimerState = {
	pendingStartedAt: number | undefined;
	pendingClearImmediate: ReturnType<typeof setImmediate> | undefined;
	queuedStartedAts: number[];
	startedAt: number | undefined;
	lastDurationMs: number | undefined;
	interval: ReturnType<typeof setInterval> | undefined;
};

/**
 * Cached git status displayed next to the branch name.
 */
export type GitStatus = {
	branch: string | null;
	dirty: boolean;
	ahead: number;
	behind: number;
};

/**
 * Mutable async git-status cache and refresh scheduler state.
 */
export type GitStatusState = {
	cached: GitStatus | undefined;
	cwd: string | undefined;
	refreshedAt: number;
	refreshing: boolean;
	scheduled: ReturnType<typeof setImmediate> | undefined;
};

/**
 * Rendered footer sections before they are joined into one line.
 */
export type FooterParts = {
	readonly left: string;
	readonly middle: string | undefined;
	readonly right: string;
};

/**
 * Visible widths for rendered footer sections and their required gaps.
 */
export type FooterPartWidths = {
	readonly gap: number;
	readonly left: number;
	readonly middle: number;
	readonly right: number;
	readonly total: number;
};
