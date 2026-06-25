/**
 * Theme palette file loading and validation.
 *
 * This module reads the dark/light palette JSON configured for the extension and
 * verifies the tokens required by Pi's Theme constructor before construction.
 */

import { readFileSync } from "node:fs"
import { isValidColorValue } from "./theme-colors.ts"
import { REQUIRED_TOKENS } from "./theme-tokens.ts"
import type { ResolvedConfig, ThemeJson, ThemeKind } from "./types.ts"

/**
 * Load and validate one configured override palette.
 *
 * @param kind - Built-in theme kind whose palette should be loaded.
 * @param config - Resolved extension configuration with absolute theme paths.
 * @returns Parsed theme palette JSON.
 * @throws If the palette cannot be read, cannot be parsed, has an invalid shape,
 * or is missing required color tokens.
 */
export function loadPalette(kind: ThemeKind, config: ResolvedConfig): ThemeJson {
  const themePath = config.themes[kind]
  const palette = JSON.parse(readFileSync(themePath, "utf8")) as ThemeJson

  if (!palette || typeof palette !== "object" || !palette.colors || typeof palette.colors !== "object") {
    throw new Error(`Invalid ${kind} theme file: ${themePath}`)
  }

  const missing = REQUIRED_TOKENS.filter((token) => !isValidColorValue(palette.colors[token]))
  if (missing.length > 0) {
    throw new Error(`Invalid ${kind} theme file ${themePath}; missing colors: ${missing.join(", ")}`)
  }

  return palette
}
