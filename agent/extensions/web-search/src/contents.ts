/**
 * fetch_contents orchestration facade.
 *
 * Validates tool input, normalizes URLs, checks the disk cache, calls Exa
 * /contents for cache misses, and returns formatted content entries. Cache
 * policy and response parsing live in focused helper modules.
 */
import { createFailedContentEntry, dedupeContentMisses, formatContentCacheEntryForTool, isCacheableContentEntry, isContentCacheEntryUsable } from "./content-cache.js";
import { parseExaContentsResults } from "./content-parser.js";
import { callExaContents } from "./exa-contents.js";
import { loadConfig, readConfiguredEnv } from "./config.js";
import { cacheKeyForUrl, normalizeUrl } from "./url.js";
import { readContentCacheEntry, writeContentCacheEntry } from "./storage.js";
import type { ContentCacheEntry, SearchConfig } from "./types.js";
import type { FormattedContentEntry } from "./format.js";
import type { SecretForRedaction } from "./redact.js";

export const DEFAULT_CONTENT_MAX_CHARACTERS = 12_000;

type ContentCacheMiss = { index: number; normalizedUrl: string; cacheKey: string };

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${field} must be a non-empty array of non-empty strings`);
  }
  return value.map((item) => item.trim());
}

function optionalMaxCharacters(value: unknown): number {
  if (value === undefined) return DEFAULT_CONTENT_MAX_CHARACTERS;
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error("maxCharacters must be a positive integer");
  return value as number;
}

/**
 * Fetches Markdown content entries for explicit URLs, using disk cache when valid.
 *
 * @param params - Raw tool parameters plus optional injected config, Exa key, redaction secrets, and abort signal.
 * @returns Formatted content entries in the same order as the requested URIs.
 * @throws Error when input validation fails, configuration is missing, URL normalization fails, or uncached Exa /contents retrieval fails.
 */
export async function fetchContentsEntries(params: {
  rawUris: unknown;
  rawMaxCharacters?: unknown;
  signal?: AbortSignal;
  config?: SearchConfig;
  exaApiKey?: string;
  secrets?: SecretForRedaction[];
}): Promise<FormattedContentEntry[]> {
  const config = params.config ?? (await loadConfig());
  const exaApiKey = params.exaApiKey ?? readConfiguredEnv(config.exaApiKeyEnv);
  if (!exaApiKey) throw new Error(`Missing required environment variable ${config.exaApiKeyEnv}`);

  const secrets = params.secrets ?? [{ label: config.exaApiKeyEnv, value: exaApiKey }];
  const maxCharacters = optionalMaxCharacters(params.rawMaxCharacters);
  const inputUris = assertStringArray(params.rawUris, "uris");

  const normalizedRequests = inputUris.map((uri) => normalizeUrl(uri));
  const entries: Array<FormattedContentEntry | undefined> = new Array(normalizedRequests.length);
  const misses: ContentCacheMiss[] = [];

  for (let index = 0; index < normalizedRequests.length; index += 1) {
    const normalizedUrl = normalizedRequests[index];
    const cacheKey = cacheKeyForUrl(normalizedUrl);
    const cached = await readContentCacheEntry(config.cacheDir, cacheKey);
    if (cached && isContentCacheEntryUsable(cached, maxCharacters)) {
      entries[index] = formatContentCacheEntryForTool(cached, true, maxCharacters);
    } else {
      misses.push({ index, normalizedUrl, cacheKey });
    }
  }

  if (misses.length > 0) {
    const uniqueMisses = dedupeContentMisses(misses);
    let parsed: ContentCacheEntry[];
    try {
      const response = await callExaContents({
        urls: uniqueMisses.map((miss) => miss.normalizedUrl),
        maxCharacters,
        exaApiKey,
        signal: params.signal,
      });
      parsed = parseExaContentsResults({
        data: response.rawResponse.bodyJson,
        requestedUrls: uniqueMisses.map((miss) => miss.normalizedUrl),
        requestedMaxCharacters: maxCharacters,
        ttlMs: config.contentCacheTtlMs,
      });
    } catch (error) {
      if (!entries.some(Boolean)) throw error;
      parsed = uniqueMisses.map((miss) => createFailedContentEntry(miss.normalizedUrl, maxCharacters, error));
    }

    for (let missIndex = 0; missIndex < uniqueMisses.length; missIndex += 1) {
      const missGroup = uniqueMisses[missIndex];
      const entry = parsed[missIndex];
      if (isCacheableContentEntry(entry)) {
        await writeContentCacheEntry(config.cacheDir, missGroup.cacheKey, entry, secrets);
      }
      for (const miss of missGroup.misses) {
        entries[miss.index] = formatContentCacheEntryForTool(entry, false, maxCharacters);
      }
    }
  }

  return entries.filter(Boolean) as FormattedContentEntry[];
}
