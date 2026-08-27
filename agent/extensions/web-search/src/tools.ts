import { callExaCodeSearch, isUsableExaCodeSearch } from "./exa-code.js";
import { callFirecrawlDeveloperSearch, isUsableFirecrawlDeveloperSearch } from "./firecrawl-developer.js";
import {
  callGeminiExaGroundingAttempts,
  callGeminiParallelGrounding,
} from "./gemini-grounding.js";
import {
  classifyPrimaryFailure,
  fallbackReasonFromGrounding,
  isGroundingFallbackAllowed,
  isUsableGroundingAttempt,
} from "./grounding-failure.js";
import { fetchContentsEntries, resolveFetchContentsInput, validateFetchContentsInput } from "./contents.js";
import {
  appendDiagnosticSuffix,
  boundCodeSearchAttemptForStorage,
  boundGroundingAttemptForStorage,
  boundQueryForStorage,
  boundUrlForStorage,
  buildStoredFetchContentsRecord,
  codeFailureCategory,
  fetchFailureCategory,
  groundingFailureCategory,
  markPreflight,
  preflightSettingsFrom,
  preflightStep,
  PREFLIGHT_CATEGORY,
  PreflightFailure,
  uniqueFailureCategories,
  writeDiagnosticRecordSafely,
  writePreflightDiagnostic,
} from "./diagnostics.js";
import {
  formatCleanGeminiSuccess,
  formatCodeSearchResult,
  formatCodeSearchUnavailable,
  formatFetchedContents,
  formatWebSearchUnavailable,
} from "./format.js";
import type { FormattedContentEntry } from "./format.js";
import { loadConfig, readConfiguredEnv } from "./config.js";
import {
  createWebSearchCallRenderer,
  createWebSearchResultRenderer,
} from "./render.js";
import {
  fetchContentsSchema,
  webCodeSearchSchema,
  webSearchSchema,
} from "./schemas.js";
import { generateResponseId } from "./storage.js";
import { providerForContentEntry } from "./content-cache.js";
import { DEFAULT_CONTENT_MAX_CHARACTERS, MAX_CONTENT_AGE_HOURS } from "./contents.js";
import type {
  CodeSearchAttempt,
  CodeSearchFocus,
  ExtensionContextLike,
  FetchContentsDiagnostics,
  GroundingAttempt,
  SearchConfig,
  StoredCodeSearchResponse,
  StoredFetchResult,
  StoredSearchResponse,
  ToolRegistration,
  ToolResult,
  WebSearchDepth,
} from "./types.js";
import type { SecretForRedaction } from "./redact.js";

/** Options injected by deterministic tests; production calls omit them. */
export type ExecuteOptions = {
  config?: SearchConfig;
};

function assertQuery(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error("query must be a non-empty string");
  return value.trim();
}

function asParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("parameters must be an object");
  return value as Record<string, unknown>;
}

function assertDepth(value: unknown, fallback: WebSearchDepth): WebSearchDepth {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === "standard" || value === "deep") return value;
  throw new Error("depth must be one of: standard, deep");
}

function assertFocus(value: unknown): CodeSearchFocus {
  if (value === "developer_sources" || value === "implementation_examples") return value;
  throw new Error("focus must be one of: developer_sources, implementation_examples");
}

function buildSecrets(
  configEnv: {
    googleCloudApiKeyEnv: string;
    parallelApiKeyEnv: string;
    exaApiKeyEnv: string;
    firecrawlApiKeyEnv: string;
  },
  keys: { google?: string; parallel?: string; exa?: string; firecrawl?: string },
): SecretForRedaction[] {
  return [
    { label: configEnv.googleCloudApiKeyEnv, value: keys.google },
    { label: configEnv.parallelApiKeyEnv, value: keys.parallel },
    { label: configEnv.exaApiKeyEnv, value: keys.exa },
    { label: configEnv.firecrawlApiKeyEnv, value: keys.firecrawl },
  ];
}

