/**
 * Exa Code client.
 *
 * Exports the Context-API-backed code search used as the primary provider for
 * web_code_search focus "implementation_examples" and as the fallback for
 * focus "developer_sources". Promoted from the former fallback-only client.
 */
import { postJson } from "./http.js";
import { asFiniteNumber, asRecord, asString } from "./value-guards.js";
import type { CodeSearchAttempt, ExaCodeTokens, NormalizedExaCodeSearch } from "./types.js";

const CONTEXT_URL = "https://api.exa.ai/context";

/**
 * Normalizes an Exa Context API response defensively.
 *
 * Prefers the `response` text, parses a numeric `resultsCount`, and retains
 * request metadata for private details.
 */
export function parseExaCodeResponse(data: unknown): NormalizedExaCodeSearch {
  const root = asRecord(data) ?? {};
  return {
    response: asString(root.response) ?? asString(root.text) ?? "",
    resultsCount: asFiniteNumber(root.resultsCount),
    requestId: asString(root.requestId),
    costDollars: root.costDollars,
    searchTime: asFiniteNumber(root.searchTime),
    outputTokens: asFiniteNumber(root.outputTokens),
  };
}

/**
 * Calls the Exa Context API for implementation-ready code context.
 *
 * @param params - Query text, Exa API key, token budget, and optional abort signal.
 * @returns The code-search attempt record with raw HTTP exchange data and the normalized response.
 */
export async function callExaCodeSearch(params: {
  query: string;
  exaApiKey: string;
  tokensNum: ExaCodeTokens;
  signal?: AbortSignal;
}): Promise<CodeSearchAttempt> {
  const raw = await postJson({
    url: CONTEXT_URL,
    headers: {
      "x-api-key": params.exaApiKey,
      "Content-Type": "application/json",
    },
    body: {
      query: params.query,
      tokensNum: params.tokensNum,
    },
    signal: params.signal,
  });
  const normalized = raw.rawResponse?.bodyJson ? parseExaCodeResponse(raw.rawResponse.bodyJson) : undefined;

  return {
    provider: "exa-code",
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    normalized,
    error: raw.error,
  };
}

/**
 * Determines whether an Exa Code attempt is usable.
 *
 * HTTP 2xx plus non-empty response text is required. An explicit
 * `resultsCount` of 0 counts as zero usable results and triggers operational
 * fallback even when the response text is non-empty. A missing or non-numeric
 * `resultsCount` stays compatible when the response text is non-empty.
 */
export function isUsableExaCodeSearch(attempt: CodeSearchAttempt): boolean {
  const status = attempt.rawResponse?.status;
  if (!status || status < 200 || status >= 300) return false;
  const normalized = attempt.normalized;
  if (!normalized || !("response" in normalized)) return false;
  if (normalized.resultsCount === 0) return false;
  return normalized.response.trim().length > 0;
}
