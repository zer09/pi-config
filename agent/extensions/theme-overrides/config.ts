/**
 * Configuration loading and normalization for theme-overrides.
 *
 * This module reads the extension's config.json on demand so edits take effect
 * without restarting Pi. It applies defaults but otherwise preserves the
 * original permissive JSON casting behavior.
 */

import { existsSync, readFileSync } from "node:fs"
import { DEFAULT_CONFIG } from "./constants.ts"
import { CONFIG_PATH, resolveExtensionPath } from "./paths.ts"
import type { ResolvedConfig, ThemeKind, ThemeOverridesConfig } from "./types.ts"

/**
 * Check whether an unknown value is one of the built-in theme kinds.
 *
 * @param value - Value read from user configuration or settings.
 * @returns True when the value is "dark" or "light".
 */
export function isThemeKind(value: unknown): value is ThemeKind {
  return value === "dark" || value === "light"
}

/**
 * Normalize a user-provided positive integer option.
 *
 * @param value - Unknown config value to validate.
 * @param fallback - Fallback value used when validation fails.
 * @returns The positive integer value, or the fallback.
 */
export function normalizePositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

/**
 * Load and normalize theme-overrides configuration.
 *
 * @returns Resolved configuration with defaults applied and theme paths made absolute.
 * @throws If config.json exists but cannot be read or parsed.
 *
 * @example
 * ```ts
 * const config = loadConfig()
 * if (config.enabled) {
 *   // Apply an override using config.themes.dark or config.themes.light.
 * }
 * ```
 */
export function loadConfig(): ResolvedConfig {
  let userConfig: ThemeOverridesConfig = {}

  if (existsSync(CONFIG_PATH)) {
    userConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ThemeOverridesConfig
  }

  const fallbackTheme = isThemeKind(userConfig.fallbackTheme) ? userConfig.fallbackTheme : DEFAULT_CONFIG.fallbackTheme

  return {
    enabled: typeof userConfig.enabled === "boolean" ? userConfig.enabled : DEFAULT_CONFIG.enabled,
    fallbackTheme,
    pollIntervalMs: normalizePositiveInteger(userConfig.pollIntervalMs, DEFAULT_CONFIG.pollIntervalMs),
    queryTimeoutMs: normalizePositiveInteger(userConfig.queryTimeoutMs, DEFAULT_CONFIG.queryTimeoutMs),
    themes: {
      dark: resolveExtensionPath(userConfig.themes?.dark ?? DEFAULT_CONFIG.themes.dark),
      light: resolveExtensionPath(userConfig.themes?.light ?? DEFAULT_CONFIG.themes.light),
    },
  }
}

/**
 * Read only the polling interval, falling back safely if config loading fails.
 *
 * @returns Configured polling interval in milliseconds, or the default interval.
 */
export function readPollIntervalMs(): number {
  try {
    return loadConfig().pollIntervalMs
  } catch {
    return DEFAULT_CONFIG.pollIntervalMs
  }
}
