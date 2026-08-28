/**
 * Diagnostic-record helpers for the web-search tools.
 *
 * Owns the retention bounds applied to stored diagnostic strings and provider
 * bodies, the fetch_contents stored-record builder, and the safe preflight
 * failure records persisted when a tool fails locally before any provider
 * result exists. Diagnostic writes are best-effort: they must never mask the
 * original tool error.
 */
import { createHash } from "node:crypto";
import { configLoaderFallbackCacheDirForTests, DEFAULT_CONFIG, readConfiguredEnv } from "./config.js";
import { isUsableGroundingAttempt } from "./grounding-failure.js";
import { isUsableTavilySearch } from "./tavily-search.js";
import { MAX_TAVILY_RESULTS } from "./limits.js";
import { sanitizeResponseId, writeStoredResponse } from "./storage.js";
import { stripTerminalControlSequences } from "./terminal-sanitize.js";
import { redactSecrets, redactString, type SecretForRedaction } from "./redact.js";
import type {
  CodeSearchAttempt,
  FetchContentsAttempt,
  GroundingAttempt,
  GroundingSource,
  GroundingSupport,
  RawHttpRequest,
  RawHttpResponse,
  SearchConfig,
  StoredFetchContentsResponse,
  StoredFetchResult,
  StoredPreflightRecord,
  StoredToolRecord,
  TavilySearchAttempt,
  WebSearchAttempt,
} from "./types.js";

/** Upper bound for any diagnostic string (errors, warnings, header values). */
export const DIAGNOSTIC_MAX_STRING_CHARS = 500;
/** Upper bound for a stored raw provider response body. */
export const DIAGNOSTIC_MAX_BODY_CHARS = 20_000;
/** Upper bound for any persisted URL copy; longer URLs keep a prefix plus digest. */
export const DIAGNOSTIC_MAX_URL_CHARS = 500;
/** Upper bound for the persisted query copy on main records and preflight metadata. */
export const DIAGNOSTIC_MAX_QUERY_CHARS = 2_000;
/** Upper bound for persisted grounding sources on one stored normalized response. */
export const DIAGNOSTIC_MAX_GROUNDING_SOURCES = 25;
/** Upper bound for persisted grounding supports on one stored normalized response. */
export const DIAGNOSTIC_MAX_GROUNDING_SUPPORTS = 25;
/** Upper bound for persisted generated search queries on one stored normalized response. */
export const DIAGNOSTIC_MAX_WEB_SEARCH_QUERIES = 25;
/** Upper bound for persisted grounding chunk indices on one stored support. */
export const DIAGNOSTIC_MAX_SUPPORT_CHUNK_INDICES = 25;
/** Upper bound for persisted code artifacts on one stored normalized response. */
export const DIAGNOSTIC_MAX_CODE_ARTIFACTS = 25;
/** Upper bound for persisted passages on one stored code artifact. */
export const DIAGNOSTIC_MAX_CODE_PASSAGES = 25;
/** Upper bound for persisted Tavily results on one stored normalized response. */
export const DIAGNOSTIC_MAX_TAVILY_RESULTS = MAX_TAVILY_RESULTS;
/** Upper bound for persisted Tavily result content per result. */
export const DIAGNOSTIC_MAX_TAVILY_CONTENT_CHARS = 4_000;
/** Serial bound for arbitrary provider metadata fields (coverage, cost, usage previews). */
export const DIAGNOSTIC_MAX_ARBITRARY_FIELD_CHARS = 500;
/**
 * Upper bound for persisted fetch attempts in one stored record. The
 * reachable maximum with 25 requested URLs is 25 Firecrawl Scrape attempts
 * plus one Exa Contents batch attempt.
 */
export const DIAGNOSTIC_MAX_FETCH_ATTEMPTS = 26;
/** Upper bound for persisted per-URL results in one stored record (one per requested URL). */
export const DIAGNOSTIC_MAX_FETCH_RESULTS = 25;
/** Upper bound for persisted URLs on one stored fetch attempt (one batch of at most 25 URLs). */
export const DIAGNOSTIC_MAX_ATTEMPT_URLS = 25;
/** Upper bound for persisted per-URL metadata entries on one stored fetch attempt. */
export const DIAGNOSTIC_MAX_PER_URL_ENTRIES = 25;

/** Stable generic suffix attaching a diagnostic responseId to a thrown error. */
export const DIAGNOSTIC_SUFFIX_TEMPLATE = ` Diagnostic responseId=`;

export const PREFLIGHT_CATEGORY = {
  invalidInput: "invalid_input",
  configLoadFailure: "config_load_failure",
} as const;

