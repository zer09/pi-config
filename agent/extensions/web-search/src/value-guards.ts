/**
 * Shared unknown-value narrowing helpers for the web-search extension.
 *
 * Exports small, behavior-preserving guards used when parsing configuration,
 * provider responses, cached records, and render details.
 */

/**
 * Narrows an unknown value to a non-array object record.
 *
 * @param value - Value to inspect.
 * @returns The value as a record, or undefined when it is not an object record.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * Narrows an unknown value to a record, falling back to an empty object.
 *
 * @param value - Value to inspect.
 * @returns The value as a record, or an empty record when it is not an object record.
 */
export function asRecordOrEmpty(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

/**
 * Narrows an unknown value to an array.
 *
 * @param value - Value to inspect.
 * @returns The value as an array, or an empty array when it is not an array.
 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Narrows an unknown value to a string, including empty strings.
 *
 * @param value - Value to inspect.
 * @returns The string value, or undefined when it is not a string.
 */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Narrows an unknown value to a non-empty string without trimming it.
 *
 * @param value - Value to inspect.
 * @returns The string value, or undefined when it is not a non-empty string.
 */
export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Narrows an unknown value to a trimmed non-empty string.
 *
 * @param value - Value to inspect.
 * @returns The trimmed string, or undefined when it is not a string with non-whitespace content.
 */
export function asTrimmedNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Narrows an unknown value to a finite number.
 *
 * @param value - Value to inspect.
 * @returns The finite number, or undefined when it is not a finite number.
 */
export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Narrows an unknown value to a positive integer.
 *
 * @param value - Value to inspect.
 * @returns The positive integer, or undefined when it is not a positive integer.
 */
export function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
