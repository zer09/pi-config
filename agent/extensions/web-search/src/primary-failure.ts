/**
 * Exact classification of Gemini primary-attempt provider failures.
 *
 * Exports the narrow classifier used to recognize the intermittent
 * Gemini-to-Exa empty-query rejection so it can be retried once and reported
 * explicitly, without treating unrelated failures as retryable.
 */
import { asString } from "./value-guards.js";
import type { PrimaryAttempt, PrimaryFailureCode } from "./types.js";

/**
 * Collapses provider-specific escaping so stable message fragments can be matched.
 *
 * Google returns the nested Exa error as an embedded JSON string, so the same
 * message arrives with a `>` escape instead of `>` in `bodyText`, and with
 * backslash-escaped quotes around the field name in both forms.
 */
function normalizeErrorText(text: string): string {
  return text
    .replace(/\\u003e/gi, ">")
    .replace(/\\u003c/gi, "<")
    .replace(/\\+"/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function providerErrorText(primary: PrimaryAttempt): string | undefined {
  const bodyJson = primary.rawResponse?.bodyJson as { error?: { message?: unknown } } | undefined;
  return asString(bodyJson?.error?.message) ?? asString(primary.rawResponse?.bodyText);
}

/**
 * Classifies a primary attempt as a known, actionable provider failure.
 *
 * @param primary - The primary attempt to inspect.
 * @returns `EXA_EMPTY_QUERY` for the exact nested Exa empty-query rejection, otherwise undefined.
 */
export function classifyPrimaryFailure(primary: PrimaryAttempt): PrimaryFailureCode | undefined {
  if (primary.rawResponse?.status !== 400) return undefined;

  const text = providerErrorText(primary);
  if (!text) return undefined;

  const normalized = normalizeErrorText(text);
  if (!normalized.includes("exa ai api returned bad request error")) return undefined;
  if (!/too small: expected string to have\s*>=\s*1 characters/.test(normalized)) return undefined;
  // The failing field must be exactly `query`, not a prefix match such as `queryType`.
  if (!/\bat\s+(?:"query"|query(?![\w$.-]))/.test(normalized)) return undefined;
  return "EXA_EMPTY_QUERY";
}
