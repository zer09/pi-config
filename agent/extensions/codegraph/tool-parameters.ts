/**
 * TypeBox parameter schemas and value coercion for CodeGraph tools.
 *
 * The schemas live here to keep tool modules focused on execution while sharing
 * identical validation metadata for common parameters such as `projectPath` and
 * result limits.
 */

import { Type } from "typebox";
import type { TSchema } from "typebox";
import { MAX_CODEGRAPH_QUERY_CHARS, MAX_TOOL_RESULTS } from "./constants.ts";

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

/** Result of validating user text before passing it to CodeGraph search APIs. */
export type QueryTextValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

/**
 * Trim and bound user text before passing it to SQLite-backed CodeGraph APIs.
 *
 * @param value - User-provided query or symbol text.
 * @param label - Human-readable parameter label for error messages.
 * @returns Trimmed text or a user-facing validation message.
 */
export function validateQueryText(value: unknown, label: string): QueryTextValidation {
  if (typeof value !== "string") return { ok: false, message: `${label} must be a string.` };
  const query = value.trim();
  if (!query) return { ok: false, message: `${label} requires a non-empty value.` };
  if (query.length > MAX_CODEGRAPH_QUERY_CHARS) {
    return { ok: false, message: `${label} is too long (${query.length} characters; max ${MAX_CODEGRAPH_QUERY_CHARS}). Use a shorter, more specific query.` };
  }
  return { ok: true, value: query };
}

/**
 * Convert known CodeGraph search-query failures into user-facing messages.
 *
 * @param error - Error thrown by CodeGraph search/context APIs.
 * @returns Message for known user-input failures, otherwise undefined.
 */
export function formatCodeGraphQueryError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/LIKE or GLOB pattern too complex/i.test(message)) {
    return "CodeGraph query is too complex for SQLite pattern matching. Use a shorter, more specific query.";
  }
  return undefined;
}