function truncateDiagnosticText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  // The marker is deterministic and sized so the result is exactly maxChars.
  const marker = `[truncated at ${maxChars} characters]`;
  return value.slice(0, maxChars - marker.length) + marker;
}

const URL_DIGEST_HEX_CHARS = 12;

/**
 * Bounds one URL copy for storage while keeping it identifiable.
 *
 * Complete secret values are replaced on the full URL first: bounding before
 * redaction could leave a partial secret fragment when a secret crosses the
 * cutoff. URLs at or under the bound stay readable verbatim; longer URLs
 * keep a readable prefix plus a deterministic digest of the complete
 * redacted URL, so distinct long URLs remain distinguishable.
 */
export function boundUrlForStorage(url: string, secrets: SecretForRedaction[]): string {
  const redacted = redactString(url, secrets);
  if (redacted.length <= DIAGNOSTIC_MAX_URL_CHARS) return redacted;
  const digest = createHash("sha256").update(redacted).digest("hex").slice(0, URL_DIGEST_HEX_CHARS);
  const marker = `[+sha256:${digest}]`;
  return redacted.slice(0, DIAGNOSTIC_MAX_URL_CHARS - marker.length) + marker;
}

/**
 * Bounds one diagnostic string (control sequences stripped).
 *
 * `secrets` are replaced on the complete raw value first: bounding before
 * redaction could leave a partial secret fragment when a secret crosses the
 * cutoff. Storage-level deep redaction stays as defense in depth.
 */
export function sanitizeDiagnosticText(
  value: unknown,
  secrets: SecretForRedaction[] = [],
  maxChars: number = DIAGNOSTIC_MAX_STRING_CHARS,
): string {
  const message = value instanceof Error ? value.message : String(value);
  return truncateDiagnosticText(stripTerminalControlSequences(redactString(message, secrets)), maxChars);
}

function boundHeaders(headers: Record<string, string>, secrets: SecretForRedaction[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = truncateDiagnosticText(redactString(value, secrets), DIAGNOSTIC_MAX_STRING_CHARS);
  }
  return out;
}

/** Bounds one provider query for main-record and preflight storage. */
export function boundQueryForStorage(query: string, secrets: SecretForRedaction[]): string {
  // Complete secret values are replaced on the full query before truncation
  // so a secret crossing the cutoff cannot survive as a partial fragment.
  return truncateDiagnosticText(stripTerminalControlSequences(redactString(query, secrets)), DIAGNOSTIC_MAX_QUERY_CHARS);
}

/**
 * Bounds one arbitrary provider metadata value without an unbounded escape.
 *
 * The redacted value keeps its ordinary shape only when its serialized form
 * fits `maxChars`; anything larger becomes an explicit bounded preview
 * wrapper carrying the deterministic truncation marker. Numbers, booleans,
 * and null always keep their shape, so ordinary small coverage/cost/usage
 * objects are stored unchanged when they fit. The recursive redaction and
 * serialization both run inside the catch boundary: deeply nested,
 * cyclic, or otherwise unserializable values become the constant omission
 * wrapper, so provider-controlled metadata can never throw out of record
 * construction and mask a usable tool outcome.
 */
export function boundArbitraryForStorage(value: unknown, secrets: SecretForRedaction[], maxChars: number): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  let redacted: unknown;
  let serialized: string | undefined;
  try {
    redacted = redactSecrets(value, secrets);
    serialized = JSON.stringify(redacted);
  } catch {
    // Cyclic, deeply nested (recursion overflow), or otherwise
    // unserializable values become an omission marker.
    return { diagnosticPreview: "[unserializable diagnostic value omitted]", diagnosticPreviewTruncated: false };
  }
  if (serialized === undefined) return undefined;
  if (serialized.length <= maxChars) return redacted;
  return {
    diagnosticPreview: truncateDiagnosticText(stripTerminalControlSequences(serialized), maxChars),
    diagnosticPreviewTruncated: true,
  };
}

function boundOptionalString(value: string | undefined, secrets: SecretForRedaction[]): string | undefined {
  return value !== undefined ? sanitizeDiagnosticText(value, secrets) : undefined;
}

