/**
 * Deterministic tests for the fetch_contents diagnostic-record system and the
 * shared preflight diagnostic records. All HTTP calls are stubbed, caches use
 * temporary directories, and environment variables use test-only names.
 */
import "./pi-tui-mock.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResult } from "../src/types.js";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const {
  executeFetchContents,
  executeWebSearch,
  executeWebCodeSearch,
  createToolRegistrations,
} = await import("../src/tools.js");
const { readStoredToolRecord, readStoredResponse, responsePath } = await import("../src/storage.js");
const {
  boundUrlForStorage,
  buildStoredFetchContentsRecord,
  DIAGNOSTIC_MAX_ATTEMPT_URLS,
  DIAGNOSTIC_MAX_BODY_CHARS,
  DIAGNOSTIC_MAX_FETCH_ATTEMPTS,
  DIAGNOSTIC_MAX_FETCH_RESULTS,
  DIAGNOSTIC_MAX_PER_URL_ENTRIES,
  DIAGNOSTIC_MAX_STRING_CHARS,
  DIAGNOSTIC_MAX_URL_CHARS,
  preflightSettingsFrom,
  writePreflightDiagnostic,
} = await import("../src/diagnostics.js");
const { DEFAULT_CONFIG, ONE_MONTH_MS, setConfigLoaderForTests } = await import("../src/config.js");
const { normalizeUrl } = await import("../src/url.js");
const { createWebSearchResultRenderer } = await import("../src/render.js");
const {
  clearTestEnv,
  cleanGroundingBody,
  expectNoSecretFragments,
  jsonResponse,
  mockFetch,
  setTestEnv,
  TEST_ENV_NAMES,
  TEST_KEYS,
  testConfig,
} = await import("./helpers.js");

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const TEST_TTL_MS = 60_000;

function scrapeSuccess(markdown = "# Title\n\nBody text.", url = "https://example.com/a"): unknown {
  return {
    success: true,
    data: { markdown, metadata: { title: "Page Title", sourceURL: url, statusCode: 200 } },
  };
}

function exaContentsSuccess(urls: string[]): unknown {
  return {
    results: urls.map((url) => ({ url, title: "Exa Title", text: "Exa markdown body." })),
    statuses: urls.map((url) => ({ id: url, status: "success" })),
  };
}

let cacheDir: string;
let restore: (() => void) | undefined;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "wse-fetch-diag-"));
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

const config = () => testConfig({ cacheDir, rawResponseTtlMs: TEST_TTL_MS });

async function readRecord(responseId: string) {
  return readStoredToolRecord(cacheDir, responseId) as Record<string, any>;
}

async function readRecordFile(responseId: string): Promise<string> {
  return readFile(responsePath(cacheDir, responseId), "utf8");
}

function renderDetailsLine(toolName: "web_search" | "web_code_search" | "fetch_contents", result: ToolResult): string {
  const renderer = createWebSearchResultRenderer(toolName);
  const lines = renderer(result, { expanded: true, isPartial: false }, {}, {}).render(400) as string[];
  const line = lines.find((entry) => entry.startsWith("Details: "));
  if (!line) throw new Error(`no details line rendered in: ${JSON.stringify(lines)}`);
  return line.slice("Details: ".length);
}

function responseIdFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Diagnostic responseId=([A-Za-z0-9._-]+)$/);
  if (!match) throw new Error(`missing diagnostic suffix on error: ${message}`);
  return match[1]!;
}

describe("fetch_contents diagnostic records", () => {
  it("stores a success record with request metadata, results, and one chronological attempt", async () => {
    install([jsonResponse(scrapeSuccess())]);
    const result = await executeFetchContents({ uris: ["https://example.com/a"] }, undefined, { config: config() });

    const record = await readRecord(result.details!.responseId as string);
    expect(record.tool).toBe("fetch_contents");
    expect(record.schemaVersion).toBe(2);
    expect(record.request).toEqual({ urlCount: 1, uniqueUrlCount: 1, maxCharacters: 12000, maxAgeHours: 24 });
    expect(record.expiresAt - record.createdAt).toBe(TEST_TTL_MS);
    expect(record.attempts).toHaveLength(1);
    expect(record.attempts[0].provider).toBe("firecrawl_scrape");
    expect(record.attempts[0].urls).toEqual(["https://example.com/a"]);
    expect(record.attempts[0].status).toBe("success");
    expect(record.attempts[0].normalized).toEqual({ success: true, statusCode: 200, markdownCharacters: expect.any(Number) });
    // The request body is stored as a bounded serialized string like the other tools.
    expect(typeof record.attempts[0].rawRequest.body).toBe("string");
    expect(JSON.parse(record.attempts[0].rawRequest.body).url).toBe("https://example.com/a");
    expect(record.attemptsTotal).toBe(1);
    expect(record.attemptsOmitted).toBe(0);
    expect(record.resultsTotal).toBe(1);
    expect(record.resultsOmitted).toBe(0);
    expect(record.results).toEqual([
      { normalizedUrl: "https://example.com/a", provider: "firecrawl_scrape", fromCache: false, status: null },
    ]);
  });

  it("stores mixed fallback attempts chronologically with the Exa batch last", async () => {
    install([
      jsonResponse(scrapeSuccess("# A", "https://example.com/a")),
      jsonResponse({ success: false, error: "paywall" }, 402),
      jsonResponse(exaContentsSuccess(["https://example.com/b"])),
    ]);
    const result = await executeFetchContents(
      { uris: ["https://example.com/a", "https://example.com/b"] },
      undefined,
      { config: config() },
    );

    const record = await readRecord(result.details!.responseId as string);
    expect(record.attempts).toHaveLength(3);
    expect(record.attempts[2].provider).toBe("exa_contents");
    expect(record.attempts[2].urls).toEqual(["https://example.com/b"]);
    expect(record.attempts[2].status).toBe("success");
    expect(record.attempts[2].normalized.perUrl).toEqual([
      { url: "https://example.com/b", ok: true, textCharacters: "Exa markdown body.".length },
    ]);
    const startedAt = record.attempts.map((attempt: any) => attempt.requestStartedAt);
    expect([...startedAt].sort()).toEqual(startedAt);
    expect(record.results.map((entry: any) => entry.provider)).toEqual(["firecrawl_scrape", "exa_contents"]);
    expect(record.request.uniqueUrlCount).toBe(2);
  });

  it("retains raw Firecrawl and Exa failure context in the record but never in model-visible output", async () => {
    const sentinel = "WSE-FETCH-FAIL-SENTINEL-91c2";
    const calls = install([
      jsonResponse({ success: false, error: `scrape rejected ${sentinel}` }, 402),
      jsonResponse({ error: `exa down ${sentinel}` }, 503),
    ]);
    void calls;
    const result = await executeFetchContents({ uris: ["https://example.com/bad"] }, undefined, { config: config() });

    const text = result.content[0].text;
    expect(text).toContain("Status: fetch failed");
    expect(text).not.toContain(sentinel);
    expect(text).not.toContain("scrape rejected");
    const detailsJson = JSON.stringify(result.details);
    expect(detailsJson).not.toContain(sentinel);
    const tui = renderDetailsLine("fetch_contents", result);
    expect(tui).not.toContain(sentinel);

    const record = await readRecord(result.details!.responseId as string);
    const recordJson = JSON.stringify(record);
    expect(recordJson).toContain(sentinel);
    expect(record.attempts[0].status).toBe("http_error");
    expect(record.attempts[0].rawResponse.status).toBe(402);
    expect(record.attempts[1].provider).toBe("exa_contents");
    expect(record.attempts[1].status).toBe("http_error");
    expect(record.attempts[1].rawResponse.status).toBe(503);
    expect(record.attempts[1].rawResponse.bodyText).toContain(sentinel);
    expect(record.results[0].status).toBe("fetch failed");
  });

  it("records aborted Firecrawl attempts and the skipped Exa fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    install(async (call) => {
      if (call.url === FIRECRAWL_SCRAPE_URL) throw new Error("The operation was aborted");
      throw new Error(`unexpected fetch call ${call.url}`);
    });

    const result = await executeFetchContents({ uris: ["https://example.com/a"] }, controller.signal, {
      config: config(),
    });

    expect(result.content[0].text).toContain("fetch failed");
    const record = await readRecord(result.details!.responseId as string);
    expect(record.attempts).toHaveLength(2);
    expect(record.attempts[0].provider).toBe("firecrawl_scrape");
    expect(record.attempts[0].status).toBe("aborted");
    expect(record.attempts[0].error).toContain("aborted");
    expect(record.attempts[1].provider).toBe("exa_contents");
    expect(record.attempts[1].status).toBe("skipped");
    expect(record.attempts[1].skippedReason).toContain("aborted");
  });

  it("stores a cache-only record with no provider attempts", async () => {
    const now = Date.now();
    const url = "https://example.com/a";
    await mkdir(join(cacheDir, "contents"), { recursive: true });
    const { contentPath } = await import("../src/storage.js");
    const { cacheKeyForUrl } = await import("../src/url.js");
    await writeFile(
      contentPath(cacheDir, cacheKeyForUrl(url)),
      JSON.stringify({
        url,
        normalizedUrl: url,
        fetchedAt: now - 1000,
        expiresAt: now + 100_000,
        requestedMaxCharacters: 12000,
        providerMaxAgeHours: 1,
        title: "Cached",
        text: "cached body",
        provider: "exa_contents",
      }),
      "utf8",
    );
    install([]);

    const result = await executeFetchContents({ uris: [url] }, undefined, { config: config() });

    const record = await readRecord(result.details!.responseId as string);
    expect(record.attempts).toEqual([]);
    expect(record.results[0]).toEqual({ normalizedUrl: url, provider: "exa_contents", fromCache: true, status: null });
    expect(result.details!.attemptCount).toBe(0);
  });

  it("fetches duplicate URLs once and records per-unique-URL attempts", async () => {
    install([
      jsonResponse(scrapeSuccess("# A", "https://example.com/a")),
      jsonResponse(scrapeSuccess("# B", "https://example.com/b")),
    ]);
    const result = await executeFetchContents(
      { uris: ["https://example.com/a", "https://example.com/b", "https://example.com/a"] },
      undefined,
      { config: config() },
    );

    const record = await readRecord(result.details!.responseId as string);
    expect(record.request.urlCount).toBe(3);
    expect(record.request.uniqueUrlCount).toBe(2);
    expect(record.attempts).toHaveLength(2);
    expect(new Set(record.attempts.map((attempt: any) => attempt.urls[0]))).toEqual(
      new Set(["https://example.com/a", "https://example.com/b"]),
    );
    expect(record.results).toHaveLength(3);
  });

  it("records maxAgeHours 0 in the request metadata while bypassing the cache", async () => {
    install([jsonResponse(scrapeSuccess())]);
    const result = await executeFetchContents(
      { uris: ["https://example.com/a"], maxAgeHours: 0 },
      undefined,
      { config: config() },
    );

    const record = await readRecord(result.details!.responseId as string);
    expect(record.request.maxAgeHours).toBe(0);
    expect(record.results[0].fromCache).toBe(false);
  });
});

