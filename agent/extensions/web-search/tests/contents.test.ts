import "./pi-tui-mock.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { executeFetchContents } = await import("../src/tools.js");
const {
  fetchContentsEntries,
  parseFetchContentsInput,
  resolveFetchContentsInput,
  validateFetchContentsInput,
} = await import("../src/contents.js");
const { contentPath, readContentCacheEntry, readStoredToolRecord } = await import("../src/storage.js");
const { cacheKeyForUrl, normalizeUrl } = await import("../src/url.js");
const { boundUrlForStorage } = await import("../src/diagnostics.js");
const { createWebSearchResultRenderer } = await import("../src/render.js");
const { setConfigLoaderForTests } = await import("../src/config.js");
const {
  clearTestEnv,
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
const HOUR_MS = 3_600_000;

function scrapeSuccess(markdown = "# Title\n\nBody text.", overrides: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data: {
      markdown,
      metadata: { title: "Page Title", sourceURL: "https://example.com/a", statusCode: 200 },
      ...overrides,
    },
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
let calls: ReturnType<typeof mockFetch>["calls"];

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "wse-contents-"));
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

async function readCachedEntry(normalizedUrl: string) {
  return readContentCacheEntry(cacheDir, cacheKeyForUrl(normalizedUrl));
}

async function writeCache(normalizedUrl: string, entry: Record<string, unknown>): Promise<void> {
  await mkdir(join(cacheDir, "contents"), { recursive: true });
  await writeFile(contentPath(cacheDir, cacheKeyForUrl(normalizedUrl)), JSON.stringify(entry), "utf8");
}

