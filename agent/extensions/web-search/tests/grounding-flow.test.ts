import "./pi-tui-mock.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { executeWebSearch } = await import("../src/tools.js");
const { responsePath } = await import("../src/storage.js");
const {
  cleanGroundingBody,
  cleanTavilyBody,
  clearTestEnv,
  EXA_EMPTY_QUERY_MESSAGE,
  googleErrorBody,
  jsonResponse,
  mockFetch,
  setTestEnv,
  TEST_ENV_NAMES,
  TEST_KEYS,
  testConfig,
} = await import("./helpers.js");

const GEMINI_URL = "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash:generateContent";
const TAVILY_URL = "https://api.tavily.com/search";

function safetyBlockedBody(): unknown {
  return { promptFeedback: { blockReason: "SAFETY" }, candidates: [] };
}

function answerWithoutSources(): unknown {
  const body = cleanGroundingBody("Answer without sources.") as Record<string, any>;
  body.candidates[0].groundingMetadata.groundingChunks = [];
  return body;
}

let cacheDir: string;
let restore: (() => void) | undefined;
let calls: ReturnType<typeof mockFetch>["calls"];

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "wse-grounding-flow-"));
  setTestEnv({
    [TEST_ENV_NAMES.googleCloudApiKeyEnv]: TEST_KEYS.google,
    [TEST_ENV_NAMES.parallelApiKeyEnv]: TEST_KEYS.parallel,
    [TEST_ENV_NAMES.exaApiKeyEnv]: TEST_KEYS.exa,
    [TEST_ENV_NAMES.firecrawlApiKeyEnv]: TEST_KEYS.firecrawl,
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
  return executeWebSearch({ query: "How does MJML syntax highlighting work in Neovim?", ...params }, signal, {
    config: config(),
  });
}

function toolOf(body: any): Record<string, any> {
  return body.tools[0];
}

describe("web_search grounding orchestration", () => {
  it("stops the provider chain on a clean Parallel success", async () => {
    install([jsonResponse(cleanGroundingBody())]);
    const result = await run();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(GEMINI_URL);
    // Omitted depth resolves to standard, which maps to Parallel mode basic.
    expect(toolOf(calls[0]!.body).parallelAiSearch.customConfigs.mode).toBe("basic");
    expect(toolOf(calls[0]!.body).parallelAiSearch.api_key).toBe(TEST_KEYS.parallel);
    expect(result.details.answerProvider).toBe("gemini-parallel-grounding");
    expect(result.details.fallbackUsed).toBe(false);
    expect(result.details.attemptCount).toBe(1);
    expect(result.details.sourceCount).toBe(1);
    expect(result.content[0].text).toContain("Grounded answer [0].");
    expect(result.content[0].text).toContain("### Sources:");
  });

  it("omits the Parallel api_key when no partner key is configured", async () => {
    setTestEnv({ [TEST_ENV_NAMES.parallelApiKeyEnv]: undefined });
    install([jsonResponse(cleanGroundingBody())]);
    await run();

    expect("api_key" in toolOf(calls[0]!.body).parallelAiSearch).toBe(false);
  });

  it("maps depth to the Parallel mode in the request body", async () => {
    install([jsonResponse(cleanGroundingBody()), jsonResponse(cleanGroundingBody())]);
    await run({ depth: "standard" });
    expect(toolOf(calls[0]!.body).parallelAiSearch.customConfigs.mode).toBe("basic");

    await run({ depth: "deep" });
    expect(toolOf(calls[1]!.body).parallelAiSearch.customConfigs.mode).toBe("advanced");
  });

  it("starts Gemini + Exa grounding after an eligible Parallel failure", async () => {
    install([
      jsonResponse(googleErrorBody("upstream unavailable", 503, "UNAVAILABLE")),
      jsonResponse(cleanGroundingBody("Exa grounded answer.")),
    ]);
    const result = await run();

    expect(calls).toHaveLength(2);
    expect(toolOf(calls[1]!.body).exaAiSearch.api_key).toBe(TEST_KEYS.exa);
    expect(toolOf(calls[1]!.body).exaAiSearch.customConfigs.type).toBe("fast");
    expect(toolOf(calls[1]!.body).exaAiSearch.customConfigs.numResults).toBe(5);
    expect(toolOf(calls[1]!.body).exaAiSearch.customConfigs.contents.highlights.maxCharacters).toBe(2000);
    expect(result.details.answerProvider).toBe("gemini-exa-grounding");
    expect(result.details.fallbackUsed).toBe(true);
    expect(result.details.fallbackFrom).toBe("parallel");
    expect(result.details.attemptProviders).toEqual(["gemini-parallel-grounding", "gemini-exa-grounding"]);
    expect(result.content[0].text).toContain("Exa grounded answer [0].");
  });

  it("uses the larger Exa budget for deep depth", async () => {
    install([
      jsonResponse(googleErrorBody("upstream unavailable", 503, "UNAVAILABLE")),
      jsonResponse(cleanGroundingBody()),
    ]);
    await run({ depth: "deep" });

    const customConfigs = toolOf(calls[1]!.body).exaAiSearch.customConfigs;
    expect(customConfigs.numResults).toBe(10);
    expect(customConfigs.contents.highlights.maxCharacters).toBe(4000);
  });

  it("does not treat a non-empty answer without sources as grounded success", async () => {
    install([jsonResponse(answerWithoutSources()), jsonResponse(cleanGroundingBody("Exa grounded answer."))]);
    const result = await run();

    expect(calls).toHaveLength(2);
    expect(result.details.answerProvider).toBe("gemini-exa-grounding");
    expect(result.details.fallbackReason).toBe("Gemini+Parallel returned no usable grounding sources.");
  });

  it("retries the Exa empty-query failure exactly once inside the flow", async () => {
    install([
      jsonResponse(googleErrorBody("upstream unavailable", 503, "UNAVAILABLE")),
      jsonResponse(googleErrorBody(EXA_EMPTY_QUERY_MESSAGE), 400),
      jsonResponse(cleanGroundingBody("Recovered answer.")),
    ]);
    const result = await run();

    expect(calls).toHaveLength(3);
    expect(result.details.answerProvider).toBe("gemini-exa-grounding");
    expect(result.details.attemptCount).toBe(3);
    expect(result.content[0].text).toContain("Recovered answer [0].");
  });

  it("does not start the Exa grounding attempt after an abort", async () => {
    const controller = new AbortController();
    install([jsonResponse(googleErrorBody("upstream unavailable", 503, "UNAVAILABLE"))]);
    controller.abort();
    const result = await run({}, controller.signal);

    expect(calls).toHaveLength(1);
    expect(result.details.fallbackUsed).toBe(false);
    expect(result.details.answerProvider).toBeNull();
  });

  it("does not switch grounding partners after a prompt safety block", async () => {
    install([jsonResponse(safetyBlockedBody())]);
    const result = await run();

    expect(calls).toHaveLength(1);
    expect(result.details.fallbackUsed).toBe(false);
    expect(result.details.answerProvider).toBeNull();
    expect(result.content[0].text).toContain("Web search could not produce usable results");
  });

  it("does not preflight-throw on a missing Google credential and skips both Gemini stages", async () => {
    setTestEnv({ [TEST_ENV_NAMES.googleCloudApiKeyEnv]: undefined, [TEST_ENV_NAMES.tavilyApiKeyEnv]: TEST_KEYS.tavily });
    install([jsonResponse(cleanTavilyBody())]);
    const result = await run();

    // Only the Tavily call is made; both Gemini stages are recorded as skips.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TAVILY_URL);
    expect(result.details.attemptProviders).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
    expect(result.details.failureCategories).toEqual(["skipped_missing_credentials"]);
    expect(result.details.answerProvider).toBe("tavily-search");
    expect(result.details.fallbackUsed).toBe(true);
    expect(result.content[0].text).toContain("## Search results");
  });

  it("records a skipped Exa attempt when only the Exa key is missing", async () => {
    setTestEnv({ [TEST_ENV_NAMES.exaApiKeyEnv]: undefined, [TEST_ENV_NAMES.tavilyApiKeyEnv]: TEST_KEYS.tavily });
    install([jsonResponse(googleErrorBody("upstream unavailable", 503, "UNAVAILABLE")), jsonResponse(cleanTavilyBody())]);
    const result = await run();

    expect(calls).toHaveLength(2);
    expect(result.details.attemptProviders).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "tavily-search",
    ]);
    expect(result.details.answerProvider).toBe("tavily-search");
  });

  it("keeps provider failures out of model-visible output when both partners fail", async () => {
    install([
      jsonResponse(googleErrorBody("Google internal quota exhausted for key test-google-key", 429, "RESOURCE_EXHAUSTED"), 429),
      jsonResponse(googleErrorBody("Exa upstream invalid key test-exa-key", 500, "INTERNAL"), 500),
    ]);
    const result = await run();
    const text = result.content[0].text;

    expect(text).not.toContain("429");
    expect(text).not.toContain("500");
    expect(text).not.toContain("test-google-key");
    expect(text).not.toContain("test-exa-key");
    expect(text).not.toContain("test-tavily-key");
    expect(text).toContain("Web search could not produce usable results");
    // Parallel 429, Exa 500, then the Tavily skip: three attempts, one skip.
    expect(result.details.attemptCount).toBe(3);
    expect(result.details.failureCategories).toEqual(["http_429", "http_500", "skipped_missing_credentials"]);
  });

  it("redacts all five credentials from the stored record", async () => {
    setTestEnv({ [TEST_ENV_NAMES.tavilyApiKeyEnv]: TEST_KEYS.tavily });
    install([
      jsonResponse(cleanGroundingBody()),
    ]);
    const result = await run();

    const stored = await readFile(responsePath(cacheDir, result.details.responseId as string), "utf8");
    expect(stored).not.toContain(TEST_KEYS.google);
    expect(stored).not.toContain(TEST_KEYS.parallel);
    expect(stored).not.toContain(TEST_KEYS.exa);
    expect(stored).not.toContain(TEST_KEYS.firecrawl);
    expect(stored).not.toContain(TEST_KEYS.tavily);
    const record = JSON.parse(stored);
    expect(record.schemaVersion).toBe(3);
    expect(record.tool).toBe("web_search");
    expect(record.depth).toBe("standard");
    expect(record.selectedProvider).toBe("gemini-parallel-grounding");
    expect(record.selectedResult.provider).toBe("gemini-parallel-grounding");
    expect(record.attempts[0].rawRequest.headers["x-goog-api-key"]).toBe("[REDACTED_WSE_TEST_GOOGLE_KEY]");
    expect(JSON.stringify(record.attempts[0].rawRequest.body)).toContain("[REDACTED_WSE_TEST_PARALLEL_KEY]");
  });
});
