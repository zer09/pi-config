/**
 * Firecrawl Scrape client.
 *
 * Exports the per-URL Markdown scrape used as the primary content provider by
 * fetch_contents. Only the deterministic Markdown format is requested;
 * LLM-based cleaning and extraction formats are deliberately not enabled.
 */
import { postJson } from "./http.js";
import { asFiniteNumber, asRecord, asString } from "./value-guards.js";
import type { ContentFetchAttempt, NormalizedFirecrawlScrape } from "./types.js";

const SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

/**
 * Normalizes a Firecrawl Scrape response defensively.
 *
 * The source URL prefers `data.metadata.sourceURL` and falls back to
 * `data.metadata.url`; `data.warning` is optional.
 */
export function parseFirecrawlScrapeResponse(data: unknown): NormalizedFirecrawlScrape {
  const root = asRecord(data) ?? {};
  const dataRecord = asRecord(root.data) ?? {};
  const metadata = asRecord(dataRecord.metadata) ?? {};

  return {
    markdown: asString(dataRecord.markdown) ?? "",
    title: asString(metadata.title),
    sourceUrl: asString(metadata.sourceURL) ?? asString(metadata.url),
    statusCode: asFiniteNumber(metadata.statusCode),
    warning: asString(dataRecord.warning),
  };
}

/**
 * Scrapes one URL to Markdown through Firecrawl.
 *
 * The Authorization header is included only when a Firecrawl key is
 * configured; the endpoint tolerates unauthenticated requests, so the
 * attempt may run keyless and the Exa Contents fallback stays available.
 *
 * @param params - Normalized URL, provider cache max age in milliseconds, timeout, optional key, and abort signal.
 * @returns The content-fetch attempt record with raw HTTP exchange data and the normalized scrape.
 */
export async function callFirecrawlScrape(params: {
  url: string;
  maxAgeMs: number;
  timeoutMs: number;
  firecrawlApiKey?: string;
  signal?: AbortSignal;
}): Promise<ContentFetchAttempt> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (params.firecrawlApiKey) headers.Authorization = `Bearer ${params.firecrawlApiKey}`;

  const raw = await postJson({
    url: SCRAPE_URL,
    headers,
    body: {
      url: params.url,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: params.maxAgeMs,
      timeout: params.timeoutMs,
    },
    signal: params.signal,
  });
  const normalized = raw.rawResponse?.bodyJson ? parseFirecrawlScrapeResponse(raw.rawResponse.bodyJson) : undefined;

  return {
    provider: "firecrawl_scrape",
    url: params.url,
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    normalized,
    error: raw.error,
  };
}

/**
 * Determines whether a Firecrawl Scrape attempt is usable.
 *
 * HTTP 2xx, `success === true`, and non-empty Markdown are required. Empty or
 * failure-status content is treated as an operational failure so the URL is
 * handed to the Exa Contents fallback.
 */
export function isUsableFirecrawlScrape(attempt: ContentFetchAttempt): boolean {
  const status = attempt.rawResponse?.status;
  if (!status || status < 200 || status >= 300) return false;
  const root = asRecord(attempt.rawResponse?.bodyJson);
  if (root?.success !== true) return false;
  return (attempt.normalized?.markdown ?? "").trim().length > 0;
}
