/**
 * Shared types for the Fastlane extension.
 */

/** Per-session override for Fastlane's enabled state. */
export type FastlaneOverride = "auto" | "on" | "off";

/** User configuration for Fastlane behavior. */
export type FastlaneConfig = {
	/** Default Fastlane state when there is no session override. */
	enabled: boolean;
	/** Number of thinking glyphs gc-footer should render while Fastlane is active. */
	thinkingGlyphCount: number;
};

/** Mutable state scoped to one Pi session. */
export type SessionState = {
	config: FastlaneConfig;
	override: FastlaneOverride;
	lastInjectedAt?: number;
	lastInjectedModel?: string;
};

/** Current model eligibility for the initial Fastlane backend. */
export type Eligibility = {
	eligible: boolean;
	modelKey: string;
	reason?: string;
};

/** Event payload consumed by gc-footer to render Fastlane's glyph indicator. */
export type FastlaneStateEvent = {
	active: boolean;
	eligible: boolean;
	mode: string;
	modelKey: string;
	reason?: string;
	thinkingGlyphCount: number;
	lastInjectedAt?: number;
	lastInjectedModel?: string;
};

export type PayloadRecord = Record<string, unknown>;

export type RecursivePartial<T> = {
	[P in keyof T]?: T[P] extends object ? RecursivePartial<T[P]> : T[P];
};
