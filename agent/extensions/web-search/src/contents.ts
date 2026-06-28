import { callExaContents } from "./api.js";
import { loadConfig, readConfiguredEnv } from "./config.js";
import { cacheKeyForUrl, normalizeUrl } from "./url.js";
import { readContentCacheEntry, writeContentCacheEntry } from "./storage.js";
import type { ContentCacheEntry, SearchConfig } from "./types.js";
import type { FormattedContentEntry } from "./format.js";
import type { SecretForRedaction } from "./redact.js";

export const DEFAULT_CONTENT_MAX_CHARACTERS = 12_000;

type ContentCacheMiss = { index: number; normalizedUrl: string; cacheKey: string };

type DedupedContentCacheMiss = {
  normalizedUrl: string;
  cacheKey: string;
  misses: ContentCacheMiss[];
};

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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function statusLabel(status: unknown): string | undefined {
  if (typeof status === "string") return status;
  const record = asRecord(status);
  if (!record) return undefined;
  const statusText = asString(record.status) ?? asString(record.error) ?? asString(record.message);
  return statusText;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

export function isCacheableContentEntry(entry: ContentCacheEntry): boolean {
  return entry.text.trim().length > 0 && !statusIndicatesFailure(entry.exaStatus);
}

export function isContentCacheEntryUsable(entry: ContentCacheEntry, requestedMaxCharacters: number): boolean {
  if (!isCacheableContentEntry(entry)) return false;
  if (!Number.isFinite(entry.requestedMaxCharacters) || entry.requestedMaxCharacters <= 0) return false;
  return entry.requestedMaxCharacters >= requestedMaxCharacters;
}

function forToolOutput(entry: ContentCacheEntry, fromCache: boolean, requestedMaxCharacters: number): FormattedContentEntry {
  const text = entry.text.length > requestedMaxCharacters ? entry.text.slice(0, requestedMaxCharacters) : entry.text;
  return { ...entry, text, fromCache, statusLabel: statusLabel(entry.exaStatus) };
}

function failedContentEntry(normalizedUrl: string, requestedMaxCharacters: number, error: unknown): ContentCacheEntry {
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
      entries[index] = forToolOutput(cached, true, maxCharacters);
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
      parsed = uniqueMisses.map((miss) => failedContentEntry(miss.normalizedUrl, maxCharacters, error));
    }

    for (let missIndex = 0; missIndex < uniqueMisses.length; missIndex += 1) {
      const missGroup = uniqueMisses[missIndex];
      const entry = parsed[missIndex];
      if (isCacheableContentEntry(entry)) {
        await writeContentCacheEntry(config.cacheDir, missGroup.cacheKey, entry, secrets);
      }
      for (const miss of missGroup.misses) {
        entries[miss.index] = forToolOutput(entry, false, maxCharacters);
      }
    }
  }

  return entries.filter(Boolean) as FormattedContentEntry[];
}
