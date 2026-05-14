import { homedir } from "node:os";
import { join } from "node:path";

export const AGENTS = [
  "investigator",
  "reviewer",
  "tester",
  "docs-researcher",
  "oracle",
] as const;
export const MODES = ["read", "write"] as const;
export const STATUSES = new Set(["ok", "blocked", "error"]);
export const CONFIDENCE = new Set(["low", "medium", "high"]);

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
export const MAX_JSON_LINE_BYTES = 2 * 1024 * 1024;
export const MAX_STDERR_BYTES = 2 * 1024 * 1024;
export const MAX_SUMMARY_CHARS = 800;
export const MAX_FINDING_CHARS = 2_000;
export const MAX_FIELD_CHARS = 1_200;
export const MAX_ARRAY_ITEMS = 40;
export const MAX_EVIDENCE_ITEMS = 20;
export const MAX_MODEL_SUGGESTIONS = 8;
export const MAX_RESULT_RETRIES = 1;
export const MODEL_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export const BANNED_SUBAGENT_MODELS = new Set(["gpt-5.3-codex-spark"]);
export const SUBAGENT_ROOT = join(homedir(), ".pi", "agent", "subagent-sessions");
export const AGENT_ROOT = join(homedir(), ".pi", "agent", "agents");
export const LOG_DIR = join(homedir(), ".pi", "logs");
export const LOG_FILE = join(LOG_DIR, "subagent-runner.log");
export const HOME_PREFIX = homedir();

export const SECRET_KEY_PATTERN =
  /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|API_KEY|PRIVATE)/i;
export const SECRET_ASSIGNMENT_PATTERN =
  /\b((?!Authorization\b)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|API_KEY|PRIVATE)[A-Z0-9_]*)\b\s*[:=]\s*([^\s,;]+)/gi;
export const BEARER_TOKEN_PATTERN = /\b(Authorization\s*:\s*Bearer\s+)[^\s,;]+/gi;
export const PROVIDER_TOKEN_PATTERN =
  /\b(?:gh[pousr]_|xox[baprs]-|AIza)[0-9A-Za-z_-]+\b/g;
export const QUOTED_TILDE_PATH_PATTERN = /["'`]~(?:\/|["'`])/;
export const NO_MATCH_TOOL_RESULT_PATTERN = /No matching sections found/i;
export const FAILED_TOOL_RESULT_PATTERN =
  /(?:Exit code:\s*(?!0\b)\d+|command not found|No such file or directory)/i;
export const POSITIVE_EXISTENCE_TASK_PATTERN =
  /(?:exists?\s+and\s+is\s+a\s+directory|is\s+present\s+and\s+is\s+a\s+directory|verify\s+[^.\n]*\bexists?\b[^.\n]*\bdirectory\b)/i;
export const NEGATIVE_EXISTENCE_RESULT_PATTERN =
  /\b(?:not\s+present|does\s+not\s+exist|missing|not\s+(?:an?\s+)?(?:existing\s+)?directory|returned\s+`?no`?)\b/i;
export const INCOMPLETE_OK_RESULT_PATTERN =
  /\b(?:unable\s+to\s+complete|not\s+yet\s+complete|still\s+needs?|needs?\s+(?:one\s+)?(?:additional|another)|only\s+mandatory\s+startup|startup\s+(?:rule-)?file\s+reads\s+alone|target-file\s+inspection\s+yet|subject-matter\s+inspection\s+(?:is\s+)?(?:missing|incomplete))\b/i;
