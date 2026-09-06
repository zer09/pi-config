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

const OPTIONS_WITH_VALUE = new Set([
  "--provider", "--model", "--api-key", "--thinking", "--models", "--name", "-n",
  "--session", "--session-dir", "--fork", "--tools", "-t", "--exclude-tools", "-xt",
  "--extension", "-e", "--skill", "--prompt-template", "--theme", "--system-prompt",
  "--append-system-prompt", "--tui-mode",
])

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
 * Detect a user-supplied per-run theme selection. The wrapper marks only its own
 * injected default so runtime Windows appearance polling can continue.
 */
export function hasExplicitUseTheme(
  args: readonly string[] = process.argv.slice(2),
  wrapperInjected = process.env.PI_THEME_WRAPPER_INJECTED === "1",
): boolean {
  if (wrapperInjected) return false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--") return false
    if (argument === "--use-theme") return true
    if (OPTIONS_WITH_VALUE.has(argument ?? "")) index += 1
  }
  return false
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
  if (hasExplicitUseTheme()) return false

  const configured = readConfiguredTheme()
  if (configured && !isManagedThemeName(configured)) return false

  const current = currentThemeInfo(ctx)
  if (current.name && !isManagedThemeName(current.name) && !isManagedThemeSource(current.sourcePath)) {
    return false
  }

  return true
}
