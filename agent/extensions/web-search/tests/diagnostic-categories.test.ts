/**
 * Deterministic tests for the diagnostic failure-category contract of
 * web_search and web_code_search. Categories must classify by cause with the
 * numeric HTTP status checked before any normalized body, and null must mean
 * the orchestrator's usability predicate actually accepts the attempt. All
 * HTTP calls are stubbed, caches use temporary directories, and environment
 * variables use test-only names.
 */
import "./pi-tui-mock.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CodeSearchAttempt,
  CodeSearchProvider,
  GroundingAttempt,
  NormalizedCodeSearchResult,
  NormalizedGeminiGroundingResponse,
  NormalizedFirecrawlDeveloperSearch,
  NormalizedExaCodeSearch,
  RawHttpResponse,
  ToolResult,
} from "../src/types.js";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { executeWebSearch, executeWebCodeSearch } = await import("../src/tools.js");
const { codeFailureCategory, groundingFailureCategory } = await import("../src/diagnostics.js");
const { isUsableGroundingAttempt } = await import("../src/grounding-failure.js");
const { isUsableExaCodeSearch } = await import("../src/exa-code.js");
const { isUsableFirecrawlDeveloperSearch } = await import("../src/firecrawl-developer.js");
const { createWebSearchResultRenderer } = await import("../src/render.js");
const { DEFAULT_CONFIG } = await import("../src/config.js");
const {
  cleanGroundingBody,
  clearTestEnv,
  googleErrorBody,
  jsonResponse,
  mockFetch,
  setTestEnv,
  TEST_ENV_NAMES,
  TEST_KEYS,
  testConfig,
} = await import("./helpers.js");

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

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "wse-diag-categories-"));
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
  return mock.calls;
}

const config = () => testConfig({ cacheDir });

function renderDetailsLine(toolName: "web_search" | "web_code_search", result: ToolResult): string {
  const renderer = createWebSearchResultRenderer(toolName);
  const lines = renderer(result, { expanded: true, isPartial: false }, {}, {}).render(400) as string[];
  const line = lines.find((entry) => entry.startsWith("Details: "));
  if (!line) throw new Error(`no details line rendered in: ${JSON.stringify(lines)}`);
  return line.slice("Details: ".length);
}

function rawResponse(status: number): RawHttpResponse {
  return { status, statusText: "", headers: {}, bodyText: "{}" };
}

function codeAttempt(
  provider: CodeSearchProvider,
  fields: { status?: number; normalized?: NormalizedCodeSearchResult; error?: string },
): CodeSearchAttempt {
  return {
    provider,
    requestStartedAt: "2026-08-27T00:00:00.000Z",
    elapsedMs: 10,
    rawResponse: fields.status === undefined ? undefined : rawResponse(fields.status),
    normalized: fields.normalized,
    error: fields.error,
  };
}

function firecrawlNormalized(
  success: boolean,
  resultCount: number,
): NormalizedFirecrawlDeveloperSearch {
  return {
    success,
    artifacts: success
      ? [{ type: "doc", url: "https://example.com/doc", passages: ["passage"] }]
      : [],
    resultCount,
  };
}

function exaNormalized(response: string, resultsCount?: number): NormalizedExaCodeSearch {
  return { response, resultsCount };
}

function groundingAttempt(fields: {
  status?: number;
  normalized?: NormalizedGeminiGroundingResponse;
  error?: string;
}): GroundingAttempt {
  return {
    provider: "gemini-parallel-grounding",
    partner: "parallel",
    model: "gemini-3.5-flash",
    requestStartedAt: "2026-08-27T00:00:00.000Z",
    elapsedMs: 10,
    rawResponse: fields.status === undefined ? undefined : rawResponse(fields.status),
    normalized: fields.normalized,
    error: fields.error,
  };
}

function cleanNormalized(answer = "Grounded answer."): NormalizedGeminiGroundingResponse {
  return {
    answer,
    finishReason: "STOP",
    cleanSuccess: true,
    sources: [{ groundingId: 0, title: "Docs", url: "https://example.com/docs" }],
    supports: [],
    webSearchQueries: ["query"],
  };
}