/** Explicit bounded storage copy of one grounding normalized response. */
function boundGroundingNormalizedForStorage(
  normalized: NonNullable<GroundingAttempt["normalized"]>,
  secrets: SecretForRedaction[],
): NonNullable<GroundingAttempt["normalized"]> {
  const sources = normalized.sources.slice(0, DIAGNOSTIC_MAX_GROUNDING_SOURCES);
  const boundedSources: GroundingSource[] = sources.map((source) => ({
    groundingId: source.groundingId,
    title: boundOptionalString(source.title, secrets),
    url: source.url !== undefined ? boundUrlForStorage(source.url, secrets) : undefined,
    domain: boundOptionalString(source.domain, secrets),
  }));
  const supports = normalized.supports.slice(0, DIAGNOSTIC_MAX_GROUNDING_SUPPORTS);
  const boundedSupports: GroundingSupport[] = supports.map((support) => {
    const indices = support.groundingChunkIndices.slice(0, DIAGNOSTIC_MAX_SUPPORT_CHUNK_INDICES);
    return {
      text: sanitizeDiagnosticText(support.text, secrets),
      groundingChunkIndices: indices,
      startIndex: support.startIndex,
      endIndex: support.endIndex,
      chunkIndicesTotal: support.groundingChunkIndices.length,
      chunkIndicesOmitted: support.groundingChunkIndices.length - indices.length,
    };
  });
  const webSearchQueries = normalized.webSearchQueries.slice(0, DIAGNOSTIC_MAX_WEB_SEARCH_QUERIES);
  return {
    answer: truncateDiagnosticText(
      stripTerminalControlSequences(redactString(normalized.answer, secrets)),
      DIAGNOSTIC_MAX_BODY_CHARS,
    ),
    finishReason: boundOptionalString(normalized.finishReason, secrets),
    cleanSuccess: normalized.cleanSuccess,
    sources: boundedSources,
    sourcesTotal: normalized.sources.length,
    sourcesOmitted: normalized.sources.length - boundedSources.length,
    supports: boundedSupports,
    supportsTotal: normalized.supports.length,
    supportsOmitted: normalized.supports.length - boundedSupports.length,
    webSearchQueries: webSearchQueries.map((query) => sanitizeDiagnosticText(query, secrets)),
    webSearchQueriesTotal: normalized.webSearchQueries.length,
    webSearchQueriesOmitted: normalized.webSearchQueries.length - webSearchQueries.length,
    usage: boundArbitraryForStorage(normalized.usage, secrets, DIAGNOSTIC_MAX_BODY_CHARS),
    googleResponseId: boundOptionalString(normalized.googleResponseId, secrets),
    modelVersion: boundOptionalString(normalized.modelVersion, secrets),
    promptBlockReason: boundOptionalString(normalized.promptBlockReason, secrets),
  };
}

/** Explicit bounded storage copy of one code-search normalized response. */
function boundCodeNormalizedForStorage(
  normalized: NonNullable<CodeSearchAttempt["normalized"]>,
  secrets: SecretForRedaction[],
): NonNullable<CodeSearchAttempt["normalized"]> {
  if (!("artifacts" in normalized)) {
    return {
      response: truncateDiagnosticText(
        stripTerminalControlSequences(redactString(normalized.response, secrets)),
        DIAGNOSTIC_MAX_BODY_CHARS,
      ),
      resultsCount: normalized.resultsCount,
      requestId: boundOptionalString(normalized.requestId, secrets),
      costDollars: boundArbitraryForStorage(normalized.costDollars, secrets, DIAGNOSTIC_MAX_ARBITRARY_FIELD_CHARS),
      searchTime: normalized.searchTime,
      outputTokens: normalized.outputTokens,
    };
  }
  const artifacts = normalized.artifacts.slice(0, DIAGNOSTIC_MAX_CODE_ARTIFACTS);
  const boundedArtifacts = artifacts.map((artifact) => {
    const passages = artifact.passages.slice(0, DIAGNOSTIC_MAX_CODE_PASSAGES);
    return {
      id: boundOptionalString(artifact.id, secrets),
      type: boundOptionalString(artifact.type, secrets),
      url: artifact.url !== undefined ? boundUrlForStorage(artifact.url, secrets) : undefined,
      title: boundOptionalString(artifact.title, secrets),
      passages: passages.map((passage) => sanitizeDiagnosticText(passage, secrets)),
      passagesTotal: artifact.passages.length,
      passagesOmitted: artifact.passages.length - passages.length,
    };
  });
  return {
    success: normalized.success,
    artifacts: boundedArtifacts,
    artifactsTotal: normalized.artifacts.length,
    artifactsOmitted: normalized.artifacts.length - boundedArtifacts.length,
    coverage:
      normalized.coverage !== undefined
        ? (boundArbitraryForStorage(normalized.coverage, secrets, DIAGNOSTIC_MAX_ARBITRARY_FIELD_CHARS) as Record<
            string,
            unknown
          >)
        : undefined,
    reranked: normalized.reranked,
    resultCount: normalized.resultCount,
  };
}

/** Serializes and bounds one provider request body for storage. */
function boundSerializedBodyForStorage(body: unknown, secrets: SecretForRedaction[]): string {
  return truncateDiagnosticText(redactString(JSON.stringify(redactSecrets(body, secrets)), secrets), DIAGNOSTIC_MAX_BODY_CHARS);
}

