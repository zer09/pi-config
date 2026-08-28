/**
 * Deterministic tests for the Tavily final fallback of web_search: exact
 * provider request contract, routing and credential-skip behavior, response
 * normalization, degraded output bounds, secret redaction including
 * truncation boundaries, diagnostics bounds, failure-category parity, schema-3
 * stored records with legacy compatibility, safe details, and the TUI
 * summary. All HTTP calls are stubbed, caches use temporary directories, and
 * environment variables use test-only names.
 */
import "./pi-tui-mock.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GroundingAttempt, TavilySearchAttempt, ToolResult } from "../src/types.js";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { executeWebSearch, executeWebCodeSearch, buildStoredRecord, detailsForSearch } = await import("../src/tools.js");
const { callTavilySearch, isUsableTavilySearch, parseTavilySearchResponse } = await import("../src/tavily-search.js");
const {
  boundTavilyAttemptForStorage,
  tavilyFailureCategory,
  webSearchFailureCategory,
  groundingFailureCategory,
} = await import("../src/diagnostics.js");
const { formatTavilySearchDocument } = await import("../src/format.js");
const { readStoredResponse, readStoredToolRecord, responsePath } = await import("../src/storage.js");
const { createWebSearchResultRenderer, createWebSearchCallRenderer } = await import("../src/render.js");
const { createToolRegistrations } = await import("../src/tools.js");
const { webSearchSchema, webCodeSearchSchema, fetchContentsSchema } = await import("../src/schemas.js");
const {
  cleanGroundingBody,
  cleanTavilyBody,
  clearTestEnv,
  expectNoSecretFragments,
  googleErrorBody,
  jsonResponse,
  mockFetch,
  setTestEnv,
  TEST_ENV_NAMES,
  TEST_KEYS,
  testConfig,
  tavilyResults,
} = await import("./helpers.js");

const GEMINI_URL = "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash:generateContent";
const TAVILY_URL = "https://api.tavily.com/search";

let cacheDir: string;
let restore: (() => void) | undefined;
let calls: ReturnType<typeof mockFetch>["calls"];

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "wse-tavily-"));
  setTestEnv({
    [TEST_ENV_NAMES.googleCloudApiKeyEnv]: TEST_KEYS.google,
    [TEST_ENV_NAMES.parallelApiKeyEnv]: TEST_KEYS.parallel,
    [TEST_ENV_NAMES.exaApiKeyEnv]: TEST_KEYS.exa,
    [TEST_ENV_NAMES.firecrawlApiKeyEnv]: TEST_KEYS.firecrawl,
    [TEST_ENV_NAMES.tavilyApiKeyEnv]: TEST_KEYS.tavily,
  });
});

afterEach(async () => {
  restore?.();
  restore = undefined;
  clearTestEnv();
  await rm(cacheDir, { recursive: true, force: true });
});

function install(handler: Parameters<typeof mockFetch>[0]) {
  const mock = mockFetch(handler);
  restore = mock.restore;
  calls = mock.calls;
}

const config = () => testConfig({ cacheDir });

function run(params: Record<string, unknown> = {}, signal?: AbortSignal) {
  return executeWebSearch({ query: "How does Tavily search routing work?", ...params }, signal, {
    config: config(),
  });
}

function parallelFailure(): Response {
  return jsonResponse(googleErrorBody("upstream unavailable", 503, "UNAVAILABLE"), 503);
}

function exaFailure(): Response {
  return jsonResponse(googleErrorBody("exa upstream down", 500, "INTERNAL"), 500);
}

function exaEmptyQuery(): Response {
  return jsonResponse(
    {
      error: {
        code: 400,
        message:
          'Exa AI API returned bad request error. Please check your request. {"requestId":"abc","error":"Invalid request body | Validation error: Too small: expected string to have >=1 characters at \\"query\\"","tag":"INVALID_REQUEST_BODY"}',
        status: "INVALID_ARGUMENT",
      },
    },
    400,
  );
}

function tavilyBody(results: Array<Record<string, unknown>>): Response {
  return jsonResponse({ results, response_time: 0.9, request_id: "req-t1", usage: { credits: 1 } });
}

