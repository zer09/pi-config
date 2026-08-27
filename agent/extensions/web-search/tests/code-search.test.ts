import "./pi-tui-mock.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { executeWebCodeSearch } = await import("../src/tools.js");
const { responsePath } = await import("../src/storage.js");
const {
  clearTestEnv,
  jsonResponse,
  mockFetch,
  setTestEnv,
  TEST_ENV_NAMES,
  TEST_KEYS,
  testConfig,
} = await import("./helpers.js");

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/search/developer";
const EXA_CONTEXT_URL = "https://api.exa.ai/context";

const firecrawlSuccess = {
  success: true,
  results: [
    {
      id: "doc:zod",
      type: "doc",
      url: "https://zod.dev/api",
      title: "Zod API",
      passages: [{ text: "Use z.object to validate shapes." }],
    },
  ],
  coverage: { doc: "ok" },
  reranked: true,
};

const exaCodeSuccess = { response: "const schema = z.object({ a: z.string() });", resultsCount: 12, requestId: "req-9" };

let cacheDir: string;
let restore: (() => void) | undefined;
let calls: ReturnType<typeof mockFetch>["calls"];

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "wse-code-search-"));
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

function run(focus: "developer_sources" | "implementation_examples", signal?: AbortSignal, overrideConfig = config()) {
  return executeWebCodeSearch({ query: "How do I validate a request body with Zod?", focus }, signal, {
    config: overrideConfig,
  });
}

