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
import { DEFAULT_CONFIG, readConfiguredEnv } from "./config.js";
import { isUsableGroundingAttempt } from "./grounding-failure.js";
import { sanitizeResponseId, writeStoredResponse } from "./storage.js";
import { stripTerminalControlSequences } from "./terminal-sanitize.js";
import { redactSecrets, redactString, type SecretForRedaction } from "./redact.js";
import type {
  CodeSearchAttempt,
  FetchContentsAttempt,
  GroundingAttempt,
  RawHttpRequest,
  RawHttpResponse,
  SearchConfig,
  StoredFetchContentsResponse,
  StoredFetchResult,
  StoredPreflightRecord,
  StoredToolRecord,
} from "./types.js";

/** Upper bound for any diagnostic string (errors, warnings, header values). */
export const DIAGNOSTIC_MAX_STRING_CHARS = 500;
/** Upper bound for a stored raw provider response body. */
export const DIAGNOSTIC_MAX_BODY_CHARS = 20_000;
/** Upper bound for any persisted URL copy; longer URLs keep a prefix plus digest. */
export const DIAGNOSTIC_MAX_URL_CHARS = 500;
/** Upper bound for persisted fetch attempts in one stored record. */
export const DIAGNOSTIC_MAX_FETCH_ATTEMPTS = 100;
/** Upper bound for persisted per-URL results in one stored record. */
export const DIAGNOSTIC_MAX_FETCH_RESULTS = 250;
/** Upper bound for persisted URLs on one stored fetch attempt. */
export const DIAGNOSTIC_MAX_ATTEMPT_URLS = 50;
/** Upper bound for persisted per-URL metadata entries on one stored fetch attempt. */
export const DIAGNOSTIC_MAX_PER_URL_ENTRIES = 50;

/** Stable generic suffix attaching a diagnostic responseId to a thrown error. */
export const DIAGNOSTIC_SUFFIX_TEMPLATE = ` Diagnostic responseId=`;

export const PREFLIGHT_CATEGORY = {
  invalidInput: "invalid_input",
  configLoadFailure: "config_load_failure",
  missingCredentials: "missing_credentials",
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
 * Bounds one fetch attempt for storage without duplicating provider bodies.
 *
 * Complete secret values are replaced before any truncation so a secret
 * crossing a cutoff can never survive as a partial fragment. Every persisted
 * URL copy is bounded with a readable prefix plus digest, collection sizes
 * are capped with retained total/omitted counts, `bodyJson` is dropped on
 * purpose, and the request body is stored as a bounded serialized string
 * exactly like the web_search and web_code_search attempts.
 */
function boundFetchAttemptForStorage<T extends FetchContentsAttempt>(attempt: T, secrets: SecretForRedaction[]): T {
  const retainedUrls = attempt.urls.slice(0, DIAGNOSTIC_MAX_ATTEMPT_URLS).map((url) => boundUrlForStorage(url, secrets));
  const normalized = attempt.normalized?.perUrl
    ? {
        ...attempt.normalized,
        perUrl: attempt.normalized.perUrl
          .slice(0, DIAGNOSTIC_MAX_PER_URL_ENTRIES)
          .map((entry) => ({ ...entry, url: boundUrlForStorage(entry.url, secrets) })),
        perUrlTotal: attempt.normalized.perUrl.length,
        perUrlOmitted: attempt.normalized.perUrl.length - Math.min(attempt.normalized.perUrl.length, DIAGNOSTIC_MAX_PER_URL_ENTRIES),
      }
    : attempt.normalized;
  const bounded = {
    ...attempt,
    urls: retainedUrls,
    urlsTotal: attempt.urls.length,
    urlsOmitted: attempt.urls.length - retainedUrls.length,
    rawRequest: attempt.rawRequest && {
      ...attempt.rawRequest,
      url: boundUrlForStorage(attempt.rawRequest.url, secrets),
      headers: boundHeaders(attempt.rawRequest.headers, secrets),
      body:
        attempt.rawRequest.body !== undefined ? boundSerializedBodyForStorage(attempt.rawRequest.body, secrets) : undefined,
    },
    rawResponse: attempt.rawResponse && boundRawResponseForStorage(attempt.rawResponse, secrets),
    normalized,
    error: attempt.error !== undefined ? sanitizeDiagnosticText(attempt.error, secrets) : undefined,
    skippedReason: attempt.skippedReason !== undefined ? sanitizeDiagnosticText(attempt.skippedReason, secrets) : undefined,
  };
  return bounded as T;
}

/** Fields shared by web_search and web_code_search provider attempts. */
type RawAttemptFields = {
  rawRequest?: RawHttpRequest;
  rawResponse?: RawHttpResponse;
  error?: string;
};

/**
 * Storage normalization shared by web_search and web_code_search attempts.
 *
 * Headers, status text, and error strings are capped at 500 characters and
 * raw bodies at 20 000, with complete secret values replaced before any
 * truncation. The request body is stored as a bounded serialized string so no
 * unbounded nested object copy survives, and the duplicate `bodyJson` is
 * omitted because the bounded `bodyText` retains the diagnostic context.
 */
function boundSearchAttemptForStorage<T extends RawAttemptFields>(attempt: T, secrets: SecretForRedaction[]): T {
  const bounded: RawAttemptFields = {
    ...attempt,
    rawRequest: attempt.rawRequest && {
      method: attempt.rawRequest.method,
      url: attempt.rawRequest.url,
      headers: boundHeaders(attempt.rawRequest.headers, secrets),
      body: attempt.rawRequest.body !== undefined ? boundSerializedBodyForStorage(attempt.rawRequest.body, secrets) : undefined,
    },
    rawResponse: attempt.rawResponse && boundRawResponseForStorage(attempt.rawResponse, secrets),
    error: attempt.error !== undefined ? sanitizeDiagnosticText(attempt.error, secrets) : undefined,
  };
  return bounded as T;
}

/** @internal Exported so the stored-record normalization can be tested deterministically. */
export function boundGroundingAttemptForStorage(attempt: GroundingAttempt, secrets: SecretForRedaction[]): GroundingAttempt {
  return boundSearchAttemptForStorage(attempt, secrets);
}

/** @internal Exported so the stored-record normalization can be tested deterministically. */
export function boundCodeSearchAttemptForStorage(attempt: CodeSearchAttempt, secrets: SecretForRedaction[]): CodeSearchAttempt {
  return boundSearchAttemptForStorage(attempt, secrets);
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
    .map((result) => ({ ...result, normalizedUrl: boundUrlForStorage(result.normalizedUrl, params.secrets) }));
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
  };
};

