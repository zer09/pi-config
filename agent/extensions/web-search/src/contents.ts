/**
 * fetch_contents orchestration facade.
 *
 * Validates tool input, normalizes URLs, checks disk-cache freshness, calls
 * Firecrawl /v2/scrape with bounded concurrency for cache misses, batches the
 * Firecrawl-failed URLs into one Exa /contents fallback call, and returns
 * formatted content entries in the original input order. Cache policy and
 * response parsing live in focused helper modules.
 */
import {
  createFailedContentEntry,
  dedupeContentMisses,
  formatContentCacheEntryForTool,
  isCacheableContentEntry,
  isContentCacheEntryUsable,
  MS_PER_HOUR,
} from "./content-cache.js";
import { parseExaContentsResults } from "./content-parser.js";
import { callExaContents } from "./exa-contents.js";
import { callFirecrawlScrape, isUsableFirecrawlScrape } from "./firecrawl-scrape.js";
import { loadConfig, readConfiguredEnv } from "./config.js";
import { MAX_CONTENT_CHARACTERS, MAX_CONTENT_CONCURRENCY, MAX_FETCH_CONTENT_URLS } from "./limits.js";
import { cacheKeyForUrl, normalizeUrl } from "./url.js";
import { readContentCacheEntry, writeContentCacheEntry } from "./storage.js";
import type {
  ContentCacheEntry,
  ContentFetchAttempt,
  FetchContentsAttempt,
  FetchContentsDiagnostics,
  SearchConfig,
} from "./types.js";
import type { FormattedContentEntry } from "./format.js";
import type { SecretForRedaction } from "./redact.js";

export const DEFAULT_CONTENT_MAX_CHARACTERS = 12_000;
export const MAX_CONTENT_AGE_HOURS = 720;

type ContentCacheMiss = { index: number; normalizedUrl: string; cacheKey: string };
type UniqueContentMiss = ReturnType<typeof dedupeContentMisses>[number];

/** Purely validated and normalized fetch_contents input; no I/O happens here. */
export type ParsedFetchContentsInput = {
  uris: string[];
  normalizedUrls: string[];
  maxCharacters: number;
  maxAgeHours: number;
};

/**
 * Config-independent validated fetch_contents input.
 *
 * `maxAgeHours` stays absent until a config supplies the default, so this
 * validation can run before any config load.
 */
export type ValidatedFetchContentsInput = {
  uris: string[];
  normalizedUrls: string[];
  maxCharacters: number;
  maxAgeHours?: number;
};

/**
 * Validates tool input and normalizes URLs without touching config, cache,
 * provider, or cache-write state, so this step can run before the config
 * load and invalid input always wins over loader failures.
 */
export function validateFetchContentsInput(params: {
  rawUris: unknown;
  rawMaxCharacters?: unknown;
  rawMaxAgeHours?: unknown;
}): ValidatedFetchContentsInput {
  const maxCharacters = optionalMaxCharacters(params.rawMaxCharacters);
  const maxAgeHours = explicitMaxAgeHours(params.rawMaxAgeHours);
  const inputUris = assertStringArray(params.rawUris, "uris");
  return { uris: inputUris, normalizedUrls: inputUris.map((uri) => normalizeUrl(uri)), maxCharacters, maxAgeHours };
}

/** Resolves the config-dependent defaults on an already validated input. */
export function resolveFetchContentsInput(
  input: ValidatedFetchContentsInput,
  defaultMaxAgeHours: number,
): ParsedFetchContentsInput {
  return { ...input, maxAgeHours: input.maxAgeHours ?? defaultMaxAgeHours };
}

/**
 * Validates tool input and normalizes URLs without touching cache, provider,
 * or cache-write state, so callers can classify these failures as invalid
 * input separately from later operational failures.
 */
export function parseFetchContentsInput(params: {
  rawUris: unknown;
  rawMaxCharacters?: unknown;
  rawMaxAgeHours?: unknown;
  defaultMaxAgeHours: number;
}): ParsedFetchContentsInput {
  return resolveFetchContentsInput(validateFetchContentsInput(params), params.defaultMaxAgeHours);
}