/**
 * Bounds one raw response for storage; the parsed `bodyJson` copy is omitted
 * because the bounded `bodyText` keeps the diagnostic context once.
 */
function boundRawResponseForStorage(raw: RawHttpResponse, secrets: SecretForRedaction[]): RawHttpResponse {
  return {
    status: raw.status,
    statusText: truncateDiagnosticText(redactString(raw.statusText, secrets), DIAGNOSTIC_MAX_STRING_CHARS),
    headers: boundHeaders(raw.headers, secrets),
    bodyText: truncateDiagnosticText(redactString(raw.bodyText, secrets), DIAGNOSTIC_MAX_BODY_CHARS),
  };
}

/**
 * Bounds one raw request for storage.
 *
 * The request URL gets the same 500-character bound with digest as every
 * other persisted URL copy; headers are bounded and the body is stored as a
 * bounded serialized string.
 */
function boundRawRequestForStorage(raw: RawHttpRequest, secrets: SecretForRedaction[]): RawHttpRequest {
  return {
    method: raw.method,
    url: boundUrlForStorage(raw.url, secrets),
    headers: boundHeaders(raw.headers, secrets),
    body: raw.body !== undefined ? boundSerializedBodyForStorage(raw.body, secrets) : undefined,
  };
}

/**
 * Bounds one fetch attempt for storage without duplicating provider bodies.
 *
 * The copy is explicit, never a spread, so no provider-controlled field can
 * survive unbounded. Complete secret values are replaced before any
 * truncation so a secret crossing a cutoff can never survive as a partial
 * fragment. Every persisted URL copy is bounded with a readable prefix plus
 * digest, collection sizes are capped with retained total/omitted counts,
 * `bodyJson` is dropped on purpose, and the request body is stored as a
 * bounded serialized string exactly like the web_search and web_code_search
 * attempts.
 */
function boundFetchAttemptForStorage<T extends FetchContentsAttempt>(attempt: T, secrets: SecretForRedaction[]): T {
  const retainedUrls = attempt.urls.slice(0, DIAGNOSTIC_MAX_ATTEMPT_URLS).map((url) => boundUrlForStorage(url, secrets));
  const normalized = attempt.normalized
    ? {
        success: attempt.normalized.success,
        statusCode: attempt.normalized.statusCode,
        markdownCharacters: attempt.normalized.markdownCharacters,
        perUrl: attempt.normalized.perUrl
          ? attempt.normalized.perUrl
              .slice(0, DIAGNOSTIC_MAX_PER_URL_ENTRIES)
              .map((entry) => ({
                url: boundUrlForStorage(entry.url, secrets),
                ok: entry.ok,
                textCharacters: entry.textCharacters,
              }))
          : undefined,
        perUrlTotal: attempt.normalized.perUrl?.length,
        perUrlOmitted: attempt.normalized.perUrl
          ? attempt.normalized.perUrl.length - Math.min(attempt.normalized.perUrl.length, DIAGNOSTIC_MAX_PER_URL_ENTRIES)
          : undefined,
      }
    : undefined;
  const bounded = {
    provider: attempt.provider,
    urls: retainedUrls,
    urlsTotal: attempt.urls.length,
    urlsOmitted: attempt.urls.length - retainedUrls.length,
    requestStartedAt: attempt.requestStartedAt,
    elapsedMs: attempt.elapsedMs,
    rawRequest: attempt.rawRequest && boundRawRequestForStorage(attempt.rawRequest, secrets),
    rawResponse: attempt.rawResponse && boundRawResponseForStorage(attempt.rawResponse, secrets),
    normalized,
    status: attempt.status,
    error: attempt.error !== undefined ? sanitizeDiagnosticText(attempt.error, secrets) : undefined,
    skippedReason: attempt.skippedReason !== undefined ? sanitizeDiagnosticText(attempt.skippedReason, secrets) : undefined,
  };
  return bounded as T;
}

/**
 * Storage normalization for one grounding attempt, exported so the
 * stored-record normalization can be tested deterministically.
 *
 * The copy is explicit, never a spread, so the provider-controlled normalized
 * response (answer, sources, supports, queries, usage) is stored only through
 * its bounded copy. Headers, status text, and error strings are capped at 500
 * characters, raw bodies, answers, and usage at 20 000, with complete secret
 * values replaced before any truncation. The request body is stored as a
 * bounded serialized string and the duplicate `bodyJson` is omitted because
 * the bounded `bodyText` retains the diagnostic context.
 */
