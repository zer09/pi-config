/**
 * Exa /contents response parser.
 *
 * Exports the parser that converts raw Exa /contents JSON into cache entries
 * keyed by the normalized URLs requested by fetch_contents.
 */
import { normalizeUrl } from "./url.js";
import { asArray, asRecord, asString } from "./value-guards.js";
import type { ContentCacheEntry } from "./types.js";

/** Normalizes one candidate identity string, or undefined when it is not a usable http(s) URL. */
function urlLikeIdentity(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  try {
    return normalizeUrl(raw);
  } catch {
    return undefined;
  }
}

/**
 * Resolves common Exa identity: normalized `url`, then `uri`, then a
 * URL-like `id`. Results or statuses without one stay unidentified.
 */
function recordIdentity(record: Record<string, unknown> | undefined): string | undefined {
  return urlLikeIdentity(record?.url) ?? urlLikeIdentity(record?.uri) ?? urlLikeIdentity(record?.id);
}

function findStatusForResult(params: {
  statuses: unknown[];
  result: Record<string, unknown> | undefined;
  allowLegacyPositional: boolean;
}): unknown {
  // Status identity follows result identity through the same url/uri/URL-like
  // id rule. Position is tolerated only for the single unidentified-result
  // legacy case, never for multi-URL batches or identified results.
  const identity = recordIdentity(params.result);
  if (identity) {
    return params.statuses.find((status) => recordIdentity(asRecord(status)) === identity);
  }
  return params.allowLegacyPositional ? params.statuses[0] : undefined;
}

/**
 * Resolves the provider result allowed to satisfy one requested URL.
 *
 * URL identity is authoritative: a URL-bearing result (through `url`,
 * `uri`, or a URL-like `id`) may satisfy only the request for the same
 * normalized URL. Positional attribution survives only as legacy tolerance
 * for a single-URL batch whose only result carries no identity of its own,
 * so a partial or reordered multi-URL response can never assign one URL's
 * content to another request, and a lone unidentified result can never be
 * cross-applied to several requested URLs.
 */
function resultForRequest(
  normalizedUrl: string,
  byNormalizedUrl: Map<string, Record<string, unknown>>,
  results: Record<string, unknown>[],
  allowLegacyPositional: boolean,
): Record<string, unknown> | undefined {
  const matched = byNormalizedUrl.get(normalizedUrl);
  if (matched) return matched;
  // Legacy tolerance only for a single-URL batch whose sole result carries
  // no identity of its own: one unidentified result can never be applied to
  // several different requested URLs.
  if (!allowLegacyPositional || results.length !== 1) return undefined;
  const positional = results[0];
  return positional && !recordIdentity(positional) ? positional : undefined;
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
    const normalized = recordIdentity(result);
    if (normalized) byNormalizedUrl.set(normalized, result);
  });
  // Positional legacy tolerance requires exactly one requested URL, exactly
  // one returned result, and no url/uri/URL-like id on that result.
  const allowLegacyPositional =
    params.requestedUrls.length === 1 && results.length === 1 && !recordIdentity(results[0]);

  return params.requestedUrls.map((normalizedUrl) => {
    const result = resultForRequest(normalizedUrl, byNormalizedUrl, results, allowLegacyPositional);
    const status = result ? findStatusForResult({ statuses, result, allowLegacyPositional }) : undefined;
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
