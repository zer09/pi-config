/**
 * Direct Exa fallback clients for web and code search.
 *
 * Exports the fallback API calls used when Gemini native grounding is
 * unavailable or does not return a clean STOP answer.
 */
import { postJson } from "./http.js";
import { asString } from "./value-guards.js";
import type { FallbackAttempt, SearchConfig } from "./types.js";

function getExaSearchResults(data: unknown): unknown[] {
  return Array.isArray((data as { results?: unknown[] })?.results) ? ((data as { results: unknown[] }).results) : [];
}

function formatHighlights(highlights: unknown): string[] {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .map((highlight) => (typeof highlight === "string" ? highlight : asString((highlight as { text?: unknown })?.text)))
    .filter((highlight): highlight is string => typeof highlight === "string" && highlight.trim().length > 0);
}

function formatExaSearchAnswer(query: string, data: unknown): string {
  const results = getExaSearchResults(data);
  if (results.length === 0) return `Direct Exa search returned no results for: ${query}`;

  const lines: string[] = [`Direct Exa search results for: ${query}`, ""];
  results.forEach((raw, index) => {
    const result = raw as Record<string, unknown>;
    const title = asString(result.title) || asString(result.url) || `Result ${index + 1}`;
    lines.push(`${index + 1}. ${title}`);
    if (asString(result.url)) lines.push(`   URL: ${result.url}`);
    if (asString(result.publishedDate)) lines.push(`   Published: ${result.publishedDate}`);
    const highlights = formatHighlights(result.highlights);
    if (highlights.length > 0) {
      lines.push("   Highlights:");
      highlights.slice(0, 3).forEach((highlight) => lines.push(`   - ${highlight.replace(/\s+/g, " ").trim()}`));
    } else if (asString(result.text)) {
      lines.push(`   Text: ${asString(result.text)!.replace(/\s+/g, " ").trim().slice(0, 1000)}`);
    }
  });
  return lines.join("\n");
}

/**
 * Calls Exa's web search endpoint as the non-code fallback provider.
 *
 * @param params - Query text, Exa API key, search configuration, fallback reason, and optional abort signal.
 * @returns The fallback-attempt record with formatted answer text and raw HTTP exchange data.
 * @throws Error when Exa search fails before a response or returns a non-2xx HTTP status.
 */
export async function callExaSearchFallback(params: {
  query: string;
  exaApiKey: string;
  config: SearchConfig;
  reason: string;
  signal?: AbortSignal;
}): Promise<FallbackAttempt> {
  const body = {
    query: params.query,
    type: params.config.searchType,
    numResults: params.config.numResults,
    contents: {
      highlights: true,
    },
  };
  const raw = await postJson({
    url: "https://api.exa.ai/search",
    headers: {
      "x-api-key": params.exaApiKey,
      "Content-Type": "application/json",
    },
    body,
    signal: params.signal,
  });
  const data = raw.rawResponse?.bodyJson;
  const status = raw.rawResponse?.status;
  if (raw.error || !raw.rawResponse || !status || status < 200 || status >= 300) {
    throw new Error(`exa_search fallback failed${status ? ` with HTTP ${status}` : ""}${raw.error ? `: ${raw.error}` : ""}`);
  }

  const results = getExaSearchResults(data);
  return {
    used: true,
    provider: "exa_search",
    reason: params.reason,
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    answer: formatExaSearchAnswer(params.query, data),
    costDollars: (data as { costDollars?: unknown })?.costDollars,
    resultCount: results.length,
  };
}

/**
 * Calls Exa's Context API as the code-oriented fallback provider.
 *
 * @param params - Query text, Exa API key, fallback reason, and optional abort signal.
 * @returns The fallback-attempt record with response text and raw HTTP exchange data.
 * @throws Error when Exa Context fails before a response or returns a non-2xx HTTP status.
 */
export async function callCodeSearchFallback(params: {
  query: string;
  exaApiKey: string;
  reason: string;
  signal?: AbortSignal;
}): Promise<FallbackAttempt> {
  const body = {
    query: params.query,
    tokensNum: "dynamic",
  };
  const raw = await postJson({
    url: "https://api.exa.ai/context",
    headers: {
      "x-api-key": params.exaApiKey,
      "Content-Type": "application/json",
    },
    body,
    signal: params.signal,
  });
  const data = raw.rawResponse?.bodyJson as Record<string, unknown> | undefined;
  const status = raw.rawResponse?.status;
  if (raw.error || !raw.rawResponse || !status || status < 200 || status >= 300) {
    throw new Error(`code_search fallback failed${status ? ` with HTTP ${status}` : ""}${raw.error ? `: ${raw.error}` : ""}`);
  }

  const answer = asString(data?.response) || asString(data?.text) || "Exa Context API returned no response text.";
  return {
    used: true,
    provider: "code_search",
    reason: params.reason,
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    answer,
  };
}
