/**
 * Exa /contents response parser.
 *
 * Exports the parser that converts raw Exa /contents JSON into cache entries
 * keyed by the normalized URLs requested by fetch_contents.
 */
import { normalizeUrl } from "./url.js";
import { asArray, asRecord, asString } from "./value-guards.js";
import type { ContentCacheEntry } from "./types.js";

function normalizeResultUrl(result: Record<string, unknown> | undefined): string | undefined {
  const url = asString(result?.url) ?? asString(result?.uri);
  if (!url) return undefined;
  try {
    return normalizeUrl(url);
  } catch {
    return undefined;
  }
}

function findStatusForResult(statuses: unknown[], result: Record<string, unknown> | undefined, index: number): unknown {
  // Status identity follows result identity: the provider id (Exa uses the
  // URL) or the result's own normalized URL, never position alone.
  const resultId = asString(result?.id) ?? normalizeResultUrl(result);
  if (resultId) {
    const byId = statuses.find((status) => asString(asRecord(status)?.id) === resultId);
    if (byId) return byId;
  }
  return statuses[index];
}

/**
 * Resolves the provider result allowed to satisfy one requested URL.
 *
 * URL identity is authoritative: a URL-bearing result may satisfy only the
 * request for the same normalized URL. Positional attribution survives only
 * as legacy tolerance for results without any URL identity, so a partial or
 * reordered response can never assign one URL's content to another request.
 */
function resultForRequest(
  normalizedUrl: string,
  index: number,
  byNormalizedUrl: Map<string, Record<string, unknown>>,
  results: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const matched = byNormalizedUrl.get(normalizedUrl);
  if (matched) return matched;
  const positional = results[index];
  return positional && !normalizeResultUrl(positional) ? positional : undefined;
}

/**
 * Parses Exa /contents JSON into cache entries aligned to the requested URL order.
 *
 * A requested URL receives content only from the result carrying the same
 * normalized URL (or, as legacy tolerance, a position-matched result with no
 * URL identity of its own). Unmatched requested URLs parse into empty,
 * non-cacheable entries so orchestration turns them into structured failures.
 *
 * Entries carry the `exa_contents` provider and its per-item status so cache
 * and tool details can identify the original provider.
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
    const result = resultForRequest(normalizedUrl, index, byNormalizedUrl, results);
    const status = result ? findStatusForResult(statuses, result, index) : undefined;
    return {
      url: normalizedUrl,
      normalizedUrl,
      fetchedAt: now,
      expiresAt: now + params.ttlMs,
      requestedMaxCharacters: params.requestedMaxCharacters,
      title: asString(result?.title),
      text: asString(result?.text) ?? asString(result?.markdown) ?? "",
      provider: "exa_contents" as const,
      providerStatus: result ? status : "no result matched the requested URL",
      exaStatus: result ? status : undefined,
      rawResult: result,
    };
  });
}
