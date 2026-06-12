/**
 * Pi Theme construction from validated override palettes.
 *
 * This module converts a theme-overrides palette into an actual Pi Theme
 * instance, preserving Pi's runtime Theme constructor identity requirements.
 */

import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent"
import { resolveVar } from "./theme-colors.ts"
import { loadPalette } from "./theme-palette.ts"
import { isBackgroundToken, REQUIRED_TOKENS } from "./theme-tokens.ts"
import type { ColorMode, ColorValue, ResolvedConfig, ThemeConstructor, ThemeKind } from "./types.ts"

/**
 * Build a Pi Theme instance for one override palette.
 *
 * The Theme constructor is read from Pi's active or built-in theme rather than
 * imported directly. This preserves the original instanceof compatibility with
 * Pi's internal UI theme checks across extension module loaders.
 *
 * @param ctx - Current Pi extension context.
 * @param kind - Built-in theme kind being overridden.
 * @param mode - Current terminal color mode.
 * @param config - Resolved extension configuration.
 * @returns A Theme instance suitable for ctx.ui.setTheme(theme).
 * @throws If the palette is invalid or contains invalid variable references.
 */
export function buildOverrideTheme(
  ctx: ExtensionContext,
  kind: ThemeKind,
  mode: ColorMode,
  config: ResolvedConfig,
): Theme {
  const palette = loadPalette(kind, config)
  const vars = palette.vars ?? {}
  const fgColors: Partial<Record<ThemeColor, ColorValue>> = {}
  const bgColors: Record<string, ColorValue> = {}

  for (const token of REQUIRED_TOKENS) {
    const resolved = resolveVar(palette.colors[token], vars)
    if (isBackgroundToken(token)) {
      bgColors[token] = resolved
    } else {
      fgColors[token as ThemeColor] = resolved
    }
  }

  // Use Pi's own Theme constructor instance so ctx.ui.setTheme(theme) passes
  // the internal instanceof Theme check even if extension loading uses another module loader.
  const baseTheme = ctx.ui.getTheme(kind) ?? ctx.ui.theme
  const ThemeCtor = baseTheme.constructor as ThemeConstructor

  return new ThemeCtor(
    fgColors as Record<ThemeColor, ColorValue>,
    bgColors as Record<string, ColorValue>,
    mode,
    { name: kind, sourcePath: config.themes[kind] },
  )
}
