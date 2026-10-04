/**
 * Shared constants for the Fastlane extension.
 */

/** Event emitted when Fastlane active/display state changes. */
export const FASTLANE_STATE_EVENT = "fastlane:state";

/** RPC status key for child-local Fastlane configuration. */
export const FASTLANE_RPC_STATUS_KEY = "delegate-fastlane";

/** API type used by Pi's ChatGPT-auth Codex provider. */
export const OPENAI_CODEX_API_ID = "openai-codex-responses";

/** OpenAI service tier value that corresponds to Codex Fast mode. */
export const FAST_SERVICE_TIER = "priority";

/** Models whose official Codex catalog entry advertises the priority/Fast service tier. */
export const SUPPORTED_OPENAI_CODEX_MODELS: ReadonlySet<string> = new Set([
	"gpt-5.4",
	"gpt-5.5",
	"gpt-5.6-luna",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-6-astra",
	"gpt-6-luna",
	"gpt-6-sol",
	"gpt-6.1-sol",
]);