function makeSkippedGrounding(
  provider: "gemini-parallel-grounding" | "gemini-exa-grounding",
  partner: "parallel" | "exa",
  model: string,
  reason: string,
): GroundingAttempt {
  return {
    provider,
    partner,
    model,
    requestStartedAt: new Date().toISOString(),
    elapsedMs: 0,
    error: reason,
  };
}

function makeSkippedCodeAttempt(
  provider: CodeSearchAttempt["provider"],
  reason: string,
): CodeSearchAttempt {
  return {
    provider,
    requestStartedAt: new Date().toISOString(),
    elapsedMs: 0,
    error: reason,
  };
}

/** @internal Exported only so the stored-record field contract can be tested deterministically. */
export function buildStoredRecord(params: {
  responseId: string;
  now: number;
  ttlMs: number;
  query: string;
  depth: WebSearchDepth;
  parallelAttempts: [GroundingAttempt, ...GroundingAttempt[]];
  exaAttempts: GroundingAttempt[];
  selected: GroundingAttempt | undefined;
  secrets: SecretForRedaction[];
}): StoredSearchResponse {
  // Every stored attempt and every legacy mirror derives from these bounded
  // copies so raw unbounded values cannot re-enter the record.
  const parallelAttempts = params.parallelAttempts.map((attempt) => boundGroundingAttemptForStorage(attempt, params.secrets));
  const exaAttempts = params.exaAttempts.map((attempt) => boundGroundingAttemptForStorage(attempt, params.secrets));
  const rawAttempts = [...params.parallelAttempts, ...params.exaAttempts];
  const boundedAttempts = [...parallelAttempts, ...exaAttempts];
  const selected = params.selected === undefined ? undefined : boundedAttempts[rawAttempts.indexOf(params.selected)];
  const primary = parallelAttempts[parallelAttempts.length - 1]!;
  const fallback = exaAttempts.length > 0 ? exaAttempts[exaAttempts.length - 1]! : null;
  // Legacy top-level fields keep describing the final selected attempt so
  // existing raw-response consumers stay correct while history is preserved.
  return {
    schemaVersion: 2,
    responseId: params.responseId,
    createdAt: params.now,
    expiresAt: params.now + params.ttlMs,
    tool: "web_search",
    depth: params.depth,
    selectedProvider: selected?.provider ?? "none",
    query: boundQueryForStorage(params.query, params.secrets),
    model: primary.model,
    attempts: boundedAttempts,
    provider: selected?.provider ?? primary.provider,
    request: selected?.rawRequest ?? primary.rawRequest,
    response: selected?.rawResponse ?? primary.rawResponse,
    primary,
    // `primary` already is the only Parallel attempt, so history is stored only
    // when a retry actually produced a second attempt.
    primaryAttempts: parallelAttempts.length > 1 ? parallelAttempts : undefined,
    normalized: selected?.normalized ?? null,
    fallback,
    googleResponseId: selected?.normalized?.googleResponseId,
  };
}

function attemptsForRecord(record: StoredSearchResponse): GroundingAttempt[] {
  if (record.attempts?.length) return record.attempts;
  return record.primaryAttempts?.length ? record.primaryAttempts : [record.primary];
}

