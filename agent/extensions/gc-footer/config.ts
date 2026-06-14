/**
 * Configuration loading and profile resolution for gc-footer.
 *
 * This module reads the optional JSON configuration file, validates the subset of
 * supported fields, and exposes helpers used by rendering to resolve segment
 * profile overrides.
 */

import { existsSync, readFileSync } from "node:fs";
import { CONFIG_PATH, DEFAULT_CONFIG, SEGMENT_KEYS } from "./constants";
import type { FooterConfig, FooterProfile, SegmentName, SegmentProfileOverride } from "./types";

/**
 * Load gc-footer configuration from disk with safe defaults.
 *
 * @returns A complete footer configuration. Invalid or missing config values are ignored.
 */
export function loadConfig(): FooterConfig {
	const config = createDefaultConfig();
	const configPath = process.env.GC_FOOTER_CONFIG_PATH || CONFIG_PATH;
	if (!existsSync(configPath)) return config;

	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8"));
		if (!isRecord(parsed)) return config;

		if (typeof parsed.nerdFont === "boolean") config.nerdFont = parsed.nerdFont;

		if (isRecord(parsed.segments)) {
			for (const key of SEGMENT_KEYS) {
				const value = parsed.segments[key];
				if (typeof value === "boolean") config.segments[key] = value;
			}
		}

		if (isRecord(parsed.segmentProfiles)) {
			for (const key of SEGMENT_KEYS) {
				const value = parsed.segmentProfiles[key];
				if (isSegmentProfileOverride(value)) config.segmentProfiles[key] = value;
			}
		}
	} catch {
		return config;
	}

	return config;
}

/**
 * Create a mutable config object from immutable defaults.
 *
 * @returns A fresh footer configuration object.
 */
export function createDefaultConfig(): FooterConfig {
	return {
		nerdFont: DEFAULT_CONFIG.nerdFont,
		segmentProfiles: { ...DEFAULT_CONFIG.segmentProfiles },
		segments: { ...DEFAULT_CONFIG.segments },
	};
}

/**
 * Resolve a segment's effective profile for the active footer profile.
 *
 * @param config - Active footer configuration.
 * @param segment - Segment whose profile should be resolved.
 * @param footerProfile - Current overall footer density profile.
 * @returns The override profile when configured, otherwise the footer profile.
 */
export function resolveSegmentProfile(
	config: FooterConfig,
	segment: SegmentName,
	footerProfile: FooterProfile,
): FooterProfile {
	const override = config.segmentProfiles[segment];
	return override && override !== "inherit" ? override : footerProfile;
}

/**
 * Check whether a segment has an explicit non-inherited profile override.
 *
 * @param config - Active footer configuration.
 * @param segment - Segment to inspect.
 * @returns `true` when the segment profile is explicitly overridden.
 */
export function hasSegmentProfileOverride(config: FooterConfig, segment: SegmentName): boolean {
	const override = config.segmentProfiles[segment];
	return Boolean(override && override !== "inherit");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSegmentProfileOverride(value: unknown): value is SegmentProfileOverride {
	return value === "inherit" || value === "full" || value === "compact" || value === "minimal";
}