describe("fetch record redaction and bounds", () => {
  it("deep-redacts all four credentials from headers and nested bodies", async () => {
    install([
      jsonResponse({
        success: false,
        error: `rejected google=${TEST_KEYS.google} parallel=${TEST_KEYS.parallel} exa=${TEST_KEYS.exa} firecrawl=${TEST_KEYS.firecrawl}`,
        nested: { keys: [TEST_KEYS.google, TEST_KEYS.exa] },
      }, 402),
      jsonResponse({ error: `exa saw ${TEST_KEYS.exa} and ${TEST_KEYS.google}` }, 500),
    ]);

    const result = await executeFetchContents({ uris: ["https://example.com/bad"] }, undefined, { config: config() });

    const serialized = await readRecordFile(result.details!.responseId as string);
    expect(serialized).not.toContain(TEST_KEYS.google);
    expect(serialized).not.toContain(TEST_KEYS.parallel);
    expect(serialized).not.toContain(TEST_KEYS.exa);
    expect(serialized).not.toContain(TEST_KEYS.firecrawl);
    const record = JSON.parse(serialized);
    expect(record.attempts[0].rawRequest.headers.Authorization).toBe(`Bearer [REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(record.attempts[1].rawRequest.headers["x-api-key"]).toBe(`[REDACTED_${TEST_ENV_NAMES.exaApiKeyEnv}]`);
    expect(record.attempts[0].rawResponse.bodyText).toContain(`[REDACTED_${TEST_ENV_NAMES.googleCloudApiKeyEnv}]`);
    expect(record.attempts[0].rawResponse.bodyText).toContain(`[REDACTED_${TEST_ENV_NAMES.parallelApiKeyEnv}]`);
  });

  it("bounds stored provider bodies and error strings with deterministic markers", async () => {
    const bigMarkdown = "x".repeat(DIAGNOSTIC_MAX_BODY_CHARS + 10_000);
    const longTransportError = "e".repeat(DIAGNOSTIC_MAX_STRING_CHARS + 500);
    install(async (call) => {
      if (call.url === FIRECRAWL_SCRAPE_URL && call.body.url === "https://example.com/a") {
        return jsonResponse(scrapeSuccess(bigMarkdown));
      }
      if (call.url === FIRECRAWL_SCRAPE_URL) return jsonResponse({ success: false, error: "no" }, 500);
      if (call.url === EXA_CONTENTS_URL) throw new Error(longTransportError);
      throw new Error(`unexpected fetch call ${call.url}`);
    });

    const result = await executeFetchContents(
      { uris: ["https://example.com/a", "https://example.com/b"] },
      undefined,
      { config: config() },
    );

    const record = await readRecord(result.details!.responseId as string);
    const firecrawl = record.attempts.find((attempt: any) => attempt.provider === "firecrawl_scrape" && attempt.status === "success");
    expect(firecrawl.rawResponse.bodyText.length).toBe(DIAGNOSTIC_MAX_BODY_CHARS);
    expect(firecrawl.rawResponse.bodyText.endsWith(`[truncated at ${DIAGNOSTIC_MAX_BODY_CHARS} characters]`)).toBe(true);
    // The parsed copy is dropped so the Markdown page is not stored twice.
    expect(firecrawl.rawResponse.bodyJson).toBeUndefined();
    const exa = record.attempts.find((attempt: any) => attempt.provider === "exa_contents");
    expect(exa.status).toBe("transport_error");
    expect(exa.error.length).toBe(DIAGNOSTIC_MAX_STRING_CHARS);
    expect(exa.error.endsWith(`[truncated at ${DIAGNOSTIC_MAX_STRING_CHARS} characters]`)).toBe(true);
  });

  it("replaces complete secrets in headers, status text, and bodies before bounding", async () => {
    const firecrawlSecret = "wse-fc-complete-boundary-" + "f".repeat(27);
    const exaSecret = "wse-exa-complete-boundary-" + "a".repeat(27);
    setTestEnv({
      [TEST_ENV_NAMES.firecrawlApiKeyEnv]: firecrawlSecret,
      [TEST_ENV_NAMES.exaApiKeyEnv]: exaSecret,
    });
    install([
      new Response(
        JSON.stringify({ success: false, error: `rejected with ${firecrawlSecret}` }),
        { status: 402, statusText: `denied ${firecrawlSecret}`, headers: { "x-note": `hint ${firecrawlSecret}` } },
      ),
      jsonResponse(exaContentsSuccess(["https://example.com/bad"])),
    ]);

    const result = await executeFetchContents({ uris: ["https://example.com/bad"] }, undefined, { config: config() });

    const serialized = await readRecordFile(result.details!.responseId as string);
    expect(serialized).not.toContain(firecrawlSecret);
    expect(serialized).not.toContain(exaSecret);
    expectNoSecretFragments(serialized, firecrawlSecret);
    expectNoSecretFragments(serialized, exaSecret);
    const record = JSON.parse(serialized);
    expect(record.attempts[0].rawResponse.statusText).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(record.attempts[0].rawResponse.headers["x-note"]).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(record.attempts[0].rawResponse.bodyText).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(record.attempts[0].rawRequest.headers.Authorization).toBe(`Bearer [REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(record.attempts[1].rawRequest.headers["x-api-key"]).toBe(`[REDACTED_${TEST_ENV_NAMES.exaApiKeyEnv}]`);
  });

  it("replaces secrets that cross each cutoff before truncating, leaving no partial fragment", async () => {
    // 200-char secrets with short padding: the raw value crosses its cutoff,
    // while the redacted replacement still fits inside the bound.
    const firecrawlSecret = "wse-fc-cross-boundary-" + "f".repeat(180);
    const exaSecret = "wse-exa-cross-boundary-" + "a".repeat(180);
    setTestEnv({
      [TEST_ENV_NAMES.firecrawlApiKeyEnv]: firecrawlSecret,
      [TEST_ENV_NAMES.exaApiKeyEnv]: exaSecret,
    });
    install(async (call) => {
      if (call.url === FIRECRAWL_SCRAPE_URL) {
        return new Response("b".repeat(19_900) + firecrawlSecret, {
          status: 500,
          statusText: "s".repeat(460) + firecrawlSecret,
          headers: { "x-note": "h".repeat(460) + firecrawlSecret },
        });
      }
      if (call.url === EXA_CONTENTS_URL) throw new Error("e".repeat(460) + exaSecret);
      throw new Error(`unexpected fetch call ${call.url}`);
    });

    const result = await executeFetchContents({ uris: ["https://example.com/bad"] }, undefined, { config: config() });

    const serialized = await readRecordFile(result.details!.responseId as string);
    expect(serialized).not.toContain(firecrawlSecret);
    expect(serialized).not.toContain(exaSecret);
    expectNoSecretFragments(serialized, firecrawlSecret);
    expectNoSecretFragments(serialized, exaSecret);
    const record = JSON.parse(serialized);
    const firecrawl = record.attempts[0];
    expect(firecrawl.rawResponse.statusText.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_STRING_CHARS);
    expect(firecrawl.rawResponse.statusText).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(firecrawl.rawResponse.headers["x-note"].length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_STRING_CHARS);
    expect(firecrawl.rawResponse.headers["x-note"]).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(firecrawl.rawResponse.bodyText.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_BODY_CHARS);
    expect(firecrawl.rawResponse.bodyText).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    const exa = record.attempts[1];
    expect(exa.status).toBe("transport_error");
    expect(exa.error.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_STRING_CHARS);
    expect(exa.error).toContain(`[REDACTED_${TEST_ENV_NAMES.exaApiKeyEnv}]`);
  });
});

describe("fetch record URL and collection bounds", () => {
  it("bounds every persisted long-URL copy while short URLs stay readable", async () => {
    const longUrl = "https://example.com/long/" + "q".repeat(DIAGNOSTIC_MAX_URL_CHARS + 800);
    const longNormalized = normalizeUrl(longUrl);
    install([
      jsonResponse(scrapeSuccess("# A", "https://example.com/a")),
      jsonResponse({ success: false, error: "paywall" }, 402),
      jsonResponse(exaContentsSuccess([longNormalized])),
    ]);
    const result = await executeFetchContents(
      { uris: ["https://example.com/a", longUrl] },
      undefined,
      { config: config() },
    );

    const record = await readRecord(result.details!.responseId as string);
    const firecrawl = record.attempts[0];
    // Short normal URLs stay readable verbatim in every stored copy.
    expect(firecrawl.urls).toEqual(["https://example.com/a"]);
    expect(firecrawl.urlsTotal).toBe(1);
    expect(firecrawl.urlsOmitted).toBe(0);
    expect(firecrawl.rawRequest.url).toBe("https://api.firecrawl.dev/v2/scrape");
    const exa = record.attempts[2];
    const storedLongUrl = exa.urls[0];
    expect(storedLongUrl.length).toBe(DIAGNOSTIC_MAX_URL_CHARS);
    expect(storedLongUrl).toMatch(/\[\+sha256:[0-9a-f]{12}\]$/);
    expect(exa.urlsTotal).toBe(1);
    expect(exa.normalized.perUrl[0].url).toBe(storedLongUrl);
    expect(exa.normalized.perUrlTotal).toBe(1);
    expect(exa.normalized.perUrlOmitted).toBe(0);
    expect(record.results.map((entry: any) => entry.normalizedUrl)).toEqual(["https://example.com/a", storedLongUrl]);
    expect(record.attemptsTotal).toBe(3);
    expect(record.attemptsOmitted).toBe(0);
    expect(record.resultsTotal).toBe(2);
    expect(record.resultsOmitted).toBe(0);
    // The raw URL survives only inside the bounded serialized request body.
    expect(typeof exa.rawRequest.body).toBe("string");
    expect(exa.rawRequest.body.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_BODY_CHARS);
    // Model-visible output reuses the stored bounded URL copies; the full
    // normalized URL appears only in the provider request captured above.
    const visible = (result.details!.results as Array<{ url: string; normalizedUrl: string }>)[1]!;
    expect(visible.url).toBe(storedLongUrl);
    expect(visible.normalizedUrl).toBe(storedLongUrl);
    expect(result.content[0].text).toContain("Exa markdown body.");
    expect(result.content[0].text).toContain(storedLongUrl);
    expect(result.content[0].text).not.toContain(longNormalized);
  });

  it("replaces a secret crossing the URL cutoff before truncation and digests the redacted URL", () => {
    const secret = "wse-url-cross-boundary-" + "z".repeat(180);
    const secrets = [{ label: TEST_ENV_NAMES.exaApiKeyEnv, value: secret }];
    // Both URLs place the secret across the 500-character cutoff; the second
    // keeps enough tail padding that the redaction label survives truncation.
    const crossing = "https://example.com/p/" + "x".repeat(490 - "https://example.com/p/".length) + "?k=" + secret;
    const labeled =
      "https://example.com/p/" + "x".repeat(430 - "https://example.com/p/".length) + "?k=" + secret + "&" + "t".repeat(120);

    const record = buildStoredFetchContentsRecord({
      responseId: "wse_url_bounds_0123456789ab",
      now: 1_000,
      ttlMs: 60_000,
      request: { urlCount: 2, uniqueUrlCount: 2, maxCharacters: 12_000, maxAgeHours: 24 },
      results: [
        { normalizedUrl: crossing, provider: null, fromCache: false, status: null },
        { normalizedUrl: labeled, provider: null, fromCache: false, status: null },
      ],
      attempts: [
        {
          provider: "exa_contents",
          urls: [crossing, labeled],
          requestStartedAt: "2026-08-27T00:00:00.000Z",
          elapsedMs: 1,
          status: "skipped",
          skippedReason: "test",
          dispatchOrdinal: 0,
        },
      ],
      secrets,
    });

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(secret);
    expectNoSecretFragments(serialized, secret);
    const storedCrossing = record.results[0].normalizedUrl;
    expect(storedCrossing.length).toBe(DIAGNOSTIC_MAX_URL_CHARS);
    expect(storedCrossing).toMatch(/\[\+sha256:[0-9a-f]{12}\]$/);
    expect(boundUrlForStorage(crossing, secrets)).toBe(storedCrossing);
    expect(record.attempts[0].urls[0]).toBe(storedCrossing);
    const storedLabeled = record.results[1].normalizedUrl;
    expect(storedLabeled.length).toBe(DIAGNOSTIC_MAX_URL_CHARS);
    expect(storedLabeled).toContain(`[REDACTED_${TEST_ENV_NAMES.exaApiKeyEnv}]`);
    expectNoSecretFragments(storedLabeled, secret);
  });

  it("keeps distinct long URLs distinguishable through deterministic digests", () => {
    const shared = "https://example.com/shared/" + "p".repeat(DIAGNOSTIC_MAX_URL_CHARS + 300);
    const first = boundUrlForStorage(`${shared}/a`, []);
    const second = boundUrlForStorage(`${shared}/b`, []);
    const digestOf = (value: string) => value.match(/\[\+sha256:([0-9a-f]{12})\]$/)![1];

    expect(first.length).toBe(DIAGNOSTIC_MAX_URL_CHARS);
    expect(second.length).toBe(DIAGNOSTIC_MAX_URL_CHARS);
    // Identical readable prefixes differ only in the digest of the full URL.
    expect(first.slice(0, DIAGNOSTIC_MAX_URL_CHARS - 22)).toBe(second.slice(0, DIAGNOSTIC_MAX_URL_CHARS - 22));
    expect(digestOf(first)).not.toBe(digestOf(second));
    // Deterministic: the same input always bounds to the same stored value.
    expect(boundUrlForStorage(`${shared}/a`, [])).toBe(first);
    // Short normal URLs stay readable verbatim.
    expect(boundUrlForStorage("https://example.com/a", [])).toBe("https://example.com/a");
  });

  it("caps persisted attempts, results, per-attempt URLs, and perUrl with retained counts", () => {
    const urls = Array.from({ length: DIAGNOSTIC_MAX_ATTEMPT_URLS + 10 }, (_, i) => `https://example.com/u/${i}`);
    const heavyAttempt = {
      provider: "exa_contents" as const,
      urls,
      requestStartedAt: "2026-08-27T00:00:00.000Z",
      elapsedMs: 1,
      normalized: {
        success: true,
        perUrl: urls.map((url) => ({ url, ok: true, textCharacters: 9 })),
      },
      status: "success" as const,
    };
    const attempts = Array.from({ length: DIAGNOSTIC_MAX_FETCH_ATTEMPTS + 10 }, (_, i) => ({
      ...heavyAttempt,
      dispatchOrdinal: i,
    }));
    const results = Array.from({ length: DIAGNOSTIC_MAX_FETCH_RESULTS + 10 }, (_, i) => ({
      normalizedUrl: urls[i % urls.length]!,
      provider: null,
      fromCache: false,
      status: null,
    }));

    const record = buildStoredFetchContentsRecord({
      responseId: "wse_caps_0123456789abcdef",
      now: 1_000,
      ttlMs: 60_000,
      request: { urlCount: results.length, uniqueUrlCount: urls.length, maxCharacters: 12_000, maxAgeHours: 24 },
      results,
      attempts,
      secrets: [],
    });

    expect(record.attempts).toHaveLength(DIAGNOSTIC_MAX_FETCH_ATTEMPTS);
    expect(record.attemptsTotal).toBe(DIAGNOSTIC_MAX_FETCH_ATTEMPTS + 10);
    expect(record.attemptsOmitted).toBe(10);
    // The earliest attempts in dispatch order are the ones retained.
    const stored = record.attempts[0]!;
    expect(stored.urls).toHaveLength(DIAGNOSTIC_MAX_ATTEMPT_URLS);
    expect(stored.urlsTotal).toBe(urls.length);
    expect(stored.urlsOmitted).toBe(10);
    expect(stored.urls[DIAGNOSTIC_MAX_ATTEMPT_URLS - 1]).toBe(urls[DIAGNOSTIC_MAX_ATTEMPT_URLS - 1]);
    expect(stored.normalized!.perUrl).toHaveLength(DIAGNOSTIC_MAX_PER_URL_ENTRIES);
    expect(stored.normalized!.perUrlTotal).toBe(urls.length);
    expect(stored.normalized!.perUrlOmitted).toBe(urls.length - DIAGNOSTIC_MAX_PER_URL_ENTRIES);
    expect(record.results).toHaveLength(DIAGNOSTIC_MAX_FETCH_RESULTS);
    expect(record.resultsTotal).toBe(DIAGNOSTIC_MAX_FETCH_RESULTS + 10);
    expect(record.resultsOmitted).toBe(10);
    expect(JSON.stringify(record)).not.toContain("dispatchOrdinal");
  });

  it("bounds the worst-case serialized fetch record size", () => {
    const maxUrl = ("https://example.com/w/" + "w".repeat(DIAGNOSTIC_MAX_URL_CHARS)).slice(0, DIAGNOSTIC_MAX_URL_CHARS);
    const urls = Array.from({ length: DIAGNOSTIC_MAX_ATTEMPT_URLS }, () => maxUrl);
    const heavyAttempt = {
      provider: "exa_contents" as const,
      urls,
      requestStartedAt: "2026-08-27T00:00:00.000Z",
      elapsedMs: 1,
      rawRequest: {
        method: "POST",
        url: maxUrl,
        headers: { "x-long": "h".repeat(DIAGNOSTIC_MAX_STRING_CHARS + 100) },
        body: { urls, padding: "p".repeat(DIAGNOSTIC_MAX_BODY_CHARS) },
      },
      rawResponse: {
        status: 200,
        statusText: "s".repeat(DIAGNOSTIC_MAX_STRING_CHARS + 100),
        headers: { "x-long": "h".repeat(DIAGNOSTIC_MAX_STRING_CHARS + 100) },
        bodyText: "b".repeat(DIAGNOSTIC_MAX_BODY_CHARS + 5_000),
      },
      normalized: {
        success: true,
        perUrl: urls.map((url) => ({ url, ok: true, textCharacters: 9_999 })),
      },
      status: "success" as const,
    };
    const attempts = Array.from({ length: DIAGNOSTIC_MAX_FETCH_ATTEMPTS + 5 }, (_, i) => ({
      ...heavyAttempt,
      dispatchOrdinal: i,
    }));
    const results = Array.from({ length: DIAGNOSTIC_MAX_FETCH_RESULTS + 5 }, () => ({
      normalizedUrl: maxUrl,
      provider: null,
      fromCache: false,
      status: null,
    }));

    const record = buildStoredFetchContentsRecord({
      responseId: "wse_worst_case_0123456789a",
      now: 1_000,
      ttlMs: 60_000,
      request: { urlCount: results.length, uniqueUrlCount: urls.length, maxCharacters: 12_000, maxAgeHours: 24 },
      results,
      attempts,
      secrets: [],
    });

    // The caps hold the worst case at a bounded serialized size in both the
    // compact form and the stored pretty-printed form, while staying heavy
    // enough to prove the maximum was actually exercised. The reachable
    // ceiling (26 attempts, 25 URLs/results per attempt) keeps the worst case
    // well below the pre-cap ~9.5 MB bound.
    const compact = JSON.stringify(record).length;
    const pretty = JSON.stringify(record, null, 2).length;
    expect(compact).toBeGreaterThan(1_000_000);
    expect(compact).toBeLessThanOrEqual(2_000_000);
    expect(pretty).toBeLessThanOrEqual(3_000_000);
  });
});

describe("fetch result status bounds", () => {
  it("bounds every stored and model-visible status copy at 500 characters and strips terminal controls", async () => {
    // A non-failure provider status whose label is oversized and carries a
    // terminal control sequence: every copy must be stripped and bounded.
    const longStatus = "\x1b[31mok-" + "s".repeat(2_000);
    install((call) => {
      if (call.url === EXA_CONTENTS_URL) {
        return jsonResponse({
          results: [{ url: "https://example.com/x", title: "X", text: "Exa body." }],
          statuses: [{ id: "https://example.com/x", status: longStatus }],
        });
      }
      return jsonResponse({ success: false, error: "paywall" }, 402);
    });
    const result = await executeFetchContents({ uris: ["https://example.com/x"] }, undefined, { config: config() });

    const record = await readRecord(result.details!.responseId as string);
    const storedStatus = record.results[0].status as string;
    expect(storedStatus.length).toBe(500);
    expect(storedStatus.endsWith("[truncated at 500 characters]")).toBe(true);
    expect(storedStatus).not.toContain("\x1b");
    // Tool details reuse the redacted stored status copy, not a raw label.
    const detailStatus = (result.details!.results as Array<{ status: string }>)[0]!.status;
    expect(detailStatus).toBe(storedStatus);
    // The model-visible output carries the same bounded, stripped label.
    const text = result.content[0].text;
    expect(text).toContain(`Status: ${storedStatus}`);
    expect(text).not.toContain("\x1b");
    expect(JSON.stringify(result)).not.toContain("s".repeat(600));
  });
});

describe("Exa Contents 2xx-unusable batches", () => {
  const RAW_SENTINEL = "WSE-EXA-RAW-SENTINEL-4b7e";

  it("marks a malformed 2xx body unusable_response with per-URL failures and no raw leak", async () => {
    install([
      jsonResponse({ success: false, error: "paywall" }, 402),
      new Response(`not json ${RAW_SENTINEL}`, { status: 200, headers: { "content-type": "text/plain" } }),
    ]);
    const result = await executeFetchContents({ uris: ["https://example.com/x"] }, undefined, { config: config() });

    expect(result.content[0].text).toContain("Status: fetch failed");
    expect(result.content[0].text).not.toContain(RAW_SENTINEL);
    expect(JSON.stringify(result.details)).not.toContain(RAW_SENTINEL);
    expect(renderDetailsLine("fetch_contents", result)).toContain("failures=http_error,unusable_response");
    expect(renderDetailsLine("fetch_contents", result)).not.toContain(RAW_SENTINEL);
    const record = await readRecord(result.details!.responseId as string);
    const exa = record.attempts[1];
    expect(exa.status).toBe("unusable_response");
    expect(exa.normalized.success).toBe(false);
    expect(exa.normalized.perUrl).toEqual([{ url: "https://example.com/x", ok: false, textCharacters: 0 }]);
    expect(result.details!.failureCategories).toContain("unusable_response");
    // Raw provider context stays in the stored record only.
    expect(exa.rawResponse.bodyText).toContain(RAW_SENTINEL);
  });

  it("marks missing and empty results arrays unusable_response", async () => {
    install((call, index) => {
      if (call.url === EXA_CONTENTS_URL) {
        return jsonResponse(index === 1 ? {} : { results: [], statuses: [] });
      }
      return jsonResponse({ success: false, error: "paywall" }, 402);
    });

    const first = await executeFetchContents({ uris: ["https://example.com/x"] }, undefined, { config: config() });
    const firstRecord = await readRecord(first.details!.responseId as string);
    expect(firstRecord.attempts[1].status).toBe("unusable_response");
    expect(firstRecord.attempts[1].normalized.success).toBe(false);
    expect(firstRecord.attempts[1].normalized.perUrl).toEqual([
      { url: "https://example.com/x", ok: false, textCharacters: 0 },
    ]);

    const second = await executeFetchContents({ uris: ["https://example.com/x"] }, undefined, { config: config() });
    const secondRecord = await readRecord(second.details!.responseId as string);
    expect(secondRecord.attempts[1].status).toBe("unusable_response");
    expect(secondRecord.attempts[1].normalized.success).toBe(false);
    expect(second.content[0].text).toContain("fetch failed");
    expect(second.details!.failureCategories).toContain("unusable_response");
  });

  it("marks whitespace-only content unusable_response", async () => {
    install((call) => {
      if (call.url === EXA_CONTENTS_URL) {
        return jsonResponse({
          results: [{ url: "https://example.com/x", title: "X", text: "   \n\t  " }],
          statuses: [{ id: "https://example.com/x", status: "completed" }],
        });
      }
      return jsonResponse({ success: false, error: "paywall" }, 402);
    });
    const result = await executeFetchContents({ uris: ["https://example.com/x"] }, undefined, { config: config() });

    const record = await readRecord(result.details!.responseId as string);
    const exa = record.attempts[1];
    expect(exa.status).toBe("unusable_response");
    expect(exa.normalized.success).toBe(false);
    expect(exa.normalized.perUrl).toEqual([
      { url: "https://example.com/x", ok: false, textCharacters: "   \n\t  ".length },
    ]);
    expect(result.content[0].text).toContain("[No Markdown text returned]");
    expect(result.details!.failureCategories).toContain("unusable_response");
  });

  it("marks non-empty text with a provider failure status unusable_response", async () => {
    install((call) => {
      if (call.url === EXA_CONTENTS_URL) {
        return jsonResponse({
          results: [{ url: "https://example.com/x", title: "X", text: `body text ${RAW_SENTINEL}` }],
          statuses: [{ id: "https://example.com/x", status: "error" }],
        });
      }
      return jsonResponse({ success: false, error: "paywall" }, 402);
    });
    const result = await executeFetchContents({ uris: ["https://example.com/x"] }, undefined, { config: config() });

    const record = await readRecord(result.details!.responseId as string);
    const exa = record.attempts[1];
    expect(exa.status).toBe("unusable_response");
    expect(exa.normalized.success).toBe(false);
    expect(exa.normalized.perUrl).toEqual([
      { url: "https://example.com/x", ok: false, textCharacters: expect.any(Number) },
    ]);
    // The non-empty but failure-status content never reaches output, details, or TUI.
    expect(result.content[0].text).toContain("Status: fetch failed");
    expect(result.content[0].text).not.toContain(RAW_SENTINEL);
    expect(JSON.stringify(result.details)).not.toContain(RAW_SENTINEL);
    const summary = renderDetailsLine("fetch_contents", result);
    expect(summary).toContain("failures=http_error,unusable_response");
    expect(summary).not.toContain(RAW_SENTINEL);
  });

  it("keeps a mixed batch successful while failed URLs remain generic failures", async () => {
    install((call) => {
      if (call.url === EXA_CONTENTS_URL) {
        return jsonResponse({
          results: [
            { url: "https://example.com/good", title: "Good", text: "Good Exa body." },
            { url: "https://example.com/bad", title: "Bad", text: "Bad Exa body." },
          ],
          statuses: [
            { id: "https://example.com/good", status: "success" },
            { id: "https://example.com/bad", status: "forbidden" },
          ],
        });
      }
      return jsonResponse({ success: false, error: "paywall" }, 402);
    });
    const result = await executeFetchContents(
      { uris: ["https://example.com/good", "https://example.com/bad"] },
      undefined,
      { config: config() },
    );

    const text = result.content[0].text;
    expect(text).toContain("Good Exa body.");
    expect(text).toContain("https://example.com/bad");
    expect(text).toContain("Status: fetch failed");
    expect(text).not.toContain("Bad Exa body.");
    const record = await readRecord(result.details!.responseId as string);
    const exa = record.attempts[2];
    expect(exa.status).toBe("success");
    expect(exa.normalized.success).toBe(true);
    expect(exa.normalized.perUrl.map((entry: any) => entry.ok)).toEqual([true, false]);
    expect(result.details!.failureCategories).toEqual(["http_error"]);
    expect(renderDetailsLine("fetch_contents", result)).not.toContain("unusable_response");
    // The failed URL stays a generic failure entry and is never cached.
    const { contentPath } = await import("../src/storage.js");
    const { cacheKeyForUrl } = await import("../src/url.js");
    await expect(readFile(contentPath(cacheDir, cacheKeyForUrl("https://example.com/bad")), "utf8")).rejects.toThrow();
    const good = JSON.parse(await readFile(contentPath(cacheDir, cacheKeyForUrl("https://example.com/good")), "utf8"));
    expect(good.text).toBe("Good Exa body.");
  });
});

describe("config-independent fetch input validation order", () => {
  it("rejects 26 URLs as invalid_input before the config loader is ever called", async () => {
    const calls = install([]);
    let loadCount = 0;
    setConfigLoaderForTests({
      load: () => {
        loadCount += 1;
        throw new Error("Deterministic loader failure");
      },
      fallbackCacheDir: cacheDir,
    });
    try {
      const urls = Array.from({ length: 26 }, (_, i) => `https://example.com/order/${i}`);
      let thrown: unknown;
      try {
        await executeFetchContents({ uris: urls }, undefined);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as Error).message).toContain("uris must contain at most 25 URLs");
      // invalid_input wins: the loader was never reached and no provider or
      // cache I/O happened.
      expect(loadCount).toBe(0);
      expect(calls).toHaveLength(0);

      const record = await readRecord(responseIdFromError(thrown));
      expect(record.tool).toBe("fetch_contents");
      expect(record.category).toBe("invalid_input");
      expect(record.attempts).toEqual([]);
      expect(record.metadata).toEqual({ urlCount: 26 });
      expect(JSON.stringify(record)).not.toContain("example.com/order");
    } finally {
      setConfigLoaderForTests(undefined);
    }
  });

  it("rejects maxCharacters 50001 as invalid_input before the config loader is ever called", async () => {
    const calls = install([]);
    let loadCount = 0;
    setConfigLoaderForTests({
      load: () => {
        loadCount += 1;
        throw new Error("Deterministic loader failure");
      },
      fallbackCacheDir: cacheDir,
    });
    try {
      let thrown: unknown;
      try {
        await executeFetchContents({ uris: ["https://example.com/a"], maxCharacters: 50_001 }, undefined);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as Error).message).toContain("maxCharacters must be a positive integer no greater than 50000");
      expect(loadCount).toBe(0);
      expect(calls).toHaveLength(0);

      const record = await readRecord(responseIdFromError(thrown));
      expect(record.category).toBe("invalid_input");
      expect(record.attempts).toEqual([]);
      expect(record.metadata).toEqual({ urlCount: 1, maxCharacters: 50_001 });
    } finally {
      setConfigLoaderForTests(undefined);
    }
  });

  it("keeps config_load_failure for valid input when the config loader throws", async () => {
    const calls = install([]);
    let loadCount = 0;
    setConfigLoaderForTests({
      load: () => {
        loadCount += 1;
        throw new Error("Deterministic loader failure");
      },
      fallbackCacheDir: cacheDir,
    });
    try {
      let thrown: unknown;
      try {
        await executeFetchContents({ uris: ["https://example.com/a"] }, undefined);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as Error).message).toContain("Deterministic loader failure");
      // A valid input reaches the loader exactly once and classifies its
      // failure as config_load_failure, never invalid_input.
      expect(loadCount).toBe(1);
      expect(calls).toHaveLength(0);

      const record = await readRecord(responseIdFromError(thrown));
      expect(record.tool).toBe("fetch_contents");
      expect(record.category).toBe("config_load_failure");
      expect(record.attempts).toEqual([]);
      expect(record.metadata).toEqual({ urlCount: 1 });
    } finally {
      setConfigLoaderForTests(undefined);
    }
  });
});

