/**
 * Gemini grounding client for the Parallel and Exa search partners.
 *
 * Exports the provider-aware grounding calls used by the web_search tool.
 * Both partners share the Gemini request transport and response
 * normalization; only the raw REST tool payload differs.
 */
import { postJson } from "./http.js";
import { normalizeGeminiGroundingResponse } from "./grounding-normalize.js";
import { classifyPrimaryFailure } from "./grounding-failure.js";
import type {
  ExaGroundingBudget,
  GroundingAttempt,
  ParallelGroundingMode,
} from "./types.js";

function groundingUrl(model: string): string {
  return `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

async function postGrounding(params: {
  model: string;
  googleCloudApiKey: string;
  tool: Record<string, unknown>;
  query: string;
  signal?: AbortSignal;
  provider: GroundingAttempt["provider"];
  partner: GroundingAttempt["partner"];
}): Promise<GroundingAttempt> {
  const raw = await postJson({
    url: groundingUrl(params.model),
    headers: {
      "x-goog-api-key": params.googleCloudApiKey,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: params.query }],
        },
      ],
      tools: [params.tool],
    },
    signal: params.signal,
  });

  const normalized = raw.rawResponse?.bodyJson
    ? normalizeGeminiGroundingResponse(raw.rawResponse.bodyJson)
    : undefined;
  return {
    provider: params.provider,
    partner: params.partner,
    model: params.model,
    requestStartedAt: raw.requestStartedAt,
    elapsedMs: raw.elapsedMs,
    rawRequest: raw.rawRequest,
    rawResponse: raw.rawResponse,
    normalized,
    error: raw.error,
  };
}

/**
 * Calls Gemini generateContent with the native Parallel grounding tool.
 *
 * The Parallel partner key is optional: `api_key` is omitted when not
 * configured so Google Cloud Marketplace subscriptions still operate.
 *
 * @param params - Query text, Google key, optional Parallel key, Parallel mode, model, and optional abort signal.
 * @returns The grounding attempt record, including raw HTTP exchange data and normalized response data when available.
 */
export async function callGeminiParallelGrounding(params: {
  query: string;
  googleCloudApiKey: string;
  parallelApiKey?: string;
  mode: ParallelGroundingMode;
  model: string;
  signal?: AbortSignal;
}): Promise<GroundingAttempt> {
  const parallelAiSearch: Record<string, unknown> = {
    customConfigs: {
      mode: params.mode,
    },
  };
  if (params.parallelApiKey) parallelAiSearch.api_key = params.parallelApiKey;

  return postGrounding({
    model: params.model,
    googleCloudApiKey: params.googleCloudApiKey,
    query: params.query,
    signal: params.signal,
    provider: "gemini-parallel-grounding",
    partner: "parallel",
    tool: { parallelAiSearch },
  });
}

/**
 * Calls Gemini generateContent with the native Exa grounding tool enabled.
 *
 * @param params - Query text, Google key, Exa key, Exa grounding budget, model, and optional abort signal.
 * @returns The grounding attempt record, including raw HTTP exchange data and normalized response data when available.
 */
export async function callGeminiExaGrounding(params: {
  query: string;
  googleCloudApiKey: string;
  exaApiKey: string;
  budget: ExaGroundingBudget;
  model: string;
  signal?: AbortSignal;
}): Promise<GroundingAttempt> {
  return postGrounding({
    model: params.model,
    googleCloudApiKey: params.googleCloudApiKey,
    query: params.query,
    signal: params.signal,
    provider: "gemini-exa-grounding",
    partner: "exa",
    tool: {
      exaAiSearch: {
        api_key: params.exaApiKey,
        customConfigs: {
          type: params.budget.type,
          numResults: params.budget.numResults,
          contents: {
            highlights: {
              maxCharacters: params.budget.maxHighlightCharacters,
            },
          },
        },
      },
    },
  });
}

/**
 * Calls Gemini native Exa grounding, retrying once for the empty-query failure only.
 *
 * The managed Gemini-to-Exa path intermittently forwards an empty search query,
 * and repeating the identical request can recover this intermittent provider
 * failure. Every other failure class is returned as-is so the caller treats
 * the Exa grounding attempt as unusable without extra retries.
 *
 * @param params - The same parameters accepted by `callGeminiExaGrounding`.
 * @returns One attempt, or two when the first was the retryable empty-query failure.
 */
export async function callGeminiExaGroundingAttempts(
  params: Parameters<typeof callGeminiExaGrounding>[0],
): Promise<[GroundingAttempt, ...GroundingAttempt[]]> {
  const first = await callGeminiExaGrounding(params);
  if (params.signal?.aborted) return [first];
  if (classifyPrimaryFailure(first) !== "EXA_EMPTY_QUERY") return [first];
  return [first, await callGeminiExaGrounding(params)];
}
