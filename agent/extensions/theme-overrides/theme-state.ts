/**
 * Theme state inspection and override policy checks.
 *
 * This module isolates reads from Pi settings and the active UI theme so the
 * apply orchestration can decide whether it is safe to replace the theme.
 */

import { readFileSync } from "node:fs"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { SETTINGS_PATH } from "./paths.ts"
import type { ColorMode, CurrentThemeInfo, ResolvedConfig } from "./types.ts"

/**
 * Read the theme configured in Pi settings.json, if one is present.
 *
 * @returns The configured theme name, or undefined when settings cannot be read
 * or do not contain a string theme.
 */
export function readConfiguredTheme(): string | undefined {
  try {
    const json = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as { theme?: unknown }
    return typeof json.theme === "string" ? json.theme : undefined
  } catch {
    return undefined
  }
}

/**
 * Snapshot the active Pi UI theme state used by override decisions.
 *
 * @param ctx - Current Pi extension context.
 * @returns Current theme name, source path, and color mode when available.
 */
export function currentThemeInfo(ctx: ExtensionContext): CurrentThemeInfo {
  try {
    const mode = ctx.ui.theme.getColorMode() as ColorMode
    return {
      name: ctx.ui.theme.name,
      sourcePath: ctx.ui.theme.sourcePath,
      mode: mode === "256color" ? "256color" : "truecolor",
    }
  } catch {
    return { mode: "truecolor" }
  }
}

/**
 * Decide whether the extension may override the current UI theme.
 *
 * The extension only fights for Pi's built-in dark/light selectors. If the user
 * has configured or is previewing another theme, the override is suppressed.
 *
 * @param ctx - Current Pi extension context.
 * @param config - Resolved extension configuration.
 * @returns True when applying a dark/light override is allowed.
 */
export function isThemeOverrideAllowed(ctx: ExtensionContext, config: ResolvedConfig): boolean {
  const configured = readConfiguredTheme()
  if (configured && configured !== "dark" && configured !== "light") return false

  const current = currentThemeInfo(ctx)
  const currentSourcePath = current.sourcePath ?? ""
  const isOverrideSource = currentSourcePath === config.themes.dark || currentSourcePath === config.themes.light

  // If the user is previewing/selecting a non-dark/light theme, do not fight the preview.
  if (current.name && current.name !== "dark" && current.name !== "light" && !isOverrideSource) {
    return false
  }

  return true
}