export function boundGroundingAttemptForStorage(attempt: GroundingAttempt, secrets: SecretForRedaction[]): GroundingAttempt {
  return {
    provider: attempt.provider,
    partner: attempt.partner,
    model: sanitizeDiagnosticText(attempt.model, secrets),
    requestStartedAt: attempt.requestStartedAt,
    elapsedMs: attempt.elapsedMs,
    rawRequest: attempt.rawRequest && boundRawRequestForStorage(attempt.rawRequest, secrets),
    rawResponse: attempt.rawResponse && boundRawResponseForStorage(attempt.rawResponse, secrets),
    normalized: attempt.normalized && boundGroundingNormalizedForStorage(attempt.normalized, secrets),
    error: attempt.error !== undefined ? sanitizeDiagnosticText(attempt.error, secrets) : undefined,
  };
}

/**
 * Storage normalization for one code-search attempt, exported so the
 * stored-record normalization can be tested deterministically.
 *
 * The copy is explicit, never a spread, so the provider-controlled normalized
 * response (Exa Code response text, Firecrawl artifacts/passages/coverage) is
 * stored only through its bounded copy, with the same string, body, and URL
 * bounds as the grounding attempts.
 */
export function boundCodeSearchAttemptForStorage(attempt: CodeSearchAttempt, secrets: SecretForRedaction[]): CodeSearchAttempt {
  return {
    provider: attempt.provider,
    requestStartedAt: attempt.requestStartedAt,
    elapsedMs: attempt.elapsedMs,
    rawRequest: attempt.rawRequest && boundRawRequestForStorage(attempt.rawRequest, secrets),
    rawResponse: attempt.rawResponse && boundRawResponseForStorage(attempt.rawResponse, secrets),
    normalized: attempt.normalized && boundCodeNormalizedForStorage(attempt.normalized, secrets),
    error: attempt.error !== undefined ? sanitizeDiagnosticText(attempt.error, secrets) : undefined,
  };
}

/** Explicit bounded storage copy of one Tavily normalized response. */
function boundTavilyNormalizedForStorage(
  normalized: NonNullable<TavilySearchAttempt["normalized"]>,
  secrets: SecretForRedaction[],
): NonNullable<TavilySearchAttempt["normalized"]> {
  const results = normalized.results.slice(0, DIAGNOSTIC_MAX_TAVILY_RESULTS);
  return {
    results: results.map((result) => ({
      title: sanitizeDiagnosticText(result.title, secrets),
      url: boundUrlForStorage(result.url, secrets),
      content: truncateDiagnosticText(
        stripTerminalControlSequences(redactString(result.content, secrets)),
        DIAGNOSTIC_MAX_TAVILY_CONTENT_CHARS,
      ),
      score: Number.isFinite(result.score) ? result.score : undefined,
    })),
    resultsTotal: normalized.resultsTotal,
    usableResultsCount: normalized.usableResultsCount,
    resultsOmitted: normalized.resultsOmitted,
    resultsArrayPresent: normalized.resultsArrayPresent,
    requestId: boundOptionalString(normalized.requestId, secrets),
    responseTime: Number.isFinite(normalized.responseTime) ? normalized.responseTime : undefined,
    usageCredits: Number.isFinite(normalized.usageCredits) ? normalized.usageCredits : undefined,
  };
}

/**
 * Bounded storage copy of the recorded final delivered count. Only a finite
 * nonnegative value survives, capped at the Tavily retention bound; the
 * count is copied verbatim, never recomputed from stored URLs.
 */
function boundTavilyDeliveredCountForStorage(count: number | undefined): number | undefined {
  if (count === undefined || !Number.isFinite(count) || count < 0) return undefined;
  return Math.min(Math.floor(count), DIAGNOSTIC_MAX_TAVILY_RESULTS);
}

/**
 * Storage normalization for one Tavily attempt, exported so the
 * stored-record normalization can be tested deterministically.
 *
 * The copy is explicit, never a spread, so provider-controlled Tavily values
 * are stored only through their bounded copy: at most 20 results with title
 * strings bounded at 500, URLs through the diagnostic URL bound, content
 * bounded at 4 000 per result, and only finite numeric score, response time,
 * and usage credits. Counters, results-array presence, and the recorded
 * final delivered count survive as bounded numeric fields.
 */
export function boundTavilyAttemptForStorage(attempt: TavilySearchAttempt, secrets: SecretForRedaction[]): TavilySearchAttempt {
  return {
    provider: attempt.provider,
    requestStartedAt: attempt.requestStartedAt,
    elapsedMs: attempt.elapsedMs,
    rawRequest: attempt.rawRequest && boundRawRequestForStorage(attempt.rawRequest, secrets),
    rawResponse: attempt.rawResponse && boundRawResponseForStorage(attempt.rawResponse, secrets),
    normalized: attempt.normalized && boundTavilyNormalizedForStorage(attempt.normalized, secrets),
    deliveredResultsCount: boundTavilyDeliveredCountForStorage(attempt.deliveredResultsCount),
    error: attempt.error !== undefined ? sanitizeDiagnosticText(attempt.error, secrets) : undefined,
  };
}