describe("preflight diagnostic records", () => {
  it("persists an invalid-input record for bad uris and rethrows with the responseId suffix", async () => {
    install([]);
    let thrown: unknown;
    try {
      await executeFetchContents({ uris: "not-an-array" }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("uris must be a non-empty array of non-empty strings");

    const responseId = responseIdFromError(thrown);
    const record = await readRecord(responseId);
    expect(record.tool).toBe("fetch_contents");
    expect(record.phase).toBe("preflight");
    expect(record.category).toBe("invalid_input");
    expect(record.attempts).toEqual([]);
    expect(record.error).toContain("uris must be a non-empty array");
    expect(record.expiresAt - record.createdAt).toBe(TEST_TTL_MS);
    // Raw invalid parameter values are never stored; only safe metadata.
    expect(record.metadata).toEqual({});
    expect(JSON.stringify(record)).not.toContain("not-an-array");
  });

  it("keeps safe counts in invalid-input records when the failure happens later", async () => {
    install([]);
    let thrown: unknown;
    try {
      await executeFetchContents({ uris: ["https://example.com/a"], maxCharacters: -5 }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("maxCharacters must be a positive integer");

    const record = await readRecord(responseIdFromError(thrown));
    expect(record.category).toBe("invalid_input");
    expect(record.metadata).toEqual({ urlCount: 1 });
  });

  it("persists an invalid-input record with only the URL count when 26 URLs are requested", async () => {
    const calls = install([]);
    const urls = Array.from({ length: 26 }, (_, i) => `https://example.com/over/${i}`);
    let thrown: unknown;
    try {
      await executeFetchContents({ uris: urls }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("uris must contain at most 25 URLs");
    // Rejected before any cache or provider I/O.
    expect(calls).toHaveLength(0);

    const record = await readRecord(responseIdFromError(thrown));
    expect(record.tool).toBe("fetch_contents");
    expect(record.phase).toBe("preflight");
    expect(record.category).toBe("invalid_input");
    expect(record.attempts).toEqual([]);
    // Only the safe count survives; no requested URL value is stored.
    expect(record.metadata).toEqual({ urlCount: 26 });
    expect(JSON.stringify(record)).not.toContain("example.com/over");
  });

  it("persists an invalid-input record for web_search and web_code_search", async () => {
    install([]);
    let thrown: unknown;
    try {
      await executeWebSearch({ query: "q", depth: "extreme" }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("depth must be one of: standard, deep");
    let record = await readRecord(responseIdFromError(thrown));
    expect(record.tool).toBe("web_search");
    expect(record.category).toBe("invalid_input");
    expect(record.metadata).toEqual({ query: "q" });

    thrown = undefined;
    try {
      await executeWebCodeSearch({ query: "q", focus: "auto" }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("focus must be one of: developer_sources, implementation_examples");
    record = await readRecord(responseIdFromError(thrown));
    expect(record.tool).toBe("web_code_search");
    expect(record.category).toBe("invalid_input");
  });

  it("persists a missing-credentials record for the terminal missing Google key", async () => {
    setTestEnv({ [TEST_ENV_NAMES.googleCloudApiKeyEnv]: undefined });
    install([]);

    let thrown: unknown;
    try {
      await executeWebSearch({ query: "grounded query" }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain(`Missing required environment variable ${TEST_ENV_NAMES.googleCloudApiKeyEnv}`);

    const record = await readRecord(responseIdFromError(thrown));
    expect(record.tool).toBe("web_search");
    expect(record.category).toBe("missing_credentials");
    expect(record.attempts).toEqual([]);
    expect(record.error).toContain("Missing required environment variable");
    expect(record.metadata).toEqual({ query: "grounded query" });
  });

  it("falls back to the default cache dir, TTL, and credential env names when the config never loaded", async () => {
    const defaults = preflightSettingsFrom(undefined);
    expect(defaults.cacheDir).toBe(DEFAULT_CONFIG.cacheDir);
    expect(defaults.rawResponseTtlMs).toBe(ONE_MONTH_MS);
    expect(defaults.envNames).toEqual({
      googleCloudApiKeyEnv: "GOOGLE_CLOUD_API_KEY",
      parallelApiKeyEnv: "PARALLEL_API_KEY",
      exaApiKeyEnv: "EXA_API_KEY",
      firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
    });

    // Same branch executeWebSearch uses when loadConfig fails, exercised with
    // an injected temporary directory instead of the live default cache.
    const sentinelKey = "wse-default-env-sentinel-key";
    process.env.GOOGLE_CLOUD_API_KEY = sentinelKey;
    try {
      await writePreflightDiagnostic({
        tool: "web_search",
        category: "config_load_failure",
        error: new Error(`Failed to read web_search config: boom ${sentinelKey}`),
        responseId: "wse_cfgfail_0123456789abcdef",
        settings: { cacheDir, rawResponseTtlMs: ONE_MONTH_MS, envNames: defaults.envNames },
      });

      const record = JSON.parse(await readFile(responsePath(cacheDir, "wse_cfgfail_0123456789abcdef"), "utf8"));
      expect(record.tool).toBe("web_search");
      expect(record.phase).toBe("preflight");
      expect(record.category).toBe("config_load_failure");
      expect(record.expiresAt - record.createdAt).toBe(ONE_MONTH_MS);
      expect(record.error).not.toContain(sentinelKey);
      expect(record.error).toContain("[REDACTED_GOOGLE_CLOUD_API_KEY]");
    } finally {
      delete process.env.GOOGLE_CLOUD_API_KEY;
    }
  });

  it("never lets a diagnostic write failure mask the original tool error", async () => {
    // A file where a directory is needed makes every diagnostic write fail.
    const blocker = join(cacheDir, "blocker");
    await writeFile(blocker, "x", "utf8");
    const blockedConfig = testConfig({ cacheDir: join(blocker, "cache"), rawResponseTtlMs: TEST_TTL_MS });
    install([]);

    let thrown: unknown;
    try {
      await executeFetchContents({ uris: "nope" }, undefined, { config: blockedConfig });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("uris must be a non-empty array of non-empty strings");
    expect(responseIdFromError(thrown)).toMatch(/^wse_/);
  });

  it("keeps returning fetched entries when only the diagnostic record write fails", async () => {
    // A regular file where the responses directory belongs makes every
    // diagnostic write fail deterministically, without permission bits that a
    // root runner would bypass.
    const responsesBlocker = join(cacheDir, "responses");
    await writeFile(responsesBlocker, "blocker", "utf8");
    install([jsonResponse(scrapeSuccess())]);
    const result = await executeFetchContents({ uris: ["https://example.com/a"] }, undefined, { config: config() });

    expect(result.content[0].text).toContain("Body text.");
    expect(result.details!.responseId).toMatch(/^wse_/);
    // The operational content cache still received the successful entry.
    const { contentPath } = await import("../src/storage.js");
    const { cacheKeyForUrl } = await import("../src/url.js");
    const cached = JSON.parse(await readFile(contentPath(cacheDir, cacheKeyForUrl("https://example.com/a")), "utf8"));
    expect(cached.text).toContain("Body text.");
    // No diagnostic record was written; the blocker is untouched.
    expect(await readFile(responsesBlocker, "utf8")).toBe("blocker");
    await expect(readdir(responsesBlocker)).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("legacy record reading and tool surface", () => {
  it("reads legacy records without a tool field and fetch records through the union reader", async () => {
    const legacy = {
      responseId: "wse_legacy_diag_0123456789a",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      provider: "gemini-exa-grounding",
      query: "legacy",
      primary: {
        provider: "gemini-exa-grounding",
        partner: "exa",
        model: "m",
        requestStartedAt: "2026-07-30T00:00:00.000Z",
        elapsedMs: 1,
      },
      normalized: null,
      fallback: null,
    };
    const { writeStoredResponse } = await import("../src/storage.js");
    await writeStoredResponse(cacheDir, legacy as any, []);

    expect((await readStoredToolRecord(cacheDir, legacy.responseId) as any).query).toBe("legacy");
    expect((await readStoredResponse(cacheDir, legacy.responseId) as any).query).toBe("legacy");

    install([jsonResponse(scrapeSuccess())]);
    const result = await executeFetchContents({ uris: ["https://example.com/a"] }, undefined, { config: config() });
    const fetchRecord = await readStoredToolRecord(cacheDir, result.details!.responseId as string) as any;
    expect(fetchRecord.tool).toBe("fetch_contents");
    await expect(readStoredResponse(cacheDir, result.details!.responseId as string)).rejects.toThrow(
      "is not a web_search record",
    );
  });

  it("registers exactly the three public tools and no inspector", async () => {
    const tools = createToolRegistrations();
    expect(tools.map((tool) => tool.name)).toEqual(["web_search", "web_code_search", "fetch_contents"]);
    expect(tools.map((tool) => tool.name).join("\n")).not.toContain("inspect");
  });
});

describe("TUI safe summaries with diagnostics", () => {
  it("shows providers, attempts, failures, elapsed, and responseId for fetch_contents", async () => {
    install([
      jsonResponse(scrapeSuccess("# A", "https://example.com/a")),
      jsonResponse({ success: false, error: "boom" }, 402),
      jsonResponse(exaContentsSuccess(["https://example.com/b"])),
    ]);
    const result = await executeFetchContents(
      { uris: ["https://example.com/a", "https://example.com/b"] },
      undefined,
      { config: config() },
    );

    const summary = renderDetailsLine("fetch_contents", result);
    expect(summary).toContain("2 URLs, cache hits 0/2");
    expect(summary).toContain("provider=firecrawl_scrape|exa_contents");
    expect(summary).toContain("attempts=3");
    expect(summary).toContain("failures=http_error");
    expect(summary).toMatch(/elapsed=\d+ms/);
    expect(summary).toContain(`responseId=${result.details!.responseId}`);
    expect(summary).not.toContain("boom");
  });

  it("renders provider=none for fetch_contents when no provider produced content", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ error: "down" }, 503),
    ]);
    const result = await executeFetchContents({ uris: ["https://example.com/bad"] }, undefined, { config: config() });

    const summary = renderDetailsLine("fetch_contents", result);
    expect(summary).toContain("provider=none");
    expect(summary).toContain("failures=http_error");
  });

  it("keeps legacy minimal fetch details rendering unchanged", () => {
    const summary = renderDetailsLine("fetch_contents", {
      content: [{ type: "text", text: "done" }],
      details: { results: [{ normalizedUrl: "https://a", fromCache: false, characterCount: 3 }] },
    });
    expect(summary).toBe("1 URLs, cache hits 0/1, chars=3");
  });

  it("adds providers, failures, and elapsed to web_search summaries without changing the provider logic", () => {
    const summary = renderDetailsLine("web_search", {
      content: [{ type: "text", text: "answer" }],
      details: {
        responseId: "wse_abc",
        answerProvider: null,
        attemptCount: 2,
        attemptProviders: ["gemini-parallel-grounding", "gemini-exa-grounding"],
        failureCategories: ["http_429"],
        elapsedMs: 1200,
      },
    });
    expect(summary).toBe(
      "provider=none attempts=2 providers=gemini-parallel-grounding,gemini-exa-grounding failures=http_429 elapsed=1200ms responseId=wse_abc",
    );
  });

  it("adds providers, failures, and elapsed to web_code_search summaries", () => {
    const summary = renderDetailsLine("web_code_search", {
      content: [{ type: "text", text: "results" }],
      details: {
        responseId: "wse_abc",
        focus: "developer_sources",
        answerProvider: "exa-code",
        attemptCount: 2,
        attemptProviders: ["firecrawl-developer", "exa-code"],
        failureCategories: ["no_results"],
        degraded: true,
        elapsedMs: 300,
      },
    });
    expect(summary).toBe(
      "provider=exa-code focus=developer_sources attempts=2 providers=firecrawl-developer,exa-code failures=no_results degraded=true elapsed=300ms responseId=wse_abc",
    );
  });
});

describe("preflight redaction boundaries", () => {
  it("bounds the preflight query metadata at 2000 characters with redaction before truncation", async () => {
    // The secret is configured so redaction replaces it before truncation.
    const secret = "wse-preflight-query-boundary-" + "q".repeat(30);
    setTestEnv({ [TEST_ENV_NAMES.exaApiKeyEnv]: secret });
    install([]);

    let thrown: unknown;
    try {
      // The query crosses the 2000-character cutoff; depth validation fails so
      // the record keeps only the bounded query metadata.
      await executeWebSearch(
        { query: "a".repeat(1_900) + secret + "b".repeat(600), depth: "extreme" },
        undefined,
        { config: config() },
      );
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("depth must be one of: standard, deep");

    const record = await readRecord(responseIdFromError(thrown));
    expect(record.category).toBe("invalid_input");
    expect(typeof record.metadata.query).toBe("string");
    expect(record.metadata.query.length).toBeLessThanOrEqual(2_000);
    expect(record.metadata.query.endsWith("[truncated at 2000 characters]")).toBe(true);
    // The complete secret was replaced before truncation, so no fragment survives.
    expect(record.metadata.query).not.toContain(secret);
    expect(record.metadata.query).toContain(`[REDACTED_${TEST_ENV_NAMES.exaApiKeyEnv}]`);
    expectNoSecretFragments(JSON.stringify(record), secret);
  });

  it("replaces a secret crossing the string cutoff in a persisted preflight error", async () => {
    // The URL scheme is echoed verbatim into the URL-normalization error, so
    // a secret-shaped scheme crosses the 500-character diagnostic cutoff.
    const schemeSecret = "wse-preflight-boundary-" + "c".repeat(37);
    setTestEnv({ [TEST_ENV_NAMES.exaApiKeyEnv]: schemeSecret });
    install([]);

    let thrown: unknown;
    try {
      await executeFetchContents({ uris: [`q`.repeat(440) + `${schemeSecret}://host/path`] }, undefined, {
        config: config(),
      });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("Unsupported URL protocol");
    expect((thrown as Error).message).toContain("Diagnostic responseId=");

    const record = await readRecord(responseIdFromError(thrown));
    expect(record.tool).toBe("fetch_contents");
    expect(record.phase).toBe("preflight");
    expect(record.category).toBe("invalid_input");
    expect(record.error.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_STRING_CHARS);
    expect(record.error).toContain(`[REDACTED_${TEST_ENV_NAMES.exaApiKeyEnv}]`);
    expect(record.error).not.toContain(schemeSecret);
    expectNoSecretFragments(record.error, schemeSecret);
  });

  it("replaces a complete secret inside a persisted preflight error", async () => {
    const secret = "wse-preflight-complete-boundary-7c1d";
    setTestEnv({ [TEST_ENV_NAMES.exaApiKeyEnv]: secret });
    await writePreflightDiagnostic({
      tool: "fetch_contents",
      category: "invalid_input",
      error: new Error(`validation failed after seeing ${secret}`),
      responseId: "wse_preflight_boundary_0123456789",
      settings: { cacheDir, rawResponseTtlMs: TEST_TTL_MS, envNames: {
        googleCloudApiKeyEnv: TEST_ENV_NAMES.googleCloudApiKeyEnv,
        parallelApiKeyEnv: TEST_ENV_NAMES.parallelApiKeyEnv,
        exaApiKeyEnv: TEST_ENV_NAMES.exaApiKeyEnv,
        firecrawlApiKeyEnv: TEST_ENV_NAMES.firecrawlApiKeyEnv,
      } },
    });

    const record = JSON.parse(await readFile(responsePath(cacheDir, "wse_preflight_boundary_0123456789"), "utf8"));
    expect(record.error).toContain(`[REDACTED_${TEST_ENV_NAMES.exaApiKeyEnv}]`);
    expect(record.error).not.toContain(secret);
    expectNoSecretFragments(record.error, secret);
  });
});

describe("operational failures are never invalid input", () => {
  async function expectNoStoredRecords(): Promise<void> {
    try {
      const files = await readdir(join(cacheDir, "responses"));
      expect(files).toEqual([]);
    } catch (error) {
      // No responses directory at all also proves no record was persisted.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  it("rethrows corrupt cache JSON unchanged without a preflight record or suffix", async () => {
    await mkdir(join(cacheDir, "contents"), { recursive: true });
    const { contentPath } = await import("../src/storage.js");
    const { cacheKeyForUrl } = await import("../src/url.js");
    await writeFile(contentPath(cacheDir, cacheKeyForUrl("https://example.com/a")), "{corrupt json", "utf8");
    install([]);

    let thrown: unknown;
    try {
      await executeFetchContents({ uris: ["https://example.com/a"] }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SyntaxError);
    expect((thrown as Error).message).not.toMatch(/Diagnostic responseId=/);
    expect((thrown as Error).message).not.toContain("uris must be");
    await expectNoStoredRecords();
  });

  it("rethrows non-ENOENT cache read failures unchanged without a preflight record", async () => {
    // A file where the contents directory belongs makes every cache read fail
    // with ENOTDIR instead of ENOENT.
    await writeFile(join(cacheDir, "contents"), "not a directory", "utf8");
    install([]);

    let thrown: unknown;
    try {
      await executeFetchContents({ uris: ["https://example.com/a"] }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as NodeJS.ErrnoException).code).toBe("ENOTDIR");
    expect((thrown as Error).message).not.toMatch(/Diagnostic responseId=/);
    await expectNoStoredRecords();
  });

  it("rethrows cache write failures unchanged after provider work succeeded", async () => {
    // maxAgeHours 0 skips every cache read; a directory where the second
    // URL's cache file belongs then fails only the cache write, with the
    // same errno for root and non-root runners.
    const { contentPath } = await import("../src/storage.js");
    const { cacheKeyForUrl } = await import("../src/url.js");
    await mkdir(contentPath(cacheDir, cacheKeyForUrl("https://example.com/b")), { recursive: true });
    install([jsonResponse(scrapeSuccess("# A", "https://example.com/a")), jsonResponse(scrapeSuccess("# B", "https://example.com/b"))]);
    let thrown: unknown;
    try {
      await executeFetchContents(
        { uris: ["https://example.com/a", "https://example.com/b"], maxAgeHours: 0 },
        undefined,
        { config: config() },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as NodeJS.ErrnoException).code).toBe("EISDIR");
    expect((thrown as Error).message).not.toMatch(/Diagnostic responseId=/);
    expect((thrown as Error).message).not.toContain("uris must be");
    await expectNoStoredRecords();
  });

  it("still records pure validation and URL-normalization failures as invalid input", async () => {
    install([]);
    let thrown: unknown;
    try {
      await executeFetchContents({ uris: ["ftp://example.com/a"] }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("Unsupported URL protocol: ftp:");

    const record = await readRecord(responseIdFromError(thrown));
    expect(record.phase).toBe("preflight");
    expect(record.category).toBe("invalid_input");
    expect(record.attempts).toEqual([]);
    expect(record.metadata).toEqual({ urlCount: 1 });
  });
});

describe("canonical dispatch order", () => {
  const FROZEN_MS = 1_750_000_000_000;

  it("keeps stored order A,B when A and B share timestamps and B completes first", async () => {
    const realNow = Date.now;
    Date.now = () => FROZEN_MS;
    let releaseA: (() => void) | undefined;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const dispatches: string[] = [];
    install(async (call) => {
      dispatches.push(call.body.url);
      if (call.body.url === "https://example.com/a") {
        await gateA;
        return jsonResponse(scrapeSuccess("# A", "https://example.com/a"));
      }
      return jsonResponse(scrapeSuccess("# B", "https://example.com/b"));
    });
    try {
      const pending = executeFetchContents(
        { uris: ["https://example.com/a", "https://example.com/b"] },
        undefined,
        { config: config() },
      );
      // B completes while A is still in flight; completion push order is B,A.
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseA!();
      const result = await pending;

      expect(dispatches).toEqual(["https://example.com/a", "https://example.com/b"]);
      const record = await readRecord(result.details!.responseId as string);
      expect(record.attempts.map((attempt: any) => attempt.urls[0])).toEqual([
        "https://example.com/a",
        "https://example.com/b",
      ]);
      // Equal frozen timestamps cannot be the tie-breaker: order came from dispatch.
      expect(new Set(record.attempts.map((attempt: any) => attempt.requestStartedAt)).size).toBe(1);
      expect(result.details!.attemptProviders).toEqual(["firecrawl_scrape", "firecrawl_scrape"]);
      expect(JSON.stringify(record)).not.toContain("dispatchOrdinal");
    } finally {
      Date.now = realNow;
    }
  });

  it("keeps every Firecrawl attempt before the Exa fallback regardless of completion order", async () => {
    const realNow = Date.now;
    Date.now = () => FROZEN_MS;
    let releaseA: (() => void) | undefined;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    install(async (call) => {
      if (call.url === FIRECRAWL_SCRAPE_URL && call.body.url === "https://example.com/a") {
        await gateA;
        return jsonResponse(scrapeSuccess("# A", "https://example.com/a"));
      }
      if (call.url === FIRECRAWL_SCRAPE_URL) return jsonResponse({ success: false, error: "paywall" }, 402);
      if (call.url === EXA_CONTENTS_URL) return jsonResponse(exaContentsSuccess(["https://example.com/b"]));
      throw new Error(`unexpected fetch call ${call.url}`);
    });
    try {
      const pending = executeFetchContents(
        { uris: ["https://example.com/a", "https://example.com/b"] },
        undefined,
        { config: config() },
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseA!();
      const result = await pending;

      const record = await readRecord(result.details!.responseId as string);
      expect(record.attempts.map((attempt: any) => [attempt.provider, ...attempt.urls])).toEqual([
        ["firecrawl_scrape", "https://example.com/a"],
        ["firecrawl_scrape", "https://example.com/b"],
        ["exa_contents", "https://example.com/b"],
      ]);
      expect(new Set(record.attempts.map((attempt: any) => attempt.requestStartedAt)).size).toBe(1);
      expect(result.details!.attemptProviders).toEqual(["firecrawl_scrape", "firecrawl_scrape", "exa_contents"]);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("web_search and web_code_search stored record bounds", () => {
  it("bounds and redacts persisted web_search attempts and legacy mirrors", async () => {
    const googleSecret = "wse-google-cross-boundary-" + "g".repeat(176);
    setTestEnv({ [TEST_ENV_NAMES.googleCloudApiKeyEnv]: googleSecret });
    const exaBody = cleanGroundingBody("Exa grounded answer.") as Record<string, any>;
    exaBody.leak = `upstream saw ${googleSecret}`;
    install([
      new Response("g".repeat(19_900) + googleSecret, { status: 429, statusText: "Too Many Requests" }),
      jsonResponse(exaBody),
    ]);

    const result = await executeWebSearch({ query: "boundary grounded query" }, undefined, { config: config() });

    const serialized = await readRecordFile(result.details!.responseId as string);
    expect(serialized).not.toContain(googleSecret);
    expect(serialized).not.toContain(TEST_KEYS.parallel);
    expectNoSecretFragments(serialized, googleSecret);
    const record = JSON.parse(serialized);
    expect(record.attempts).toHaveLength(2);
    const parallel = record.attempts[0];
    expect(parallel.rawResponse.bodyText.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_BODY_CHARS);
    expect(parallel.rawResponse.bodyText).toContain(`[REDACTED_${TEST_ENV_NAMES.googleCloudApiKeyEnv}]`);
    expect(parallel.rawResponse.bodyJson).toBeUndefined();
    expect(parallel.rawRequest.headers["x-goog-api-key"]).toBe(`[REDACTED_${TEST_ENV_NAMES.googleCloudApiKeyEnv}]`);
    // The serialized request body keeps the nested partner key only as a label.
    expect(typeof parallel.rawRequest.body).toBe("string");
    expect(parallel.rawRequest.body).toContain(`[REDACTED_${TEST_ENV_NAMES.parallelApiKeyEnv}]`);
    // Legacy mirrors derive from the bounded attempts and add no raw copies.
    expect(record.response.bodyJson).toBeUndefined();
    expect(record.response.bodyText.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_BODY_CHARS);
    expect(record.primary).toEqual(parallel);
    expect(record.fallback.provider).toBe("gemini-exa-grounding");
    expect(record.fallback.rawResponse.bodyText).toContain(`[REDACTED_${TEST_ENV_NAMES.googleCloudApiKeyEnv}]`);
  });

  it("bounds and redacts persisted web_code_search attempts", async () => {
    const firecrawlSecret = "wse-code-cross-boundary-" + "c".repeat(177);
    setTestEnv({ [TEST_ENV_NAMES.firecrawlApiKeyEnv]: firecrawlSecret });
    install([
      new Response("f".repeat(19_900) + firecrawlSecret, {
        status: 500,
        statusText: "s".repeat(460) + firecrawlSecret,
        headers: { "x-note": "h".repeat(460) + firecrawlSecret },
      }),
      jsonResponse({ response: "const schema = z.object({ a: z.string() });", resultsCount: 12, requestId: "req-9" }),
    ]);

    const result = await executeWebCodeSearch(
      { query: "How do I validate a request body with Zod?", focus: "developer_sources" },
      undefined,
      { config: config() },
    );

    const serialized = await readRecordFile(result.details!.responseId as string);
    expect(serialized).not.toContain(firecrawlSecret);
    expectNoSecretFragments(serialized, firecrawlSecret);
    const record = JSON.parse(serialized);
    expect(record.attempts).toHaveLength(2);
    const firecrawl = record.attempts[0];
    expect(firecrawl.rawResponse.bodyText.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_BODY_CHARS);
    expect(firecrawl.rawResponse.bodyText).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(firecrawl.rawResponse.bodyJson).toBeUndefined();
    expect(firecrawl.rawResponse.statusText.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_STRING_CHARS);
    expect(firecrawl.rawResponse.statusText).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(firecrawl.rawResponse.headers["x-note"].length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_STRING_CHARS);
    expect(firecrawl.rawResponse.headers["x-note"]).toContain(`[REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    expect(firecrawl.rawRequest.headers.Authorization).toBe(`Bearer [REDACTED_${TEST_ENV_NAMES.firecrawlApiKeyEnv}]`);
    const exaCode = record.attempts[1];
    expect(exaCode.rawRequest.headers["x-api-key"]).toBe(`[REDACTED_${TEST_ENV_NAMES.exaApiKeyEnv}]`);
    expect(typeof exaCode.rawRequest.body).toBe("string");
    expect(JSON.parse(exaCode.rawRequest.body)).toEqual({
      query: "How do I validate a request body with Zod?",
      tokensNum: "dynamic",
    });
    expect(record.selectedProvider).toBe("exa-code");
  });
});