describe("Tavily request contract", () => {
  beforeEach(() => {
    install([jsonResponse(cleanTavilyBody())]);
  });

  it("sends the exact POST https://api.tavily.com/search request with Bearer auth", async () => {
    await callTavilySearch({
      query: "q",
      tavilyApiKey: TEST_KEYS.tavily,
      settings: { searchDepth: "basic", maxResults: 5 },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TAVILY_URL);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TEST_KEYS.tavily}`);
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json");
  });

  it("sends exactly the six contracted body keys with the fixed flag values", async () => {
    await callTavilySearch({
      query: "How does X work?",
      tavilyApiKey: TEST_KEYS.tavily,
      settings: { searchDepth: "advanced", maxResults: 10 },
    });

    expect(Object.keys(calls[0]!.body).sort()).toEqual([
      "include_answer",
      "include_raw_content",
      "include_usage",
      "max_results",
      "query",
      "search_depth",
    ]);
    expect(calls[0]!.body).toEqual({
      query: "How does X work?",
      search_depth: "advanced",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
      include_usage: true,
    });
    expect(calls[0]!.body).not.toHaveProperty("auto_parameters");
  });

  it("captures the shared transport snapshot on the attempt", async () => {
    const attempt = await callTavilySearch({
      query: "q",
      tavilyApiKey: TEST_KEYS.tavily,
      settings: { searchDepth: "basic", maxResults: 5 },
    });

    expect(attempt.provider).toBe("tavily-search");
    expect(attempt.rawRequest?.method).toBe("POST");
    expect(attempt.rawRequest?.url).toBe(TAVILY_URL);
    expect(attempt.rawResponse?.status).toBe(200);
    expect(attempt.normalized?.results).toHaveLength(2);
  });
});

describe("web_search provider routing with Tavily", () => {
  it("runs Tavily last with basic depth and maxResults 5 for standard", async () => {
    install([parallelFailure(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();

    expect(calls).toHaveLength(3);
    expect(calls[2]!.url).toBe(TAVILY_URL);
    expect(calls[2]!.body.search_depth).toBe("basic");
    expect(calls[2]!.body.max_results).toBe(5);
    expect(result.details.answerProvider).toBe("tavily-search");
    expect(result.details.attemptProviders).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
  });

  it("uses advanced depth and maxResults 10 for deep", async () => {
    install([parallelFailure(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run({ depth: "deep" });

    const geminiTool = calls[0]!.body.tools[0] as Record<string, any>;
    expect(geminiTool.parallelAiSearch.customConfigs.mode).toBe("advanced");
    expect(calls[2]!.body.search_depth).toBe("advanced");
    expect(calls[2]!.body.max_results).toBe(10);
    expect(result.details.depth).toBe("deep");
  });

  it("stops the chain on a usable Parallel answer without calling Tavily", async () => {
    install([jsonResponse(cleanGroundingBody())]);
    const result = await run();

    expect(calls).toHaveLength(1);
    expect(result.details.answerProvider).toBe("gemini-parallel-grounding");
    expect(result.details.degraded).toBe(false);
  });

  it("stops the chain on a usable Exa answer without calling Tavily", async () => {
    install([parallelFailure(), jsonResponse(cleanGroundingBody("Exa grounded answer."))]);
    const result = await run();

    expect(calls).toHaveLength(2);
    expect(result.details.answerProvider).toBe("gemini-exa-grounding");
    expect(result.content[0].text).toContain("Exa grounded answer [0].");
  });

  it("returns the degraded ordered source document when Tavily is selected", async () => {
    install([parallelFailure(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();
    const text = result.content[0].text;

    expect(text.startsWith("## Search results")).toBe(true);
    expect(text).toContain("### [0] Example Docs");
    expect(text).toContain("URL: https://example.com/docs");
    expect(text).toContain("Example documentation snippet.");
    expect(text).toContain("### [1] Example Blog");
  });

  it("returns the generic unavailable outcome when Tavily also fails", async () => {
    install([parallelFailure(), exaFailure(), jsonResponse({ results: [] }, 200)]);
    const result = await run();

    expect(calls).toHaveLength(3);
    expect(result.details.answerProvider).toBeNull();
    expect(result.details.selectedProvider).toBe("none");
    expect(result.content[0].text).toContain("Web search could not produce usable results");
    expect(result.content[0].text).not.toContain("grounded answer");
  });

  it("makes zero HTTP calls and three safe skips when Google, Exa, and Tavily are all missing", async () => {
    setTestEnv({
      [TEST_ENV_NAMES.googleCloudApiKeyEnv]: undefined,
      [TEST_ENV_NAMES.exaApiKeyEnv]: undefined,
      [TEST_ENV_NAMES.tavilyApiKeyEnv]: undefined,
    });
    install([]);
    const result = await run();

    expect(calls).toHaveLength(0);
    expect(result.details.attemptCount).toBe(3);
    expect(result.details.attemptProviders).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
    expect(result.details.failureCategories).toEqual(["skipped_missing_credentials"]);
    expect(result.details.answerProvider).toBeNull();
    expect(result.content[0].text).toContain("Web search could not produce usable results");
  });

  it("never skips Parallel when PARALLEL_API_KEY is unset and still reaches Tavily", async () => {
    setTestEnv({ [TEST_ENV_NAMES.parallelApiKeyEnv]: undefined });
    install([parallelFailure(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();

    expect(calls).toHaveLength(3);
    const geminiTool = calls[0]!.body.tools[0] as Record<string, any>;
    expect("api_key" in geminiTool.parallelAiSearch).toBe(false);
    expect(result.details.answerProvider).toBe("tavily-search");
  });

  it("prevents Tavily after a Gemini prompt safety block at the Parallel stage", async () => {
    install([jsonResponse({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] })]);
    const result = await run();

    expect(calls).toHaveLength(1);
    expect(result.details.fallbackUsed).toBe(false);
    expect(result.details.answerProvider).toBeNull();
    expect(result.details.failureCategories).toEqual(["blocked_SAFETY"]);
  });

  it("prevents Tavily after a Gemini prompt safety block at the Exa stage", async () => {
    install([parallelFailure(), jsonResponse({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] })]);
    const result = await run();

    expect(calls).toHaveLength(2);
    expect(result.details.answerProvider).toBeNull();
    expect(result.details.failureCategories).toEqual(["http_503", "blocked_SAFETY"]);
  });

  it("prevents Tavily when the caller aborts during the Exa stage", async () => {
    const controller = new AbortController();
    install((_call, index) => {
      if (index === 0) return parallelFailure();
      if (index === 1) {
        controller.abort();
        return exaFailure();
      }
      return jsonResponse(cleanTavilyBody());
    });
    const result = await run({}, controller.signal);

    expect(calls).toHaveLength(2);
    expect(result.details.answerProvider).toBeNull();
  });

  it("does not continue the chain when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    install([parallelFailure()]);
    const result = await run({}, controller.signal);

    // Only the Parallel call is made; cancellation is terminal before Tavily.
    expect(calls).toHaveLength(1);
    expect(result.details.answerProvider).toBeNull();
    expect(result.details.attemptCount).toBe(1);
  });

  it("keeps exactly one Exa retry for the recognized nested empty-query failure", async () => {
    install([parallelFailure(), exaEmptyQuery(), jsonResponse(cleanGroundingBody("Recovered answer."))]);
    const result = await run();

    expect(calls).toHaveLength(3);
    expect(result.details.attemptCount).toBe(3);
    expect(result.details.answerProvider).toBe("gemini-exa-grounding");
    expect(result.content[0].text).toContain("Recovered answer [0].");
  });

  it("reaches Tavily after the Exa retry fails, making at most four serial calls", async () => {
    install([parallelFailure(), exaEmptyQuery(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();

    expect(calls).toHaveLength(4);
    expect(result.details.attemptCount).toBe(4);
    expect(result.details.attemptProviders).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
    expect(result.details.answerProvider).toBe("tavily-search");
  });

  it("never retries a Tavily transport failure", async () => {
    let tavilyCalls = 0;
    install((_call, index) => {
      if (index >= 2) {
        tavilyCalls += 1;
        throw new Error("socket hang up");
      }
      return index === 0 ? parallelFailure() : exaFailure();
    });
    const result = await run();

    expect(tavilyCalls).toBe(1);
    expect(result.details.answerProvider).toBeNull();
    expect(result.details.failureCategories).toEqual(["http_503", "http_500", "transport_error"]);
  });

  it("does not retry Tavily after an empty result set", async () => {
    let tavilyCalls = 0;
    install((_call, index) => {
      if (index >= 2) {
        tavilyCalls += 1;
        return jsonResponse({ results: [] });
      }
      return index === 0 ? parallelFailure() : exaFailure();
    });
    const result = await run();

    expect(tavilyCalls).toBe(1);
    expect(result.details.failureCategories).toEqual(["http_503", "http_500", "no_results"]);
  });

  it("still returns the degraded Tavily document when the diagnostic write is blocked", async () => {
    const responsesDir = join(cacheDir, "responses");
    await writeFile(responsesDir, "blocker", "utf8");
    install([parallelFailure(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();

    expect(result.content[0].text).toContain("## Search results");
    expect(result.details.answerProvider).toBe("tavily-search");
    expect(await readFile(responsesDir, "utf8")).toBe("blocker");
  });

  it("does not route web_code_search through Tavily", async () => {
    install([
      jsonResponse({ success: true, results: [], coverage: {}, reranked: false }),
      jsonResponse({ response: "code", resultsCount: 1 }),
    ]);
    await executeWebCodeSearch(
      { query: "How do I validate input?", focus: "developer_sources" },
      undefined,
      { config: config() },
    );

    expect(calls.every((call) => call.url !== TAVILY_URL)).toBe(true);
  });
});

describe("Tavily response normalization", () => {
  it("normalizes clean results in order keeping only title, URL, content, and finite score", () => {
    const normalized = parseTavilySearchResponse(
      cleanTavilyBody([
        { title: "A", url: "https://a.example/x", content: "ca", score: 0.9 },
        { title: "B", url: "https://b.example/y", content: "cb", score: "0.4", extra: "dropped" },
      ]),
    );

    expect(normalized.results).toHaveLength(2);
    expect(normalized.results[0]).toEqual({ title: "A", url: "https://a.example/x", content: "ca", score: 0.9 });
    expect(normalized.results[1]).toEqual({ title: "B", url: "https://b.example/y", content: "cb" });
    expect(normalized.resultsTotal).toBe(2);
    expect(normalized.usableResultsCount).toBe(2);
    expect(normalized.resultsOmitted).toBe(0);
    expect(normalized.resultsArrayPresent).toBe(true);
    expect(normalized.requestId).toBe("tavily-req-1");
    expect(normalized.responseTime).toBe(1.23);
    expect(normalized.usageCredits).toBe(2);
  });

  it("drops non-object, URL-less, non-http, relative, and textless results", () => {
    const normalized = parseTavilySearchResponse({
      results: [
        null,
        42,
        "text",
        { title: "NoUrl", content: "c" },
        { title: "Ftp", url: "ftp://example.com/f", content: "c" },
        { title: "Rel", url: "/docs", content: "c" },
        { title: "  ", url: "https://example.com/blank", content: "" },
        { title: "Kept", url: "https://example.com/kept", content: "c" },
      ],
    });

    expect(normalized.results.map((result) => result.title)).toEqual(["Kept"]);
    expect(normalized.resultsTotal).toBe(8);
    expect(normalized.usableResultsCount).toBe(1);
    expect(normalized.resultsOmitted).toBe(7);
  });

  it("strips terminal control sequences from candidate strings", () => {
    const escape = String.fromCharCode(27);
    const normalized = parseTavilySearchResponse({
      results: [
        { title: `${escape}[31mTitle${escape}[0m`, url: ` https://example.com/a${escape} `, content: `${escape}[2mc${escape}[0m` },
      ],
    });

    expect(normalized.results[0]!.title).toBe("Title");
    expect(normalized.results[0]!.content).toBe("c");
    expect(normalized.results[0]!.url).toBe("https://example.com/a");
  });

  it("trims and normalizes URLs to absolute lowercase-host http/https form", () => {
    const normalized = parseTavilySearchResponse({
      results: [{ title: "T", url: "  https://Example.com/Docs#frag  ", content: "c" }],
    });

    expect(normalized.results[0]!.url).toBe("https://example.com/Docs");
  });

  it("keeps a title-only result with empty content", () => {
    const normalized = parseTavilySearchResponse({
      results: [{ title: "TitleOnly", url: "https://example.com/t", content: "" }],
    });

    expect(normalized.results).toHaveLength(1);
    expect(normalized.results[0]!.content).toBe("");
  });

  it("drops results whose URL exceeds the 2000-character output bound instead of truncating", () => {
    const normalized = parseTavilySearchResponse({
      results: [
        { title: "Long", url: `https://example.com/${"a".repeat(2_100)}`, content: "c" },
        { title: "Exact", url: `https://example.com/${"b".repeat(2_000 - "https://example.com/".length)}`, content: "c" },
      ],
    });

    expect(normalized.results.map((result) => result.title)).toEqual(["Exact"]);
    expect(normalized.results[0]!.url.length).toBe(2_000);
  });

  it("caps retained results at 20 and keeps raw/usable/omitted counters", () => {
    const results = Array.from({ length: 25 }, (_, i) => ({
      title: `T${i}`,
      url: `https://example.com/${i}`,
      content: "c",
    }));
    const normalized = parseTavilySearchResponse({ results });

    expect(normalized.results).toHaveLength(20);
    expect(normalized.results[19]!.title).toBe("T19");
    expect(normalized.resultsTotal).toBe(25);
    expect(normalized.usableResultsCount).toBe(25);
    expect(normalized.resultsOmitted).toBe(5);
  });

  it("accepts response_time as a finite number or numeric string only", () => {
    expect(parseTavilySearchResponse({ results: [], response_time: 1.5 }).responseTime).toBe(1.5);
    expect(parseTavilySearchResponse({ results: [], response_time: "2.25" }).responseTime).toBe(2.25);
    expect(parseTavilySearchResponse({ results: [], response_time: "fast" }).responseTime).toBeUndefined();
    expect(parseTavilySearchResponse({ results: [], response_time: "" }).responseTime).toBeUndefined();
    expect(parseTavilySearchResponse({ results: [], response_time: null }).responseTime).toBeUndefined();
  });

  it("retains only finite numeric usage credits and tracks results-array presence", () => {
    expect(parseTavilySearchResponse({ results: [], usage: { credits: 3 } }).usageCredits).toBe(3);
    expect(parseTavilySearchResponse({ results: [], usage: { credits: "x" } }).usageCredits).toBeUndefined();
    const missing = parseTavilySearchResponse({ response_time: 1 });
    expect(missing.resultsArrayPresent).toBe(false);
    expect(missing.resultsTotal).toBe(0);
    expect(missing.results).toEqual([]);
  });
});