/**
 * Canonical stored order for fetch attempts: synchronous dispatch ordinal
 * first, start timestamp only as the fallback for attempts without one.
 */
function canonicalFetchAttemptOrder(
  a: FetchContentsAttempt & { dispatchOrdinal?: number },
  b: FetchContentsAttempt & { dispatchOrdinal?: number },
): number {
  const ordinalA = a.dispatchOrdinal ?? Number.MAX_SAFE_INTEGER;
  const ordinalB = b.dispatchOrdinal ?? Number.MAX_SAFE_INTEGER;
  if (ordinalA !== ordinalB) return ordinalA - ordinalB;
  return a.requestStartedAt.localeCompare(b.requestStartedAt);
}

/** @internal Exported only so the stored-record field contract can be tested deterministically. */
export function buildStoredFetchContentsRecord(params: {
  responseId: string;
  now: number;
  ttlMs: number;
  request: StoredFetchContentsResponse["request"];
  results: StoredFetchResult[];
  attempts: Array<FetchContentsAttempt & { dispatchOrdinal?: number }>;
  secrets: SecretForRedaction[];
}): StoredFetchContentsResponse {
  // Canonical order is synchronous dispatch order: the ordinal is assigned
  // before each attempt starts, so completion push order and equal timestamps
  // cannot reorder the record. The retention cap keeps the earliest attempts
  // in that order, and the internal ordinal is stripped after sorting and
  // never persists.
  const sortedAttempts = [...params.attempts].sort(canonicalFetchAttemptOrder);
  const retainedAttempts = sortedAttempts.slice(0, DIAGNOSTIC_MAX_FETCH_ATTEMPTS);
  const attempts = retainedAttempts.map((attempt) => {
    const bounded = boundFetchAttemptForStorage(attempt, params.secrets) as FetchContentsAttempt & {
      dispatchOrdinal?: number;
    };
    delete bounded.dispatchOrdinal;
    return bounded as FetchContentsAttempt;
  });
  const retainedResults = params.results
    .slice(0, DIAGNOSTIC_MAX_FETCH_RESULTS)
    .map((result) => ({
      normalizedUrl: boundUrlForStorage(result.normalizedUrl, params.secrets),
      provider: result.provider,
      fromCache: result.fromCache,
      // Status labels are provider-controlled strings: every stored copy is
      // redacted, terminal-stripped, and bounded to the diagnostic string cap.
      status: result.status !== null ? sanitizeDiagnosticText(result.status, params.secrets) : null,
    }));
  return {
    schemaVersion: 2,
    responseId: params.responseId,
    createdAt: params.now,
    expiresAt: params.now + params.ttlMs,
    tool: "fetch_contents",
    request: params.request,
    results: retainedResults,
    resultsTotal: params.results.length,
    resultsOmitted: params.results.length - retainedResults.length,
    attempts,
    attemptsTotal: sortedAttempts.length,
    attemptsOmitted: sortedAttempts.length - retainedAttempts.length,
  };
}

/** Settings a preflight record needs when the config may not have loaded. */
export type PreflightRecordSettings = {
  cacheDir: string;
  rawResponseTtlMs: number;
  envNames: {
    googleCloudApiKeyEnv: string;
    parallelApiKeyEnv: string;
    exaApiKeyEnv: string;
    firecrawlApiKeyEnv: string;
    tavilyApiKeyEnv: string;
  };
};

/**
 * Resolves preflight settings from the loaded config, falling back to the
 * shipped default cache directory, TTL, and credential env names when the
 * configuration itself failed to load.
 */
export function preflightSettingsFrom(config?: SearchConfig): PreflightRecordSettings {
  return {
    // The test seam's fallback dir applies only when the loader itself
    // failed, so deterministic tests never touch the live default cache.
    cacheDir: config?.cacheDir ?? configLoaderFallbackCacheDirForTests() ?? DEFAULT_CONFIG.cacheDir,
    rawResponseTtlMs: config?.rawResponseTtlMs ?? DEFAULT_CONFIG.rawResponseTtlMs,
    envNames: {
      googleCloudApiKeyEnv: config?.googleCloudApiKeyEnv ?? DEFAULT_CONFIG.googleCloudApiKeyEnv,
      parallelApiKeyEnv: config?.parallelApiKeyEnv ?? DEFAULT_CONFIG.parallelApiKeyEnv,
      exaApiKeyEnv: config?.exaApiKeyEnv ?? DEFAULT_CONFIG.exaApiKeyEnv,
      firecrawlApiKeyEnv: config?.firecrawlApiKeyEnv ?? DEFAULT_CONFIG.firecrawlApiKeyEnv,
      tavilyApiKeyEnv: config?.tavilyApiKeyEnv ?? DEFAULT_CONFIG.tavilyApiKeyEnv,
    },
  };
}

