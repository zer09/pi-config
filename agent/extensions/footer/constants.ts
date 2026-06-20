/**
 * Shared constants for the footer extension.
 *
 * The values in this module are consumed by rendering, status, timer, and git
 * modules. Keeping them together makes display glyphs and timing thresholds easy
 * to audit without coupling those modules to the entrypoint.
 */

import type { FooterProfile } from "./types";

/** Matches simple ANSI SGR color/style escape sequences. */
export const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Nerd Font times glyph shown when Pi experimental features are enabled. */
export const EXPERIMENTAL_GLYPH = "\uf00d";

/** Maximum time to wait for `git status` before falling back to cached state. */
export const GIT_STATUS_TIMEOUT_MS = 500;

/** Minimum cache age before scheduling another git-status refresh. */
export const GIT_STATUS_TTL_MS = 5000;

/** Nerd Font glyph shown for queued follow-up prompts. */
export const QUEUE_GLYPH = "\uf46c";

/** Nerd Font check glyph shown for a completed prompt timer. */
export const TIMER_DONE_GLYPH = "\uf00c";

/** Nerd Font clock glyph shown for a running prompt timer. */
export const TIMER_RUNNING_GLYPH = "\uf017";

/** Ordered footer density profiles attempted while fitting to terminal width. */
export const FOOTER_PROFILES: readonly FooterProfile[] = ["full", "compact", "minimal"] as const;
