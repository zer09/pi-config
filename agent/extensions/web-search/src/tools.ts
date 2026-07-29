import { callCodeSearchFallback, callExaSearchFallback } from "./exa-search.js";
import { callGeminiExaGroundingAttempts } from "./gemini.js";
import { classifyPrimaryFailure } from "./primary-failure.js";
import { fetchContentsEntries } from "./contents.js";
import {
  formatCleanGeminiSuccess,
  formatFallbackResult,
  formatFetchedContents,
} from "./format.js";
import { loadConfig, readConfiguredEnv } from "./config.js";
import {
  createWebSearchCallRenderer,
  createWebSearchResultRenderer,
} from "./render.js";
import {
  fetchContentsSchema,
  webSearchExaSchema,
} from "./schemas.js";
import {
  fallbackReasonFromPrimary,
  selectFallbackRoute,
  assertMode,
} from "./routing.js";
import {
  generateResponseId,
  writeStoredResponse,
} from "./storage.js";
import type {
  ExtensionContextLike,
  FallbackAttempt,
  PrimaryAttempt,
  PrimaryAttempts,
  StoredSearchResponse,
  ToolRegistration,
  ToolResult,
} from "./types.js";
import type { SecretForRedaction } from "./redact.js";

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

function buildSecrets(
  configEnv: { googleCloudApiKeyEnv: string; exaApiKeyEnv: string },
  keys: { google?: string; exa?: string },
): SecretForRedaction[] {
  return [
    { label: configEnv.googleCloudApiKeyEnv, value: keys.google },
    { label: configEnv.exaApiKeyEnv, value: keys.exa },
  ];
}

function makeSkippedPrimary(model: string, reason: string): PrimaryAttempt {
  return {
    provider: "gemini-exa-grounding",
    model,
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
  primaryAttempts: PrimaryAttempts;
  fallback: FallbackAttempt | null;
}): StoredSearchResponse {
  // Legacy top-level fields keep describing the final attempt so existing
  // raw-response consumers stay correct while history is preserved alongside.
  const primary = params.primaryAttempts[params.primaryAttempts.length - 1]!;
  const normalized = primary.normalized ?? null;
  return {
    responseId: params.responseId,
    createdAt: params.now,
    expiresAt: params.now + params.ttlMs,
    provider: "gemini-exa-grounding",
    model: primary.model,
    query: params.query,
    request: primary.rawRequest,
    response: primary.rawResponse,
    primary,
    // `primary` already is the only attempt in the common case, so history is
    // stored only when a retry actually produced a second attempt.
    primaryAttempts: params.primaryAttempts.length > 1 ? params.primaryAttempts : undefined,
    normalized,
    fallback: params.fallback,
    googleResponseId: normalized?.googleResponseId,
  };
}

function primaryAttemptsForRecord(record: StoredSearchResponse): PrimaryAttempt[] {
  return record.primaryAttempts?.length ? record.primaryAttempts : [record.primary];
}

export function detailsForSearch(
  record: StoredSearchResponse,
): Record<string, unknown> {
  const normalized = record.normalized ?? undefined;
  const attempts = primaryAttemptsForRecord(record);
  const finalAttempt = attempts[attempts.length - 1]!;
  // Gemini grounding counts only describe a Gemini answer; reporting them for a
  // fallback answer would claim the successful search found nothing.
  const geminiAnswered = record.fallback === null;
  return {
    responseId: record.responseId,
    googleResponseId: record.googleResponseId ?? null,
    answerProvider: record.fallback?.provider ?? "gemini-exa-grounding",
    primaryProvider: "gemini-exa-grounding",
    primaryFinishReason: normalized?.finishReason ?? null,
    primaryAttemptCount: attempts.length,
    primaryFirstFailureCode: classifyPrimaryFailure(attempts[0]!) ?? null,
    primaryFinalFailureCode: classifyPrimaryFailure(finalAttempt) ?? null,
    primaryFinalStatus: finalAttempt.rawResponse?.status ?? null,
    fallbackUsed: record.fallback !== null,
    fallbackProvider: record.fallback?.provider ?? null,
    fallbackReason: record.fallback?.reason ?? null,
    fallbackResultCount: record.fallback?.resultCount ?? null,
    sourceCount: geminiAnswered ? normalized?.sources.length ?? null : null,
    supportCount: geminiAnswered ? normalized?.supports.length ?? null : null,
    queryCount: geminiAnswered ? normalized?.webSearchQueries.length ?? null : null,
  };
}

