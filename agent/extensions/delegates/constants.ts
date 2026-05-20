import type { ThinkingLevel } from "./types.ts";

export const DELEGATE_CHILD_MARKER = "PI_DELEGATE_CHILD";
export const DELEGATE_KIND_ENV = "PI_DELEGATE_KIND";
export const DELEGATE_ALLOWED_PATHS_ENV = "PI_DELEGATE_ALLOWED_PATHS";
export const DELEGATE_BIN_ENV = "PI_DELEGATE_BIN";

export const DEFAULT_READER_MODEL = "openai-codex/gpt-5.3-codex";
export const DEFAULT_WRITER_MODEL = "openai-codex/gpt-5.3-codex-spark";
export const DEFAULT_THINKING = "medium" satisfies ThinkingLevel;
export const DEFAULT_TIMEOUT_MS = 600_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 3_600_000;
export const DEFAULT_MAX_RESULT_BYTES = 24_000;
export const MIN_MAX_RESULT_BYTES = 1_000;
export const MAX_MAX_RESULT_BYTES = 1_000_000;
export const STDERR_TAIL_BYTES = 4_000;
export const DELEGATE_SESSION_DIR_NAME = "delegate-sessions";
export const DEFAULT_TASK_PREVIEW_CHARS = 120;
