/**
 * Firecrawl Developer Index client.
 *
 * Exports the developer-source search call used as the primary provider for
 * web_code_search focus "developer_sources" and as the restricted fallback
 * for focus "implementation_examples".
 */
import { postJson } from "./http.js";
import { asArray, asRecord, asString } from "./value-guards.js";
import type { CodeSearchAttempt, NormalizedFirecrawlDeveloperSearch } from "./types.js";

const DEVELOPER_SEARCH_URL = "https://api.firecrawl.dev/v2/search/developer";

/**
 * Normalizes a Firecrawl Developer Index response defensively.
 *
 * The public developer_sources contract requires a URL for every artifact,
 * so artifacts without a usable URL are dropped and `resultCount` counts only
 * the URL-bearing survivors; an all-invalid response therefore reports zero
 * usable results and triggers operational fallback. Missing titles fall back
 * to the URL at format time; coverage and reranking metadata is preserved for
 * private details.
 */
export function parseFirecrawlDeveloperResponse(data: unknown): NormalizedFirecrawlDeveloperSearch {
  const root = asRecord(data) ?? {};
  const artifacts = asArray(root.results)
    .map((result) => {
      const record = asRecord(result);
      if (!record) return undefined;
      return {
        id: asString(record.id),
        type: asString(record.type),
        url: asString(record.url),
        title: asString(record.title),
        passages: asArray(record.passages)
          .map((passage) => asString(asRecord(passage)?.text))
          .filter((text): text is string => typeof text === "string" && text.trim().length > 0),
      };
    })
    .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== undefined)
    .filter((artifact) => typeof artifact.url === "string" && artifact.url.trim().length > 0);
  const coverage = asRecord(root.coverage);

  return {
    success: root.success === true,
    artifacts,
    coverage,
    reranked: typeof root.reranked === "boolean" ? root.reranked : undefined,
    resultCount: artifacts.length,
  };
}

/**
 * Calls the Firecrawl Developer Index.
 *
 * The Authorization header is included only when a Firecrawl key is
 * configured; the endpoint tolerates unauthenticated requests, so the
 * attempt may run keyless and operational fallback stays available.
 *
 * @param params - Query text, k, passages, optional result-type filter, optional key, and abort signal.
 * @returns The code-search attempt record with raw HTTP exchange data and normalized results.
 */
export async function callFirecrawlDeveloperSearch(params: {
  query: string;
  k: number;
  passages: number;
  types?: string[];
  firecrawlApiKey?: string;
  signal?: AbortSignal;
}): Promise<CodeSearchAttempt> {
  const body: Record<string, unknown> = {
    query: params.query,
    k: params.k,
    passages: params.passages,
  };
  if (params.types) body.types = params.types;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (params.firecrawlApiKey) headers.Authorization = `Bearer ${params.firecrawlApiKey}`;

  const raw = await postJson({
    url: DEVELOPER_SEARCH_URL,
    headers,
    body,
    signal: params.signal,
  });
  const normalized = raw.rawResponse?.bodyJson
    ? parseFirecrawlDeveloperResponse(raw.rawResponse.bodyJson)
    : undefined;

  return {
    provider: "firecrawl-developer",
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    normalized,
    error: raw.error,
  };
}

/**
 * Determines whether a Firecrawl Developer attempt is usable.
 *
 * HTTP 2xx, a parsed response, `success === true`, and at least one usable
 * artifact are required; zero usable results count as operational failure.
 */
export function isUsableFirecrawlDeveloperSearch(attempt: CodeSearchAttempt): boolean {
  const status = attempt.rawResponse?.status;
  if (!status || status < 200 || status >= 300) return false;
  const normalized = attempt.normalized;
  if (!normalized || !("artifacts" in normalized)) return false;
  return normalized.success && normalized.resultCount > 0;
}
