/**
 * One-shot theme override orchestration.
 *
 * This module coordinates configuration loading, override policy checks, system
 * appearance detection, and Pi theme construction for a single apply attempt.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadConfig } from "./config.ts"
import { detectSystemAppearance } from "./system-appearance.ts"
import { buildOverrideTheme } from "./theme-builder.ts"
import { currentThemeInfo, isThemeOverrideAllowed, syncConfiguredTheme } from "./theme-state.ts"

/**
 * Apply the configured built-in dark/light theme override if it is currently safe.
 *
 * The override is skipped when disabled, outside TUI mode, when the user has
 * selected a non-built-in theme, or when the desired override theme is already
 * active.
 *
 * @param pi - Pi extension API used for system appearance queries.
 * @param ctx - Current Pi extension context.
 * @returns A promise that resolves after the attempt completes or is skipped.
 * @throws Propagates configuration, palette, and theme-construction errors to
 * the caller so lifecycle code can warn once and continue running.
 */
export async function applyOverride(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const config = loadConfig()

  if (!config.enabled || ctx.mode !== "tui") return
  if (!isThemeOverrideAllowed(ctx, config)) return

  const kind = await detectSystemAppearance(pi, config)
  if (!isThemeOverrideAllowed(ctx, config)) return

  syncConfiguredTheme(kind)

  const current = currentThemeInfo(ctx)
  if (current.sourcePath === config.themes[kind]) return

  ctx.ui.setTheme(buildOverrideTheme(ctx, kind, current.mode, config))
}
