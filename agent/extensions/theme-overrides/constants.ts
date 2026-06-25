/**
 * Static defaults and retry timing for the theme-overrides extension.
 *
 * Configuration code imports these constants to keep runtime defaults in one
 * place, while the extension lifecycle imports the retry schedule for startup
 * theme application attempts.
 */

import type { ThemeKind, ThemeOverridesConfig } from "./types.ts"

/**
 * Global custom theme used by pre-session UI such as `pi --resume` before this
 * extension can apply its in-memory light override.
 */
export const RESUME_LIGHT_THEME_NAME = "resume-light"

/**
 * Built-in fallback configuration used when config.default.json is absent or
 * omits a value. Theme paths are package-relative until config loading resolves
 * them to absolute paths.
 */
export const DEFAULT_CONFIG = {
  enabled: true,
  fallbackTheme: "dark",
  pollIntervalMs: 3_000,
  queryTimeoutMs: 1_500,
  themes: {
    dark: "./themes/dark.json",
    light: "./themes/light.json",
  },
} satisfies ThemeOverridesConfig & { readonly themes: Readonly<Record<ThemeKind, string>> }

/**
 * Startup retry delays used to re-apply overrides after Pi finishes any delayed
 * theme initialization.
 */
export const APPLY_RETRY_DELAYS_MS: readonly number[] = [50, 250, 1_000]
