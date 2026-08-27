import { afterEach, describe, expect, it } from "bun:test";
import { callGeminiExaGroundingAttempts, callGeminiParallelGrounding } from "../src/gemini-grounding.js";
import {
  cleanGroundingBody,
  EXA_EMPTY_QUERY_MESSAGE,
  googleErrorBody,
  jsonResponse,
  mockFetch,
  testConfig,
} from "./helpers.js";
import type { ExaGroundingBudget } from "../src/types.js";

const config = testConfig();
const STANDARD_BUDGET: ExaGroundingBudget = { type: "fast", numResults: 5, maxHighlightCharacters: 2000 };
const DEEP_BUDGET: ExaGroundingBudget = { type: "fast", numResults: 10, maxHighlightCharacters: 4000 };

const GEMINI_URL = "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash:generateContent";

function groundingTool(body: any): Record<string, any> {
  return body.tools[0];
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

function install(handler: Parameters<typeof mockFetch>[0]) {
  const mock = mockFetch(handler);
  restore = mock.restore;
  return mock.calls;
}

function callParallel(mode: "basic" | "advanced", parallelApiKey?: string, signal?: AbortSignal) {
  return callGeminiParallelGrounding({
    query: "Does gemini-3.5-flash support Parallel grounding?",
    googleCloudApiKey: "google-key",
    parallelApiKey,
    mode,
    model: config.model,
    signal,
  });
}

function callExaAttempts(budget: ExaGroundingBudget, signal?: AbortSignal) {
  return callGeminiExaGroundingAttempts({
    query: "Does gemini-3.5-flash support Exa grounding?",
    googleCloudApiKey: "google-key",
    exaApiKey: "exa-key",
    budget,
    model: config.model,
    signal,
  });
}

describe("Gemini + Parallel grounding request shape", () => {
  it("builds parallelAiSearch with mode basic for standard depth", async () => {
    const calls = install([jsonResponse(cleanGroundingBody())]);
    await callParallel("basic", "parallel-key");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(GEMINI_URL);
    expect(calls[0]!.headers["x-goog-api-key"]).toBe("google-key");
    expect(groundingTool(calls[0]!.body).parallelAiSearch).toEqual({
      api_key: "parallel-key",
      customConfigs: { mode: "basic" },
    });
  });

  it("builds parallelAiSearch with mode advanced for deep depth", async () => {
    const calls = install([jsonResponse(cleanGroundingBody())]);
    await callParallel("advanced", "parallel-key");

    expect(groundingTool(calls[0]!.body).parallelAiSearch.customConfigs).toEqual({ mode: "advanced" });
  });

  it("omits the Parallel api_key when no partner key is configured", async () => {
    const calls = install([jsonResponse(cleanGroundingBody())]);
    await callParallel("basic", undefined);

    const parallelAiSearch = groundingTool(calls[0]!.body).parallelAiSearch;
    expect(parallelAiSearch).toEqual({ customConfigs: { mode: "basic" } });
    expect("api_key" in parallelAiSearch).toBe(false);
    expect(JSON.stringify(calls[0]!.body)).not.toContain("api_key");
  });
});

describe("Gemini + Exa grounding request shape", () => {
  it("uses type fast with the standard budget by default", async () => {
    const calls = install([jsonResponse(cleanGroundingBody())]);
    await callExaAttempts(STANDARD_BUDGET);

    expect(calls).toHaveLength(1);
    expect(groundingTool(calls[0]!.body).exaAiSearch).toEqual({
      api_key: "exa-key",
      customConfigs: {
        type: "fast",
        numResults: 5,
        contents: { highlights: { maxCharacters: 2000 } },
      },
    });
  });

  it("uses the larger deep budget for deep depth", async () => {
    const calls = install([jsonResponse(cleanGroundingBody())]);
    await callExaAttempts(DEEP_BUDGET);

    const customConfigs = groundingTool(calls[0]!.body).exaAiSearch.customConfigs;
    expect(customConfigs.type).toBe("fast");
    expect(customConfigs.numResults).toBe(10);
    expect(customConfigs.contents.highlights.maxCharacters).toBe(4000);
  });
});

describe("Exa empty-query retry orchestration", () => {
  it("makes one call when the first attempt succeeds", async () => {
    const calls = install([jsonResponse(cleanGroundingBody())]);
    const attempts = await callExaAttempts(STANDARD_BUDGET);

    expect(calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.normalized?.cleanSuccess).toBe(true);
    expect(attempts[0]!.provider).toBe("gemini-exa-grounding");
    expect(attempts[0]!.partner).toBe("exa");
  });

  it("retries once after the empty-query failure and keeps both attempts", async () => {
    const calls = install([
      jsonResponse(googleErrorBody(EXA_EMPTY_QUERY_MESSAGE), 400),
      jsonResponse(cleanGroundingBody()),
    ]);
    const attempts = await callExaAttempts(STANDARD_BUDGET);

    expect(calls).toHaveLength(2);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.rawResponse?.status).toBe(400);
    expect(attempts[1]!.rawResponse?.status).toBe(200);
    expect(attempts[1]!.normalized?.cleanSuccess).toBe(true);
  });

  it("stops after two attempts when both fail with the empty-query error", async () => {
    const calls = install([
      jsonResponse(googleErrorBody(EXA_EMPTY_QUERY_MESSAGE), 400),
      jsonResponse(googleErrorBody(EXA_EMPTY_QUERY_MESSAGE), 400),
    ]);
    const attempts = await callExaAttempts(STANDARD_BUDGET);

    expect(calls).toHaveLength(2);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.rawResponse?.status).toBe(400);
  });

  it("does not retry an unrelated HTTP 400", async () => {
    const calls = install([jsonResponse(googleErrorBody("Invalid JSON payload received."), 400)]);
    const attempts = await callExaAttempts(STANDARD_BUDGET);

    expect(calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
  });

  it("does not retry HTTP 429", async () => {
    const calls = install([jsonResponse(googleErrorBody("Quota exceeded for query requests.", 429, "RESOURCE_EXHAUSTED"), 429)]);
    const attempts = await callExaAttempts(STANDARD_BUDGET);

    expect(calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
  });

  it("does not retry when the signal is aborted during the first attempt", async () => {
    const controller = new AbortController();
    const calls = install([jsonResponse(googleErrorBody(EXA_EMPTY_QUERY_MESSAGE), 400)]);
    const promise = callExaAttempts(STANDARD_BUDGET, controller.signal);
    controller.abort();
    const attempts = await promise;

    expect(calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
  });

  it("retries with the same URL and request body", async () => {
    const calls = install([
      jsonResponse(googleErrorBody(EXA_EMPTY_QUERY_MESSAGE), 400),
      jsonResponse(cleanGroundingBody()),
    ]);
    await callExaAttempts(STANDARD_BUDGET);

    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(calls[0]!.url);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
    expect(calls[0]!.url).toBe(GEMINI_URL);
  });
});
