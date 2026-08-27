/**
 * Content-cache policy helpers for fetch_contents.
 *
 * Exports cache miss deduplication, cacheability checks, freshness checks,
 * and conversion helpers used by the fetch_contents orchestration layer.
 * Physical retention (`expiresAt`) and per-call freshness
 * (`fetchedAt + maxAgeHours`) are deliberately separate: a stale entry stays
 * on disk for the configured TTL but cannot satisfy a fresher request.
 */
import { asFiniteNumber as asNumber, asRecord, asString } from "./value-guards.js";
import type { FormattedContentEntry } from "./format.js";
import type { ContentCacheEntry, ContentProvider } from "./types.js";

export const MS_PER_HOUR = 3_600_000;

/** Bounded generic label rendered for any failed content fetch. */
const FAILED_CONTENT_STATUS_LABEL = "fetch failed";

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

/**
 * Bounded model-visible status label for a content entry.
 *
 * Failure-like provider statuses collapse to a fixed generic label so raw
 * provider diagnostics never reach tool output or tool details. Non-failure
 * statuses surface only their short provider status field; free-text
 * `error`/`message` fields stay private.
 */
function safeStatusLabel(entry: ContentCacheEntry): string | undefined {
  const status = entryStatus(entry);
  if (status === undefined || status === null) return undefined;
  if (statusIndicatesFailure(status)) return FAILED_CONTENT_STATUS_LABEL;
  const record = asRecord(status);
  if (record) return asString(record.status);
  return typeof status === "string" ? status : undefined;
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

/** Returns the provider metadata a cache entry was written with, tolerating legacy records. */
export function providerForContentEntry(entry: ContentCacheEntry): ContentProvider | undefined {
  if (entry.provider === "firecrawl_scrape" || entry.provider === "exa_contents") return entry.provider;
  // Legacy records written before provider metadata existed came from Exa.
  return entry.exaStatus !== undefined ? "exa_contents" : undefined;
}

function entryStatus(entry: ContentCacheEntry): unknown {
  return entry.providerStatus ?? entry.exaStatus;
}

/**
 * Determines whether a fetched content entry is safe to persist in the disk cache.
 *
 * @param entry - Parsed provider content entry.
 * @returns True when the entry has non-empty text and no failure-like provider status.
 */
export function isCacheableContentEntry(entry: ContentCacheEntry): boolean {
  return entry.text.trim().length > 0 && !statusIndicatesFailure(entryStatus(entry));
}

/**
 * Determines whether a cached content entry can satisfy the current request.
 *
 * @param entry - Cached provider content entry.
 * @param requestedMaxCharacters - Current requested maximum Markdown characters per URL.
 * @param maxAgeHours - Current requested maximum content age in hours.
 * @param now - Current timestamp in milliseconds.
 * @returns True when the entry is cacheable, fresh enough, and was fetched with at least the requested character budget.
 */
export function isContentCacheEntryUsable(
  entry: ContentCacheEntry,
  requestedMaxCharacters: number,
  maxAgeHours: number,
  now: number,
): boolean {
  if (!isCacheableContentEntry(entry)) return false;
  if (!Number.isFinite(entry.requestedMaxCharacters) || entry.requestedMaxCharacters <= 0) return false;
  if (entry.requestedMaxCharacters < requestedMaxCharacters) return false;
  // Freshness is per call: the entry must be strictly younger than maxAgeHours.
  return now - entry.fetchedAt < maxAgeHours * MS_PER_HOUR;
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
  return { ...entry, text, fromCache, statusLabel: safeStatusLabel(entry) };
}

/**
 * Creates an uncached placeholder entry for a failed content fetch.
 *
 * Raw provider error text is deliberately not stored on the entry: both the
 * model-visible output and tool details render only the bounded generic
 * failure label, so provider diagnostics cannot leak through `providerStatus`.
 *
 * @param normalizedUrl - Normalized URL whose fetch failed.
 * @param requestedMaxCharacters - Requested maximum Markdown characters for the failed fetch.
 * @param provider - Provider whose attempt failed, when known.
 * @returns A non-cacheable content entry that can still be reported in this tool call.
 */
export function createFailedContentEntry(
  normalizedUrl: string,
  requestedMaxCharacters: number,
  provider?: ContentProvider,
): ContentCacheEntry {
  const now = Date.now();
  return {
    url: normalizedUrl,
    normalizedUrl,
    fetchedAt: now,
    expiresAt: now,
    requestedMaxCharacters,
    text: "",
    provider,
    providerStatus: FAILED_CONTENT_STATUS_LABEL,
  };
}
