/**
 * Shared constants for the Fastlane extension.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastlaneConfig } from "./types";

/** Default config path next to this extension's source files. */
export const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.json");

/** Event emitted when Fastlane active/display state changes. */
export const FASTLANE_STATE_EVENT = "fastlane:state";

/** Provider currently supported by the initial Fastlane backend. */
export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

/** API type used by Pi's ChatGPT-auth Codex provider. */
export const OPENAI_CODEX_API_ID = "openai-codex-responses";

/** OpenAI service tier value that corresponds to Codex Fast mode. */
export const FAST_SERVICE_TIER = "priority";

/** Codex models supported by the upstream openai-fast package. */
export const SUPPORTED_OPENAI_CODEX_MODELS = new Set(["gpt-5.4", "gpt-5.5"]);

/** Maximum glyph repeat count accepted from config or events. */
export const MAX_THINKING_GLYPH_COUNT = 12;

/** Built-in Fastlane configuration used when no config file is present or valid. */
export const DEFAULT_CONFIG: FastlaneConfig = {
	enabled: false,
	thinkingGlyphCount: 3,
};
