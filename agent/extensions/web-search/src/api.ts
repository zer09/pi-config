import { normalizeGeminiExaResponse } from "./normalize.js";
import type { FallbackAttempt, PrimaryAttempt, RawHttpRequest, RawHttpResponse, SearchConfig } from "./types.js";

const GEMINI_PROVIDER = "gemini-exa-grounding" as const;

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function parseJsonMaybe(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function postJson(params: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
}): Promise<{ requestStartedAt: string; elapsedMs: number; rawRequest: RawHttpRequest; rawResponse?: RawHttpResponse; error?: string }> {
  const startedMs = Date.now();
  const requestStartedAt = new Date(startedMs).toISOString();
  const rawRequest: RawHttpRequest = {
    method: "POST",
    url: params.url,
    headers: params.headers,
    body: params.body,
  };

  try {
    const response = await fetch(params.url, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(params.body),
      signal: params.signal,
    });
    const bodyText = await response.text();
    return {
      requestStartedAt,
      elapsedMs: Date.now() - startedMs,
      rawRequest,
      rawResponse: {
        status: response.status,
        statusText: response.statusText,
        headers: headersToRecord(response.headers),
        bodyText,
        bodyJson: parseJsonMaybe(bodyText),
      },
    };
  } catch (error) {
    return {
      requestStartedAt,
      elapsedMs: Date.now() - startedMs,
      rawRequest,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function callGeminiExaGrounding(params: {
  query: string;
  googleCloudApiKey: string;
  exaApiKey: string;
  config: SearchConfig;
  signal?: AbortSignal;
}): Promise<PrimaryAttempt> {
  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(
    params.config.model,
  )}:generateContent`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: params.query }],
      },
    ],
    tools: [
      {
        exaAiSearch: {
          api_key: params.exaApiKey,
          customConfigs: {
            type: params.config.searchType,
            numResults: params.config.numResults,
            contents: {
              highlights: {
                maxCharacters: params.config.maxHighlightCharacters,
              },
            },
          },
        },
      },
    ],
  };

  const raw = await postJson({
    url,
    headers: {
      "x-goog-api-key": params.googleCloudApiKey,
      "Content-Type": "application/json; charset=utf-8",
    },
    body,
    signal: params.signal,
  });

  const normalized = raw.rawResponse?.bodyJson ? normalizeGeminiExaResponse(raw.rawResponse.bodyJson) : undefined;
  return {
    provider: GEMINI_PROVIDER,
    model: params.config.model,
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    normalized,
    error: raw.error,
  };
}

function getExaSearchResults(data: unknown): unknown[] {
  return Array.isArray((data as { results?: unknown[] })?.results) ? ((data as { results: unknown[] }).results) : [];
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function formatHighlights(highlights: unknown): string[] {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .map((highlight) => (typeof highlight === "string" ? highlight : getString((highlight as { text?: unknown })?.text)))
    .filter((highlight): highlight is string => typeof highlight === "string" && highlight.trim().length > 0);
}

function formatExaSearchAnswer(query: string, data: unknown): string {
  const results = getExaSearchResults(data);
  if (results.length === 0) return `Direct Exa search returned no results for: ${query}`;

  const lines: string[] = [`Direct Exa search results for: ${query}`, ""];
  results.forEach((raw, index) => {
    const result = raw as Record<string, unknown>;
    const title = getString(result.title) || getString(result.url) || `Result ${index + 1}`;
    lines.push(`${index + 1}. ${title}`);
    if (getString(result.url)) lines.push(`   URL: ${result.url}`);
    if (getString(result.publishedDate)) lines.push(`   Published: ${result.publishedDate}`);
    const highlights = formatHighlights(result.highlights);
    if (highlights.length > 0) {
      lines.push("   Highlights:");
      highlights.slice(0, 3).forEach((highlight) => lines.push(`   - ${highlight.replace(/\s+/g, " ").trim()}`));
    } else if (getString(result.text)) {
      lines.push(`   Text: ${getString(result.text)!.replace(/\s+/g, " ").trim().slice(0, 1000)}`);
    }
  });
  return lines.join("\n");
}

export async function callExaSearchFallback(params: {
  query: string;
  exaApiKey: string;
  config: SearchConfig;
  reason: string;
  signal?: AbortSignal;
}): Promise<FallbackAttempt> {
  const body = {
    query: params.query,
    type: params.config.searchType,
    numResults: params.config.numResults,
    contents: {
      highlights: true,
    },
  };
  const raw = await postJson({
    url: "https://api.exa.ai/search",
    headers: {
      "x-api-key": params.exaApiKey,
      "Content-Type": "application/json",
    },
    body,
    signal: params.signal,
  });
  const data = raw.rawResponse?.bodyJson;
  const status = raw.rawResponse?.status;
  if (raw.error || !raw.rawResponse || !status || status < 200 || status >= 300) {
    throw new Error(`exa_search fallback failed${status ? ` with HTTP ${status}` : ""}${raw.error ? `: ${raw.error}` : ""}`);
  }

  const results = getExaSearchResults(data);
  return {
    used: true,
    provider: "exa_search",
    reason: params.reason,
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    answer: formatExaSearchAnswer(params.query, data),
    costDollars: (data as { costDollars?: unknown })?.costDollars,
    resultCount: results.length,
  };
}

export async function callCodeSearchFallback(params: {
  query: string;
  exaApiKey: string;
  reason: string;
  signal?: AbortSignal;
}): Promise<FallbackAttempt> {
  const body = {
    query: params.query,
    tokensNum: "dynamic",
  };
  const raw = await postJson({
    url: "https://api.exa.ai/context",
    headers: {
      "x-api-key": params.exaApiKey,
      "Content-Type": "application/json",
    },
    body,
    signal: params.signal,
  });
  const data = raw.rawResponse?.bodyJson as Record<string, unknown> | undefined;
  const status = raw.rawResponse?.status;
  if (raw.error || !raw.rawResponse || !status || status < 200 || status >= 300) {
    throw new Error(`code_search fallback failed${status ? ` with HTTP ${status}` : ""}${raw.error ? `: ${raw.error}` : ""}`);
  }

  const answer = getString(data?.response) || getString(data?.text) || "Exa Context API returned no response text.";
  return {
    used: true,
    provider: "code_search",
    reason: params.reason,
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    answer,
  };
}

export async function callExaContents(params: {
  urls: string[];
  maxCharacters: number;
  exaApiKey: string;
  signal?: AbortSignal;
}): Promise<{ rawRequest: RawHttpRequest; rawResponse: RawHttpResponse }> {
  const raw = await postJson({
    url: "https://api.exa.ai/contents",
    headers: {
      "x-api-key": params.exaApiKey,
      "Content-Type": "application/json",
    },
    body: {
      urls: params.urls,
      text: {
        maxCharacters: params.maxCharacters,
      },
    },
    signal: params.signal,
  });
  const status = raw.rawResponse?.status;
  if (raw.error || !raw.rawResponse || !status || status < 200 || status >= 300) {
    throw new Error(`Exa /contents failed${status ? ` with HTTP ${status}` : ""}${raw.error ? `: ${raw.error}` : ""}`);
  }
  return { rawRequest: raw.rawRequest, rawResponse: raw.rawResponse };
}
