/**
 * Shared internal types for the gc-footer extension.
 *
 * These definitions describe the data contracts exchanged between the entrypoint,
 * renderer, git-status, timer, configuration, and formatting modules. The public
 * Pi extension API remains the default export from {@link ./index.ts}.
 */

import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";

/**
 * Names of configurable footer segments.
 */
export type SegmentName =
	| "cwd"
	| "branch"
	| "statuses"
	| "timer"
	| "queue"
	| "tokens"
	| "context"
	| "model"
	| "thinking"
	| "experimental";

/**
 * Per-segment enablement map loaded from footer configuration.
 */
export type SegmentConfig = Record<SegmentName, boolean>;

/**
 * Footer density profile selected while fitting the line to terminal width.
 */
export type FooterProfile = "full" | "compact" | "minimal";

/**
 * Segment-specific profile override from user configuration.
 */
export type SegmentProfileOverride = FooterProfile | "inherit";

/**
 * Sparse map of segment profile overrides.
 */
export type SegmentProfileConfig = Partial<Record<SegmentName, SegmentProfileOverride>>;

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
 * Aggregated token totals for assistant messages in the current session.
 */
export type SessionTokenTotals = {
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly input: number;
	readonly latestCacheHitRate: number | undefined;
	readonly output: number;
};

/**
 * Immutable render-time data collected before composing footer segments.
 */
export type RenderSnapshot = {
	readonly contextUsage: ContextUsageSnapshot;
	readonly cwd: string;
	readonly experimentalFeaturesEnabled: boolean;
	readonly fastlane: FastlaneDisplayState;
	readonly formattedStatuses: readonly FormattedExtensionStatus[];
	readonly modelContextWindow: number | undefined;
	readonly modelId: string | undefined;
	readonly modelProvider: string | undefined;
	readonly now: number;
	readonly sessionTokenTotals: SessionTokenTotals | undefined;
	readonly thinkingLevel: string;
};

/**
 * User configuration for gc-footer behavior and segment visibility.
 */
export type FooterConfig = {
	nerdFont: boolean;
	segmentProfiles: SegmentProfileConfig;
	segments: SegmentConfig;
};

/**
 * Render-time Fastlane display state consumed by gc-footer.
 */
export type FastlaneDisplayState = {
	readonly active: boolean;
	readonly thinkingGlyphCount: number;
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