describe("Tavily usability routing predicate", () => {
  function tavilyAttempt(fields: {
    status?: number;
    bodyJson?: unknown;
    bodyText?: string;
    error?: string;
    normalized?: TavilySearchAttempt["normalized"];
  }): TavilySearchAttempt {
    return {
      provider: "tavily-search",
      requestStartedAt: "2026-08-28T00:00:00.000Z",
      elapsedMs: 10,
      rawResponse:
        fields.status === undefined
          ? undefined
          : {
              status: fields.status,
              statusText: "",
              headers: {},
              bodyText: fields.bodyText ?? JSON.stringify(fields.bodyJson ?? {}),
            },
      normalized: fields.normalized,
      error: fields.error,
    };
  }

  const usableNormalized = parseTavilySearchResponse(cleanTavilyBody());

  const table: Array<{ name: string; fields: Parameters<typeof tavilyAttempt>[0]; expected: boolean }> = [
    { name: "2xx with at least one survivor", fields: { status: 200, normalized: usableNormalized }, expected: true },
    { name: "missing HTTP status", fields: { normalized: usableNormalized }, expected: false },
    { name: "non-2xx status", fields: { status: 432, normalized: usableNormalized }, expected: false },
    { name: "2xx with unparsed JSON", fields: { status: 200, bodyText: "not json" }, expected: false },
    { name: "2xx with an empty results array", fields: { status: 200, normalized: parseTavilySearchResponse({ results: [] }) }, expected: false },
    { name: "2xx with a missing results array", fields: { status: 200, normalized: parseTavilySearchResponse({}) }, expected: false },
    { name: "2xx where every result was dropped", fields: { status: 200, normalized: parseTavilySearchResponse({ results: [{ title: "x" }] }) }, expected: false },
  ];

  for (const row of table) {
    it(`treats "${row.name}" as ${row.expected ? "usable" : "unusable"}`, () => {
      expect(isUsableTavilySearch(tavilyAttempt(row.fields))).toBe(row.expected);
    });
  }
});

