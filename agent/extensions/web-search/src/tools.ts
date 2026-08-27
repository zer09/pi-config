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
import { fetchContentsEntries } from "./contents.js";
import {
  formatCleanGeminiSuccess,
  formatCodeSearchResult,
  formatCodeSearchUnavailable,
  formatFetchedContents,
  formatWebSearchUnavailable,
} from "./format.js";
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
import { generateResponseId, writeStoredResponse } from "./storage.js";
import { providerForContentEntry } from "./content-cache.js";
import type {
  CodeSearchAttempt,
  CodeSearchFocus,
  ExtensionContextLike,
  GroundingAttempt,
  SearchConfig,
  StoredCodeSearchResponse,
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
}): StoredSearchResponse {
  const primary = params.parallelAttempts[params.parallelAttempts.length - 1]!;
  const fallback = params.exaAttempts.length > 0 ? params.exaAttempts[params.exaAttempts.length - 1]! : null;
  // Legacy top-level fields keep describing the final selected attempt so
  // existing raw-response consumers stay correct while history is preserved.
  return {
    schemaVersion: 2,
    responseId: params.responseId,
    createdAt: params.now,
    expiresAt: params.now + params.ttlMs,
    tool: "web_search",
    depth: params.depth,
    selectedProvider: params.selected?.provider ?? "none",
    query: params.query,
    model: primary.model,
    attempts: [...params.parallelAttempts, ...params.exaAttempts],
    provider: params.selected?.provider ?? primary.provider,
    request: params.selected?.rawRequest ?? primary.rawRequest,
    response: params.selected?.rawResponse ?? primary.rawResponse,
    primary,
    // `primary` already is the only Parallel attempt, so history is stored only
    // when a retry actually produced a second attempt.
    primaryAttempts: params.parallelAttempts.length > 1 ? params.parallelAttempts : undefined,
    normalized: params.selected?.normalized ?? null,
    fallback,
    googleResponseId: params.selected?.normalized?.googleResponseId,
  };
}

function attemptsForRecord(record: StoredSearchResponse): GroundingAttempt[] {
  if (record.attempts?.length) return record.attempts;
  return record.primaryAttempts?.length ? record.primaryAttempts : [record.primary];
}

export function detailsForSearch(
  record: StoredSearchResponse,
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
    fallbackUsed,
    fallbackFrom: fallbackUsed ? "parallel" : null,
    fallbackReason: fallbackUsed ? fallbackReasonFromGrounding(primaryFinal) : null,
    sourceCount: geminiAnswered ? record.normalized?.sources.length ?? null : null,
    supportCount: geminiAnswered ? record.normalized?.supports.length ?? null : null,
    queryCount: geminiAnswered ? record.normalized?.webSearchQueries.length ?? null : null,
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
}): StoredCodeSearchResponse {
  return {
    schemaVersion: 2,
    responseId: params.responseId,
    createdAt: params.now,
    expiresAt: params.now + params.ttlMs,
    tool: "web_code_search",
    focus: params.focus,
    selectedProvider: params.selected?.provider ?? "none",
    query: params.query,
    attempts: params.attempts,
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
    fallbackUsed,
    fallbackFrom: fallbackUsed ? attempts[0]?.provider ?? null : null,
    degraded: record.degraded,
    resultCount: codeSearchResultCount(selected),
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

export async function executeWebSearch(
  rawParams: unknown,
  signal?: AbortSignal,
  options?: ExecuteOptions,
): Promise<ToolResult> {
  const params = asParams(rawParams);
  const query = assertQuery(params.query);
  const config = options?.config ?? (await loadConfig());
  const depth = assertDepth(params.depth, config.webSearch.defaultDepth);

  // Both grounding partners share the Google transport, so a missing Google
  // credential is terminal for web_search: no Exa grounding attempt is made.
  const googleCloudApiKey = readConfiguredEnv(config.googleCloudApiKeyEnv);
  if (!googleCloudApiKey)
    throw new Error(`Missing required environment variable ${config.googleCloudApiKeyEnv}`);

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

  const responseId = generateResponseId();
  const record = buildStoredRecord({
    responseId,
    now: Date.now(),
    ttlMs: config.rawResponseTtlMs,
    query,
    depth,
    parallelAttempts,
    exaAttempts,
    selected,
  });
  await writeStoredResponse(config.cacheDir, record, secrets);

  if (selected?.normalized) {
    return {
      content: [
        {
          type: "text",
          text: formatCleanGeminiSuccess(selected.normalized, responseId),
        },
      ],
      details: detailsForSearch(record),
    };
  }

  return {
    content: [{ type: "text", text: formatWebSearchUnavailable() }],
    details: detailsForSearch(record),
  };
}

export async function executeWebCodeSearch(
  rawParams: unknown,
  signal?: AbortSignal,
  options?: ExecuteOptions,
): Promise<ToolResult> {
  const params = asParams(rawParams);
  const query = assertQuery(params.query);
  const focus = assertFocus(params.focus);
  const config = options?.config ?? (await loadConfig());

  const exaApiKey = readConfiguredEnv(config.exaApiKeyEnv);
  const firecrawlApiKey = readConfiguredEnv(config.firecrawlApiKeyEnv);
  const secrets = buildSecrets(config, {
    google: readConfiguredEnv(config.googleCloudApiKeyEnv),
    parallel: readConfiguredEnv(config.parallelApiKeyEnv),
    exa: exaApiKey,
    firecrawl: firecrawlApiKey,
  });

  const firecrawlCall = (types?: string[]) =>
    callFirecrawlDeveloperSearch({
      query,
      k: config.codeSearch.firecrawl.k,
      passages: config.codeSearch.firecrawl.passages,
      types,
      firecrawlApiKey,
      signal,
    });
  const exaCodeCall = () =>
    exaApiKey
      ? callExaCodeSearch({
          query,
          exaApiKey,
          tokensNum: config.codeSearch.exaCode.tokensNum,
          signal,
        })
      : Promise.resolve(
          makeSkippedCodeAttempt("exa-code", `Missing required environment variable ${config.exaApiKeyEnv}`),
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

  const responseId = generateResponseId();
  const record = buildStoredCodeSearchRecord({
    responseId,
    now: Date.now(),
    ttlMs: config.rawResponseTtlMs,
    query,
    focus,
    attempts,
    selected,
    degraded,
  });
  await writeStoredResponse(config.cacheDir, record, secrets);

  if (selected?.normalized) {
    return {
      content: [{ type: "text", text: formatCodeSearchResult(query, selected.normalized) }],
      details: detailsForCodeSearch(record),
    };
  }

  return {
    content: [{ type: "text", text: formatCodeSearchUnavailable() }],
    details: detailsForCodeSearch(record),
  };
}

export async function executeFetchContents(
  rawParams: unknown,
  signal?: AbortSignal,
  options?: ExecuteOptions,
): Promise<ToolResult> {
  const params = asParams(rawParams);
  const config = options?.config ?? (await loadConfig());
  const entries = await fetchContentsEntries({
    rawUris: params.uris,
    rawMaxCharacters: params.maxCharacters,
    rawMaxAgeHours: params.maxAgeHours,
    signal,
    config,
  });

  return {
    content: [{ type: "text", text: formatFetchedContents(entries) }],
    details: {
      results: entries.map((entry) => ({
        url: entry.url,
        normalizedUrl: entry.normalizedUrl,
        title: entry.title,
        fromCache: entry.fromCache,
        provider: providerForContentEntry(entry) ?? null,
        status: entry.statusLabel ?? null,
        characterCount: entry.text.length,
      })),
    },
  };
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
