import { callCodeSearchFallback, callExaSearchFallback } from "./exa-search.js";
import { callGeminiExaGrounding } from "./gemini.js";
import { fetchContentsEntries } from "./contents.js";
import { formatCleanGeminiSuccess, formatFallbackResult, formatFetchedContents, formatGroundingSources } from "./format.js";
import { loadConfig, readConfiguredEnv } from "./config.js";
import { createWebSearchCallRenderer, createWebSearchResultRenderer } from "./render.js";
import { fetchContentsSchema, fetchGroundingSchema, webSearchExaSchema } from "./schemas.js";
import { fallbackReasonFromPrimary, selectFallbackRoute, assertMode } from "./routing.js";
import { generateResponseId, readStoredResponse, writeStoredResponse } from "./storage.js";
import type {
  ExtensionContextLike,
  FallbackAttempt,
  GroundingSource,
  PrimaryAttempt,
  StoredSearchResponse,
  ToolRegistration,
  ToolResult,
} from "./types.js";
import type { SecretForRedaction } from "./redact.js";

function assertQuery(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("query must be a non-empty string");
  return value.trim();
}

function assertResponseId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("responseId must be a non-empty string");
  return value.trim();
}

function assertGroundingIds(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("groundingIds must be an array of integers");
  return value.map((id) => {
    if (!Number.isInteger(id) || id < 0) throw new Error("groundingIds must be non-negative integers");
    return id as number;
  });
}

function asParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parameters must be an object");
  return value as Record<string, unknown>;
}