describe("Tavily failure categories", () => {
  function tavilyAttempt(fields: {
    status?: number;
    normalized?: TavilySearchAttempt["normalized"];
    error?: string;
  }): TavilySearchAttempt {
    return {
      provider: "tavily-search",
      requestStartedAt: "2026-08-28T00:00:00.000Z",
      elapsedMs: 10,
      rawResponse: fields.status === undefined ? undefined : { status: fields.status, statusText: "", headers: {}, bodyText: "{}" },
      normalized: fields.normalized,
      error: fields.error,
    };
  }

  const usable = parseTavilySearchResponse(cleanTavilyBody());
  const empty = parseTavilySearchResponse({ results: [] });
  const missingArray = parseTavilySearchResponse({});
  const allDropped = parseTavilySearchResponse({ results: [{ title: "x" }] });

  const table: Array<{ name: string; fields: Parameters<typeof tavilyAttempt>[0]; expected: string | null }> = [
    { name: "2xx usable with survivors", fields: { status: 200, normalized: usable }, expected: null },
    { name: "missing status with a credential error", fields: { error: `Missing required environment variable ${TEST_ENV_NAMES.tavilyApiKeyEnv}` }, expected: "skipped_missing_credentials" },
    { name: "missing status with another error", fields: { error: "fetch failed" }, expected: "transport_error" },
    { name: "missing status without an error", fields: {}, expected: "unusable" },
    { name: "non-2xx status with a parsed usable-looking body", fields: { status: 502, normalized: usable }, expected: "http_502" },
    { name: "non-2xx status with an unparsed body", fields: { status: 401 }, expected: "http_401" },
    { name: "2xx with no normalized response", fields: { status: 200 }, expected: "unparsed" },
    { name: "2xx with a present but empty results array", fields: { status: 200, normalized: empty }, expected: "no_results" },
    { name: "2xx with a missing results array", fields: { status: 200, normalized: missingArray }, expected: "unusable" },
    { name: "2xx with no surviving results", fields: { status: 200, normalized: allDropped }, expected: "unusable" },
  ];

  for (const row of table) {
    it(`classifies ${row.name} as ${row.expected ?? "null"}`, () => {
      const attempt = tavilyAttempt(row.fields);
      expect(tavilyFailureCategory(attempt)).toBe(row.expected);
      // Parity: null exactly when the routing usability predicate accepts.
      expect(tavilyFailureCategory(attempt) === null).toBe(isUsableTavilySearch(attempt));
    });
  }

  it("dispatches by provider between the Tavily and grounding classifiers", () => {
    const tavily = tavilyAttempt({ status: 200, normalized: usable });
    const grounding: GroundingAttempt = {
      provider: "gemini-parallel-grounding",
      partner: "parallel",
      model: "gemini-3.5-flash",
      requestStartedAt: "2026-08-28T00:00:00.000Z",
      elapsedMs: 1,
      error: "fetch failed",
    };
    expect(webSearchFailureCategory(tavily)).toBeNull();
    expect(webSearchFailureCategory(grounding)).toBe(groundingFailureCategory(grounding));
    expect(webSearchFailureCategory(grounding)).toBe("transport_error");
  });
});

describe("Tavily degraded output document", () => {
  const secrets = [{ label: "WSE_TEST_TAVILY_KEY", value: TEST_KEYS.tavily }];

  function document(results: Array<Record<string, unknown>>): string {
    return formatTavilySearchDocument(parseTavilySearchResponse({ results }), secrets);
  }

  it("renders the exact degraded document shape in result order", () => {
    const text = document(tavilyResults());

    expect(text).toBe(
      [
        "## Search results",
        "",
        "### [0] Example Docs",
        "URL: https://example.com/docs",
        "Example documentation snippet.",
        "",
        "### [1] Example Blog",
        "URL: https://example.com/blog",
        "Example blog snippet.",
      ].join("\n"),
    );
  });

  it("uses the deterministic Result N title for content-only results", () => {
    const text = document([{ url: "https://example.com/only", content: "Snippet only." }]);

    expect(text).toContain("### [0] Result 1");
    expect(text).toContain("URL: https://example.com/only");
    expect(text).toContain("Snippet only.");
  });

  it("redacts every configured secret before bounds and strips terminal controls", () => {
    const escape = String.fromCharCode(27);
    const text = document([
      {
        title: `Ti${TEST_KEYS.tavily}tle ${escape}[31m`,
        url: "https://example.com/secret",
        content: `Snip ${TEST_KEYS.tavily}`,
      },
    ]);

    expect(text).toContain("[REDACTED_WSE_TEST_TAVILY_KEY]");
    expect(text).not.toContain(TEST_KEYS.tavily);
    expectNoSecretFragments(text, TEST_KEYS.tavily);
    expect(text).not.toContain(escape);
  });

  it("trims and collapses whitespace in titles and snippets", () => {
    const text = document([
      { title: "  A\t\nB   C  ", url: "https://example.com/ws", content: " x \n\n y \t z " },
    ]);

    expect(text).toContain("### [0] A B C");
    expect(text).toContain("x y z");
  });

  it("bounds titles at 500 and snippets at 4000 characters with the deterministic marker", () => {
    const text = document([
      { title: "T".repeat(600), url: "https://example.com/b", content: "S".repeat(5_000) },
    ]);

    const titleLine = text.split("\n")[2]!;
    expect(titleLine.length).toBe("### [0] ".length + 500);
    expect(titleLine.endsWith("[truncated at 500 characters]")).toBe(true);
    const snippet = text.split("\n")[4]!;
    expect(snippet.length).toBe(4_000);
    expect(snippet.endsWith("[truncated at 4000 characters]")).toBe(true);
  });

  it("never truncates a URL: results with URLs over 2000 characters are dropped", () => {
    const text = document([
      { title: "Long", url: `https://example.com/${"a".repeat(2_100)}`, content: "c" },
      { title: "Kept", url: "https://example.com/kept", content: "c" },
    ]);

    expect(text).not.toContain("aaaa");
    expect(text).toContain("https://example.com/kept");
    expect(text.split("\n").every((line) => !line.startsWith("URL: ") || line.length <= "URL: ".length + 2_000)).toBe(true);
  });

  it("drops a URL that redaction expands past 2000 before indexing and keeps display indices contiguous", () => {
    // Pre-redaction the URL is exactly 2000 characters, so normalization
    // keeps it; the longer redaction label then expands it past the bound.
    const prefix = "https://example.com/";
    const expandingUrl = prefix + TEST_KEYS.tavily + "a".repeat(2_000 - prefix.length - TEST_KEYS.tavily.length);
    expect(expandingUrl.length).toBe(2_000);
    const text = document([
      { title: "Dropped", url: expandingUrl, content: "Never shown." },
      { title: "Kept", url: "https://example.com/kept", content: "Kept snippet." },
      { url: "https://example.com/only", content: "Titleless snippet." },
    ]);

    expect(text).not.toContain("Dropped");
    expect(text).not.toContain("aaaa");
    expect(text).not.toContain(TEST_KEYS.tavily);
    // Contiguous zero-based display indices over the retained blocks only,
    // and the title-less result is numbered from its display index.
    expect(text).toContain("### [0] Kept");
    expect(text).toContain("### [1] Result 2");
    expect(text).not.toContain("### [2]");
    expect(text.split("\n").filter((line) => line.startsWith("### ["))).toHaveLength(2);
  });

  it("builds from whole result blocks with a total 50000 cap and a fitting marker", () => {
    const results = Array.from({ length: 14 }, (_, i) => ({
      title: `T${i}`,
      url: `https://example.com/${i}`,
      content: "S".repeat(4_000),
    }));
    const text = document(results);

    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(text).toMatch(/\[Output truncated at 50000 characters\. \d+ of 14 results omitted\.\]$/);
    // Whole-block truncation: every rendered URL is a complete line and every
    // rendered snippet is the full 4000 characters, never a cut fragment.
    const lines = text.split("\n");
    const urlLines = lines.filter((line) => line.startsWith("URL: "));
    for (const line of urlLines) expect(line).toMatch(/^URL: https:\/\/example\.com\/\d+$/);
    const snippetLines = lines.filter((line) => /^S+$/.test(line));
    for (const line of snippetLines) expect(line.length).toBe(4_000);
    // Deterministic: the same inputs render the same document.
    expect(document(results)).toBe(text);
  });

  it("adds no synthetic citations, answer, or error text", () => {
    const text = document(tavilyResults());

    expect(text).not.toContain("### Sources:");
    expect(text).not.toContain("Answer:");
    expect(text).not.toContain("Error");
  });
});

