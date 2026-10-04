/**
 * Shared types for the Fastlane extension.
 */

/** Mutable state scoped to one Pi session. */
export type SessionState = {
	/** Whether Fastlane is enabled for the current model and auth. */
	enabled: boolean;
	startupRequested: boolean;
	manualOverride: boolean;
};

/** Current model eligibility for the initial Fastlane backend. */
export type Eligibility = {
	eligible: boolean;
	modelKey: string;
	reason?: string;
};

export type PayloadRecord = Record<string, unknown>;
