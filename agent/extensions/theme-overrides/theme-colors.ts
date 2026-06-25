/**
 * Color value validation and variable resolution for theme palettes.
 *
 * Palette loading validates token presence, while this module validates individual
 * color values and recursively resolves variable references before theme creation.
 */

import type { ColorValue } from "./types.ts"

/**
 * Check whether a value is a Pi-compatible color value.
 *
 * @param value - Unknown value from theme JSON.
 * @returns True for strings and integer 256-color indexes from 0 through 255.
 */
export function isValidColorValue(value: unknown): value is ColorValue {
  return typeof value === "string" || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255)
}

/**
 * Resolve a color value through a palette variable map.
 *
 * Numeric values, empty strings, and hex strings are already concrete and are
 * returned as-is. Other strings are treated as variable names and resolved
 * recursively.
 *
 * @param value - Color value or variable name to resolve.
 * @param vars - Palette variable map.
 * @param seen - Internal recursion guard used to detect circular references.
 * @returns The resolved concrete color value.
 * @throws If a variable is missing or references itself circularly.
 */
export function resolveVar(
  value: ColorValue,
  vars: Readonly<Record<string, ColorValue>>,
  seen = new Set<string>(),
): ColorValue {
  if (typeof value === "number" || value === "" || value.startsWith("#")) return value
  if (seen.has(value)) throw new Error(`Circular theme variable reference: ${value}`)
  const next = vars[value]
  if (!isValidColorValue(next)) throw new Error(`Missing theme variable: ${value}`)
  seen.add(value)
  return resolveVar(next, vars, seen)
}