function secretsForSettings(settings: PreflightRecordSettings): SecretForRedaction[] {
  return [
    { label: settings.envNames.googleCloudApiKeyEnv, value: readConfiguredEnv(settings.envNames.googleCloudApiKeyEnv) },
    { label: settings.envNames.parallelApiKeyEnv, value: readConfiguredEnv(settings.envNames.parallelApiKeyEnv) },
    { label: settings.envNames.exaApiKeyEnv, value: readConfiguredEnv(settings.envNames.exaApiKeyEnv) },
    { label: settings.envNames.firecrawlApiKeyEnv, value: readConfiguredEnv(settings.envNames.firecrawlApiKeyEnv) },
    { label: settings.envNames.tavilyApiKeyEnv, value: readConfiguredEnv(settings.envNames.tavilyApiKeyEnv) },
  ].filter((secret) => secret.value !== undefined);
}

function boundPreflightMetadataForStorage(
  metadata: Record<string, unknown> | undefined,
  secrets: SecretForRedaction[],
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const bounded: Record<string, unknown> = {};
  if (typeof metadata.query === "string") bounded.query = boundQueryForStorage(metadata.query, secrets);
  if (typeof metadata.urlCount === "number" && Number.isInteger(metadata.urlCount) && metadata.urlCount >= 0) {
    bounded.urlCount = metadata.urlCount;
  }
  if (typeof metadata.maxCharacters === "number" && Number.isInteger(metadata.maxCharacters) && metadata.maxCharacters > 0) {
    bounded.maxCharacters = metadata.maxCharacters;
  }
  if (
    typeof metadata.maxAgeHours === "number" &&
    Number.isInteger(metadata.maxAgeHours) &&
    metadata.maxAgeHours >= 0 &&
    metadata.maxAgeHours <= 720
  ) {
    bounded.maxAgeHours = metadata.maxAgeHours;
  }
  return bounded;
}

/**
 * Persists a safe preflight failure record and never throws.
 *
 * @param params - Tool name, failure category, original error, responseId, settings, and safe metadata.
 * @returns Nothing; a failed diagnostic write is swallowed so the original tool error survives.
 */
export async function writePreflightDiagnostic(params: {
  tool: StoredPreflightRecord["tool"];
  category: string;
  error: unknown;
  responseId: string;
  settings: PreflightRecordSettings;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const secrets = secretsForSettings(params.settings);
  const now = Date.now();
  // Preflight metadata is an allow-list of scalar diagnostics. Query text is
  // redacted and bounded before truncation exactly like main-record queries.
  const metadata = boundPreflightMetadataForStorage(params.metadata, secrets);
  const record: StoredPreflightRecord = {
    schemaVersion: 2,
    responseId: params.responseId,
    createdAt: now,
    expiresAt: now + params.settings.rawResponseTtlMs,
    tool: params.tool,
    phase: "preflight",
    category: params.category,
    error: sanitizeDiagnosticText(params.error, secrets),
    metadata,
    attempts: [],
  };
  await writeDiagnosticRecordSafely(params.settings.cacheDir, record, secrets);
}

/**
 * Writes a diagnostic record best-effort.
 *
 * The record is pure diagnostics: when persistence fails, the failure is
 * swallowed so a fetch_contents call that already produced entries, or an
 * original preflight error, still reaches the caller unchanged.
 */
export async function writeDiagnosticRecordSafely(
  cacheDir: string,
  record: StoredToolRecord,
  secrets: SecretForRedaction[],
): Promise<void> {
  try {
    await writeStoredResponse(cacheDir, record, secrets);
  } catch {
    // Deliberately swallowed: diagnostics must not create tool failures.
  }
}

/** Wraps a preflight-stage error with its failure category for the catch path. */
export class PreflightFailure extends Error {
  readonly category: string;
  readonly causeError: unknown;

  constructor(category: string, cause: unknown) {
    super("preflight failure");
    this.name = "PreflightFailure";
    this.category = category;
    this.causeError = cause;
  }
}

/** Marks one synchronous preflight step so its failure is categorized. */
export function preflightStep<T>(category: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof PreflightFailure) throw error;
    throw new PreflightFailure(category, error);
  }
}