export async function executeWebSearchExa(
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const params = asParams(rawParams);
  const query = assertQuery(params.query);
  const mode = assertMode(params.mode);
  const config = await loadConfig();
  const exaApiKey = readConfiguredEnv(config.exaApiKeyEnv);
  if (!exaApiKey)
    throw new Error(
      `Missing required environment variable ${config.exaApiKeyEnv}`,
    );

  const googleCloudApiKey = readConfiguredEnv(config.googleCloudApiKeyEnv);
  const secrets = buildSecrets(config, {
    google: googleCloudApiKey,
    exa: exaApiKey,
  });

  let primaryAttempts: PrimaryAttempts;
  if (googleCloudApiKey) {
    primaryAttempts = await callGeminiExaGroundingAttempts({
      query,
      googleCloudApiKey,
      exaApiKey,
      config,
      signal,
    });
  } else {
    primaryAttempts = [
      makeSkippedPrimary(
        config.model,
        `Missing required environment variable ${config.googleCloudApiKeyEnv}`,
      ),
    ];
  }
  const primary = primaryAttempts[primaryAttempts.length - 1]!;

  const responseId = generateResponseId();
  const now = Date.now();

  if (
    primary.normalized?.cleanSuccess &&
    primary.rawResponse?.status &&
    primary.rawResponse.status >= 200 &&
    primary.rawResponse.status < 300
  ) {
    const record = buildStoredRecord({
      responseId,
      now,
      ttlMs: config.rawResponseTtlMs,
      query,
      primaryAttempts,
      fallback: null,
    });
    await writeStoredResponse(config.cacheDir, record, secrets);
    return {
      content: [
        {
          type: "text",
          text: formatCleanGeminiSuccess(primary.normalized, responseId),
        },
      ],
      details: detailsForSearch(record),
    };
  }

  const fallbackReason = fallbackReasonFromPrimary(primary);
  const fallbackRoute = selectFallbackRoute(query, mode);
  let fallback: FallbackAttempt;
  if (fallbackRoute === "code_search") {
    fallback = await callCodeSearchFallback({
      query,
      exaApiKey,
      reason: fallbackReason,
      signal,
    });
  } else {
    fallback = await callExaSearchFallback({
      query,
      exaApiKey,
      config,
      reason: fallbackReason,
      signal,
    });
  }
  const record = buildStoredRecord({
    responseId,
    now,
    ttlMs: config.rawResponseTtlMs,
    query,
    primaryAttempts,
    fallback,
  });
  await writeStoredResponse(config.cacheDir, record, secrets);

  return {
    content: [
      {
        type: "text",
        text: formatFallbackResult(
          fallback.answer,
          fallback.provider,
          fallbackReason,
          responseId,
        ),
      },
    ],
    details: detailsForSearch(record),
  };
}

export async function executeFetchContents(
  rawParams: unknown,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const params = asParams(rawParams);
  const entries = await fetchContentsEntries({
    rawUris: params.uris,
    rawMaxCharacters: params.maxCharacters,
    signal,
  });

  return {
    content: [{ type: "text", text: formatFetchedContents(entries) }],
    details: {
      results: entries.map((entry) => ({
        url: entry.url,
        normalizedUrl: entry.normalizedUrl,
        title: entry.title,
        fromCache: entry.fromCache,
        status: entry.statusLabel,
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
        "Search the web for current or source-backed information. The query must be a complete research prompt: ask a question or give an investigation task. Do not submit terse keyword lists. Exact package names, commands, config keys, repos, and file extensions are encouraged, but embed them in a sentence with source preferences.",
      promptSnippet:
        "Search the web with a complete research question or investigation task, not a keyword/list query.",
      promptGuidelines: [
        "Use web_search for current or source-backed web information; phrase the query as a complete question or task starting with words like 'How', 'What', 'Find', 'Does', 'Determine', 'Investigate', etc.",
        "For web_search, exact identifiers are good — package names, commands, config keys, repos, file extensions — but include them inside a sentence that states what you need to verify.",
        "For web_search, include source preferences in prose, e.g. 'Prefer official docs, npm package pages, GitHub repositories, and maintainer documentation.'",
        "web_search returns answer text with inline citation markers and a Sources section; use those source URLs directly for final answers or fetch_contents.",
        "Do not send web_search terse keyword/list queries such as 'MJML Vim Neovim syntax highlighting plugin .mjml filetype vim-mjml current status'. Rewrite them as a question or investigation task.",
        "For web_search, use one rich query before trying multiple variants; split searches only when the external fact or source target differs.",
        "For web_search, prefer mode: auto; use mode: web for docs/news and mode: code for code/package/API examples.",
      ],
      parameters: webSearchExaSchema,
      renderCall: createWebSearchCallRenderer("web_search"),
      renderResult: createWebSearchResultRenderer("web_search"),
      async execute(
        _toolCallId,
        params,
        signalFromTool,
        _onUpdate,
        ctx?: ExtensionContextLike,
      ) {
        return executeWebSearchExa(params, signalFromTool ?? ctx?.signal);
      },
    },
    {
      name: "fetch_contents",
      label: "Fetch Contents",
      description:
        "Fetch full Markdown text for explicit URLs. Results are cached on disk by normalized URL for one month by default.",
      promptSnippet:
        "Fetch full Markdown content for explicit URLs, using disk cache when available.",
      promptGuidelines: [
        "Use fetch_contents only when full page text is needed for explicit URLs, especially source URLs listed by web_search.",
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