async function listContentCache(): Promise<string[]> {
  try {
    return await readdir(join(cacheDir, "contents"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("fetch_contents provider routing", () => {
  it("satisfies a fresh local cache hit without provider calls", async () => {
    const now = Date.now();
    await writeCache("https://example.com/a", {
      url: "https://example.com/a",
      normalizedUrl: "https://example.com/a",
      fetchedAt: now - 1000,
      expiresAt: now + 100_000,
      requestedMaxCharacters: 12000,
      // Fetched under a strict 1h provider allowance: 1000ms + 1h < the
      // default 24h request budget, so the entry stays a cache hit.
      providerMaxAgeHours: 1,
      title: "Cached",
      text: "cached body",
      provider: "exa_contents",
    });
    install([]);

    const entries = await fetchContentsEntries({ rawUris: ["https://example.com/a"], config: config() });

    expect(calls).toHaveLength(0);
    expect(entries[0].text).toBe("cached body");
    expect(entries[0].fromCache).toBe(true);
    expect(entries[0].provider).toBe("exa_contents");
  });

  it("rejects a stale cache entry for the current request without deleting it", async () => {
    const now = Date.now();
    const url = "https://example.com/a";
    await writeCache(url, {
      url,
      normalizedUrl: url,
      fetchedAt: now - 48 * HOUR_MS,
      expiresAt: now + 100 * HOUR_MS,
      requestedMaxCharacters: 12000,
      text: "stale body",
    });
    const unrelatedKey = cacheKeyForUrl("https://example.com/unrelated");
    const unrelatedPath = contentPath(cacheDir, unrelatedKey);
    await writeFile(unrelatedPath, JSON.stringify({ expiresAt: now + 100_000, text: "keep me" }), "utf8");
    install([jsonResponse(scrapeSuccess())]);

    const entries = await fetchContentsEntries({ rawUris: [url], config: config() });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(FIRECRAWL_SCRAPE_URL);
    expect(entries[0].text).toContain("Body text.");
    expect(entries[0].fromCache).toBe(false);
    // Neither the stale entry nor the unrelated cache file was deleted.
    expect(await readFile(unrelatedPath, "utf8")).toContain("keep me");
  });

  it("rejects a 720h-provider-allowance cache entry for a 1h request and refetches", async () => {
    const now = Date.now();
    const url = "https://example.com/a";
    await writeCache(url, {
      url,
      normalizedUrl: url,
      fetchedAt: now - 1000,
      expiresAt: now + 100_000,
      requestedMaxCharacters: 12000,
      // Even a locally fresh entry may hold content already 720h old at the
      // provider, so a 1h request must refetch from the provider.
      providerMaxAgeHours: 720,
      text: "possibly ancient body",
    });
    install([jsonResponse(scrapeSuccess())]);

    const entries = await fetchContentsEntries({ rawUris: [url], rawMaxAgeHours: 1, config: config() });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(FIRECRAWL_SCRAPE_URL);
    expect(calls[0]!.body.maxAge).toBe(1 * HOUR_MS);
    expect(entries[0].text).toContain("Body text.");
    expect(entries[0].fromCache).toBe(false);
    // The refetched entry records the effective 1h provider allowance.
    expect(await readCachedEntry(url)).toMatchObject({ providerMaxAgeHours: 1, provider: "firecrawl_scrape" });
  });

  it("bypasses the local cache and provider caches for maxAgeHours 0", async () => {
    const now = Date.now();
    await writeCache("https://example.com/a", {
      url: "https://example.com/a",
      normalizedUrl: "https://example.com/a",
      fetchedAt: now - 1000,
      expiresAt: now + 100_000,
      requestedMaxCharacters: 12000,
      text: "fresh cached body",
    });
    install([jsonResponse(scrapeSuccess())]);

    const entries = await fetchContentsEntries({ rawUris: ["https://example.com/a"], rawMaxAgeHours: 0, config: config() });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.maxAge).toBe(0);
    expect(entries[0].text).toContain("Body text.");
    expect(entries[0].fromCache).toBe(false);
  });

  it("sends the documented Firecrawl scrape request", async () => {
    install([jsonResponse(scrapeSuccess())]);
    await fetchContentsEntries({ rawUris: ["https://example.com/a"], config: config() });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(FIRECRAWL_SCRAPE_URL);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TEST_KEYS.firecrawl}`);
    expect(calls[0]!.body).toEqual({
      url: "https://example.com/a",
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: 24 * HOUR_MS,
      timeout: 60000,
    });
    expect(JSON.stringify(calls[0]!.body)).not.toContain("onlyCleanContent");
    expect(JSON.stringify(calls[0]!.body)).not.toContain("question");
    expect(JSON.stringify(calls[0]!.body)).not.toContain("highlights");
  });

  it("parses markdown, title, source URL, status, and warning", async () => {
    install([
      jsonResponse({
        success: true,
        data: {
          markdown: "# Hello",
          metadata: { title: "T", url: "https://example.com/a", statusCode: 201 },
          warning: "minor fallback",
        },
      }),
    ]);
    const entries = await fetchContentsEntries({ rawUris: ["https://example.com/a"], config: config() });

    expect(entries[0].text).toBe("# Hello");
    expect(entries[0].title).toBe("T");
    expect(entries[0].provider).toBe("firecrawl_scrape");
    expect((entries[0].providerStatus as Record<string, unknown>).statusCode).toBe(201);
    expect((entries[0].providerStatus as Record<string, unknown>).warning).toBe("minor fallback");
    const cached = await readCachedEntry("https://example.com/a");
    expect(cached?.provider).toBe("firecrawl_scrape");
  });

  it("sends only Firecrawl-failed URLs to Exa Contents with maxAgeHours and maxCharacters", async () => {
    install([
      jsonResponse(scrapeSuccess("# A", { metadata: { title: "A", sourceURL: "https://example.com/a", statusCode: 200 } })),
      jsonResponse({ success: false, error: "paywall" }, 402),
      jsonResponse(exaContentsSuccess(["https://example.com/b"])),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b"],
      rawMaxCharacters: 5000,
      config: config(),
    });

    expect(calls).toHaveLength(3);
    expect(calls[2]!.url).toBe(EXA_CONTENTS_URL);
    expect(calls[2]!.body.urls).toEqual(["https://example.com/b"]);
    expect(calls[2]!.body.maxAgeHours).toBe(24);
    expect(calls[2]!.body.text.maxCharacters).toBe(5000);
    expect(JSON.stringify(calls[2]!.body)).not.toContain("context");
    expect(JSON.stringify(calls[2]!.body)).not.toContain("livecrawl");
    expect(entries.map((entry) => entry.text)).toEqual(["# A", "Exa markdown body."]);
    expect(entries[1].provider).toBe("exa_contents");
  });

  it("returns a structured failed entry when both providers fail without losing successes", async () => {
    install([
      jsonResponse(scrapeSuccess("# Good")),
      jsonResponse({ success: false }, 500),
      jsonResponse({ error: "exa down" }, 503),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/good", "https://example.com/bad"],
      config: config(),
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe("# Good");
    expect(entries[1].text).toBe("");
    expect(entries[1].statusLabel).toContain("fetch failed");
    // Only the successful entry was cached.
    const files = await listContentCache();
    expect(files).toHaveLength(1);
  });

  it("fails an unmatched URL without caching it when Exa returns only the other URL", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({
        results: [{ url: "https://example.com/b", title: "B", text: "Exa B body." }],
        statuses: [{ id: "https://example.com/b", status: "success" }],
      }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b"],
      config: config(),
    });

    // Output order stays [A, B]; A failed and must not receive B's content.
    expect(entries.map((entry) => entry.normalizedUrl)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(entries[0].text).toBe("");
    expect(entries[0].statusLabel).toBe("fetch failed");
    expect(JSON.stringify(entries[0])).not.toContain("Exa B body.");
    expect(entries[1].text).toBe("Exa B body.");
    // A is a non-cacheable structured failure; only B was cached.
    expect(await readCachedEntry("https://example.com/a")).toBeNull();
    const cachedB = await readCachedEntry("https://example.com/b");
    expect(cachedB?.text).toBe("Exa B body.");
    expect(cachedB?.normalizedUrl).toBe("https://example.com/b");
  });

  it("matches out-of-order Exa results to their own requested URLs", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({
        results: [
          { url: "https://example.com/b", title: "B", text: "B body only." },
          { url: "https://example.com/a", title: "A", text: "A body only." },
        ],
        statuses: [
          { id: "https://example.com/b", status: "success" },
          { id: "https://example.com/a", status: "success" },
        ],
      }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b"],
      config: config(),
    });

    expect(entries.map((entry) => entry.text)).toEqual(["A body only.", "B body only."]);
    expect(await readCachedEntry("https://example.com/a")).toMatchObject({ text: "A body only." });
    expect(await readCachedEntry("https://example.com/b")).toMatchObject({ text: "B body only." });
  });

  it("never assigns a shifted or unordered partial response to the wrong requested URL", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({
        // C and B come back unordered and A is missing: unsafe positional
        // attribution would hand C's content to A and cache it under A.
        results: [
          { url: "https://example.com/c", title: "C", text: "C body only." },
          { url: "https://example.com/b", title: "B", text: "B body only." },
        ],
        statuses: [
          { id: "https://example.com/c", status: "success" },
          { id: "https://example.com/b", status: "success" },
        ],
      }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
      config: config(),
    });

    expect(entries.map((entry) => entry.normalizedUrl)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
    expect(entries[0].text).toBe("");
    expect(entries[0].statusLabel).toBe("fetch failed");
    expect(JSON.stringify(entries[0])).not.toContain("C body only.");
    expect(entries[1].text).toBe("B body only.");
    expect(entries[2].text).toBe("C body only.");
    expect(await readCachedEntry("https://example.com/a")).toBeNull();
    expect(await readCachedEntry("https://example.com/b")).toMatchObject({ text: "B body only." });
    expect(await readCachedEntry("https://example.com/c")).toMatchObject({ text: "C body only." });
  });

  it("keeps provider diagnostics and fake secrets out of model-visible fetch_contents output", async () => {
    const sentinel = "WSE-DIAGNOSTIC-SENTINEL-7f3a91";
    const fakeSecret = "sk-test-secret-a1b2c3d4";
    const mock = mockFetch(async (call) => {
      if (call.url === FIRECRAWL_SCRAPE_URL && call.body.url === "https://example.com/bad") {
        return jsonResponse({ success: false, error: `scrape rejected ${sentinel} key=${fakeSecret}` }, 402);
      }
      if (call.url === FIRECRAWL_SCRAPE_URL) return jsonResponse(scrapeSuccess("# Good"));
      if (call.url === EXA_CONTENTS_URL) throw new Error(`Exa transport failed ${sentinel} token ${fakeSecret}`);
      throw new Error(`unexpected fetch call ${call.url}`);
    });
    restore = mock.restore;
    calls = mock.calls;

    const result = await executeFetchContents(
      { uris: ["https://example.com/bad", "https://example.com/good"] },
      undefined,
      { config: config() },
    );
    const text = result.content[0].text;

    // The failed URL stays represented with a bounded generic failure status.
    expect(text).toContain("https://example.com/bad");
    expect(text).toContain("Status: fetch failed");
    expect(text).toContain("# Good");
    // Provider diagnostics, the sentinel, and the fake secret never leak.
    expect(text).not.toContain(sentinel);
    expect(text).not.toContain(fakeSecret);
    expect(text).not.toContain("scrape rejected");
    expect(text).not.toContain("Exa transport failed");
    // Tool details stay limited to safe provider/status metadata.
    const details = JSON.stringify(result.details);
    expect(details).not.toContain(sentinel);
    expect(details).not.toContain(fakeSecret);
    const failed = (result.details.results as Array<Record<string, unknown>>).find(
      (item) => item.normalizedUrl === "https://example.com/bad",
    );
    expect(failed?.status).toBe("fetch failed");
    expect(failed?.provider).toBe("exa_contents");
    expect(failed?.characterCount).toBe(0);
  });

  it("does not cache empty or failure-status content", async () => {
    install([jsonResponse({ success: true, data: { markdown: "", metadata: {} } }), jsonResponse({ error: "no key" }, 401)]);
    const entries = await fetchContentsEntries({ rawUris: ["https://example.com/a"], config: config() });

    expect(entries[0].text).toBe("");
    const files = await listContentCache();
    expect(files).toHaveLength(0);
  });

  it("fetches duplicate URLs once and reproduces them in input order", async () => {
    install([jsonResponse(scrapeSuccess()), jsonResponse(scrapeSuccess()), jsonResponse(scrapeSuccess())]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b", "https://example.com/a"],
      config: config(),
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.body.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(entries.map((entry) => entry.normalizedUrl)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/a",
    ]);
  });

  it("bounds Firecrawl concurrency to the configured limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const mock = mockFetch(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return jsonResponse(scrapeSuccess());
    });
    restore = mock.restore;
    calls = mock.calls;

    const urls = ["https://example.com/1", "https://example.com/2", "https://example.com/3", "https://example.com/4", "https://example.com/5"];
    const entries = await fetchContentsEntries({
      rawUris: urls,
      config: testConfig({ cacheDir, contents: { ...config().contents, concurrency: 2 } }),
    });

    expect(entries).toHaveLength(5);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("persists the effective provider allowance on Firecrawl-created cache entries", async () => {
    install([jsonResponse(scrapeSuccess()), jsonResponse(scrapeSuccess())]);
    await fetchContentsEntries({ rawUris: ["https://example.com/a"], rawMaxAgeHours: 7, config: config() });

    expect(calls[0]!.body.maxAge).toBe(7 * HOUR_MS);
    const cached = await readCachedEntry("https://example.com/a");
    expect(cached?.provider).toBe("firecrawl_scrape");
    expect(cached?.providerMaxAgeHours).toBe(7);

    // A stricter prior allowance is reusable by a looser later request while
    // the combined budget fits: 7h allowance plus milliseconds fits 8h.
    const entries = await fetchContentsEntries({ rawUris: ["https://example.com/a"], rawMaxAgeHours: 8, config: config() });
    expect(calls).toHaveLength(1);
    expect(entries[0].fromCache).toBe(true);
    expect(entries[0].text).toContain("Body text.");
  });

  it("persists the effective provider allowance on Exa-created cache entries", async () => {
    install([jsonResponse({ success: false }, 500), jsonResponse(exaContentsSuccess(["https://example.com/a"]))]);
    await fetchContentsEntries({ rawUris: ["https://example.com/a"], rawMaxAgeHours: 5, config: config() });

    expect(calls[1]!.url).toBe(EXA_CONTENTS_URL);
    expect(calls[1]!.body.maxAgeHours).toBe(5);
    const cached = await readCachedEntry("https://example.com/a");
    expect(cached?.provider).toBe("exa_contents");
    expect(cached?.providerMaxAgeHours).toBe(5);
  });

  it("reads legacy Exa cache entries without provider metadata but refetches them", async () => {
    const now = Date.now();
    const url = "https://example.com/legacy";
    await writeCache(url, {
      url,
      normalizedUrl: url,
      fetchedAt: now - 1000,
      expiresAt: now + 100_000,
      requestedMaxCharacters: 12000,
      title: "Legacy",
      text: "legacy body",
      exaStatus: { status: "success" },
      rawResult: { url, text: "legacy body" },
    });
    install([jsonResponse(scrapeSuccess("# Fresh"))]);

    const entries = await fetchContentsEntries({ rawUris: [url], config: config() });

    // The legacy record stays readable, but its unknown provider allowance
    // makes it unusable as a cache hit: the provider is called instead and
    // the request succeeds with fresh content.
    expect(calls).toHaveLength(1);
    expect(entries[0].text).toBe("# Fresh");
    expect(entries[0].fromCache).toBe(false);
    expect(await readCachedEntry(url)).toMatchObject({ text: "# Fresh", providerMaxAgeHours: 24 });
  });

  it("enforces per-URL and total output bounds", async () => {
    const bigMarkdown = "x".repeat(20_000);
    install([jsonResponse(scrapeSuccess(bigMarkdown)), jsonResponse(scrapeSuccess(bigMarkdown)), jsonResponse(scrapeSuccess(bigMarkdown)), jsonResponse(scrapeSuccess(bigMarkdown)), jsonResponse(scrapeSuccess(bigMarkdown))]);
    const { formatFetchedContents } = await import("../src/format.js");
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/1", "https://example.com/2", "https://example.com/3", "https://example.com/4", "https://example.com/5"],
      rawMaxCharacters: 100,
      config: config(),
    });

    expect(entries.every((entry) => entry.text.length <= 100)).toBe(true);

    const longEntries = entries.map((entry) => ({ ...entry, text: "y".repeat(20_000) }));
    const output = formatFetchedContents(longEntries as any);
    expect(output.length).toBeLessThanOrEqual(50_000 + 300);
    expect(output).toContain("[Output truncated at 50000 characters.");
  });

  it("reports url, provider, cache hit, status, and character count in tool details", async () => {
    install([jsonResponse(scrapeSuccess("# Details"))]);
    const result = await executeFetchContents({ uris: ["https://example.com/a"] }, undefined, { config: config() });

    const details = result.details.results as Array<Record<string, unknown>>;
    expect(details).toHaveLength(1);
    expect(details[0].normalizedUrl).toBe("https://example.com/a");
    expect(details[0].provider).toBe("firecrawl_scrape");
    expect(details[0].fromCache).toBe(false);
    expect(details[0].status).toBeNull();
    expect(details[0].characterCount).toBe("# Details".length);
    expect(result.content[0].text).toContain("Source: Firecrawl /scrape");
  });

  it("bounds and redacts every model-visible URL copy while the provider sees the full URL", async () => {
    // A dedicated long secret embedded in the URL exercises redaction before
    // truncation on every model-visible copy.
    const urlSecret = "wse-visible-url-secret-" + "s".repeat(40);
    setTestEnv({ [TEST_ENV_NAMES.exaApiKeyEnv]: urlSecret });
    const longUrl = `https://example.com/deep?token=${urlSecret}&pad=${"v".repeat(700)}`;
    const normalized = normalizeUrl(longUrl);
    expect(normalized.length).toBeGreaterThan(500);
    const secrets = [
      { label: TEST_ENV_NAMES.googleCloudApiKeyEnv, value: TEST_KEYS.google },
      { label: TEST_ENV_NAMES.parallelApiKeyEnv, value: TEST_KEYS.parallel },
      { label: TEST_ENV_NAMES.exaApiKeyEnv, value: urlSecret },
      { label: TEST_ENV_NAMES.firecrawlApiKeyEnv, value: TEST_KEYS.firecrawl },
    ];
    const bounded = boundUrlForStorage(normalized, secrets);
    expect(bounded.length).toBeLessThanOrEqual(500);
    expect(bounded).toMatch(/\[\+sha256:[0-9a-f]{12}\]$/);
    expectNoSecretFragments(bounded, urlSecret);

    install(async (call) => {
      // The provider call keeps the original full normalized URL.
      expect(call.url).toBe(FIRECRAWL_SCRAPE_URL);
      expect(call.body.url).toBe(normalized);
      return jsonResponse(scrapeSuccess("# Secret page"));
    });
    const result = await executeFetchContents({ uris: [longUrl] }, undefined, { config: config() });

    // The stored diagnostic record carries only bounded, redacted copies.
    const record = (await readStoredToolRecord(cacheDir, result.details.responseId as string)) as Record<string, any>;
    expect(record.results[0].normalizedUrl).toBe(bounded);
    expect(record.attempts[0].urls[0]).toBe(bounded);
    expectNoSecretFragments(JSON.stringify(record), urlSecret);
    expect(JSON.stringify(record)).not.toContain(normalized);

    // Tool details reuse the stored bounded copies; no secret or full URL leaks.
    const details = result.details.results as Array<Record<string, unknown>>;
    expect(details[0].url).toBe(bounded);
    expect(details[0].normalizedUrl).toBe(bounded);
    expectNoSecretFragments(JSON.stringify(result.details), urlSecret);
    expect(JSON.stringify(result.details)).not.toContain(normalized);

    // Model-visible content output carries the same bounded copy.
    const text = result.content[0].text;
    expect(text).toContain(`URL: ${bounded}`);
    expect(text).toContain("# Secret page");
    expectNoSecretFragments(text, urlSecret);
    expect(text).not.toContain(normalized);

    // The expanded TUI render reads only the bounded details copies.
    const lines = (createWebSearchResultRenderer("fetch_contents")(result, { expanded: true, isPartial: false }, {}, {}).render(400) as string[]).join("\n");
    expect(lines).toContain(bounded);
    expect(lines).not.toContain(normalized);
    expectNoSecretFragments(lines, urlSecret);

    // The content cache keeps cache identity but is secret-redacted on write.
    const cached = await readCachedEntry(normalized);
    expect(cached?.text).toContain("# Secret page");
    expectNoSecretFragments(JSON.stringify(cached), urlSecret);
  });
});

describe("fetch_contents public resource bounds", () => {
  it("rejects 26 URLs as invalid input before any cache or provider attempt", async () => {
    const urls = Array.from({ length: 26 }, (_, i) => `https://example.com/u/${i}`);
    install([]);

    let thrown: unknown;
    try {
      await executeFetchContents({ uris: urls }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("uris must contain at most 25 URLs");
    // No cache read, no provider call, no cache write happened at all.
    expect(calls).toHaveLength(0);
    expect(await listContentCache()).toEqual([]);

    // The direct orchestration entry rejects the same input before I/O too.
    await expect(fetchContentsEntries({ rawUris: urls, config: config() })).rejects.toThrow("at most 25 URLs");
    expect(calls).toHaveLength(0);
  });

  it("accepts 25 URLs and records one Firecrawl attempt per unique URL", async () => {
    const urls = Array.from({ length: 25 }, (_, i) => `https://example.com/u/${i}`);
    install(async (call) => jsonResponse(scrapeSuccess(`# Page ${call.body.url}`, call.body.url)));

    const result = await executeFetchContents({ uris: urls }, undefined, { config: config() });

    expect(calls).toHaveLength(25);
    expect(result.content[0].text).toContain("# Page https://example.com/u/0");
    expect((result.details.results as unknown[])).toHaveLength(25);
    expect(result.details.attemptCount).toBe(25);
    expect(result.details.failureCategories).toEqual([]);
  });

  it("keeps at most 10 scrapes in flight for configured concurrency 10", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const mock = mockFetch(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return jsonResponse(scrapeSuccess());
    });
    restore = mock.restore;
    calls = mock.calls;
    const urls = Array.from({ length: 25 }, (_, i) => `https://example.com/u/${i}`);

    const entries = await fetchContentsEntries({
      rawUris: urls,
      config: testConfig({ cacheDir, contents: { ...config().contents, concurrency: 10 } }),
    });

    expect(entries).toHaveLength(25);
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(maxInFlight).toBeGreaterThan(3);
  });

  it("defensively caps injected concurrency above the ceiling to 10 workers", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const mock = mockFetch(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return jsonResponse(scrapeSuccess());
    });
    restore = mock.restore;
    calls = mock.calls;
    const urls = Array.from({ length: 25 }, (_, i) => `https://example.com/u/${i}`);

    // A corrupted or injected config value above the ceiling still runs at most 10 workers.
    const entries = await fetchContentsEntries({
      rawUris: urls,
      config: testConfig({ cacheDir, contents: { ...config().contents, concurrency: 50 } }),
    });

    expect(entries).toHaveLength(25);
    expect(maxInFlight).toBeLessThanOrEqual(10);
  });

  it("rejects maxCharacters above 50000 as invalid input before any provider call", async () => {
    install([]);
    let thrown: unknown;
    try {
      await executeFetchContents({ uris: ["https://example.com/a"], maxCharacters: 50_001 }, undefined, { config: config() });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("maxCharacters must be a positive integer no greater than 50000");
    expect(calls).toHaveLength(0);

    thrown = undefined;
    try {
      await fetchContentsEntries({ rawUris: ["https://example.com/a"], rawMaxCharacters: 500_001, config: config() });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toContain("no greater than 50000");
    expect(calls).toHaveLength(0);
  });
});

describe("fetch input validation and default resolution", () => {
  it("validates shape, caps, and explicit maxAgeHours without a config", () => {
    const validated = validateFetchContentsInput({
      rawUris: ["https://example.com/a"],
      rawMaxCharacters: 500,
      rawMaxAgeHours: 0,
    });
    expect(validated).toEqual({
      uris: ["https://example.com/a"],
      normalizedUrls: ["https://example.com/a"],
      maxCharacters: 500,
      maxAgeHours: 0,
    });
    expect(validateFetchContentsInput({ rawUris: ["https://example.com/a"] }).maxAgeHours).toBeUndefined();
    expect(validateFetchContentsInput({ rawUris: ["https://example.com/a"], rawMaxAgeHours: null }).maxAgeHours).toBeUndefined();
    expect(() => validateFetchContentsInput({ rawUris: ["https://example.com/a"], rawMaxAgeHours: 721 })).toThrow(
      "maxAgeHours must be an integer between 0 and 720",
    );
    expect(() => validateFetchContentsInput({ rawUris: ["https://example.com/a"], rawMaxAgeHours: -1 })).toThrow(
      "maxAgeHours must be an integer between 0 and 720",
    );
  });

  it("resolves absent maxAgeHours only through the config default and keeps explicit zero", () => {
    const validated = validateFetchContentsInput({ rawUris: ["https://example.com/a"], rawMaxCharacters: 100 });
    expect(resolveFetchContentsInput(validated, 48).maxAgeHours).toBe(48);
    expect(resolveFetchContentsInput({ ...validated, maxAgeHours: 0 }, 48).maxAgeHours).toBe(0);
    // The compatibility wrapper keeps composing both steps.
    expect(
      parseFetchContentsInput({ rawUris: ["https://example.com/a"], rawMaxAgeHours: null, defaultMaxAgeHours: 9 }).maxAgeHours,
    ).toBe(9);
    expect(parseFetchContentsInput({ rawUris: ["https://example.com/a"], defaultMaxAgeHours: 12 }).maxAgeHours).toBe(12);
  });
});

describe("direct fetchContentsEntries validation order", () => {
  it("rejects invalid input before the config loader runs", async () => {
    const urls = Array.from({ length: 26 }, (_, i) => `https://example.com/u/${i}`);
    let loadCount = 0;
    setConfigLoaderForTests({
      load: () => {
        loadCount += 1;
        throw new Error("config loader must not be reached");
      },
    });
    try {
      await expect(fetchContentsEntries({ rawUris: urls })).rejects.toThrow("at most 25 URLs");
    } finally {
      setConfigLoaderForTests(undefined);
    }
    expect(loadCount).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("resolves the absent maxAgeHours default from the loader-provided config", async () => {
    let loadCount = 0;
    setConfigLoaderForTests({
      load: () => {
        loadCount += 1;
        return testConfig({ cacheDir, contents: { ...config().contents, defaultMaxAgeHours: 7 } });
      },
    });
    try {
      install([jsonResponse(scrapeSuccess())]);
      const entries = await fetchContentsEntries({ rawUris: ["https://example.com/a"] });

      expect(loadCount).toBe(1);
      expect(entries[0].text).toContain("Body text.");
      expect(calls[0].body.maxAge).toBe(7 * HOUR_MS);
    } finally {
      setConfigLoaderForTests(undefined);
    }
  });
});

describe("Exa Contents result identity", () => {
  it("maps a URL-like id-only result to its own requested URL only", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({
        results: [{ id: "https://example.com/b", title: "B", text: "B body only." }],
        statuses: [{ id: "https://example.com/b", status: "success" }],
      }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b"],
      config: config(),
    });

    // A stays a generic failure; B's content is attributed to B alone.
    expect(entries.map((entry) => entry.text)).toEqual(["", "B body only."]);
    expect(entries[0].statusLabel).toBe("fetch failed");
    expect(entries[1].provider).toBe("exa_contents");
    expect(await readCachedEntry("https://example.com/a")).toBeNull();
    expect(await readCachedEntry("https://example.com/b")).toMatchObject({ text: "B body only." });
  });

  it("matches status entries through the same url/uri/id identity without positional fallback", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({
        results: [{ url: "https://example.com/a", title: "A", text: "A body only." }],
        statuses: [
          { id: "https://example.com/other", status: "error: wrong positional status" },
          { uri: "https://example.com/a", status: "success via uri" },
        ],
      }),
    ]);
    const entries = await fetchContentsEntries({ rawUris: ["https://example.com/a"], config: config() });

    expect(entries[0].text).toBe("A body only.");
    expect(entries[0].statusLabel).toBe("success via uri");
    expect(await readCachedEntry("https://example.com/a")).toMatchObject({ text: "A body only." });
    expect(JSON.stringify(entries)).not.toContain("wrong positional status");
  });

  it("does not apply an unrelated positional status to an identified result in a multi-URL batch", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({
        results: [{ url: "https://example.com/a", title: "A", text: "A body only." }],
        statuses: [{ id: "https://example.com/b", status: "error: belongs to B" }],
      }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b"],
      config: config(),
    });

    expect(entries[0].text).toBe("A body only.");
    expect(entries[0].statusLabel).toBeUndefined();
    expect(entries[1].text).toBe("");
    expect(entries[1].statusLabel).toBe("fetch failed");
    expect(await readCachedEntry("https://example.com/a")).toMatchObject({ text: "A body only." });
    expect(await readCachedEntry("https://example.com/b")).toBeNull();
  });

  it("maps an id-only result inside an unordered partial batch to its own URL", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({
        results: [
          { id: "https://example.com/c", title: "C", text: "C body only." },
          { url: "https://example.com/a", title: "A", text: "A body only." },
        ],
        statuses: [
          { id: "https://example.com/c", status: "success" },
          { id: "https://example.com/a", status: "success" },
        ],
      }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
      config: config(),
    });

    expect(entries.map((entry) => entry.text)).toEqual(["A body only.", "", "C body only."]);
    expect(JSON.stringify(entries[1])).not.toContain("C body only.");
    expect(await readCachedEntry("https://example.com/b")).toBeNull();
    expect(await readCachedEntry("https://example.com/c")).toMatchObject({ text: "C body only." });
  });

  it("never positionally assigns unidentified results across multiple requested URLs", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({
        // No url, uri, or URL-like id: unsafe to assign to any request.
        results: [
          { title: "First", text: "unidentified first body." },
          { title: "Second", text: "unidentified second body." },
        ],
        statuses: [],
      }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b"],
      config: config(),
    });

    expect(entries.map((entry) => entry.text)).toEqual(["", ""]);
    expect(entries.every((entry) => entry.statusLabel === "fetch failed")).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("unidentified");
    expect(await listContentCache()).toEqual([]);
  });

  it("keeps the legacy single-URL positional case for one unidentified result", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ results: [{ title: "Only", text: "legacy single body." }], statuses: [] }),
    ]);
    const entries = await fetchContentsEntries({ rawUris: ["https://example.com/a"], config: config() });

    expect(entries[0].text).toBe("legacy single body.");
    expect(entries[0].provider).toBe("exa_contents");
    expect(await readCachedEntry("https://example.com/a")).toMatchObject({ text: "legacy single body." });
  });

  it("fails both URLs generically when one unidentified result answers two requests", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      // A single unidentified result: the old positional fallback applied it
      // to every requested URL, handing one body to both requests.
      jsonResponse({ results: [{ title: "Only", text: "unidentified single body." }], statuses: [] }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b"],
      config: config(),
    });

    expect(entries.map((entry) => entry.normalizedUrl)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(entries.map((entry) => entry.text)).toEqual(["", ""]);
    expect(entries.every((entry) => entry.statusLabel === "fetch failed")).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("unidentified single body.");
    // Neither URL receives the unidentified content, so nothing is cached.
    expect(await listContentCache()).toEqual([]);
  });

  it("does not positionally assign a single mismatched identified result to one of two requests", async () => {
    install([
      jsonResponse({ success: false }, 500),
      jsonResponse({ success: false }, 500),
      jsonResponse({
        results: [{ url: "https://example.com/other", title: "Other", text: "other body." }],
        statuses: [{ id: "https://example.com/other", status: "success" }],
      }),
    ]);
    const entries = await fetchContentsEntries({
      rawUris: ["https://example.com/a", "https://example.com/b"],
      config: config(),
    });

    expect(entries.map((entry) => entry.text)).toEqual(["", ""]);
    expect(JSON.stringify(entries)).not.toContain("other body.");
    expect(await listContentCache()).toEqual([]);
  });
});

