/**
 * Filesystem locations for the theme-overrides extension.
 *
 * Keeping these path calculations in the extension root preserves the original
 * config/theme resolution semantics when the monolithic entry point is split.
 */

import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

/**
 * Absolute directory containing this extension's index and config files.
 */
export const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Absolute path to the extension's optional user configuration file.
 */
export const CONFIG_PATH = join(EXTENSION_DIR, "config.json")

/**
 * Absolute path to Pi's global settings file.
 */
export const SETTINGS_PATH = join(getAgentDir(), "settings.json")

/**
 * Resolve a config-provided path relative to the extension directory.
 *
 * @param pathValue - Absolute path or extension-relative path from config.json.
 * @returns An absolute filesystem path.
 */
export function resolveExtensionPath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : join(EXTENSION_DIR, pathValue)
}