export function detailsForSearch(
  record: StoredSearchResponse,
  elapsedMs?: number,
): Record<string, unknown> {
  const attempts = attemptsForRecord(record);
  const primaryAttempts = record.primaryAttempts?.length ? record.primaryAttempts : [record.primary];
  const primaryFinal = primaryAttempts[primaryAttempts.length - 1]!;
  const geminiAnswered = record.normalized != null;
  const fallbackUsed = record.fallback !== null;
  // Grounding counts describe a Gemini answer; reporting them for a failed
  // chain would claim a successful search found nothing.
  return {
    responseId: record.responseId,
    googleResponseId: record.googleResponseId ?? null,
    depth: record.depth ?? "standard",
    answerProvider: geminiAnswered ? record.selectedProvider ?? record.provider : null,
    selectedProvider: record.selectedProvider ?? null,
    primaryProvider: "gemini-parallel-grounding",
    primaryStatus: primaryFinal.rawResponse?.status ?? null,
    primaryFinishReason: primaryFinal.normalized?.finishReason ?? null,
    primaryFirstFailureCode: classifyPrimaryFailure(primaryAttempts[0]!) ?? null,
    primaryFinalFailureCode: classifyPrimaryFailure(primaryFinal) ?? null,
    attemptCount: attempts.length,
    attemptProviders: attempts.map((attempt) => attempt.provider),
    failureCategories: uniqueFailureCategories(attempts.map((attempt) => groundingFailureCategory(attempt))),
    fallbackUsed,
    fallbackFrom: fallbackUsed ? "parallel" : null,
    // Derived from the bounded stored primary attempt, so an embedded error
    // string is already redacted and capped at the diagnostic string bound.
    fallbackReason: fallbackUsed ? fallbackReasonFromGrounding(primaryFinal) : null,
    sourceCount: geminiAnswered ? record.normalized?.sourcesTotal ?? record.normalized?.sources.length ?? null : null,
    supportCount: geminiAnswered ? record.normalized?.supportsTotal ?? record.normalized?.supports.length ?? null : null,
    queryCount: geminiAnswered
      ? record.normalized?.webSearchQueriesTotal ?? record.normalized?.webSearchQueries.length ?? null
      : null,
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
}

/** @internal Exported only so the stored-record field contract can be tested deterministically. */
export function buildStoredCodeSearchRecord(params: {
  responseId: string;
  now: number;
  ttlMs: number;
  query: string;
  focus: CodeSearchFocus;
  attempts: CodeSearchAttempt[];
  selected: CodeSearchAttempt | undefined;
  degraded: boolean;
  secrets: SecretForRedaction[];
}): StoredCodeSearchResponse {
  // Storage normalization happens here, before record construction, so no
  // unbounded raw value can reach persistence.
  const attempts = params.attempts.map((attempt) => boundCodeSearchAttemptForStorage(attempt, params.secrets));
  const selected = params.selected === undefined ? undefined : attempts[params.attempts.indexOf(params.selected)];
  return {
    schemaVersion: 2,
    responseId: params.responseId,
    createdAt: params.now,
    expiresAt: params.now + params.ttlMs,
    tool: "web_code_search",
    focus: params.focus,
    selectedProvider: selected?.provider ?? "none",
    query: boundQueryForStorage(params.query, params.secrets),
    attempts,
    degraded: params.degraded,
  };
}

function codeSearchResultCount(attempt: CodeSearchAttempt | undefined): number | null {
  const normalized = attempt?.normalized;
  if (!normalized) return null;
  if ("artifacts" in normalized) return normalized.resultCount;
  return normalized.resultsCount ?? null;
}

export function detailsForCodeSearch(
  record: StoredCodeSearchResponse,
  elapsedMs?: number,
): Record<string, unknown> {
  const attempts = record.attempts?.length ? record.attempts : [];
  const selected = attempts.find((attempt) => attempt.provider === record.selectedProvider);
  const fallbackUsed = record.selectedProvider !== "none" && attempts.length > 1;
  const normalized = selected?.normalized;
  const details: Record<string, unknown> = {
    responseId: record.responseId,
    focus: record.focus,
    answerProvider: record.selectedProvider === "none" ? null : record.selectedProvider,
    selectedProvider: record.selectedProvider === "none" ? null : record.selectedProvider,
    attemptCount: attempts.length,
    attemptProviders: attempts.map((attempt) => attempt.provider),
    failureCategories: uniqueFailureCategories(attempts.map((attempt) => codeFailureCategory(attempt))),
    fallbackUsed,
    fallbackFrom: fallbackUsed ? attempts[0]?.provider ?? null : null,
    degraded: record.degraded,
    resultCount: codeSearchResultCount(selected),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
  if (normalized && "artifacts" in normalized) {
    details.coverage = normalized.coverage ?? null;
    details.reranked = normalized.reranked ?? null;
  }
  if (normalized && "response" in normalized) {
    details.requestId = normalized.requestId ?? null;
  }
  return details;
}

/** Safe request metadata for a fetch_contents preflight record; never stores URI values. */
function safeFetchRequestMetadata(rawParams: unknown): Record<string, unknown> {
  if (!rawParams || typeof rawParams !== "object" || Array.isArray(rawParams)) return {};
  const params = rawParams as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  if (Array.isArray(params.uris)) metadata.urlCount = params.uris.length;
  const maxCharacters = params.maxCharacters;
  if (typeof maxCharacters === "number" && Number.isInteger(maxCharacters) && maxCharacters > 0) {
    metadata.maxCharacters = maxCharacters;
  }
  const maxAgeHours = params.maxAgeHours;
  if (typeof maxAgeHours === "number" && Number.isInteger(maxAgeHours) && maxAgeHours >= 0 && maxAgeHours <= MAX_CONTENT_AGE_HOURS) {
    metadata.maxAgeHours = maxAgeHours;
  }
  return metadata;
}

/** Providers that produced non-empty content, in first-result order. */
function resultProviders(entries: FormattedContentEntry[]): string[] {
  const providers: string[] = [];
  for (const entry of entries) {
    if (entry.text.trim().length === 0) continue;
    const provider = providerForContentEntry(entry);
    if (provider && !providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

/** Safe per-URL result metadata for the stored fetch_contents record. */
function storedFetchResults(entries: FormattedContentEntry[]): StoredFetchResult[] {
  return entries.map((entry) => ({
    normalizedUrl: entry.normalizedUrl,
    provider: providerForContentEntry(entry) ?? null,
    fromCache: entry.fromCache,
    status: entry.statusLabel ?? null,
  }));
}

export async function executeWebSearch(
  rawParams: unknown,
  signal?: AbortSignal,
  options?: ExecuteOptions,
): Promise<ToolResult> {
  // Generated at execution start so preflight failures are diagnosable too.
  const responseId = generateResponseId();
  const startedAt = Date.now();
  let config: SearchConfig | undefined;
  try {
    const params = preflightStep(PREFLIGHT_CATEGORY.invalidInput, () => asParams(rawParams));
    // Config resolves before field validation so invalid-input records can
    // use the configured cache directory instead of the default fallback.
    config = await markPreflight(PREFLIGHT_CATEGORY.configLoadFailure, async () => options?.config ?? loadConfig());
    const query = preflightStep(PREFLIGHT_CATEGORY.invalidInput, () => assertQuery(params.query));
    const depth = preflightStep(PREFLIGHT_CATEGORY.invalidInput, () => assertDepth(params.depth, config!.webSearch.defaultDepth));

    // Both grounding partners share the Google transport, so a missing Google
    // credential is terminal for web_search: no Exa grounding attempt is made.
    const googleCloudApiKey = readConfiguredEnv(config.googleCloudApiKeyEnv);
    if (!googleCloudApiKey) {
      throw new PreflightFailure(
        PREFLIGHT_CATEGORY.missingCredentials,
        new Error(`Missing required environment variable ${config.googleCloudApiKeyEnv}`),
      );
    }

  const parallelApiKey = readConfiguredEnv(config.parallelApiKeyEnv);
  const exaApiKey = readConfiguredEnv(config.exaApiKeyEnv);
  const secrets = buildSecrets(config, {
    google: googleCloudApiKey,
    parallel: parallelApiKey,
    exa: exaApiKey,
    firecrawl: readConfiguredEnv(config.firecrawlApiKeyEnv),
  });

  const mode = depth === "deep" ? config.webSearch.parallel.deepMode : config.webSearch.parallel.standardMode;
  const parallelAttempts: [GroundingAttempt, ...GroundingAttempt[]] = [
    await callGeminiParallelGrounding({
      query,
      googleCloudApiKey,
      parallelApiKey,
      mode,
      model: config.model,
      signal,
    }),
  ];
  const parallelFinal = parallelAttempts[0]!;

  let selected: GroundingAttempt | undefined;
  let exaAttempts: GroundingAttempt[] = [];
  if (isUsableGroundingAttempt(parallelFinal)) {
    selected = parallelFinal;
  } else if (isGroundingFallbackAllowed(parallelFinal, signal)) {
    if (!exaApiKey) {
      exaAttempts = [
        makeSkippedGrounding(
          "gemini-exa-grounding",
          "exa",
          config.model,
          `Missing required environment variable ${config.exaApiKeyEnv}`,
        ),
      ];
    } else {
      const budget = depth === "deep" ? config.webSearch.exa.deep : config.webSearch.exa.standard;
      exaAttempts = await callGeminiExaGroundingAttempts({
        query,
        googleCloudApiKey,
        exaApiKey,
        budget,
        model: config.model,
        signal,
      });
      const exaFinal = exaAttempts[exaAttempts.length - 1]!;
      if (isUsableGroundingAttempt(exaFinal)) selected = exaFinal;
    }
  }

  const record = buildStoredRecord({
    responseId,
    now: Date.now(),
    ttlMs: config.rawResponseTtlMs,
    query,
    depth,
    parallelAttempts,
    exaAttempts,
    selected,
    secrets,
  });
  // Best-effort: a failed diagnostic write must not mask a usable answer or
  // an unavailable-provider outcome the providers already produced.
  await writeDiagnosticRecordSafely(config.cacheDir, record, secrets);

  if (selected?.normalized) {
    return {
      content: [
        {
          type: "text",
          text: formatCleanGeminiSuccess(selected.normalized, responseId),
        },
      ],
      details: detailsForSearch(record, Date.now() - startedAt),
    };
  }

  return {
    content: [{ type: "text", text: formatWebSearchUnavailable() }],
    details: detailsForSearch(record, Date.now() - startedAt),
  };
  } catch (error) {
    if (error instanceof PreflightFailure) {
      // The record keeps only safe metadata; a failed write must not mask
      // the original tool error.
      await writePreflightDiagnostic({
        tool: "web_search",
        category: error.category,
        error: error.causeError,
        responseId,
        settings: preflightSettingsFrom(config),
        metadata: safeQueryMetadata(rawParams),
      });
      throw appendDiagnosticSuffix(error.causeError, responseId);
    }
    throw error;
  }
}

/** Safe query metadata for search-tool preflight records; stores nothing when the query was not a valid string. */
function safeQueryMetadata(rawParams: unknown): Record<string, unknown> | undefined {
  if (!rawParams || typeof rawParams !== "object" || Array.isArray(rawParams)) return undefined;
  const query = (rawParams as Record<string, unknown>).query;
  return typeof query === "string" && query.trim().length > 0 ? { query: query.trim() } : undefined;
}

export async function executeWebCodeSearch(
  rawParams: unknown,
  signal?: AbortSignal,
  options?: ExecuteOptions,
): Promise<ToolResult> {
  // Generated at execution start so preflight failures are diagnosable too.
  const responseId = generateResponseId();
  const startedAt = Date.now();
  let config: SearchConfig | undefined;
  try {
    const params = preflightStep(PREFLIGHT_CATEGORY.invalidInput, () => asParams(rawParams));
    // Config resolves before field validation so invalid-input records can
    // use the configured cache directory instead of the default fallback.
    config = await markPreflight(PREFLIGHT_CATEGORY.configLoadFailure, async () => options?.config ?? loadConfig());
    const query = preflightStep(PREFLIGHT_CATEGORY.invalidInput, () => assertQuery(params.query));
    const focus = preflightStep(PREFLIGHT_CATEGORY.invalidInput, () => assertFocus(params.focus));
    // Immutable alias so closures below keep the narrowed type.
    const cfg: SearchConfig = config;

  const exaApiKey = readConfiguredEnv(cfg.exaApiKeyEnv);
  const firecrawlApiKey = readConfiguredEnv(cfg.firecrawlApiKeyEnv);
  const secrets = buildSecrets(cfg, {
    google: readConfiguredEnv(cfg.googleCloudApiKeyEnv),
    parallel: readConfiguredEnv(cfg.parallelApiKeyEnv),
    exa: exaApiKey,
    firecrawl: firecrawlApiKey,
  });

  const firecrawlCall = (types?: string[]) =>
    callFirecrawlDeveloperSearch({
      query,
      k: cfg.codeSearch.firecrawl.k,
      passages: cfg.codeSearch.firecrawl.passages,
      types,
      firecrawlApiKey,
      signal,
    });
  const exaCodeCall = () =>
    exaApiKey
      ? callExaCodeSearch({
          query,
          exaApiKey,
          tokensNum: cfg.codeSearch.exaCode.tokensNum,
          signal,
        })
      : Promise.resolve(
          makeSkippedCodeAttempt("exa-code", `Missing required environment variable ${cfg.exaApiKeyEnv}`),
        );

  const attempts: CodeSearchAttempt[] = [];
  let selected: CodeSearchAttempt | undefined;
  let degraded = false;

  const runFirecrawl = async (types?: string[]) => {
    const attempt = await firecrawlCall(types);
    attempts.push(attempt);
    if (isUsableFirecrawlDeveloperSearch(attempt)) selected = attempt;
  };
  const runExaCode = async () => {
    const attempt = await exaCodeCall();
    attempts.push(attempt);
    if (isUsableExaCodeSearch(attempt)) selected = attempt;
  };

  if (focus === "developer_sources") {
    await runFirecrawl();
    if (!selected && !signal?.aborted) {
      degraded = true;
      await runExaCode();
    }
  } else {
    await runExaCode();
    if (!selected && !signal?.aborted) {
      // The implementation-examples fallback is restricted to stable
      // documentation artifacts: doc and readme result types only.
      await runFirecrawl(["doc", "readme"]);
    }
  }

  const record = buildStoredCodeSearchRecord({
    responseId,
    now: Date.now(),
    ttlMs: cfg.rawResponseTtlMs,
    query,
    focus,
    attempts,
    selected,
    degraded,
    secrets,
  });
  // Best-effort: a failed diagnostic write must not mask a usable result or
  // an unavailable-provider outcome the providers already produced.
  await writeDiagnosticRecordSafely(cfg.cacheDir, record, secrets);

  if (selected?.normalized) {
    return {
      content: [{ type: "text", text: formatCodeSearchResult(query, selected.normalized) }],
      details: detailsForCodeSearch(record, Date.now() - startedAt),
    };
  }

  return {
    content: [{ type: "text", text: formatCodeSearchUnavailable() }],
    details: detailsForCodeSearch(record, Date.now() - startedAt),
  };
  } catch (error) {
    if (error instanceof PreflightFailure) {
      await writePreflightDiagnostic({
        tool: "web_code_search",
        category: error.category,
        error: error.causeError,
        responseId,
        settings: preflightSettingsFrom(config),
        metadata: safeQueryMetadata(rawParams),
      });
      throw appendDiagnosticSuffix(error.causeError, responseId);
    }
    throw error;
  }
}

export async function executeFetchContents(
  rawParams: unknown,
  signal?: AbortSignal,
  options?: ExecuteOptions,
): Promise<ToolResult> {
  // Generated at execution start so preflight failures are diagnosable too.
  const responseId = generateResponseId();
  const startedAt = Date.now();
  let config: SearchConfig | undefined;
  try {
    const params = preflightStep(PREFLIGHT_CATEGORY.invalidInput, () => asParams(rawParams));
    // Config-independent validation runs before the config load so invalid
    // input always wins over loader failures. Only pure input validation and
    // URL normalization count as invalid input: this step does no cache,
    // provider, or cache-write work, so operational failures later in the
    // orchestration are rethrown unchanged instead of being mislabeled
    // invalid_input.
    const validated = preflightStep(PREFLIGHT_CATEGORY.invalidInput, () =>
      validateFetchContentsInput({
        rawUris: params.uris,
        rawMaxCharacters: params.maxCharacters,
        rawMaxAgeHours: params.maxAgeHours,
      }),
    );
    // An injected config needs no load step; the production loader runs only
    // here, after validation, so a failing loader can never mask invalid input.
    config = await markPreflight(PREFLIGHT_CATEGORY.configLoadFailure, async () => options?.config ?? loadConfig());
    // The absent maxAgeHours default resolves only now, from the loaded config.
    const input = resolveFetchContentsInput(validated, config.contents.defaultMaxAgeHours);

    const diagnostics: FetchContentsDiagnostics = { attempts: [] };
    const entries = await fetchContentsEntries({
      rawUris: params.uris,
      rawMaxCharacters: params.maxCharacters,
      rawMaxAgeHours: params.maxAgeHours,
      signal,
      config,
      input,
      diagnostics,
    });

    const secrets = buildSecrets(config, {
      google: readConfiguredEnv(config.googleCloudApiKeyEnv),
      parallel: readConfiguredEnv(config.parallelApiKeyEnv),
      exa: readConfiguredEnv(config.exaApiKeyEnv),
      firecrawl: readConfiguredEnv(config.firecrawlApiKeyEnv),
    });
    const record = buildStoredFetchContentsRecord({
      responseId,
      now: Date.now(),
      ttlMs: config.rawResponseTtlMs,
      request: {
        urlCount: Array.isArray(params.uris) ? params.uris.length : null,
        uniqueUrlCount: new Set(entries.map((entry) => entry.normalizedUrl)).size,
        maxCharacters:
          typeof params.maxCharacters === "number" ? params.maxCharacters : DEFAULT_CONTENT_MAX_CHARACTERS,
        maxAgeHours: typeof params.maxAgeHours === "number" ? params.maxAgeHours : config.contents.defaultMaxAgeHours,
      },
      results: storedFetchResults(entries),
      attempts: diagnostics.attempts,
      secrets,
    });
    // Best-effort: a failed diagnostic write must not fail a fetch that
    // already produced entries.
    await writeDiagnosticRecordSafely(config.cacheDir, record, secrets);

    // Model-visible URL copies use the same redacted 500-character bound as
    // the stored record, reusing its bounded normalized URL where the
    // indexes align. Provider calls and cache identity above keep the full
    // normalized URL; only content, details, and renderer copies are bounded.
    const boundedEntries = entries.map((entry, index) => ({
      ...entry,
      url: boundUrlForStorage(entry.url, secrets),
      normalizedUrl: record.results[index]?.normalizedUrl ?? boundUrlForStorage(entry.normalizedUrl, secrets),
    }));

    return {
      content: [{ type: "text", text: formatFetchedContents(boundedEntries) }],
      details: {
        responseId,
        results: boundedEntries.map((entry, index) => ({
          url: entry.url,
          normalizedUrl: entry.normalizedUrl,
          title: entry.title,
          fromCache: entry.fromCache,
          provider: providerForContentEntry(entry) ?? null,
          // Prefer the redacted, bounded stored copy of the status label so
          // details never carry an unbounded provider-controlled string.
          status: record.results[index]?.status ?? entry.statusLabel ?? null,
          characterCount: entry.text.length,
        })),
        providers: resultProviders(entries),
        // Canonical dispatch order comes from the stored record's attempts.
        attemptCount: record.attempts.length,
        attemptProviders: record.attempts.map((attempt) => attempt.provider),
        failureCategories: uniqueFailureCategories(record.attempts.map((attempt) => fetchFailureCategory(attempt))),
        elapsedMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    if (error instanceof PreflightFailure) {
      // An injected options config stays available to invalid-input records
      // even though validation now runs before the load step.
      await writePreflightDiagnostic({
        tool: "fetch_contents",
        category: error.category,
        error: error.causeError,
        responseId,
        settings: preflightSettingsFrom(config ?? options?.config),
        metadata: safeFetchRequestMetadata(rawParams),
      });
      throw appendDiagnosticSuffix(error.causeError, responseId);
    }
    throw error;
  }
}

export function createToolRegistrations(): ToolRegistration[] {
  return [
    {
      name: "web_search",
      label: "Web Search",
      description:
        "Produce a current, source-backed answer using public-web research with inline citations. Use for current facts, versions, releases, changelogs, documentation, issues and pull-request history, comparisons, benchmarks, news, and broad technical research. Prefer web_code_search when the primary need is concrete implementation snippets, exact SDK or API syntax, or working code examples. Do not use this tool to inspect the current local repository.",
      promptSnippet:
        "Search the public web with a complete research question or investigation task, not a keyword/list query.",
      promptGuidelines: [
        "Use web_search for current or source-backed web information; phrase the query as a complete question or task starting with words like 'How', 'What', 'Find', 'Does', 'Determine', 'Investigate', etc.",
        "For web_search, exact identifiers are good — package names, commands, config keys, repos, file extensions — but include them inside a sentence that states what you need to verify.",
        "For web_search, include source preferences in prose, e.g. 'Prefer official docs, npm package pages, GitHub repositories, and maintainer documentation.'",
        "web_search returns answer text with inline citation markers and a Sources section; use those source URLs directly for final answers or fetch_contents.",
        "Do not send web_search terse keyword/list queries such as 'MJML Vim Neovim syntax highlighting plugin .mjml filetype vim-mjml current status'. Rewrite them as a question or investigation task.",
        "For web_search, use one rich query before trying multiple variants; split searches only when the external fact or source target differs.",
        "A single task may use both web_search and web_code_search when it needs both current facts and implementation examples.",
        "Do not use web_search to inspect the current local repository; use CodeGraph or local file tools instead.",
      ],
      parameters: webSearchSchema,
      renderCall: createWebSearchCallRenderer("web_search"),
      renderResult: createWebSearchResultRenderer("web_search"),
      async execute(
        _toolCallId,
        params,
        signalFromTool,
        _onUpdate,
        ctx?: ExtensionContextLike,
      ) {
        return executeWebSearch(params, signalFromTool ?? ctx?.signal);
      },
    },
    {
      name: "web_code_search",
      label: "Web Code Search",
      description:
        'Search public developer sources and implementation context. Use focus="developer_sources" for authoritative documentation, READMEs, issues, pull requests, error discussions, API contracts, and change history. Use focus="implementation_examples" for exact SDK or API syntax, working snippets, framework usage, configuration examples, and implementation patterns. Use CodeGraph or local file tools for the current repository.',
      promptSnippet:
        "Search public developer sources with focus=developer_sources, or implementation examples with focus=implementation_examples.",
      promptGuidelines: [
        "Use web_code_search with focus=developer_sources for authoritative documentation, READMEs, issues, pull requests, error discussions, API contracts, and change history.",
        "Use web_code_search with focus=implementation_examples for exact SDK or API syntax, working snippets, framework usage, configuration examples, and implementation patterns.",
        "For web_code_search, phrase the query as a complete question or task and embed exact package, SDK, API, and configuration names inside a sentence.",
        "A single task may use both web_search and web_code_search when it needs both current facts and implementation examples.",
        "Use CodeGraph or local file tools for the current repository; web_code_search covers only public developer sources.",
      ],
      parameters: webCodeSearchSchema,
      renderCall: createWebSearchCallRenderer("web_code_search"),
      renderResult: createWebSearchResultRenderer("web_code_search"),
      async execute(
        _toolCallId,
        params,
        signalFromTool,
        _onUpdate,
        ctx?: ExtensionContextLike,
      ) {
        return executeWebCodeSearch(params, signalFromTool ?? ctx?.signal);
      },
    },
    {
      name: "fetch_contents",
      label: "Fetch Contents",
      description:
        "Fetch full Markdown from explicit public URLs. Use after web_search or web_code_search when complete source text is required. This tool does not discover URLs or answer a research question.",
      promptSnippet:
        "Fetch full Markdown content for explicit URLs, using disk cache when available.",
      promptGuidelines: [
        "Use fetch_contents only when full page text is needed for explicit URLs, especially source URLs listed by web_search or web_code_search.",
      ],
      parameters: fetchContentsSchema,
      renderCall: createWebSearchCallRenderer("fetch_contents"),
      renderResult: createWebSearchResultRenderer("fetch_contents"),
      async execute(
        _toolCallId,
        params,
        signalFromTool,
        _onUpdate,
        ctx?: ExtensionContextLike,
      ) {
        return executeFetchContents(params, signalFromTool ?? ctx?.signal);
      },
    },
  ];
}
