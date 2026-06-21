/**
 * Shared constants for the Fastlane extension.
 */

/** Event emitted when Fastlane active/display state changes. */
export const FASTLANE_STATE_EVENT = "fastlane:state";

/** Provider currently supported by the initial Fastlane backend. */
export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

/** API type used by Pi's ChatGPT-auth Codex provider. */
export const OPENAI_CODEX_API_ID = "openai-codex-responses";

/** OpenAI service tier value that corresponds to Codex Fast mode. */
export const FAST_SERVICE_TIER = "priority";

/** Codex models supported by the upstream openai-fast package. */
export const SUPPORTED_OPENAI_CODEX_MODELS: ReadonlySet<string> = new Set(["gpt-5.4", "gpt-5.5"]);
