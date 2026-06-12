/**
 * Static defaults and retry timing for the theme-overrides extension.
 *
 * Configuration code imports these constants to keep runtime defaults in one
 * place, while the extension lifecycle imports the retry schedule for startup
 * theme application attempts.
 */

import type { ResolvedConfig } from "./types.ts"

/**
 * Default normalized configuration used when config.json is absent or omits a
 * value. Theme paths are intentionally extension-relative until config loading
 * resolves them, matching the original monolithic implementation.
 */
export const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  fallbackTheme: "dark",
  pollIntervalMs: 3_000,
  queryTimeoutMs: 1_500,
  themes: {
    dark: "./themes/dark.json",
    light: "./themes/light.json",
  },
}

/**
 * Startup retry delays used to re-apply overrides after Pi finishes any delayed
 * theme initialization.
 */
export const APPLY_RETRY_DELAYS_MS: readonly number[] = [50, 250, 1_000]
