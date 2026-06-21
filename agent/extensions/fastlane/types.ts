/**
 * Shared types for the Fastlane extension.
 */

/** Mutable state scoped to one Pi session. */
export type SessionState = {
	/** Whether Fastlane was enabled for this session. */
	enabled: boolean;
};

/** Current model eligibility for the initial Fastlane backend. */
export type Eligibility = {
	eligible: boolean;
	modelKey: string;
	reason?: string;
};

/** Event payload consumed by footer to render Fastlane's glyph indicator. */
export type FastlaneStateEvent = {
	active: boolean;
};

export type PayloadRecord = Record<string, unknown>;
