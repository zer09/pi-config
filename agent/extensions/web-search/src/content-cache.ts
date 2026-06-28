/**
 * Content-cache policy helpers for fetch_contents.
 *
 * Exports cache miss deduplication, cacheability checks, and conversion helpers
 * used by the fetch_contents orchestration layer.
 */
import { asFiniteNumber as asNumber, asRecord, asString } from "./value-guards.js";
import type { FormattedContentEntry } from "./format.js";
import type { ContentCacheEntry } from "./types.js";

type ContentCacheMiss = { index: number; normalizedUrl: string; cacheKey: string };

type DedupedContentCacheMiss = {
  normalizedUrl: string;
  cacheKey: string;
  misses: ContentCacheMiss[];
};

/**
 * Groups cache misses by normalized URL while preserving original request indices.
 *
 * @param misses - Cache misses in request order.
 * @returns Deduplicated miss groups, ordered by first occurrence.
 */
export function dedupeContentMisses(misses: ContentCacheMiss[]): DedupedContentCacheMiss[] {
  const byUrl = new Map<string, DedupedContentCacheMiss>();
  for (const miss of misses) {
    let group = byUrl.get(miss.normalizedUrl);
    if (!group) {
      group = { normalizedUrl: miss.normalizedUrl, cacheKey: miss.cacheKey, misses: [] };
      byUrl.set(miss.normalizedUrl, group);
    }
    group.misses.push(miss);
  }
  return [...byUrl.values()];
}

function statusLabel(status: unknown): string | undefined {
  if (typeof status === "string") return status;
  const record = asRecord(status);
  if (!record) return undefined;
  const statusText = asString(record.status) ?? asString(record.error) ?? asString(record.message);
  return statusText;
}

function statusIndicatesFailure(status: unknown): boolean {
  const label = statusLabel(status)?.toLowerCase();
  if (label && /error|fail|failed|failure|timeout|blocked|denied|forbidden|not[_ -]?found|unavailable|invalid/.test(label)) {
    return true;
  }

  const record = asRecord(status);
  if (!record) return false;
  if (record.success === false || record.ok === false) return true;

  const code = asNumber(record.statusCode) ?? asNumber(record.httpStatus) ?? asNumber(record.code);
  return typeof code === "number" && code >= 400;
}

/**
 * Determines whether a fetched content entry is safe to persist in the disk cache.
 *
 * @param entry - Parsed Exa /contents entry.
 * @returns True when the entry has non-empty text and no failure-like Exa status.
 */
export function isCacheableContentEntry(entry: ContentCacheEntry): boolean {
  return entry.text.trim().length > 0 && !statusIndicatesFailure(entry.exaStatus);
}

/**
 * Determines whether a cached content entry can satisfy a requested maxCharacters value.
 *
 * @param entry - Cached Exa /contents entry.
 * @param requestedMaxCharacters - Current requested maximum Markdown characters per URL.
 * @returns True when the cached entry is cacheable and was fetched with at least the requested character budget.
 */
export function isContentCacheEntryUsable(entry: ContentCacheEntry, requestedMaxCharacters: number): boolean {
  if (!isCacheableContentEntry(entry)) return false;
  if (!Number.isFinite(entry.requestedMaxCharacters) || entry.requestedMaxCharacters <= 0) return false;
  return entry.requestedMaxCharacters >= requestedMaxCharacters;
}

/**
 * Converts a cache entry to the trimmed tool-output shape returned by fetch_contents.
 *
 * @param entry - Cached or freshly fetched content entry.
 * @param fromCache - Whether the entry came from disk cache.
 * @param requestedMaxCharacters - Maximum characters to expose in tool output for this call.
 * @returns The formatted content entry for tool details and output rendering.
 */
export function formatContentCacheEntryForTool(
  entry: ContentCacheEntry,
  fromCache: boolean,
  requestedMaxCharacters: number,
): FormattedContentEntry {
  const text = entry.text.length > requestedMaxCharacters ? entry.text.slice(0, requestedMaxCharacters) : entry.text;
  return { ...entry, text, fromCache, statusLabel: statusLabel(entry.exaStatus) };
}

/**
 * Creates an uncached placeholder entry for a failed Exa /contents fetch.
 *
 * @param normalizedUrl - Normalized URL whose fetch failed.
 * @param requestedMaxCharacters - Requested maximum Markdown characters for the failed fetch.
 * @param error - Error that prevented fresh content retrieval.
 * @returns A non-cacheable content entry that can still be reported in this tool call.
 */
export function createFailedContentEntry(normalizedUrl: string, requestedMaxCharacters: number, error: unknown): ContentCacheEntry {
  const now = Date.now();
  return {
    url: normalizedUrl,
    normalizedUrl,
    fetchedAt: now,
    expiresAt: now,
    requestedMaxCharacters,
    text: "",
    exaStatus: `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
  };
}
