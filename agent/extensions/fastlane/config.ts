/**
 * Configuration loading for Fastlane.
 */

import { existsSync, readFileSync } from "node:fs";
import { CONFIG_PATH, DEFAULT_CONFIG, MAX_THINKING_GLYPH_COUNT } from "./constants";
import type { FastlaneConfig, RecursivePartial } from "./types";

/**
 * Load Fastlane configuration from disk with safe defaults.
 *
 * @returns A complete Fastlane configuration. Invalid or missing values are ignored.
 */
export function loadConfig(): FastlaneConfig {
	const config = createDefaultConfig();
	const configPath = process.env.FASTLANE_CONFIG_PATH || CONFIG_PATH;
	if (!existsSync(configPath)) return config;

	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8"));
		if (!isRecord(parsed)) return config;

		const overrides = parsed as RecursivePartial<FastlaneConfig>;
		if (typeof overrides.enabled === "boolean") config.enabled = overrides.enabled;
		config.thinkingGlyphCount = normalizeThinkingGlyphCount(overrides.thinkingGlyphCount, config.thinkingGlyphCount);
	} catch {
		return config;
	}

	return config;
}

/**
 * Create a mutable config object from immutable defaults.
 *
 * @returns A fresh Fastlane configuration object.
 */
export function createDefaultConfig(): FastlaneConfig {
	return { ...DEFAULT_CONFIG };
}

export function normalizeThinkingGlyphCount(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const count = Math.trunc(value);
	if (count < 1) return fallback;
	return Math.min(count, MAX_THINKING_GLYPH_COUNT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