describe("Firecrawl target-page status handling", () => {
  it("rejects a wrapped 404 target page, falls back to Exa, and never caches the error page", async () => {
    install([
      jsonResponse(scrapeSuccess("# 404 Not Found\n\nThe page you requested does not exist.", {
        metadata: { title: "Not Found", sourceURL: "https://example.com/a", statusCode: 404 },
      })),
      jsonResponse(exaContentsSuccess(["https://example.com/a"])),
    ]);
    const result = await executeFetchContents({ uris: ["https://example.com/a"] }, undefined, { config: config() });

    // The Firecrawl error-page Markdown never reaches output.
    expect(result.content[0].text).toContain("Exa markdown body.");
    expect(result.content[0].text).not.toContain("404 Not Found");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(EXA_CONTENTS_URL);
    const cached = await readCachedEntry("https://example.com/a");
    expect(cached?.text).toBe("Exa markdown body.");
    expect(cached?.provider).toBe("exa_contents");
    expect(result.details.failureCategories).toContain("unusable_response");

    const { readStoredToolRecord } = await import("../src/storage.js");
    const record = (await readStoredToolRecord(cacheDir, result.details!.responseId as string)) as Record<string, any>;
    expect(record.attempts[0].status).toBe("unusable_response");
    expect(record.attempts[0].normalized.statusCode).toBe(404);
    expect(record.results[0].provider).toBe("exa_contents");
  });

  it("rejects a wrapped 500 target page and returns a generic failure when Exa also fails", async () => {
    install([
      jsonResponse(scrapeSuccess("# 500 Server Error\n\nInternal error page markdown.", {
        metadata: { title: "Server Error", sourceURL: "https://example.com/a", statusCode: 500 },
      })),
      jsonResponse({ error: "exa down" }, 503),
    ]);
    const result = await executeFetchContents({ uris: ["https://example.com/a"] }, undefined, { config: config() });

    expect(result.content[0].text).toContain("Status: fetch failed");
    expect(result.content[0].text).not.toContain("Internal error page markdown.");
    expect(await listContentCache()).toEqual([]);

    const { readStoredToolRecord } = await import("../src/storage.js");
    const record = (await readStoredToolRecord(cacheDir, result.details!.responseId as string)) as Record<string, any>;
    expect(record.attempts[0].status).toBe("unusable_response");
    expect(record.attempts[0].normalized.statusCode).toBe(500);
    expect(record.attempts[1].status).toBe("http_error");
  });

  it("keeps absent, 2xx, and 3xx target statuses usable without an Exa call", async () => {
    install([
      jsonResponse(scrapeSuccess("# No status", { metadata: { title: "No Status", sourceURL: "https://example.com/a" } })),
      jsonResponse(scrapeSuccess("# Explicit 200", { metadata: { title: "OK", sourceURL: "https://example.com/b", statusCode: 200 } })),
      jsonResponse(scrapeSuccess("# Redirected 302", { metadata: { title: "Moved", sourceURL: "https://example.com/c", statusCode: 302 } })),
    ]);
    const result = await executeFetchContents(
      { uris: ["https://example.com/a", "https://example.com/b", "https://example.com/c"] },
      undefined,
      { config: config() },
    );

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.url === FIRECRAWL_SCRAPE_URL)).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("# No status");
    expect(text).toContain("# Explicit 200");
    expect(text).toContain("# Redirected 302");
    expect(result.details.failureCategories).toEqual([]);
  });
});
