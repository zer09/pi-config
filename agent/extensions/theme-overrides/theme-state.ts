/**
 * Theme state inspection and override policy checks.
 *
 * This module isolates reads from Pi settings and the active UI theme so the
 * apply orchestration can decide whether it is safe to replace the theme.
 */

import { readFileSync, writeFileSync } from "node:fs"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { RESUME_LIGHT_THEME_NAME } from "./constants.ts"
import { SETTINGS_PATH } from "./paths.ts"
import type { ColorMode, CurrentThemeInfo, ResolvedConfig, ThemeKind } from "./types.ts"

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
 * Keep Pi's persistent theme setting aligned with the detected system theme.
 *
 * The pre-session `pi --resume` selector reads settings before extensions can
 * run. For light mode, persist a global custom theme with better resume-list
 * contrast; for dark mode, Pi's built-in dark theme is already readable.
 *
 * @param kind - Detected built-in theme kind.
 */
export function syncConfiguredTheme(kind: ThemeKind): void {
  const themeName = configuredThemeForKind(kind)

  try {
    const json = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as { theme?: unknown }
    if (json.theme === themeName) return
    writeFileSync(SETTINGS_PATH, `${JSON.stringify({ ...json, theme: themeName }, null, 2)}\n`, "utf8")
  } catch {
    // Theme application should still succeed if settings cannot be synchronized.
  }
}

/**
 * Map detected system theme kinds to persistent Pi theme settings.
 *
 * @param kind - Detected built-in theme kind.
 * @returns Theme name safe for Pi's pre-extension UI.
 */
export function configuredThemeForKind(kind: ThemeKind): string {
  return kind === "light" ? RESUME_LIGHT_THEME_NAME : "dark"
}

/**
 * Decide whether a persisted/current theme belongs to this extension's managed
 * dark/light switching policy.
 *
 * @param value - Theme name from settings or current UI state.
 * @returns True if the extension may continue managing the theme.
 */
export function isManagedThemeName(value: string): boolean {
  return value === "dark" || value === "light" || value === RESUME_LIGHT_THEME_NAME
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
  if (configured && !isManagedThemeName(configured)) return false

  const current = currentThemeInfo(ctx)
  const currentSourcePath = current.sourcePath ?? ""
  const isOverrideSource = currentSourcePath === config.themes.dark || currentSourcePath === config.themes.light

  // If the user is previewing/selecting a non-managed theme, do not fight the preview.
  if (current.name && !isManagedThemeName(current.name) && !isOverrideSource) {
    return false
  }

  return true
}