describe("Tavily stored-record bounds and redaction", () => {
  const secret = "wse-tavily-secret-" + "t".repeat(40);
  const secrets = [{ label: "WSE_TEST_TAVILY_KEY", value: secret }];
  const redacted = "[REDACTED_WSE_TEST_TAVILY_KEY]";

  function boundaryAttempt(): TavilySearchAttempt {
    return {
      provider: "tavily-search",
      requestStartedAt: "2026-08-28T00:00:00.000Z",
      elapsedMs: 12,
      rawRequest: {
        method: "POST",
        url: TAVILY_URL,
        headers: { Authorization: `Bearer ${secret}`, "x-long": "h".repeat(470) + secret },
        body: { query: "q", search_depth: "basic", max_results: 5 },
      },
      rawResponse: {
        status: 200,
        statusText: "s".repeat(470) + secret,
        headers: { "x-long": "h".repeat(470) + secret },
        bodyText: "b".repeat(20_100) + secret,
      },
      error: "e".repeat(470) + secret,
      normalized: {
        results: Array.from({ length: 25 }, (_, i) => ({
          title: "t".repeat(470) + secret,
          url: `https://example.com/${i}/` + "u".repeat(600),
          // The secret sits inside the redaction label that crosses the
          // 4000-character cutoff of the first result's content.
          content: "c".repeat(3_985) + secret + "c".repeat(600),
          score: 0.5,
        })),
        resultsTotal: 25,
        usableResultsCount: 25,
        resultsOmitted: 5,
        resultsArrayPresent: true,
        requestId: "r".repeat(470) + secret,
        responseTime: Number.POSITIVE_INFINITY,
        usageCredits: Number.POSITIVE_INFINITY,
      },
      // Out-of-contract delivered count: storage clamps it to the retention bound.
      deliveredResultsCount: 25,
    };
  }

  it("bounds every stored Tavily field with redaction before truncation", () => {
    const bounded = boundTavilyAttemptForStorage(boundaryAttempt(), secrets);
    const normalized = bounded.normalized!;

    expect(bounded.rawRequest!.headers.Authorization).toBe(`Bearer ${redacted}`);
    expect(bounded.rawRequest!.headers["x-long"]!.length).toBeLessThanOrEqual(500);
    expect(bounded.rawRequest!.headers["x-long"]).toContain(redacted);
    expect(bounded.rawResponse!.bodyText!.length).toBe(20_000);
    expect(bounded.rawResponse!.bodyText!.endsWith("[truncated at 20000 characters]")).toBe(true);
    expect(bounded.error!.length).toBeLessThanOrEqual(500);
    expect(bounded.error).toContain(redacted);

    expect(normalized.results).toHaveLength(20);
    expect(normalized.resultsTotal).toBe(25);
    expect(normalized.usableResultsCount).toBe(25);
    expect(normalized.resultsOmitted).toBe(5);
    expect(normalized.resultsArrayPresent).toBe(true);
    const result = normalized.results[0]!;
    expect(result.title!.length).toBeLessThanOrEqual(500);
    expect(result.title).toContain(redacted);
    expect(result.url!.length).toBeLessThanOrEqual(500);
    expect(result.url).toMatch(/\[\+sha256:[0-9a-f]{12}\]$/);
    // Content bound is 4000 per result. The secret sat inside the redaction
    // label crossing the cutoff, so the truncated copy can carry only a
    // partial label, never a partial secret fragment.
    expect(result.content.length).toBe(4_000);
    expect(result.content.endsWith("[truncated at 4000 characters]")).toBe(true);
    expect(result.content).not.toContain(secret);
    expect(result.score).toBe(0.5);
    expect(normalized.requestId!.length).toBeLessThanOrEqual(500);
    expect(normalized.requestId).toContain(redacted);
    // Non-finite numerics never survive.
    expect(normalized.responseTime).toBeUndefined();
    expect(normalized.usageCredits).toBeUndefined();
    // The recorded delivered count persists bounded: finite nonnegative only,
    // capped at the 20-result retention bound, never recomputed from URLs.
    expect(bounded.deliveredResultsCount).toBe(20);
    expect(
      boundTavilyAttemptForStorage({ ...boundaryAttempt(), deliveredResultsCount: -1 }, secrets)
        .deliveredResultsCount,
    ).toBeUndefined();
    expect(
      boundTavilyAttemptForStorage({ ...boundaryAttempt(), deliveredResultsCount: Number.POSITIVE_INFINITY }, secrets)
        .deliveredResultsCount,
    ).toBeUndefined();
    expect(boundTavilyAttemptForStorage({ ...boundaryAttempt() }, secrets).deliveredResultsCount).toBe(20);

    const serialized = JSON.stringify(bounded);
    expect(serialized).not.toContain(secret);
    expectNoSecretFragments(serialized, secret);
    // No unbounded spread: only the explicit allow-list of fields is stored.
    expect(Object.keys(normalized).sort()).toEqual([
      "requestId",
      "responseTime",
      "results",
      "resultsArrayPresent",
      "resultsOmitted",
      "resultsTotal",
      "usableResultsCount",
      "usageCredits",
    ]);
    expect(Object.keys(normalized.results[0]!).sort()).toEqual(["content", "score", "title", "url"]);
  });

  it("redacts the Tavily key from the persisted schema-3 record of a full flow", async () => {
    setTestEnv({ [TEST_ENV_NAMES.tavilyApiKeyEnv]: secret });
    install([
      parallelFailure(),
      exaFailure(),
      jsonResponse({
        results: [{ title: `Doc ${secret}`, url: "https://example.com/doc", content: `Snippet ${secret}`, score: 1 }],
      }),
    ]);
    const result = await run();

    const stored = await readFile(responsePath(cacheDir, result.details.responseId as string), "utf8");
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain(TEST_KEYS.tavily);
    expectNoSecretFragments(stored, secret);
    const record = JSON.parse(stored);
    expect(record.schemaVersion).toBe(3);
    const tavily = record.attempts[2];
    expect(tavily.rawRequest.headers.Authorization).toBe(`Bearer ${redacted}`);
    // The final post-redaction delivery outcome persists on the bounded attempt.
    expect(tavily.deliveredResultsCount).toBe(1);
    expect(tavilyFailureCategory(tavily)).toBeNull();
    expect(tavily.normalized.results[0].title).toBe(`Doc ${redacted}`);
    expect(tavily.normalized.results[0].content).toBe(`Snippet ${redacted}`);
    // The model-visible document is redacted too.
    expect(result.content[0].text).toContain(`Doc ${redacted}`);
    expect(result.content[0].text).not.toContain(secret);
    expect(JSON.stringify(result.details)).not.toContain(secret);
  });
});