/**
 * Resolves preflight settings from the loaded config, falling back to the
 * shipped default cache directory, TTL, and credential env names when the
 * configuration itself failed to load.
 */
export function preflightSettingsFrom(config?: SearchConfig): PreflightRecordSettings {
  return {
    cacheDir: config?.cacheDir ?? DEFAULT_CONFIG.cacheDir,
    rawResponseTtlMs: config?.rawResponseTtlMs ?? DEFAULT_CONFIG.rawResponseTtlMs,
    envNames: {
      googleCloudApiKeyEnv: config?.googleCloudApiKeyEnv ?? DEFAULT_CONFIG.googleCloudApiKeyEnv,
      parallelApiKeyEnv: config?.parallelApiKeyEnv ?? DEFAULT_CONFIG.parallelApiKeyEnv,
      exaApiKeyEnv: config?.exaApiKeyEnv ?? DEFAULT_CONFIG.exaApiKeyEnv,
      firecrawlApiKeyEnv: config?.firecrawlApiKeyEnv ?? DEFAULT_CONFIG.firecrawlApiKeyEnv,
    },
  };
}

function secretsForSettings(settings: PreflightRecordSettings): SecretForRedaction[] {
  return [
    { label: settings.envNames.googleCloudApiKeyEnv, value: readConfiguredEnv(settings.envNames.googleCloudApiKeyEnv) },
    { label: settings.envNames.parallelApiKeyEnv, value: readConfiguredEnv(settings.envNames.parallelApiKeyEnv) },
    { label: settings.envNames.exaApiKeyEnv, value: readConfiguredEnv(settings.envNames.exaApiKeyEnv) },
    { label: settings.envNames.firecrawlApiKeyEnv, value: readConfiguredEnv(settings.envNames.firecrawlApiKeyEnv) },
  ].filter((secret) => secret.value !== undefined);
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
  const record: StoredPreflightRecord = {
    schemaVersion: 2,
    responseId: params.responseId,
    createdAt: now,
    expiresAt: now + params.settings.rawResponseTtlMs,
    tool: params.tool,
    phase: "preflight",
    category: params.category,
    error: sanitizeDiagnosticText(params.error, secrets),
    metadata: params.metadata,
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