describe("groundingFailureCategory parity table", () => {
  const table: Array<{ name: string; fields: Parameters<typeof groundingAttempt>[0]; expected: string | null }> = [
    { name: "2xx clean STOP answer with sources", fields: { status: 200, normalized: cleanNormalized() }, expected: null },
    // The old classifier trusted normalized data before the HTTP status and
    // wrongly returned null for parsed non-2xx bodies.
    { name: "non-2xx parsed clean-looking body (503)", fields: { status: 503, normalized: cleanNormalized() }, expected: "http_503" },
    { name: "non-2xx parsed clean-looking body (400)", fields: { status: 400, normalized: cleanNormalized() }, expected: "http_400" },
    {
      name: "2xx prompt safety block",
      fields: { status: 200, normalized: { ...cleanNormalized(), promptBlockReason: "SAFETY", cleanSuccess: false } },
      expected: "blocked_SAFETY",
    },
    {
      name: "2xx non-STOP finish reason",
      fields: { status: 200, normalized: { ...cleanNormalized(), finishReason: "MAX_TOKENS", cleanSuccess: false } },
      expected: "finish_MAX_TOKENS",
    },
    {
      name: "2xx clean STOP answer without sources",
      fields: { status: 200, normalized: { ...cleanNormalized(), sources: [] } },
      expected: "unusable",
    },
    {
      name: "2xx STOP finish with empty answer",
      fields: { status: 200, normalized: { ...cleanNormalized(), answer: "   ", cleanSuccess: false } },
      expected: "unusable",
    },
    { name: "2xx unparsed response with an error string", fields: { status: 200, error: "late parse failure" }, expected: "error" },
    { name: "2xx unparsed response without an error string", fields: { status: 200 }, expected: "unusable" },
    {
      name: "missing status with a credential error",
      fields: { error: `Missing required environment variable ${TEST_ENV_NAMES.exaApiKeyEnv}` },
      expected: "skipped_missing_credentials",
    },
    { name: "missing status with another transport error", fields: { error: "socket hang up" }, expected: "transport_error" },
    // Clean normalized content without an HTTP status is still unusable.
    { name: "missing status with clean normalized content", fields: { normalized: cleanNormalized() }, expected: "unusable" },
    { name: "missing status without error or normalized content", fields: {}, expected: "unusable" },
  ];

  for (const row of table) {
    it(`classifies ${row.name} as ${row.expected ?? "null"}`, () => {
      const attempt = groundingAttempt(row.fields);
      expect(groundingFailureCategory(attempt)).toBe(row.expected);
      // Parity: null exactly when the routing usability predicate accepts.
      expect(groundingFailureCategory(attempt) === null).toBe(isUsableGroundingAttempt(attempt));
    });
  }
});

describe("codeFailureCategory parity table", () => {
  const table: Array<{
    name: string;
    provider: CodeSearchProvider;
    fields: Parameters<typeof codeAttempt>[1];
    expected: string | null;
  }> = [
    { name: "Firecrawl 2xx success with results", provider: "firecrawl-developer", fields: { status: 200, normalized: firecrawlNormalized(true, 1) }, expected: null },
    { name: "Firecrawl 2xx success with zero artifacts", provider: "firecrawl-developer", fields: { status: 200, normalized: firecrawlNormalized(true, 0) }, expected: "no_results" },
    { name: "Firecrawl 2xx failure flag with zero artifacts", provider: "firecrawl-developer", fields: { status: 200, normalized: firecrawlNormalized(false, 0) }, expected: "provider_failure" },
    { name: "Firecrawl 2xx failure flag with surviving artifacts", provider: "firecrawl-developer", fields: { status: 200, normalized: firecrawlNormalized(false, 1) }, expected: "provider_failure" },
    // The old classifier trusted normalized data before the HTTP status and
    // wrongly returned provider_failure for parsed non-2xx bodies.
    { name: "Firecrawl 500 with a parsed failure body", provider: "firecrawl-developer", fields: { status: 500, normalized: firecrawlNormalized(false, 0) }, expected: "http_500" },
    { name: "Firecrawl 402 with an unparsed body", provider: "firecrawl-developer", fields: { status: 402 }, expected: "http_402" },
    { name: "Firecrawl 200 with an unparsed body", provider: "firecrawl-developer", fields: { status: 200 }, expected: "unparsed" },
    { name: "Exa 2xx non-empty response without a count", provider: "exa-code", fields: { status: 200, normalized: exaNormalized("code context") }, expected: null },
    { name: "Exa 2xx non-empty response with a nonzero count", provider: "exa-code", fields: { status: 200, normalized: exaNormalized("code context", 12) }, expected: null },
    // The old classifier ignored resultsCount and wrongly returned null here.
    { name: "Exa 2xx explicit zero count with response text", provider: "exa-code", fields: { status: 200, normalized: exaNormalized("code context", 0) }, expected: "no_results" },
    { name: "Exa 2xx empty response without a count", provider: "exa-code", fields: { status: 200, normalized: exaNormalized("") }, expected: "empty_response" },
    { name: "Exa 2xx whitespace-only response", provider: "exa-code", fields: { status: 200, normalized: exaNormalized("  \n ") }, expected: "empty_response" },
    // The old classifier trusted normalized data before the HTTP status and
    // wrongly returned null for parsed non-2xx bodies with text.
    { name: "Exa 503 with parsed response text", provider: "exa-code", fields: { status: 503, normalized: exaNormalized("stale context", 3) }, expected: "http_503" },
    { name: "Exa 400 with a parsed empty response", provider: "exa-code", fields: { status: 400, normalized: exaNormalized("") }, expected: "http_400" },
    {
      name: "missing status with a credential error",
      provider: "exa-code",
      fields: { error: `Missing required environment variable ${TEST_ENV_NAMES.exaApiKeyEnv}` },
      expected: "skipped_missing_credentials",
    },
    { name: "missing status with another transport error", provider: "exa-code", fields: { error: "fetch failed" }, expected: "transport_error" },
    // Usable-looking normalized content without an HTTP status is still unusable.
    { name: "missing status with usable-looking Exa content", provider: "exa-code", fields: { normalized: exaNormalized("code context") }, expected: "unusable" },
    { name: "missing status without error or normalized content", provider: "firecrawl-developer", fields: {}, expected: "unusable" },
  ];

  for (const row of table) {
    it(`classifies ${row.name} as ${row.expected ?? "null"}`, () => {
      const attempt = codeAttempt(row.provider, row.fields);
      expect(codeFailureCategory(attempt)).toBe(row.expected);
      // Parity: null exactly when the routing usability predicate for the
      // attempt's provider accepts.
      const usable = row.provider === "firecrawl-developer"
        ? isUsableFirecrawlDeveloperSearch(attempt)
        : isUsableExaCodeSearch(attempt);
      expect(codeFailureCategory(attempt) === null).toBe(usable);
    });
  }
});