function buildSecrets(configEnv: { googleCloudApiKeyEnv: string; exaApiKeyEnv: string }, keys: { google?: string; exa?: string }): SecretForRedaction[] {
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

function buildStoredRecord(params: {
  responseId: string;
  now: number;
  ttlMs: number;
  query: string;
  primary: PrimaryAttempt;
  fallback: FallbackAttempt | null;
}): StoredSearchResponse {
  const normalized = params.primary.normalized ?? null;
  return {
    responseId: params.responseId,
    createdAt: params.now,
    expiresAt: params.now + params.ttlMs,
    provider: "gemini-exa-grounding",
    model: params.primary.model,
    query: params.query,
    request: params.primary.rawRequest,
    response: params.primary.rawResponse,
    primary: params.primary,
    normalized,
    fallback: params.fallback,
    googleResponseId: normalized?.googleResponseId,
  };
}

function detailsForSearch(record: StoredSearchResponse): Record<string, unknown> {
  const normalized = record.normalized ?? undefined;
  return {
    responseId: record.responseId,
    googleResponseId: record.googleResponseId ?? null,
    primaryProvider: "gemini-exa-grounding",
    primaryFinishReason: normalized?.finishReason ?? null,
    fallbackUsed: record.fallback !== null,
    fallbackProvider: record.fallback?.provider ?? null,
    fallbackReason: record.fallback?.reason ?? null,
    sourceCount: normalized?.sources.length ?? 0,
    supportCount: normalized?.supports.length ?? 0,
    queryCount: normalized?.webSearchQueries.length ?? 0,
  };
}

export async function executeWebSearchExa(rawParams: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const params = asParams(rawParams);
  const query = assertQuery(params.query);
  const mode = assertMode(params.mode);
  const config = await loadConfig();
  const exaApiKey = readConfiguredEnv(config.exaApiKeyEnv);
  if (!exaApiKey) throw new Error(`Missing required environment variable ${config.exaApiKeyEnv}`);

  const googleCloudApiKey = readConfiguredEnv(config.googleCloudApiKeyEnv);
  const secrets = buildSecrets(config, { google: googleCloudApiKey, exa: exaApiKey });

  let primary: PrimaryAttempt;
  if (googleCloudApiKey) {
    primary = await callGeminiExaGrounding({ query, googleCloudApiKey, exaApiKey, config, signal });
  } else {
    primary = makeSkippedPrimary(config.model, `Missing required environment variable ${config.googleCloudApiKeyEnv}`);
  }

  const responseId = generateResponseId();
  const now = Date.now();

  if (primary.normalized?.cleanSuccess && primary.rawResponse?.status && primary.rawResponse.status >= 200 && primary.rawResponse.status < 300) {
    const record = buildStoredRecord({ responseId, now, ttlMs: config.rawResponseTtlMs, query, primary, fallback: null });
    await writeStoredResponse(config.cacheDir, record, secrets);
    return {
      content: [{ type: "text", text: formatCleanGeminiSuccess(primary.normalized, responseId) }],
      details: detailsForSearch(record),
    };
  }

  const fallbackReason = fallbackReasonFromPrimary(primary);
  const fallbackRoute = selectFallbackRoute(query, mode);
  let fallback: FallbackAttempt;
  if (fallbackRoute === "code_search") {
    fallback = await callCodeSearchFallback({ query, exaApiKey, reason: fallbackReason, signal });
  } else {
    fallback = await callExaSearchFallback({ query, exaApiKey, config, reason: fallbackReason, signal });
  }
  const record = buildStoredRecord({ responseId, now, ttlMs: config.rawResponseTtlMs, query, primary, fallback });
  await writeStoredResponse(config.cacheDir, record, secrets);

  return {
    content: [{ type: "text", text: formatFallbackResult(fallback.answer, fallback.provider, fallbackReason, responseId) }],
    details: detailsForSearch(record),
  };
}

export async function executeFetchGrounding(rawParams: unknown): Promise<ToolResult> {
  const params = asParams(rawParams);
  const responseId = assertResponseId(params.responseId);
  const groundingIds = assertGroundingIds(params.groundingIds);
  const config = await loadConfig();
  const record = await readStoredResponse(config.cacheDir, responseId);

  const byId = new Map((record.normalized?.sources ?? []).map((source) => [source.groundingId, source]));
  const resolved: GroundingSource[] = [];
  for (const id of [...new Set(groundingIds)]) {
    const source = byId.get(id);
    if (source) resolved.push(source);
  }

  return {
    content: [{ type: "text", text: formatGroundingSources(responseId, resolved) }],
    details: {
      responseId,
      sources: resolved,
    },
  };
}

export async function executeFetchContents(rawParams: unknown, signal?: AbortSignal): Promise<ToolResult> {
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
      description: "Search the web with native Gemini+Exa grounding first, then direct Exa fallback on HTTP/non-STOP failures. Supports mode: auto, web, or code for fallback routing only.",
      promptSnippet: "Search with Gemini+Exa grounding and get source grounding supports plus a raw response ID.",
      promptGuidelines: [
        "Use web_search for web research when Gemini+Exa grounding and fetch_grounding source expansion are useful.",
        "When web_search returns Source Grounding Supports, use fetch_grounding with the Raw response ID to resolve URLs before fetching full page content.",
      ],
      parameters: webSearchExaSchema,
      renderCall: createWebSearchCallRenderer("web_search"),
      renderResult: createWebSearchResultRenderer("web_search"),
      async execute(_toolCallId, params, signalFromTool, _onUpdate, ctx?: ExtensionContextLike) {
        return executeWebSearchExa(params, signalFromTool ?? ctx?.signal);
      },
    },
    {
      name: "fetch_grounding",
      label: "Fetch Grounding",
      description: "Resolve grounding IDs from a stored web_search raw response into compact source URLs, titles, and domains.",
      promptSnippet: "Resolve web_search grounding IDs into source URLs/titles/domains.",
      promptGuidelines: [
        "Use fetch_grounding after web_search when source URLs are needed for specific grounded claims.",
      ],
      parameters: fetchGroundingSchema,
      renderCall: createWebSearchCallRenderer("fetch_grounding"),
      renderResult: createWebSearchResultRenderer("fetch_grounding"),
      async execute(_toolCallId, params) {
        return executeFetchGrounding(params);
      },
    },
    {
      name: "fetch_contents",
      label: "Fetch Contents",
      description: "Fetch full Markdown text for explicit URLs through Exa /contents. Results are cached on disk by normalized URL for one month by default.",
      promptSnippet: "Fetch full Markdown content for explicit URLs, using disk cache when available.",
      promptGuidelines: [
        "Use fetch_contents only when full Markdown page text is needed for explicit URLs, especially after fetch_grounding.",
      ],
      parameters: fetchContentsSchema,
      renderCall: createWebSearchCallRenderer("fetch_contents"),
      renderResult: createWebSearchResultRenderer("fetch_contents"),
      async execute(_toolCallId, params, signalFromTool, _onUpdate, ctx?: ExtensionContextLike) {
        return executeFetchContents(params, signalFromTool ?? ctx?.signal);
      },
    },
  ];
}
