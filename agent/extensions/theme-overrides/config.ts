/**
 * Configuration loading and normalization for theme-overrides.
 *
 * The package ships with config.default.json. User overrides are read on demand
 * from ~/.pi/agent/theme-overrides/config.json or PI_THEME_OVERRIDES_CONFIG so
 * edits take effect without restarting Pi and package updates do not overwrite
 * user preferences.
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { DEFAULT_CONFIG } from "./constants.ts"
import { DEFAULT_CONFIG_PATH, PACKAGE_DIR, USER_CONFIG_PATH, resolveConfigPath } from "./paths.ts"
import type { ResolvedConfig, ThemeKind, ThemeOverridesConfig } from "./types.ts"

export interface ConfigSource {
  readonly config: ThemeOverridesConfig
  readonly baseDir: string
}

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
 * Check whether an unknown config value is a non-empty path string.
 *
 * @param value - Unknown theme path from a config object.
 * @returns True when the value can be used as a path.
 */
export function isPathValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * Read and parse one JSON config file.
 *
 * @param path - Absolute config file path.
 * @returns Parsed config object.
 * @throws If the config cannot be read or parsed.
 */
export function readConfigFile(path: string): ThemeOverridesConfig {
  return JSON.parse(readFileSync(path, "utf8")) as ThemeOverridesConfig
}

/**
 * Load the bundled default configuration, falling back to built-in constants if
 * the package default file is absent.
 *
 * @returns Default config source with package-relative path semantics.
 */
export function loadDefaultConfigSource(): ConfigSource {
  if (!existsSync(DEFAULT_CONFIG_PATH)) {
    return { config: DEFAULT_CONFIG, baseDir: PACKAGE_DIR }
  }

  const fileConfig = readConfigFile(DEFAULT_CONFIG_PATH)

  return {
    config: {
      ...DEFAULT_CONFIG,
      ...fileConfig,
      themes: {
        ...DEFAULT_CONFIG.themes,
        ...fileConfig.themes,
      },
    },
    baseDir: PACKAGE_DIR,
  }
}

/**
 * Load the optional user configuration source.
 *
 * @returns User config source, or undefined when no user config exists.
 * @throws If the user config exists but cannot be read or parsed.
 */
export function loadUserConfigSource(): ConfigSource | undefined {
  if (!existsSync(USER_CONFIG_PATH)) return undefined
  return { config: readConfigFile(USER_CONFIG_PATH), baseDir: dirname(USER_CONFIG_PATH) }
}

/**
 * Load and normalize theme-overrides configuration.
 *
 * @returns Resolved configuration with defaults applied and theme paths made absolute.
 * @throws If config.default.json or user config exists but cannot be read or parsed.
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
  const defaults = loadDefaultConfigSource()
  const user = loadUserConfigSource()
  const userConfig = user?.config ?? {}

  const defaultFallbackTheme = isThemeKind(defaults.config.fallbackTheme)
    ? defaults.config.fallbackTheme
    : DEFAULT_CONFIG.fallbackTheme
  const fallbackTheme = isThemeKind(userConfig.fallbackTheme) ? userConfig.fallbackTheme : defaultFallbackTheme

  const defaultPollIntervalMs = normalizePositiveInteger(defaults.config.pollIntervalMs, DEFAULT_CONFIG.pollIntervalMs)
  const defaultQueryTimeoutMs = normalizePositiveInteger(defaults.config.queryTimeoutMs, DEFAULT_CONFIG.queryTimeoutMs)

  return {
    enabled:
      typeof userConfig.enabled === "boolean"
        ? userConfig.enabled
        : typeof defaults.config.enabled === "boolean"
          ? defaults.config.enabled
          : DEFAULT_CONFIG.enabled,
    fallbackTheme,
    pollIntervalMs: normalizePositiveInteger(userConfig.pollIntervalMs, defaultPollIntervalMs),
    queryTimeoutMs: normalizePositiveInteger(userConfig.queryTimeoutMs, defaultQueryTimeoutMs),
    themes: {
      dark: resolveThemePath("dark", defaults, user),
      light: resolveThemePath("light", defaults, user),
    },
  }
}

/**
 * Resolve the theme path for one built-in theme kind.
 *
 * @param kind - Built-in theme kind.
 * @param defaults - Bundled default config source.
 * @param user - Optional user config source.
 * @returns Absolute palette path.
 */
export function resolveThemePath(kind: ThemeKind, defaults: ConfigSource, user: ConfigSource | undefined): string {
  const userThemePath = user?.config.themes?.[kind]
  if (isPathValue(userThemePath) && user) {
    return resolveConfigPath(userThemePath, user.baseDir)
  }

  const defaultThemePath = defaults.config.themes?.[kind]
  return resolveConfigPath(isPathValue(defaultThemePath) ? defaultThemePath : DEFAULT_CONFIG.themes[kind], defaults.baseDir)
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
