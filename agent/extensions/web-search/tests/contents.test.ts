import "./pi-tui-mock.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { executeFetchContents } = await import("../src/tools.js");
const { fetchContentsEntries } = await import("../src/contents.js");
const { contentPath, readContentCacheEntry } = await import("../src/storage.js");
const { cacheKeyForUrl } = await import("../src/url.js");
const {
  clearTestEnv,
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

  it("reads legacy Exa cache entries without provider metadata", async () => {
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
    install([]);

    const entries = await fetchContentsEntries({ rawUris: [url], config: config() });

    expect(calls).toHaveLength(0);
    expect(entries[0].text).toBe("legacy body");
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
});
