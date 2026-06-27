/**
 * One-shot theme override orchestration.
 *
 * This module detects system appearance and switches Pi's active runtime theme
 * without writing agent/settings.json.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { THEME_PATHS } from "./constants.ts"
import { detectSystemAppearance } from "./system-appearance.ts"
import { currentThemeInfo, isThemeOverrideAllowed } from "./theme-state.ts"

/**
 * Apply the matching dark/light runtime theme if it is currently safe.
 */
export async function applyOverride(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") return
  if (!isThemeOverrideAllowed(ctx)) return

  const kind = await detectSystemAppearance(pi)
  if (!kind) return
  if (!isThemeOverrideAllowed(ctx)) return

  const theme = ctx.ui.getTheme(kind)
  if (!theme) {
    throw new Error(`Theme "${kind}" is not available; expected ${THEME_PATHS[kind]}`)
  }

  const current = currentThemeInfo(ctx)
  if (theme.sourcePath ? current.sourcePath === theme.sourcePath : current.name === kind && !current.sourcePath) {
    return
  }

  ctx.ui.setTheme(theme)
}