/** Marks one asynchronous preflight step so its failure is categorized. */
export async function markPreflight<T>(category: string, run: () => Promise<T> | T): Promise<T> {
  // Must await inside this try: a plain `return preflightStep(...)` would let
  // an async rejection escape the synchronous catch unwrapped.
  try {
    return await run();
  } catch (error) {
    if (error instanceof PreflightFailure) throw error;
    throw new PreflightFailure(category, error);
  }
}

/**
 * Attaches the stable generic diagnostic suffix to a thrown error.
 *
 * The responseId contains only safe identifier characters, so the suffix adds
 * no paths or provider details.
 */
export function appendDiagnosticSuffix(error: unknown, responseId: string): unknown {
  if (!(error instanceof Error)) return error;
  return new Error(`${error.message}${DIAGNOSTIC_SUFFIX_TEMPLATE}${sanitizeResponseId(responseId)}`, { cause: error });
}

function missingCredentials(error: string | undefined): boolean {
  return /missing required environment variable/i.test(error ?? "");
}

/** Safe failure category for one grounding attempt, or null when it was usable. */
export function groundingFailureCategory(attempt: GroundingAttempt): string | null {
  // HTTP status is checked first so a parsed clean-looking body on a failing
  // status can never masquerade as a usable attempt.
  const status = attempt.rawResponse?.status;
  if (typeof status !== "number") {
    if (attempt.error) return missingCredentials(attempt.error) ? "skipped_missing_credentials" : "transport_error";
    return "unusable";
  }
  if (status < 200 || status >= 300) return `http_${status}`;
  // Null exactly when the orchestrator's usability predicate accepts the
  // attempt, so details can never claim a category the routing disagrees with.
  if (isUsableGroundingAttempt(attempt)) return null;
  if (attempt.normalized?.promptBlockReason) return `blocked_${attempt.normalized.promptBlockReason}`;
  const finishReason = attempt.normalized?.finishReason;
  if (finishReason && finishReason !== "STOP") return `finish_${finishReason}`;
  return attempt.error ? "error" : "unusable";
}

/** Safe failure category for one Tavily attempt, or null when it was usable. */
export function tavilyFailureCategory(attempt: TavilySearchAttempt): string | null {
  // Status-first classification mirrors the other providers: no parsed body
  // can masquerade as usable under a failing HTTP status.
  const status = attempt.rawResponse?.status;
  if (typeof status !== "number") {
    if (attempt.error) return missingCredentials(attempt.error) ? "skipped_missing_credentials" : "transport_error";
    return "unusable";
  }
  if (status < 200 || status >= 300) return `http_${status}`;
  const normalized = attempt.normalized;
  if (!normalized) return "unparsed";
  if (normalized.resultsArrayPresent && normalized.resultsTotal === 0) return "no_results";
  // Null exactly when the routing usability predicate accepts the attempt;
  // a missing results array, an all-dropped array, or a recorded zero
  // post-redaction delivery stays unusable.
  return isUsableTavilySearch(attempt) ? null : "unusable";
}

/** Safe failure-category dispatcher for any web_search attempt. */
export function webSearchFailureCategory(attempt: WebSearchAttempt): string | null {
  return attempt.provider === "tavily-search" ? tavilyFailureCategory(attempt) : groundingFailureCategory(attempt);
}

/** Safe failure category for one code-search attempt, or null when it was usable. */
export function codeFailureCategory(attempt: CodeSearchAttempt): string | null {
  // HTTP status is checked first so a parsed body on a failing status can
  // never masquerade as a usable result.
  const status = attempt.rawResponse?.status;
  if (typeof status !== "number") {
    if (attempt.error) return missingCredentials(attempt.error) ? "skipped_missing_credentials" : "transport_error";
    return "unusable";
  }
  if (status < 200 || status >= 300) return `http_${status}`;
  const normalized = attempt.normalized;
  if (!normalized) return "unparsed";
  if ("artifacts" in normalized) {
    if (normalized.success && normalized.resultCount > 0) return null;
    return normalized.success ? "no_results" : "provider_failure";
  }
  // Exa Code: an explicit zero count is zero results even with response text;
  // non-empty text with an absent or nonzero count is usable.
  if (normalized.resultsCount === 0) return "no_results";
  if (normalized.response.trim().length > 0) return null;
  return "empty_response";
}

/** Safe failure category for one fetch_contents attempt, or null on success. */
export function fetchFailureCategory(attempt: FetchContentsAttempt): string | null {
  return attempt.status === "success" ? null : attempt.status;
}

/** Unique non-null failure categories in attempt order. */
export function uniqueFailureCategories(categories: Array<string | null>): string[] {
  const out: string[] = [];
  for (const category of categories) {
    if (category !== null && !out.includes(category)) out.push(category);
  }
  return out;
}