describe("groundingFailureCategory integration", () => {
  it("classifies a non-2xx clean-looking Parallel body as http_503 in details and TUI while fallback succeeds", async () => {
    install([
      jsonResponse(cleanGroundingBody("Primary clean-looking answer."), 503),
      jsonResponse(cleanGroundingBody("Exa fallback answer.")),
    ]);
    const result = await executeWebSearch(
      { query: "How does provider routing classify grounding failures?" },
      undefined,
      { config: config() },
    );

    expect(result.details!.answerProvider).toBe("gemini-exa-grounding");
    expect(result.details!.fallbackUsed).toBe(true);
    expect(result.details!.failureCategories).toEqual(["http_503"]);
    expect(result.content[0].text).toContain("Exa fallback answer [0].");
    const summary = renderDetailsLine("web_search", result);
    expect(summary).toContain("failures=http_503");
    expect(summary).toContain("provider=gemini-exa-grounding");
  });
});

describe("codeFailureCategory integration", () => {
  it("reports no_results for the Exa zero-results fallback in details and TUI", async () => {
    install([
      jsonResponse({ response: "Context text that reports zero results.", resultsCount: 0 }),
      jsonResponse(firecrawlSuccess),
    ]);
    const result = await executeWebCodeSearch(
      { query: "How do I validate a request body with Zod?", focus: "implementation_examples" },
      undefined,
      { config: config() },
    );

    expect(result.details!.answerProvider).toBe("firecrawl-developer");
    expect(result.details!.fallbackUsed).toBe(true);
    expect(result.details!.fallbackFrom).toBe("exa-code");
    expect(result.details!.resultCount).toBe(1);
    expect(result.details!.failureCategories).toEqual(["no_results"]);
    expect(result.content[0].text).toContain("Zod API");
    const summary = renderDetailsLine("web_code_search", result);
    expect(summary).toContain("failures=no_results");
    expect(summary).toContain("fallbackFrom=exa-code");
  });

  it("classifies a parsed Firecrawl 500 body as http_500 in details and TUI", async () => {
    install([
      jsonResponse({ success: false, error: "internal failure" }, 500),
      jsonResponse(exaCodeSuccess),
    ]);
    const result = await executeWebCodeSearch(
      { query: "How do I validate a request body with Zod?", focus: "developer_sources" },
      undefined,
      { config: config() },
    );

    expect(result.details!.answerProvider).toBe("exa-code");
    expect(result.details!.degraded).toBe(true);
    expect(result.details!.failureCategories).toEqual(["http_500"]);
    expect(result.content[0].text).toContain("z.object");
    const summary = renderDetailsLine("web_code_search", result);
    expect(summary).toContain("failures=http_500");
    expect(summary).toContain("fallbackFrom=firecrawl-developer");
  });

  it("classifies a parsed Exa 503 body with response text as http_503 in details and TUI", async () => {
    install([
      jsonResponse({ response: "Stale partial context.", resultsCount: 3 }, 503),
      jsonResponse(firecrawlSuccess),
    ]);
    const result = await executeWebCodeSearch(
      { query: "How do I validate a request body with Zod?", focus: "implementation_examples" },
      undefined,
      { config: config() },
    );

    expect(result.details!.answerProvider).toBe("firecrawl-developer");
    expect(result.details!.failureCategories).toEqual(["http_503"]);
    expect(result.content[0].text).toContain("Zod API");
    const summary = renderDetailsLine("web_code_search", result);
    expect(summary).toContain("failures=http_503");
    expect(summary).toContain("fallbackFrom=exa-code");
  });
});

