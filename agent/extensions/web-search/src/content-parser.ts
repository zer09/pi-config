/**
 * Exa /contents response parser.
 *
 * Exports the parser that converts raw Exa /contents JSON into cache entries
 * keyed by the normalized URLs requested by fetch_contents.
 */
import { normalizeUrl } from "./url.js";
import { asArray, asRecord, asString } from "./value-guards.js";
import type { ContentCacheEntry } from "./types.js";

function findStatusForResult(statuses: unknown[], result: Record<string, unknown> | undefined, index: number): unknown {
  const resultId = asString(result?.id);
  if (resultId) {
    const byId = statuses.find((status) => asString(asRecord(status)?.id) === resultId);
    if (byId) return byId;
  }
  return statuses[index];
}

function normalizeResultUrl(result: Record<string, unknown>): string | undefined {
  const url = asString(result.url) ?? asString(result.uri);
  if (!url) return undefined;
  try {
    return normalizeUrl(url);
  } catch {
    return undefined;
  }
}

/**
 * Parses Exa /contents JSON into cache entries aligned to the requested URL order.
 *
 * @param params - Raw response data, requested normalized URLs, character budget, TTL, and optional timestamp.
 * @returns Parsed content cache entries in the same order as the requested URLs.
 */
export function parseExaContentsResults(params: {
  data: unknown;
  requestedUrls: string[];
  requestedMaxCharacters: number;
  ttlMs: number;
  now?: number;
}): ContentCacheEntry[] {
  const now = params.now ?? Date.now();
  const root = asRecord(params.data) ?? {};
  const results = asArray(root.results).map((result) => asRecord(result)).filter(Boolean) as Record<string, unknown>[];
  const statuses = asArray(root.statuses);
  const byNormalizedUrl = new Map<string, Record<string, unknown>>();
  results.forEach((result) => {
    const normalized = normalizeResultUrl(result);
    if (normalized) byNormalizedUrl.set(normalized, result);
  });

  return params.requestedUrls.map((normalizedUrl, index) => {
    const result = byNormalizedUrl.get(normalizedUrl) ?? results[index];
    const text = asString(result?.text) ?? asString(result?.markdown) ?? "";
    return {
      url: normalizedUrl,
      normalizedUrl,
      fetchedAt: now,
      expiresAt: now + params.ttlMs,
      requestedMaxCharacters: params.requestedMaxCharacters,
      title: asString(result?.title),
      text,
      exaStatus: findStatusForResult(statuses, result, index),
      rawResult: result,
    };
  });
}