/** Converts one Firecrawl Scrape attempt into the stored-record attempt shape. */
function fetchAttemptFromScrape(attempt: ContentFetchAttempt, usable: boolean, aborted: boolean): FetchContentsAttempt {
  const status = attempt.error
    ? aborted
      ? "aborted"
      : "transport_error"
    : attempt.rawResponse && (attempt.rawResponse.status < 200 || attempt.rawResponse.status >= 300)
      ? "http_error"
      : usable
        ? "success"
        : "unusable_response";
  return {
    provider: "firecrawl_scrape",
    urls: [attempt.url],
    requestStartedAt: attempt.requestStartedAt,
    elapsedMs: attempt.elapsedMs,
    rawRequest: attempt.rawRequest,
    rawResponse: attempt.rawResponse,
    // Only safe lengths and statuses: the raw response body already holds
    // the provider's copy of the Markdown.
    normalized: attempt.normalized
      ? {
          success: usable,
          statusCode: attempt.normalized.statusCode,
          markdownCharacters: attempt.normalized.markdown.length,
        }
      : undefined,
    status,
    error: attempt.error,
  };
}

function makeSkippedExaAttempt(misses: UniqueContentMiss[], reason: string, dispatchOrdinal: number): FetchContentsAttempt & { dispatchOrdinal: number } {
  return {
    provider: "exa_contents",
    urls: misses.map((miss) => miss.normalizedUrl),
    requestStartedAt: new Date().toISOString(),
    elapsedMs: 0,
    status: "skipped",
    skippedReason: reason,
    dispatchOrdinal,
  };
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${field} must be a non-empty array of non-empty strings`);
  }
  if (value.length > MAX_FETCH_CONTENT_URLS) {
    throw new Error(`${field} must contain at most ${MAX_FETCH_CONTENT_URLS} URLs`);
  }
  return value.map((item) => item.trim());
}

function optionalMaxCharacters(value: unknown): number {
  if (value === undefined) return DEFAULT_CONTENT_MAX_CHARACTERS;
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error("maxCharacters must be a positive integer");
  if ((value as number) > MAX_CONTENT_CHARACTERS) {
    throw new Error(`maxCharacters must be a positive integer no greater than ${MAX_CONTENT_CHARACTERS}`);
  }
  return value as number;
}

/** Config-independent explicit maxAgeHours check; absent and null stay unresolved. */
function explicitMaxAgeHours(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_CONTENT_AGE_HOURS) {
    throw new Error(`maxAgeHours must be an integer between 0 and ${MAX_CONTENT_AGE_HOURS}`);
  }
  return value as number;
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  // Defensive ceiling: even an injected or corrupt config value can never
  // start more than MAX_CONTENT_CONCURRENCY workers at once.
  const workerCount = Math.max(1, Math.min(limit, MAX_CONTENT_CONCURRENCY, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}

function entryFromScrape(miss: { normalizedUrl: string }, markdown: string, title: string | undefined, statusCode: number | undefined, warning: string | undefined, maxCharacters: number, providerMaxAgeHours: number, ttlMs: number, now: number): ContentCacheEntry {
  return {
    url: miss.normalizedUrl,
    normalizedUrl: miss.normalizedUrl,
    fetchedAt: now,
    expiresAt: now + ttlMs,
    requestedMaxCharacters: maxCharacters,
    // The effective allowance this Firecrawl request was made under, so the
    // conservative combined-age cache check stays accurate for later calls.
    providerMaxAgeHours,
    title,
    text: markdown,
    provider: "firecrawl_scrape",
    providerStatus: { success: true, statusCode, warning },
  };
}

/**
 * Fetches Markdown content entries for explicit URLs.
 *
 * Routing per unique normalized URL: usable local disk cache, then Firecrawl
 * POST /v2/scrape, then Exa POST /contents only for URLs whose Firecrawl
 * attempt failed. Input order and duplicate URLs are preserved and partial
 * success is returned.
 *
 * @param params - Raw tool parameters plus optional injected config, provider keys, redaction secrets, abort signal, and diagnostics sink.
 * @returns Formatted content entries in the same order as the requested URIs.
 * @throws Error when input validation fails or URL normalization fails.
 */
export async function fetchContentsEntries(params: {
  rawUris: unknown;
  rawMaxCharacters?: unknown;
  rawMaxAgeHours?: unknown;
  signal?: AbortSignal;
  config?: SearchConfig;
  /** Pre-validated input from {@link parseFetchContentsInput}; skips re-parsing when supplied. */
  input?: ParsedFetchContentsInput;
  exaApiKey?: string;
  firecrawlApiKey?: string;
  secrets?: SecretForRedaction[];
  diagnostics?: FetchContentsDiagnostics;
}): Promise<FormattedContentEntry[]> {
  // Config-independent validation runs before the config load so an invalid
  // direct call fails as invalid input even when no config can load.
  const validatedInput = params.input
    ? undefined
    : validateFetchContentsInput({
        rawUris: params.rawUris,
        rawMaxCharacters: params.rawMaxCharacters,
        rawMaxAgeHours: params.rawMaxAgeHours,
      });
  const config = params.config ?? (await loadConfig());
  const diagnostics = params.diagnostics;
  const exaApiKey = params.exaApiKey ?? readConfiguredEnv(config.exaApiKeyEnv);
  const firecrawlApiKey = params.firecrawlApiKey ?? readConfiguredEnv(config.firecrawlApiKeyEnv);
  const secrets =
    params.secrets ??
    [
      { label: config.googleCloudApiKeyEnv, value: readConfiguredEnv(config.googleCloudApiKeyEnv) },
      { label: config.parallelApiKeyEnv, value: readConfiguredEnv(config.parallelApiKeyEnv) },
      { label: config.exaApiKeyEnv, value: exaApiKey },
      { label: config.firecrawlApiKeyEnv, value: firecrawlApiKey },
    ].filter((secret) => secret.value !== undefined);

  // The absent maxAgeHours default resolves only now, from the loaded config.
  const input = params.input ?? resolveFetchContentsInput(validatedInput!, config.contents.defaultMaxAgeHours);
  const maxCharacters = input.maxCharacters;
  const maxAgeHours = input.maxAgeHours;
  const now = Date.now();

  const normalizedRequests = input.normalizedUrls;
  const entries: Array<FormattedContentEntry | undefined> = new Array(normalizedRequests.length);
  const misses: ContentCacheMiss[] = [];

  for (let index = 0; index < normalizedRequests.length; index += 1) {
    const normalizedUrl = normalizedRequests[index]!;
    const cacheKey = cacheKeyForUrl(normalizedUrl);
    // maxAgeHours 0 bypasses the local cache entirely: no read for satisfaction.
    const cached = maxAgeHours > 0 ? await readContentCacheEntry(config.cacheDir, cacheKey) : null;
    if (cached && isContentCacheEntryUsable(cached, maxCharacters, maxAgeHours, now)) {
      entries[index] = formatContentCacheEntryForTool(cached, true, maxCharacters);
    } else {
      misses.push({ index, normalizedUrl, cacheKey });
    }
  }

  if (misses.length > 0) {
    const uniqueMisses = dedupeContentMisses(misses);
    // Assigned synchronously before each attempt starts: the strictly
    // increasing ordinal is the canonical stored order even when concurrent
    // attempts complete out of dispatch order or share a timestamp.
    let dispatchOrdinal = 0;
    const nextDispatchOrdinal = (): number => {
      const ordinal = dispatchOrdinal;
      dispatchOrdinal += 1;
      return ordinal;
    };
    const scraped: Array<ContentCacheEntry | undefined> = await runWithConcurrency(
      uniqueMisses,
      config.contents.concurrency,
      async (miss) => {
        const ordinal = nextDispatchOrdinal();
        const attempt = await callFirecrawlScrape({
          url: miss.normalizedUrl,
          maxAgeMs: maxAgeHours * MS_PER_HOUR,
          timeoutMs: config.contents.scrapeTimeoutMs,
          firecrawlApiKey,
          signal: params.signal,
        });
        const usable = isUsableFirecrawlScrape(attempt);
        // The attempt is recorded whether it succeeded or failed so stored
        // diagnostics keep the Firecrawl failure context.
        diagnostics?.attempts.push({ ...fetchAttemptFromScrape(attempt, usable, params.signal?.aborted === true), dispatchOrdinal: ordinal });
        if (usable) {
          return entryFromScrape(
            miss,
            attempt.normalized!.markdown,
            attempt.normalized!.title,
            attempt.normalized!.statusCode,
            attempt.normalized!.warning,
            maxCharacters,
            maxAgeHours,
            config.contentCacheTtlMs,
            Date.now(),
          );
        }
        return undefined;
      },
    );

    // Only the Firecrawl-failed URLs move on to the Exa Contents fallback.
    const exaMisses: typeof uniqueMisses = [];
    for (let index = 0; index < uniqueMisses.length; index += 1) {
      if (scraped[index] === undefined) exaMisses.push(uniqueMisses[index]!);
    }

    let exaEntries: Array<ContentCacheEntry | undefined> = [];
    if (exaMisses.length > 0 && !params.signal?.aborted) {
      if (!exaApiKey) {
        diagnostics?.attempts.push(
          makeSkippedExaAttempt(exaMisses, `Missing required environment variable ${config.exaApiKeyEnv}`, nextDispatchOrdinal()),
        );
        exaEntries = exaMisses.map((miss) => createFailedContentEntry(miss.normalizedUrl, maxCharacters, "exa_contents"));
      } else {
        const exaOrdinal = nextDispatchOrdinal();
        // The captured exchange is kept even for HTTP/transport failures so
        // the raw Exa failure context reaches the diagnostic record instead
        // of being discarded by an exception.
        const raw = await callExaContents({
          urls: exaMisses.map((miss) => miss.normalizedUrl),
          maxCharacters,
          maxAgeHours,
          exaApiKey,
          signal: params.signal,
        });
        const status = raw.rawResponse?.status;
        const httpOk = !raw.error && typeof status === "number" && status >= 200 && status < 300;
        let parsed: ContentCacheEntry[] | null = null;
        let parseError: string | undefined;
        if (httpOk) {
          try {
            parsed = parseExaContentsResults({
              data: raw.rawResponse!.bodyJson,
              requestedUrls: exaMisses.map((miss) => miss.normalizedUrl),
              requestedMaxCharacters: maxCharacters,
              providerMaxAgeHours: maxAgeHours,
              ttlMs: config.contentCacheTtlMs,
            });
          } catch (error) {
            parseError = error instanceof Error ? error.message : String(error);
          }
        }
        // The same usability predicate as returned/cacheable entries decides
        // per-URL and batch success: a 2xx batch whose results are all empty
        // or failure-status is unusable, while one usable URL keeps the batch
        // attempt successful and the failed URLs become generic failures.
        const perUrl = parsed
          ? parsed.map((entry, index) => ({
              url: exaMisses[index]!.normalizedUrl,
              ok: isCacheableContentEntry(entry),
              textCharacters: entry.text.length,
            }))
          : undefined;
        const anyUsable = perUrl !== undefined && perUrl.some((entry) => entry.ok);
        diagnostics?.attempts.push({
          provider: "exa_contents",
          urls: exaMisses.map((miss) => miss.normalizedUrl),
          requestStartedAt: raw.requestStartedAt,
          elapsedMs: raw.elapsedMs,
          rawRequest: raw.rawRequest,
          rawResponse: raw.rawResponse,
          dispatchOrdinal: exaOrdinal,
          normalized: perUrl ? { success: anyUsable, perUrl } : undefined,
          status: raw.error
            ? params.signal?.aborted === true
              ? "aborted"
              : "transport_error"
            : httpOk
              ? anyUsable
                ? "success"
                : "unusable_response"
              : "http_error",
          error: raw.error ?? parseError,
        });
        if (!parsed) {
          // Raw provider error text stays out of the entry: failed entries render
          // only the bounded generic failure status in model-visible output.
          parsed = exaMisses.map((miss) => createFailedContentEntry(miss.normalizedUrl, maxCharacters, "exa_contents"));
        }
        exaEntries = parsed.map((entry) => (isCacheableContentEntry(entry) ? entry : undefined));
        // Entries both providers failed to fill become structured failures.
        exaEntries = exaEntries.map((entry, index) =>
          entry ??
          createFailedContentEntry(
            exaMisses[index]!.normalizedUrl,
            maxCharacters,
            "exa_contents",
          ),
        );
      }
    } else if (exaMisses.length > 0) {
      diagnostics?.attempts.push(makeSkippedExaAttempt(exaMisses, "aborted before Exa Contents fallback", nextDispatchOrdinal()));
    }

    const resolved: Array<ContentCacheEntry | undefined> = scraped.map((entry, index) => {
      if (entry) return entry;
      const exaIndex = exaMisses.indexOf(uniqueMisses[index]!);
      return exaIndex >= 0 ? exaEntries[exaIndex] : undefined;
    });

    for (let index = 0; index < uniqueMisses.length; index += 1) {
      const missGroup = uniqueMisses[index]!;
      const entry = resolved[index] ?? createFailedContentEntry(missGroup.normalizedUrl, maxCharacters);
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