describe("best-effort main record writes", () => {
  /** Blocks the diagnostic responses directory with a regular file and returns its path. */
  async function blockedResponsesDir(): Promise<string> {
    // A file where the responses directory belongs makes every diagnostic
    // write fail deterministically; unlike permission bits this cannot be
    // bypassed by a root test runner.
    const responsesDir = join(cacheDir, "responses");
    await writeFile(responsesDir, "blocker", "utf8");
    return responsesDir;
  }

  /** Asserts the blocker is intact, proving no diagnostic record was written. */
  async function expectNoRecordsWritten(blocker: string): Promise<void> {
    expect(await readFile(blocker, "utf8")).toBe("blocker");
    await expect(readdir(blocker)).rejects.toMatchObject({ code: "ENOTDIR" });
  }

  beforeEach(() => {
    // Every write stays inside the temporary test cache; the live default
    // cache directory is never read or written by these tests.
    expect(cacheDir.startsWith(tmpdir())).toBe(true);
    expect(cacheDir).not.toBe(DEFAULT_CONFIG.cacheDir);
  });

  it("web_search still returns the usable answer when the record write is blocked", async () => {
    const responsesDir = await blockedResponsesDir();
    install([jsonResponse(cleanGroundingBody("Grounded answer."))]);
    const result = await executeWebSearch(
      { query: "How does MJML syntax highlighting work in Neovim?" },
      undefined,
      { config: config() },
    );

    expect(result.content[0].text).toContain("Grounded answer [0].");
    expect(result.details!.responseId).toMatch(/^wse_/);
    expect(result.details!.answerProvider).toBe("gemini-parallel-grounding");
    await expectNoRecordsWritten(responsesDir);
  });

  it("web_search still returns the unavailable outcome when the record write is blocked", async () => {
    const responsesDir = await blockedResponsesDir();
    install([
      jsonResponse(googleErrorBody("upstream unavailable", 503, "UNAVAILABLE"), 503),
      jsonResponse(googleErrorBody("exa upstream down", 500, "INTERNAL"), 500),
    ]);
    const result = await executeWebSearch(
      { query: "How does MJML syntax highlighting work in Neovim?" },
      undefined,
      { config: config() },
    );

    expect(result.content[0].text).toContain("Web search could not produce usable results");
    expect(result.details!.responseId).toMatch(/^wse_/);
    expect(result.details!.answerProvider).toBeNull();
    // Both partners fail operationally, then the unconfigured Tavily fallback
    // is recorded as a credential skip.
    expect(result.details!.failureCategories).toEqual(["http_503", "http_500", "skipped_missing_credentials"]);
    await expectNoRecordsWritten(responsesDir);
  });

  it("web_code_search still returns the usable result when the record write is blocked", async () => {
    const responsesDir = await blockedResponsesDir();
    install([jsonResponse(exaCodeSuccess)]);
    const result = await executeWebCodeSearch(
      { query: "How do I validate a request body with Zod?", focus: "implementation_examples" },
      undefined,
      { config: config() },
    );

    expect(result.content[0].text).toContain("z.object");
    expect(result.details!.responseId).toMatch(/^wse_/);
    expect(result.details!.answerProvider).toBe("exa-code");
    expect(result.details!.resultCount).toBe(12);
    await expectNoRecordsWritten(responsesDir);
  });

  it("web_code_search still returns the unavailable outcome when the record write is blocked", async () => {
    const responsesDir = await blockedResponsesDir();
    install([
      jsonResponse({ success: false, error: "internal failure" }, 500),
      jsonResponse({ error: "exa down" }, 503),
    ]);
    const result = await executeWebCodeSearch(
      { query: "How do I validate a request body with Zod?", focus: "developer_sources" },
      undefined,
      { config: config() },
    );

    expect(result.content[0].text).toContain("Code search could not produce results");
    expect(result.details!.responseId).toMatch(/^wse_/);
    expect(result.details!.answerProvider).toBeNull();
    expect(result.details!.failureCategories).toEqual(["http_500", "http_503"]);
    await expectNoRecordsWritten(responsesDir);
  });
});