describe("web_code_search routing", () => {
  it("calls Firecrawl Developer first for developer_sources and stops on usable results", async () => {
    install([jsonResponse(firecrawlSuccess)]);
    const result = await run("developer_sources");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(FIRECRAWL_URL);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TEST_KEYS.firecrawl}`);
    expect(calls[0]!.body.k).toBe(10);
    expect(calls[0]!.body.passages).toBe(2);
    expect(result.details.answerProvider).toBe("firecrawl-developer");
    expect(result.details.fallbackUsed).toBe(false);
    expect(result.details.degraded).toBe(false);
    expect(result.details.resultCount).toBe(1);
    expect(result.details.coverage).toEqual({ doc: "ok" });
    expect(result.details.reranked).toBe(true);
    expect(result.content[0].text).toContain("Zod API");
    expect(result.content[0].text).toContain("Use z.object to validate shapes.");
  });

  it("falls back to Exa Code after Firecrawl operational failure and marks degraded", async () => {
    install([jsonResponse({ success: false }, 500), jsonResponse(exaCodeSuccess)]);
    const result = await run("developer_sources");

    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(EXA_CONTEXT_URL);
    expect(calls[1]!.headers["x-api-key"]).toBe(TEST_KEYS.exa);
    expect(result.details.answerProvider).toBe("exa-code");
    expect(result.details.fallbackUsed).toBe(true);
    expect(result.details.fallbackFrom).toBe("firecrawl-developer");
    expect(result.details.degraded).toBe(true);
    expect(result.details.resultCount).toBe(12);
    expect(result.details.requestId).toBe("req-9");
    expect(result.content[0].text).toContain("z.object");
  });

  it("treats zero usable Firecrawl results as an operational failure", async () => {
    install([jsonResponse({ success: true, results: [] }), jsonResponse(exaCodeSuccess)]);
    const result = await run("developer_sources");

    expect(calls).toHaveLength(2);
    expect(result.details.answerProvider).toBe("exa-code");
    expect(result.details.degraded).toBe(true);
  });

  it("treats Firecrawl artifacts without a URL as unusable and runs the Exa fallback", async () => {
    const urlLess = {
      success: true,
      results: [
        { id: "title-only", type: "issue", title: "No URL artifact", passages: [{ text: "Orphan passage." }] },
        { id: "passages-only", type: "doc", passages: [{ text: "Passage without a URL." }] },
      ],
    };
    install([jsonResponse(urlLess), jsonResponse(exaCodeSuccess)]);
    const result = await run("developer_sources");

    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(EXA_CONTEXT_URL);
    expect(result.details.answerProvider).toBe("exa-code");
    expect(result.details.degraded).toBe(true);
    expect(result.details.resultCount).toBe(12);
    // URL-less artifacts never reach model-visible output.
    expect(result.content[0].text).not.toContain("No URL artifact");
    expect(result.content[0].text).not.toContain("Orphan passage.");
    expect(result.content[0].text).toContain("z.object");
  });

  it("calls Exa Code first for implementation_examples and stops on usable output", async () => {
    install([jsonResponse(exaCodeSuccess)]);
    const result = await run("implementation_examples");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(EXA_CONTEXT_URL);
    expect(calls[0]!.body).toEqual({ query: "How do I validate a request body with Zod?", tokensNum: "dynamic" });
    expect(result.details.answerProvider).toBe("exa-code");
    expect(result.details.fallbackUsed).toBe(false);
    expect(result.content[0].text).toContain("z.object");
  });

  it("falls back from Exa failure to Firecrawl restricted to doc and readme types", async () => {
    install([jsonResponse({ error: "upstream" }, 503), jsonResponse(firecrawlSuccess)]);
    const result = await run("implementation_examples");

    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(FIRECRAWL_URL);
    expect(calls[1]!.body.types).toEqual(["doc", "readme"]);
    expect(result.details.answerProvider).toBe("firecrawl-developer");
    expect(result.details.fallbackFrom).toBe("exa-code");
    expect(result.details.degraded).toBe(false);
  });

  it("runs the restricted doc/readme Firecrawl fallback when Exa reports resultsCount 0", async () => {
    install([
      jsonResponse({ response: "Non-empty context that still reports zero results.", resultsCount: 0 }),
      jsonResponse(firecrawlSuccess),
    ]);
    const result = await run("implementation_examples");

    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(FIRECRAWL_URL);
    expect(calls[1]!.body.types).toEqual(["doc", "readme"]);
    expect(result.details.answerProvider).toBe("firecrawl-developer");
    expect(result.details.fallbackFrom).toBe("exa-code");
    expect(result.content[0].text).toContain("Zod API");
  });

  it("routes by focus, not by query keywords: the same query flips provider order", async () => {
    install([jsonResponse(firecrawlSuccess)]);
    await run("developer_sources");
    expect(calls[0]!.url).toBe(FIRECRAWL_URL);

    install([jsonResponse(exaCodeSuccess)]);
    await run("implementation_examples");
    expect(calls[0]!.url).toBe(EXA_CONTEXT_URL);
  });

  it("does not start the fallback after an abort", async () => {
    const controller = new AbortController();
    install([jsonResponse({ success: false }, 500)]);
    controller.abort();
    const result = await run("developer_sources", controller.signal);

    expect(calls).toHaveLength(1);
    expect(result.details.answerProvider).toBeNull();
    expect(result.details.fallbackUsed).toBe(false);
  });

  it("keeps provider failures out of model-visible output", async () => {
    install([
      jsonResponse({ success: false, error: "payment required on account test-firecrawl-key" }, 402),
      jsonResponse({ error: "Exa API key test-exa-key invalid" }, 401),
    ]);
    const result = await run("developer_sources");
    const text = result.content[0].text;

    expect(text).not.toContain("402");
    expect(text).not.toContain("401");
    expect(text).not.toContain("test-firecrawl-key");
    expect(text).not.toContain("test-exa-key");
    expect(text).toContain("Code search could not produce results");
    expect(result.details.attemptProviders).toEqual(["firecrawl-developer", "exa-code"]);
  });

  it("runs the keyless Firecrawl fallback for implementation_examples without an Exa key", async () => {
    setTestEnv({ [TEST_ENV_NAMES.exaApiKeyEnv]: undefined, [TEST_ENV_NAMES.firecrawlApiKeyEnv]: undefined });
    install([jsonResponse(firecrawlSuccess)]);
    const result = await run("implementation_examples");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(FIRECRAWL_URL);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(result.details.answerProvider).toBe("firecrawl-developer");
    expect(result.details.attemptProviders).toEqual(["exa-code", "firecrawl-developer"]);
    expect(result.details.attemptCount).toBe(2);
  });

  it("records a skipped Exa attempt and bounded output when both providers are unavailable", async () => {
    setTestEnv({ [TEST_ENV_NAMES.exaApiKeyEnv]: undefined });
    install([jsonResponse({ success: false }, 429)]);
    const result = await run("developer_sources");

    expect(calls).toHaveLength(1);
    expect(result.details.answerProvider).toBeNull();
    expect(result.details.attemptProviders).toEqual(["firecrawl-developer", "exa-code"]);
    expect(result.content[0].text).toContain("Code search could not produce results");
  });

  it("redacts Exa and Firecrawl credentials from the stored record", async () => {
    install([jsonResponse(exaCodeSuccess)]);
    const result = await run("implementation_examples");

    const stored = await readFile(responsePath(cacheDir, result.details.responseId as string), "utf8");
    expect(stored).not.toContain(TEST_KEYS.exa);
    expect(stored).not.toContain(TEST_KEYS.firecrawl);
    expect(stored).not.toContain(TEST_KEYS.google);
    expect(stored).not.toContain(TEST_KEYS.parallel);
    expect(stored).toContain("[REDACTED_WSE_TEST_EXA_KEY]");
    const record = JSON.parse(stored);
    expect(record.schemaVersion).toBe(2);
    expect(record.tool).toBe("web_code_search");
    expect(record.focus).toBe("implementation_examples");
    expect(record.attempts[0].rawRequest.headers["x-api-key"]).toBe("[REDACTED_WSE_TEST_EXA_KEY]");
  });
});
