/**
 * Fixed runtime constants for the theme-overrides extension.
 *
 * This is a personal global extension, so behavior is intentionally encoded here
 * instead of being loaded from a separate config file.
 */

import { join } from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"
import type { ThemeKind } from "./types.ts"

/** Polling cadence for re-checking system appearance. */
export const POLL_INTERVAL_MS = 3_000

/** Timeout for each system appearance query. */
export const QUERY_TIMEOUT_MS = 1_500

/** Startup retry delays used after Pi finishes its own delayed theme initialization. */
export const APPLY_RETRY_DELAYS_MS: readonly number[] = [50, 250, 1_000]

/** Pi's global settings file, read only to decide whether this extension should back off. */
export const SETTINGS_PATH = join(getAgentDir(), "settings.json")

/** Auto-discovered custom themes managed by this extension. */
export const THEME_PATHS: Readonly<Record<ThemeKind, string>> = {
  dark: join(getAgentDir(), "themes", "dark.json"),
  light: join(getAgentDir(), "themes", "light.json"),
}
