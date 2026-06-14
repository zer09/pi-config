/**
 * TypeBox parameter schemas and value coercion for CodeGraph tools.
 *
 * The schemas live here to keep tool modules focused on execution while sharing
 * identical validation metadata for common parameters such as `projectPath` and
 * result limits.
 */

import { Type } from "typebox";
import type { TSchema } from "typebox";
import { MAX_TOOL_RESULTS } from "./constants.ts";

/** Shared optional `projectPath` schema used by every CodeGraph tool. */
export const ProjectPathSchema = Type.Optional(Type.String({
  description: "Optional project path. Defaults to Pi's current working directory. A leading @ is accepted and ignored.",
}));

/**
 * Create an optional bounded integer limit schema.
 *
 * @param defaultValue - Default shown in the schema description.
 * @param max - Maximum accepted value.
 * @returns TypeBox integer schema for a tool `limit`-style parameter.
 *
 * @example
 * ```ts
 * const limit = createLimitSchema(20, 100);
 * ```
 */
export function createLimitSchema(defaultValue: number, max = MAX_TOOL_RESULTS): TSchema {
  return Type.Optional(Type.Integer({
    description: `Maximum results to return (default ${defaultValue}, max ${max}).`,
    minimum: 1,
    maximum: max,
    default: defaultValue,
  }));
}

/**
 * Create a string enum schema from a readonly string tuple.
 *
 * @param values - Allowed string literal values.
 * @param options - Additional TypeBox schema options.
 * @returns TypeBox schema constrained to the supplied string values.
 *
 * @example
 * ```ts
 * const kind = createStringEnumSchema(["function", "class"] as const);
 * ```
 */
export function createStringEnumSchema<T extends readonly string[]>(values: T, options: Record<string, unknown> = {}): TSchema {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

/**
 * Clamp an unknown numeric parameter to a safe integer range.
 *
 * @param value - User-provided value from tool parameters.
 * @param defaultValue - Value used when `value` is not a finite number.
 * @param max - Inclusive upper bound.
 * @returns Integer in the range `[1, max]`.
 *
 * @example
 * ```ts
 * const limit = coerceLimit(params.limit, 20, 100);
 * ```
 */
export function coerceLimit(value: unknown, defaultValue: number, max = MAX_TOOL_RESULTS): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : defaultValue;
  return Math.max(1, Math.min(max, n));
}
