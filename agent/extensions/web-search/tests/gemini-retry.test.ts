import { afterEach, describe, expect, it } from "bun:test";
import { callGeminiExaGroundingAttempts } from "../src/gemini.js";
import type { SearchConfig } from "../src/types.js";

const config: SearchConfig = {
  googleCloudApiKeyEnv: "GOOGLE_CLOUD_API_KEY",
  exaApiKeyEnv: "EXA_API_KEY",
  model: "gemini-3.5-flash",
  searchType: "auto",
  numResults: 5,
  maxHighlightCharacters: 500,
  cacheDir: "/tmp/unused-web-search-cache",
  rawResponseTtlMs: 1000,
  contentCacheTtlMs: 1000,
};

const EXA_EMPTY_QUERY_MESSAGE =
  'Exa AI API returned bad request error. Please check your request. {"requestId":"abc","error":"Invalid request body | Validation error: Too small: expected string to have >=1 characters at \\"query\\"","tag":"INVALID_REQUEST_BODY"}';

const cleanGeminiBody = {
  responseId: "google-response-1",
  modelVersion: "gemini-3.5-flash",
  candidates: [
    {
      finishReason: "STOP",
      content: { parts: [{ text: "Grounded answer." }] },
      groundingMetadata: {
        webSearchQueries: ["gemini 3.5 flash exa grounding"],
        groundingChunks: [{ web: { title: "Docs", uri: "https://example.com/docs" } }],
        groundingSupports: [{ segment: { text: "Grounded answer." }, groundingChunkIndices: [0] }],
      },
    },
  ],
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function googleError(message: string, status: number, statusLabel: string): Response {
  return jsonResponse({ error: { code: status, message, status: statusLabel } }, status);
}

function emptyQueryResponse(): Response {
  return googleError(EXA_EMPTY_QUERY_MESSAGE, 400, "INVALID_ARGUMENT");
}

type FetchCall = { url: string; body: string };

const originalFetch = globalThis.fetch;
let calls: FetchCall[] = [];

function mockFetch(responses: Response[]): void {
  calls = [];
  let index = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    const response = responses[index];
    index += 1;
    if (!response) throw new Error(`unexpected fetch call ${index}`);
    return response;
  }) as typeof fetch;
}

function callAttempts(signal?: AbortSignal) {
  return callGeminiExaGroundingAttempts({
    query: "Does gemini-3.5-flash support Exa grounding?",
    googleCloudApiKey: "google-key",
    exaApiKey: "exa-key",
    config,
    signal,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("gemini attempt orchestration", () => {
  it("makes one call when the first attempt succeeds", async () => {
    mockFetch([jsonResponse(cleanGeminiBody, 200)]);
    const attempts = await callAttempts();

    expect(calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.normalized?.cleanSuccess).toBe(true);
  });

  it("retries once after the empty-query failure and keeps both attempts", async () => {
    mockFetch([emptyQueryResponse(), jsonResponse(cleanGeminiBody, 200)]);
    const attempts = await callAttempts();

    expect(calls).toHaveLength(2);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.rawResponse?.status).toBe(400);
    expect(attempts[1]!.rawResponse?.status).toBe(200);
    expect(attempts[1]!.normalized?.cleanSuccess).toBe(true);
  });

  it("stops after two attempts when both fail with the empty-query error", async () => {
    mockFetch([emptyQueryResponse(), emptyQueryResponse()]);
    const attempts = await callAttempts();

    expect(calls).toHaveLength(2);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.rawResponse?.status).toBe(400);
  });

  it("does not retry an unrelated HTTP 400", async () => {
    mockFetch([googleError("Invalid JSON payload received.", 400, "INVALID_ARGUMENT")]);
    const attempts = await callAttempts();

    expect(calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
  });

  it("does not retry HTTP 429", async () => {
    mockFetch([googleError("Quota exceeded for query requests.", 429, "RESOURCE_EXHAUSTED")]);
    const attempts = await callAttempts();

    expect(calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
  });

  it("does not retry when the signal is aborted during the first attempt", async () => {
    const controller = new AbortController();
    mockFetch([emptyQueryResponse()]);
    const promise = callAttempts(controller.signal);
    controller.abort();
    const attempts = await promise;

    expect(calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
  });

  it("retries with the same URL and request body", async () => {
    mockFetch([emptyQueryResponse(), jsonResponse(cleanGeminiBody, 200)]);
    await callAttempts();

    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(calls[0]!.url);
    expect(calls[1]!.body).toBe(calls[0]!.body);
    expect(calls[0]!.url).toBe(
      "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash:generateContent",
    );
  });
});
