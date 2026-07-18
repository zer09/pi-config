/**
 * Theme state inspection and override policy checks.
 *
 * The extension reads settings.json only to decide whether to back off. It never
 * writes settings; runtime switching is applied in memory through Theme objects.
 */

import { readFileSync } from "node:fs"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { SETTINGS_PATH, THEME_PATHS } from "./constants.ts"
import type { CurrentThemeInfo, ThemeKind } from "./types.ts"

/**
 * Read the theme configured in Pi settings.json, if one is present.
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
 * Decide whether a persisted/current theme belongs to this extension's managed
 * dark/light switching policy.
 */
export function isManagedThemeName(value: string): value is ThemeKind {
  return value === "dark" || value === "light"
}

/**
 * Decide whether a theme source path belongs to this extension's managed themes.
 */
export function isManagedThemeSource(sourcePath: string | undefined): boolean {
  return sourcePath === THEME_PATHS.dark || sourcePath === THEME_PATHS.light
}

/**
 * Snapshot the active Pi UI theme state used by override decisions.
 */
export function currentThemeInfo(ctx: ExtensionContext): CurrentThemeInfo {
  return {
    name: ctx.ui.theme.name,
    sourcePath: ctx.ui.theme.sourcePath,
  }
}

/**
 * Decide whether the extension may override the current UI theme.
 *
 * If the user selects or persists any non-managed theme, this extension backs off
 * instead of fighting that choice.
 */
export function isThemeOverrideAllowed(ctx: ExtensionContext): boolean {
  const configured = readConfiguredTheme()
  if (configured && !isManagedThemeName(configured)) return false

  const current = currentThemeInfo(ctx)
  if (current.name && !isManagedThemeName(current.name) && !isManagedThemeSource(current.sourcePath)) {
    return false
  }

  return true
}
