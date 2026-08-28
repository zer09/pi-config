/**
 * Tavily search client.
 *
 * Exports the direct `/search` call used as the final operational fallback of
 * the web_search tool. The request shape is fixed: only `query`,
 * `search_depth`, `max_results`, `include_answer: false`,
 * `include_raw_content: false`, and `include_usage: true` are ever sent, so
 * unrelated fields such as `auto_parameters` can never reach the provider.
 */
import { postJson } from "./http.js";
import { MAX_TAVILY_RESULT_URL_CHARS, MAX_TAVILY_RESULTS } from "./limits.js";
import { stripTerminalControlSequences } from "./terminal-sanitize.js";
import { asFiniteNumber, asRecord, asString } from "./value-guards.js";
import { normalizeUrl } from "./url.js";
import type {
  NormalizedTavilySearchResponse,
  TavilySearchAttempt,
  TavilySearchResult,
  TavilySearchSettings,
} from "./types.js";

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/** Terminal-stripped, trimmed candidate string, or undefined for non-strings. */
function candidateString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return stripTerminalControlSequences(value).trim();
}

/** Accepts a finite response_time number or numeric string only. */
function parseResponseTime(value: unknown): number | undefined {
  let numeric: number | undefined;
  if (typeof value === "number") numeric = value;
  else if (typeof value === "string" && value.trim().length > 0) numeric = Number(value);
  return numeric !== undefined && Number.isFinite(numeric) ? numeric : undefined;
}

/** Validates and normalizes one raw Tavily result, or drops it. */
function normalizeTavilyResult(entry: unknown): TavilySearchResult | undefined {
  const record = asRecord(entry);
  if (record === undefined) return undefined;
  const title = candidateString(record.title) ?? "";
  const content = candidateString(record.content) ?? "";
  // A result must carry some useful text next to its URL.
  if (title.length === 0 && content.length === 0) return undefined;
  const rawUrl = candidateString(record.url);
  if (rawUrl === undefined || rawUrl.length === 0) return undefined;
  let url: string;
  try {
    // Rejects non-http(s) schemes and anything without a parseable hostname.
    url = normalizeUrl(rawUrl);
  } catch {
    return undefined;
  }
  // Overlong output URLs drop the whole result; a URL is never truncated.
  if (url.length > MAX_TAVILY_RESULT_URL_CHARS) return undefined;
  return { title, url, content, score: asFiniteNumber(record.score) };
}

/**
 * Normalizes a Tavily /search response defensively.
 *
 * Results are validated in order and capped at 20; only title, normalized
 * URL, content, and a finite score survive per result. Raw/usable/omitted
 * counters and results-array presence are tracked so diagnostics and failure
 * categories can distinguish an empty result set from an unusable one.
 */
export function parseTavilySearchResponse(data: unknown): NormalizedTavilySearchResponse {
  const root = asRecord(data) ?? {};
  const rawResults = Array.isArray(root.results) ? root.results : undefined;
  const survivors: TavilySearchResult[] = [];
  if (rawResults !== undefined) {
    for (const entry of rawResults) {
      const normalized = normalizeTavilyResult(entry);
      if (normalized !== undefined) survivors.push(normalized);
    }
  }
  const results = survivors.slice(0, MAX_TAVILY_RESULTS);
  const resultsTotal = rawResults?.length ?? 0;
  return {
    results,
    resultsTotal,
    usableResultsCount: survivors.length,
    resultsOmitted: resultsTotal - results.length,
    resultsArrayPresent: rawResults !== undefined,
    requestId: asString(root.request_id) ?? asString(root.requestId),
    responseTime: parseResponseTime(root.response_time),
    usageCredits: asFiniteNumber(asRecord(root.usage)?.credits),
  };
}

/**
 * Calls the Tavily /search endpoint for the final web_search fallback.
 *
 * @param params - Query text, Tavily API key, per-depth settings, and optional abort signal.
 * @returns The Tavily attempt record with raw HTTP exchange data and the normalized response.
 */
export async function callTavilySearch(params: {
  query: string;
  tavilyApiKey: string;
  settings: TavilySearchSettings;
  signal?: AbortSignal;
}): Promise<TavilySearchAttempt> {
  const raw = await postJson({
    url: TAVILY_SEARCH_URL,
    headers: {
      Authorization: `Bearer ${params.tavilyApiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      query: params.query,
      search_depth: params.settings.searchDepth,
      max_results: params.settings.maxResults,
      include_answer: false,
      include_raw_content: false,
      include_usage: true,
    },
    signal: params.signal,
  });
  const normalized = raw.rawResponse?.bodyJson ? parseTavilySearchResponse(raw.rawResponse.bodyJson) : undefined;

  return {
    provider: "tavily-search",
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    normalized,
    error: raw.error,
  };
}

/**
 * Determines whether a Tavily attempt is usable.
 *
 * Structural acceptance requires an HTTP 2xx status, a parsed response, and
 * at least one surviving result. Once the final post-redaction delivered
 * count has been recorded on the attempt, acceptance additionally requires
 * more than zero delivered blocks, so the predicate matches final selection
 * exactly. Tavily is never retried by the orchestrator.
 */
export function isUsableTavilySearch(attempt: TavilySearchAttempt): boolean {
  const status = attempt.rawResponse?.status;
  if (!status || status < 200 || status >= 300) return false;
  const normalized = attempt.normalized;
  if (!normalized) return false;
  if (normalized.results.length === 0) return false;
  const deliveredResultsCount = attempt.deliveredResultsCount;
  if (deliveredResultsCount !== undefined) return deliveredResultsCount > 0;
  return true;
}
