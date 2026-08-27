/**
 * Exact classification of Gemini grounding provider failures.
 *
 * Exports the narrow classifier used to recognize the intermittent
 * Gemini-to-Exa empty-query rejection so it can be retried once and reported
 * explicitly, plus the shared grounding usability and fallback-eligibility
 * rules used by the web_search orchestration layer.
 */
import { asString } from "./value-guards.js";
import type { GroundingAttempt, PrimaryFailureCode } from "./types.js";

const PARTNER_LABELS: Record<GroundingAttempt["partner"], string> = {
  parallel: "Parallel",
  exa: "Exa",
};

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

function providerErrorText(attempt: GroundingAttempt): string | undefined {
  const bodyJson = attempt.rawResponse?.bodyJson as { error?: { message?: unknown } } | undefined;
  return asString(bodyJson?.error?.message) ?? asString(attempt.rawResponse?.bodyText);
}

/**
 * Classifies a grounding attempt as a known, actionable provider failure.
 *
 * @param attempt - The grounding attempt to inspect.
 * @returns `EXA_EMPTY_QUERY` for the exact nested Exa empty-query rejection, otherwise undefined.
 */
export function classifyPrimaryFailure(attempt: GroundingAttempt): PrimaryFailureCode | undefined {
  if (attempt.rawResponse?.status !== 400) return undefined;

  const text = providerErrorText(attempt);
  if (!text) return undefined;

  const normalized = normalizeErrorText(text);
  if (!normalized.includes("exa ai api returned bad request error")) return undefined;
  if (!/too small: expected string to have\s*>=\s*1 characters/.test(normalized)) return undefined;
  // The failing field must be exactly `query`, not a prefix match such as `queryType`.
  if (!/\bat\s+(?:"query"|query(?![\w$.-]))/.test(normalized)) return undefined;
  return "EXA_EMPTY_QUERY";
}

/**
 * Determines whether a grounding attempt is a usable grounded success.
 *
 * A usable attempt has HTTP 2xx, a parsed response, a clean STOP finish, a
 * non-empty answer, at least one usable source, and no prompt safety block.
 * A non-empty answer without sources is not grounded success.
 */
export function isUsableGroundingAttempt(attempt: GroundingAttempt): boolean {
  const status = attempt.rawResponse?.status;
  if (!status || status < 200 || status >= 300) return false;
  const normalized = attempt.normalized;
  if (!normalized) return false;
  if (normalized.promptBlockReason) return false;
  if (!normalized.cleanSuccess) return false;
  return normalized.sources.length > 0;
}

/**
 * Determines whether operational fallback may start after a failed attempt.
 *
 * Caller cancellation and prompt safety blocks are terminal: no later provider
 * attempt is started for either cause.
 */
export function isGroundingFallbackAllowed(attempt: GroundingAttempt, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (attempt.normalized?.promptBlockReason) return false;
  return true;
}

/**
 * Builds a bounded, provider-labeled reason string for the fallback decision.
 *
 * The string stays private to details and stored diagnostics; it is never
 * rendered into model-visible content.
 */
export function fallbackReasonFromGrounding(attempt: GroundingAttempt): string {
  const label = `Gemini+${PARTNER_LABELS[attempt.partner]}`;

  if (attempt.error) return `${label} request failed before an HTTP response was received: ${attempt.error}`;

  if (classifyPrimaryFailure(attempt) === "EXA_EMPTY_QUERY") {
    return "Gemini native Exa grounding sent Exa an empty search query.";
  }

  const status = attempt.rawResponse?.status;
  if (status && (status < 200 || status >= 300)) {
    if (status === 401 || status === 403) {
      return `${label} returned HTTP ${status}; likely Google Cloud quota, billing, API-key restriction, or service availability issue.`;
    }
    if (status === 429) return `${label} returned HTTP 429; quota or rate limiting prevented a clean primary answer.`;
    if (status >= 500) return `${label} returned HTTP ${status}; the primary provider had a server-side or transient failure.`;
    return `${label} returned HTTP ${status}, so the primary answer was unavailable.`;
  }

  if (attempt.normalized?.promptBlockReason) {
    return `${label} prompt was blocked with blockReason=${attempt.normalized.promptBlockReason}.`;
  }

  const finishReason = attempt.normalized?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    return `${label} hit MAX_TOKENS, so the primary answer was incomplete.`;
  }
  if (finishReason && finishReason !== "STOP") {
    return `${label} returned finishReason=${finishReason}, so the primary answer was not treated as a clean success.`;
  }

  if (!attempt.normalized) return `${label} returned a response that could not be parsed as normal generateContent JSON.`;
  if (attempt.normalized.answer.trim().length === 0) return `${label} returned no answer text.`;
  if (attempt.normalized.sources.length === 0) return `${label} returned no usable grounding sources.`;
  return `${label} did not return a clean STOP finish reason.`;
}
