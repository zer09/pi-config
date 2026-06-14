/**
 * Shared constants for the gc-footer extension.
 *
 * The values in this module are consumed by configuration, rendering, status,
 * timer, and git modules. Keeping them together makes display glyphs and timing
 * thresholds easy to audit without coupling those modules to the entrypoint.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FooterConfig, FooterProfile, SegmentName } from "./types";

/** Matches simple ANSI SGR color/style escape sequences. */
export const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Default config path next to this extension's source files. */
export const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.json");

/** Unicode filled circle used when Nerd Font glyphs are disabled. */
export const FALLBACK_THINKING_FILLED_CIRCLE = "\u25cf";

/** Unicode outline circle used when Nerd Font glyphs are disabled. */
export const FALLBACK_THINKING_OUTLINE_CIRCLE = "\u25cb";

/** Maximum time to wait for `git status` before falling back to cached state. */
export const GIT_STATUS_TIMEOUT_MS = 500;

/** Minimum cache age before scheduling another git-status refresh. */
export const GIT_STATUS_TTL_MS = 5000;

/** Nerd Font glyph shown for queued follow-up prompts. */
export const QUEUE_GLYPH = "\uf46c";

/** Nerd Font filled-circle glyph used for active thinking levels. */
export const THINKING_FILLED_CIRCLE = "\uf111";

/** Nerd Font outline-circle glyph used when thinking is off. */
export const THINKING_OUTLINE_CIRCLE = "\uf10c";

/** Nerd Font check glyph shown for a completed prompt timer. */
export const TIMER_DONE_GLYPH = "\uf00c";

/** Nerd Font clock glyph shown for a running prompt timer. */
export const TIMER_RUNNING_GLYPH = "\uf017";

/** Ordered segment keys used for defaults, config parsing, and status output. */
export const SEGMENT_KEYS: readonly SegmentName[] = [
	"cwd",
	"branch",
	"statuses",
	"timer",
	"queue",
	"tokens",
	"context",
	"model",
	"thinking",
] as const;

/** Ordered footer density profiles attempted while fitting to terminal width. */
export const FOOTER_PROFILES: readonly FooterProfile[] = ["full", "compact", "minimal"] as const;

/** Built-in footer configuration used when no config file is present or valid. */
export const DEFAULT_CONFIG: FooterConfig = {
	nerdFont: true,
	segmentProfiles: {},
	segments: {
		cwd: true,
		branch: true,
		statuses: true,
		timer: true,
		queue: true,
		tokens: true,
		context: true,
		model: true,
		thinking: true,
	},
};