describe("schema-3 stored records and legacy compatibility", () => {
  const common = { responseId: "wse_tavily_0123456789", now: 1_000, ttlMs: 60_000, query: "q", secrets: [] };

  function failedParallel(): GroundingAttempt {
    return {
      provider: "gemini-parallel-grounding",
      partner: "parallel",
      model: "gemini-3.5-flash",
      requestStartedAt: "2026-08-28T00:00:00.000Z",
      elapsedMs: 5,
      rawResponse: { status: 503, statusText: "", headers: {}, bodyText: "{}" },
    };
  }

  function failedExa(): GroundingAttempt {
    return {
      provider: "gemini-exa-grounding",
      partner: "exa",
      model: "gemini-3.5-flash",
      requestStartedAt: "2026-08-28T00:00:01.000Z",
      elapsedMs: 5,
      rawResponse: { status: 500, statusText: "", headers: {}, bodyText: "{}" },
    };
  }

  function tavilySuccess(): TavilySearchAttempt {
    return {
      provider: "tavily-search",
      requestStartedAt: "2026-08-28T00:00:02.000Z",
      elapsedMs: 5,
      rawResponse: { status: 200, statusText: "", headers: {}, bodyText: "{}" },
      normalized: parseTavilySearchResponse(cleanTavilyBody()),
    };
  }

  it("stores a Tavily selection with schema 3 and clean legacy Gemini mirrors", () => {
    const tavily = tavilySuccess();
    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [failedParallel()],
      exaAttempts: [failedExa()],
      tavilyAttempt: tavily,
      selected: tavily,
    });

    expect(built.schemaVersion).toBe(3);
    expect(built.selectedProvider).toBe("tavily-search");
    expect(built.selectedResult.provider).toBe("tavily-search");
    expect(built.selectedResult.normalized).toBe(built.attempts[2]!.normalized);
    expect(built.attempts.map((attempt) => attempt.provider)).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
    // Gemini stage history stays even though Tavily was selected.
    expect(built.primary).toBe(built.attempts[0]);
    expect(built.fallback).toBe(built.attempts[1]);
    // No Tavily data in the legacy selected-response mirrors; the legacy
    // provider mirror keeps the final bounded Gemini attempt provider.
    const serialized = JSON.parse(JSON.stringify(built));
    expect(serialized.request).toBeUndefined();
    expect(serialized.response).toBeUndefined();
    expect(serialized.normalized).toBeNull();
    expect(serialized.googleResponseId).toBeUndefined();
    expect(serialized.provider).toBe("gemini-exa-grounding");
  });

  it("reports a null result count for a Tavily selection without the persisted delivery field", () => {
    // A Tavily-shaped record predating the persisted delivery field, or one
    // whose count was dropped by storage clamping, reports no count rather
    // than a count recomputed from the stored selection.
    const tavily = tavilySuccess();
    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [failedParallel()],
      exaAttempts: [failedExa()],
      tavilyAttempt: tavily,
      selected: tavily,
    });

    const details = detailsForSearch(built);
    expect(details.answerProvider).toBe("tavily-search");
    expect(details.degraded).toBe(true);
    expect(details.resultCount).toBeNull();
  });

  it("keeps the existing legacy mirror meanings for a Gemini selection", () => {
    const exaSuccess: GroundingAttempt = {
      provider: "gemini-exa-grounding",
      partner: "exa",
      model: "gemini-3.5-flash",
      requestStartedAt: "2026-08-28T00:00:01.000Z",
      elapsedMs: 5,
      rawRequest: { method: "POST", url: GEMINI_URL, headers: {}, body: {} },
      rawResponse: { status: 200, statusText: "", headers: {}, bodyText: "{}" },
      normalized: {
        answer: "Grounded answer.",
        finishReason: "STOP",
        cleanSuccess: true,
        sources: [{ groundingId: 0, title: "Docs", url: "https://example.com/docs" }],
        supports: [],
        webSearchQueries: ["q"],
        googleResponseId: "google-response-1",
      },
    };
    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [failedParallel()],
      exaAttempts: [exaSuccess],
      selected: exaSuccess,
    });

    expect(built.selectedResult.provider).toBe("gemini-exa-grounding");
    expect(built.provider).toBe("gemini-exa-grounding");
    expect(built.request).toBe(built.attempts[1]!.rawRequest);
    expect(built.response).toBe(built.attempts[1]!.rawResponse);
    expect(built.normalized?.cleanSuccess).toBe(true);
    expect(built.googleResponseId).toBe("google-response-1");
  });

  it("stores a none selection as null with the Tavily skip in attempts", () => {
    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [failedParallel()],
      exaAttempts: [failedExa()],
      tavilyAttempt: {
        provider: "tavily-search",
        requestStartedAt: "2026-08-28T00:00:02.000Z",
        elapsedMs: 0,
        error: "Missing required environment variable WSE_TEST_TAVILY_KEY",
      },
      selected: undefined,
    });

    expect(built.selectedProvider).toBe("none");
    expect(built.selectedResult).toBeNull();
    expect(built.attempts).toHaveLength(3);
    expect(built.normalized).toBeNull();
    // The legacy provider mirror keeps the final bounded Gemini attempt
    // provider (the Exa fallback here), never none or tavily-search.
    expect(built.provider).toBe("gemini-exa-grounding");
  });

  it("reads schema-2 and pre-schema legacy web_search records compatibly", async () => {
    const legacy = {
      schemaVersion: 2,
      responseId: "wse_legacy_tavily_compat1",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      tool: "web_search",
      depth: "standard",
      selectedProvider: "gemini-exa-grounding",
      query: "legacy query",
      model: "gemini-3.5-flash",
      attempts: [failedExa()],
      provider: "gemini-exa-grounding",
      primary: failedExa(),
      normalized: {
        answer: "Legacy answer.",
        finishReason: "STOP",
        cleanSuccess: true,
        sources: [{ groundingId: 0, title: "Docs", url: "https://example.com/docs" }],
        supports: [],
        webSearchQueries: [],
      },
      fallback: null,
    };
    await mkdir(join(cacheDir, "responses"), { recursive: true });
    await writeFile(responsePath(cacheDir, legacy.responseId), JSON.stringify(legacy), "utf8");

    const read = await readStoredResponse(cacheDir, legacy.responseId);
    expect(read.selectedProvider).toBe("gemini-exa-grounding");
    const details = detailsForSearch(read);
    // Legacy records without selectedResult fall back to the Gemini mirror.
    expect(details.answerProvider).toBe("gemini-exa-grounding");
    expect(details.degraded).toBe(false);
    expect(details.resultCount).toBeNull();
    expect(details.sourceCount).toBe(1);
  });

  it("persists schema 3 for web_search while the other tools stay on schema 2", async () => {
    install([parallelFailure(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();
    const record = await readStoredResponse(cacheDir, result.details.responseId as string);
    expect(record.schemaVersion).toBe(3);

    install([jsonResponse({ success: true, results: [], coverage: {}, reranked: false }), jsonResponse({ response: "code", resultsCount: 1 })]);
    const code = await executeWebCodeSearch(
      { query: "How do I validate input?", focus: "developer_sources" },
      undefined,
      { config: config() },
    );
    const codeRecord = await readStoredToolRecord(cacheDir, code.details.responseId as string);
    expect(codeRecord.tool).toBe("web_code_search");
    expect(codeRecord.schemaVersion).toBe(2);
  });
});

describe("Tavily safe details and TUI summary", () => {
  function renderDetailsLine(result: ToolResult): string {
    const renderer = createWebSearchResultRenderer("web_search");
    const lines = renderer(result, { expanded: true, isPartial: false }, {}, {}).render(400) as string[];
    const line = lines.find((entry) => entry.startsWith("Details: "));
    if (!line) throw new Error(`no details line rendered in: ${JSON.stringify(lines)}`);
    return line.slice("Details: ".length);
  }

  it("reports the full degraded details contract for a Tavily selection", async () => {
    install([parallelFailure(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();
    const details = result.details;

    expect(details.answerProvider).toBe("tavily-search");
    expect(details.selectedProvider).toBe("tavily-search");
    expect(details.degraded).toBe(true);
    expect(details.fallbackUsed).toBe(true);
    expect(details.fallbackFrom).toBe("parallel");
    expect(details.resultCount).toBe(2);
    expect(details.attemptCount).toBe(3);
    expect(details.attemptProviders).toEqual(["gemini-parallel-grounding", "gemini-exa-grounding", "tavily-search"]);
    expect(details.failureCategories).toEqual(["http_503", "http_500"]);
    expect(details.googleResponseId).toBeNull();
    // No grounding counts for a degraded Tavily document.
    expect(details.sourceCount).toBeNull();
    expect(details.supportCount).toBeNull();
    expect(details.queryCount).toBeNull();
    expect(typeof details.elapsedMs).toBe("number");
    expect(details.responseId).toMatch(/^wse_/);
    expect(JSON.stringify(details)).not.toContain(TEST_ENV_NAMES.tavilyApiKeyEnv);
    expect(JSON.stringify(details)).not.toContain(TEST_KEYS.tavily);
  });

  it("counts duplicate Exa retry attempts in attempt details", async () => {
    install([parallelFailure(), exaEmptyQuery(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();

    expect(result.details.attemptCount).toBe(4);
    expect(result.details.attemptProviders).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
  });

  it("reports resultCount as the delivered blocks when redaction drops a URL after normalization", async () => {
    // The URL is exactly 2000 characters pre-redaction, so normalization keeps
    // it, but the secret's longer redaction label expands it past the bound
    // and the delivered document drops the whole result block.
    const prefix = "https://example.com/";
    const expandingUrl = prefix + TEST_KEYS.tavily + "a".repeat(2_000 - prefix.length - TEST_KEYS.tavily.length);
    install([
      parallelFailure(),
      exaFailure(),
      tavilyBody([
        { title: "Dropped", url: expandingUrl, content: "Never shown." },
        { title: "Kept", url: "https://example.com/kept", content: "Kept snippet." },
      ]),
    ]);
    const result = await run();
    const text = result.content[0].text;

    const deliveredBlocks = text.split("\n").filter((line) => line.startsWith("### [")).length;
    expect(deliveredBlocks).toBe(1);
    expect(text).toContain("### [0] Kept");
    // Parity: the safe count equals the delivered blocks, not the two
    // normalized results.
    expect(result.details.resultCount).toBe(deliveredBlocks);
    expect(result.details.resultCount).toBe(1);
  });

  it("uses the persisted delivered count for a stored record instead of recomputing from stored URLs", async () => {
    // Same live scenario: normalization keeps both 2000-character URLs, the
    // redaction label expands one past the format bound, and the live
    // delivered document keeps only one block.
    const prefix = "https://example.com/";
    const expandingUrl = prefix + TEST_KEYS.tavily + "a".repeat(2_000 - prefix.length - TEST_KEYS.tavily.length);
    install([
      parallelFailure(),
      exaFailure(),
      tavilyBody([
        { title: "Dropped", url: expandingUrl, content: "Never shown." },
        { title: "Kept", url: "https://example.com/kept", content: "Kept snippet." },
      ]),
    ]);
    const result = await run();

    const stored = await readStoredResponse(cacheDir, result.details.responseId as string);
    const storedTavily = stored.attempts.find((attempt) => attempt.provider === "tavily-search") as TavilySearchAttempt;
    // The final post-redaction delivery outcome persists as 1.
    expect(storedTavily.deliveredResultsCount).toBe(1);
    // Discriminating property: storage re-bounded the dropped URL back under
    // the 2000-character format bound, so recomputing the count from the
    // stored selection would retain both blocks and report 2.
    expect(storedTavily.normalized?.results).toHaveLength(2);
    expect(storedTavily.normalized!.results.every((entry) => entry.url.length <= 2_000)).toBe(true);
    // A details read from the stored record carries no live override, so the
    // count comes from the persisted field, never from stored URLs.
    const details = detailsForSearch(stored);
    expect(details.answerProvider).toBe("tavily-search");
    expect(details.resultCount).toBe(1);
  });

  it("does not select Tavily when redaction drops every result block after normalization", async () => {
    // Both URLs are exactly 2000 characters pre-redaction, so normalization
    // keeps them and provider usability passes; the longer redaction labels
    // then expand both past the bound, so the delivered document would carry
    // zero result blocks and Tavily must not be selected at all.
    const prefix = "https://example.com/";
    const expandingUrl = (tag: string) =>
      prefix + TEST_KEYS.tavily + "a".repeat(2_000 - prefix.length - TEST_KEYS.tavily.length - tag.length) + tag;
    expect(expandingUrl("1").length).toBe(2_000);
    install([
      parallelFailure(),
      exaFailure(),
      tavilyBody([
        { title: "Dropped One", url: expandingUrl("1"), content: "Never shown." },
        { title: "Dropped Two", url: expandingUrl("2"), content: "Never shown either." },
      ]),
    ]);
    const result = await run();
    const text = result.content[0].text;

    expect(calls).toHaveLength(3);
    // Generic unavailable content: no heading-only degraded document.
    expect(text).toContain("Web search could not produce usable results");
    expect(text).not.toContain("## Search results");
    expect(text).not.toContain("Dropped");
    // No Tavily selection in the safe details.
    expect(result.details.answerProvider).toBeNull();
    expect(result.details.selectedProvider).toBe("none");
    expect(result.details.degraded).toBe(false);
    expect(result.details.resultCount).toBeNull();
    // The chronological Tavily attempt is retained after the two failures.
    expect(result.details.attemptCount).toBe(3);
    expect(result.details.attemptProviders).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
    // The terminal Tavily failure is visible: zero post-redaction delivery
    // is classified unusable, exactly matching final acceptance.
    expect(result.details.failureCategories).toEqual(["http_503", "http_500", "unusable"]);
    // The stored schema-3 record stores a none selection with a null
    // selectedResult while keeping all three attempts.
    const record = await readStoredResponse(cacheDir, result.details.responseId as string);
    expect(record.selectedProvider).toBe("none");
    expect(record.selectedResult).toBeNull();
    expect(record.attempts.map((attempt) => attempt.provider)).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
    // The stored bounded Tavily attempt carries the final post-redaction
    // delivery outcome as an explicit field, never recomputed from stored
    // URLs, and the shared predicate and category agree on it.
    const storedTavily = record.attempts[2] as TavilySearchAttempt;
    expect(storedTavily.deliveredResultsCount).toBe(0);
    expect(isUsableTavilySearch(storedTavily)).toBe(false);
    expect(tavilyFailureCategory(storedTavily)).toBe("unusable");
    // The TUI safe failure summary includes unusable without errors or env names.
    const summary = renderDetailsLine(result);
    expect(summary).toContain("failures=http_503,http_500,unusable");
    expect(summary).toContain("attempts=3");
    expect(summary).not.toContain("WSE_TEST");
    expect(summary).not.toContain(TEST_KEYS.tavily);
    expect(summary).not.toContain("primaryError=");
    expect(JSON.stringify(result.details)).not.toContain(TEST_KEYS.tavily);
  });

  it("reports resultCount as the delivered blocks under the whole-block total cap", async () => {
    const results = Array.from({ length: 14 }, (_, i) => ({
      title: `T${i}`,
      url: `https://example.com/${i}`,
      content: "S".repeat(4_000),
    }));
    install([parallelFailure(), exaFailure(), tavilyBody(results)]);
    const result = await run();
    const text = result.content[0].text;

    const deliveredBlocks = text.split("\n").filter((line) => line.startsWith("### [")).length;
    expect(text).toMatch(/\[Output truncated at 50000 characters\. \d+ of 14 results omitted\.\]$/);
    expect(deliveredBlocks).toBeLessThan(14);
    // Parity: the safe count equals the delivered blocks after whole-block
    // total-cap truncation, not the 14 normalized results.
    expect(result.details.resultCount).toBe(deliveredBlocks);
    expect(result.details.resultCount).toBe(12);
  });

  it("renders provider=tavily-search with degraded, results, and routing diagnostics in the TUI", async () => {
    install([parallelFailure(), exaFailure(), jsonResponse(cleanTavilyBody())]);
    const result = await run();
    const summary = renderDetailsLine(result);

    expect(summary).toContain("provider=tavily-search");
    expect(summary).toContain("degraded=true");
    expect(summary).toContain("results=2");
    expect(summary).toContain("attempts=3");
    expect(summary).toContain("providers=gemini-parallel-grounding,gemini-exa-grounding,tavily-search");
    expect(summary).toContain("failures=http_503,http_500");
    expect(summary).toContain("elapsed=");
    expect(summary).toMatch(/responseId=wse_/);
    // No errors, env names, credentials, or grounding counts.
    expect(summary).not.toContain("WSE_TEST");
    expect(summary).not.toContain(TEST_KEYS.tavily);
    expect(summary).not.toContain("sources=");
    expect(summary).not.toContain("primaryError=");
  });

  it("keeps the call renderer summary unchanged for the web_search surface", () => {
    const theme = { bold: (text: string) => text, fg: (_name: string, text: string) => text };
    const summary = (
      createWebSearchCallRenderer("web_search")({ query: "How does X work?", depth: "deep" }, theme, {}) as {
        render: () => string[];
      }
    ).render().join("\n");
    expect(summary).toContain('query="How does X work?"');
    expect(summary).toContain("depth=deep");
  });
});

describe("tool surface and other tools unchanged", () => {
  it("still registers exactly three tools with unchanged public schemas", () => {
    const tools = createToolRegistrations();
    expect(tools.map((tool) => tool.name)).toEqual(["web_search", "web_code_search", "fetch_contents"]);

    const webSearch = webSearchSchema as Record<string, any>;
    expect(Object.keys(webSearch.properties).sort()).toEqual(["depth", "query"]);
    expect(webSearch.required).toEqual(["query"]);
    expect(webSearch.additionalProperties).toBe(false);
    expect(webSearch.properties.depth.enum).toEqual(["standard", "deep"]);
    expect(JSON.stringify(webSearchSchema)).not.toContain("provider");
    expect(JSON.stringify(webSearchSchema)).not.toContain("tavily");

    const codeSearch = webCodeSearchSchema as Record<string, any>;
    expect(codeSearch.required).toEqual(["query", "focus"]);
    const fetchContents = fetchContentsSchema as Record<string, any>;
    expect(fetchContents.required).toEqual(["uris"]);
    expect(fetchContents.properties.uris.maxItems).toBe(25);
  });

  it("documents the degraded ordered source document in the web_search description and guidelines", () => {
    const [webSearch] = createToolRegistrations();
    expect(webSearch.description).toContain("degraded ordered source document");
    expect(webSearch.description).toContain("synthesize and cite");
    const guidelines = webSearch.promptGuidelines?.join("\n") ?? "";
    expect(guidelines).toContain("degraded ordered source document");
    expect(guidelines).toContain("synthesize the answer yourself");
    expect(guidelines).toContain("cite their URLs");
  });
});
