/**
 * Filesystem locations for the theme-overrides package.
 *
 * Package defaults live next to the extension entry point. User-editable config
 * lives under Pi's agent directory (or an explicit env-var path) so npm/git
 * package updates do not overwrite local preferences.
 */

import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

/**
 * Environment variable that points to an explicit user config file.
 */
export const CONFIG_ENV_VAR = "PI_THEME_OVERRIDES_CONFIG"

/**
 * Absolute directory containing this package's extension files.
 */
export const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Backward-compatible alias for the package directory.
 */
export const EXTENSION_DIR = PACKAGE_DIR

/**
 * Absolute path to the bundled default configuration file.
 */
export const DEFAULT_CONFIG_PATH = join(PACKAGE_DIR, "config.default.json")

/**
 * Directory for user-editable theme-overrides configuration.
 */
export const USER_CONFIG_DIR = join(getAgentDir(), "theme-overrides")

/**
 * Absolute path to the user-editable configuration file.
 */
export const USER_CONFIG_PATH = resolveUserConfigPath(process.env[CONFIG_ENV_VAR])

/**
 * Backward-compatible alias for the user configuration file.
 */
export const CONFIG_PATH = USER_CONFIG_PATH

/**
 * Absolute path to Pi's global settings file.
 */
export const SETTINGS_PATH = join(getAgentDir(), "settings.json")

/**
 * Resolve an optional env-provided config path to an absolute file path.
 *
 * @param envPath - Value from PI_THEME_OVERRIDES_CONFIG, if provided.
 * @returns Absolute user config path.
 */
export function resolveUserConfigPath(envPath: string | undefined): string {
  if (!envPath) return join(USER_CONFIG_DIR, "config.json")
  return isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath)
}

/**
 * Resolve a config-provided path relative to a config source directory.
 *
 * @param pathValue - Absolute path or config-relative path from JSON.
 * @param baseDir - Directory used for relative path resolution.
 * @returns An absolute filesystem path.
 */
export function resolveConfigPath(pathValue: string, baseDir: string): string {
  return isAbsolute(pathValue) ? pathValue : join(baseDir, pathValue)
}

/**
 * Resolve a package-relative path. Kept for compatibility with older imports.
 *
 * @param pathValue - Absolute path or package-relative path.
 * @returns An absolute filesystem path.
 */
export function resolveExtensionPath(pathValue: string): string {
  return resolveConfigPath(pathValue, PACKAGE_DIR)
}
