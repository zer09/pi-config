/**
 * Gemini native Exa grounding client.
 *
 * Exports the primary provider call used by the web_search tool and keeps the
 * Gemini request shape separate from direct Exa fallback clients.
 */
import { postJson } from "./http.js";
import { normalizeGeminiExaResponse } from "./normalize.js";
import type { PrimaryAttempt, SearchConfig } from "./types.js";

const GEMINI_PROVIDER = "gemini-exa-grounding" as const;

/**
 * Calls Gemini generateContent with the native Exa grounding tool enabled.
 *
 * @param params - Query text, provider API keys, search configuration, and optional abort signal.
 * @returns The primary-attempt record, including raw HTTP exchange data and normalized response data when available.
 */
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
