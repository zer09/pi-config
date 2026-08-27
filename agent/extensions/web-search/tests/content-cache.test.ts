import { describe, expect, it } from "bun:test";
import {
  createFailedContentEntry,
  dedupeContentMisses,
  formatContentCacheEntryForTool,
  isCacheableContentEntry,
  isContentCacheEntryUsable,
  providerForContentEntry,
} from "../src/content-cache.js";
import { parseExaContentsResults } from "../src/content-parser.js";
import type { ContentCacheEntry } from "../src/types.js";

const NOW = 1_000_000;
const HOUR_MS = 3_600_000;

function entry(overrides: Partial<ContentCacheEntry> = {}): ContentCacheEntry {
  return {
    url: "https://example.com/a",
    normalizedUrl: "https://example.com/a",
    fetchedAt: NOW - 1_000,
    expiresAt: NOW + 100_000,
    requestedMaxCharacters: 1000,
    // Zero provider allowance means the entry's age is exactly its local age.
    providerMaxAgeHours: 0,
    text: "abcdef",
    ...overrides,
  };
}

describe("fetch_contents cache policy", () => {
  it("records requested maxCharacters on parsed Exa /contents results", () => {
    const [parsed] = parseExaContentsResults({
      data: {
        results: [{ url: "https://example.com/a", title: "A", text: "abcdef" }],
        statuses: [{ id: "https://example.com/a", status: "success" }],
      },
      requestedUrls: ["https://example.com/a"],
      requestedMaxCharacters: 500,
      providerMaxAgeHours: 24,
      ttlMs: 1000,
      now: 10,
    });

    expect(parsed.requestedMaxCharacters).toBe(500);
    expect(parsed.providerMaxAgeHours).toBe(24);
    expect(parsed.expiresAt).toBe(1010);
    expect(parsed.text).toBe("abcdef");
    expect(parsed.provider).toBe("exa_contents");
    expect(parsed.providerStatus).toEqual({ id: "https://example.com/a", status: "success" });
  });

  it("attributes URL-bearing results only to the same normalized requested URL", () => {
    const parsed = parseExaContentsResults({
      data: { results: [{ url: "https://example.com/b", title: "B", text: "b content" }] },
      requestedUrls: ["https://example.com/a", "https://example.com/b"],
      requestedMaxCharacters: 1000,
      providerMaxAgeHours: 0,
      ttlMs: 1000,
      now: 10,
    });

    // A requested only B's content: A must not receive it positionally.
    expect(parsed[0].text).toBe("");
    expect(parsed[0].title).toBeUndefined();
    expect(parsed[0].providerStatus).toBe("no result matched the requested URL");
    expect(isCacheableContentEntry(parsed[0])).toBe(false);
    expect(parsed[1].text).toBe("b content");
    expect(parsed[1].title).toBe("B");
  });

  it("keeps out-of-order results matched to their own requested URLs", () => {
    const parsed = parseExaContentsResults({
      data: {
        results: [
          { url: "https://example.com/b", text: "b content" },
          { url: "https://example.com/a", text: "a content" },
        ],
        statuses: [
          { id: "https://example.com/b", status: "success" },
          { id: "https://example.com/a", status: "success" },
        ],
      },
      requestedUrls: ["https://example.com/a", "https://example.com/b"],
      requestedMaxCharacters: 1000,
      providerMaxAgeHours: 24,
      ttlMs: 1000,
      now: 10,
    });

    expect(parsed[0].text).toBe("a content");
    expect(parsed[0].providerStatus).toEqual({ id: "https://example.com/a", status: "success" });
    expect(parsed[1].text).toBe("b content");
    expect(parsed[1].providerStatus).toEqual({ id: "https://example.com/b", status: "success" });
  });

  it("keeps positional attribution only for results without a URL identity", () => {
    const urlLess = parseExaContentsResults({
      data: { results: [{ title: "Legacy", text: "legacy content" }] },
      requestedUrls: ["https://example.com/a"],
      requestedMaxCharacters: 1000,
      providerMaxAgeHours: 24,
      ttlMs: 1000,
      now: 10,
    });
    expect(urlLess[0].text).toBe("legacy content");

    // A URL-bearing result at another request's position is never reassigned.
    const mismatched = parseExaContentsResults({
      data: { results: [{ url: "https://example.com/b", text: "b content" }] },
      requestedUrls: ["https://example.com/a"],
      requestedMaxCharacters: 1000,
      providerMaxAgeHours: 24,
      ttlMs: 1000,
      now: 10,
    });
    expect(mismatched[0].text).toBe("");
    expect(isCacheableContentEntry(mismatched[0])).toBe(false);
  });

  it("never applies a single unidentified result to multiple requested URLs", () => {
    const parsed = parseExaContentsResults({
      // Exactly one result with no url, uri, or URL-like id: the old
      // positional fallback satisfied every requested URL with it.
      data: { results: [{ title: "Only", text: "unidentified body." }] },
      requestedUrls: ["https://example.com/a", "https://example.com/b"],
      requestedMaxCharacters: 1000,
      providerMaxAgeHours: 24,
      ttlMs: 1000,
      now: 10,
    });

    expect(parsed.map((entry) => entry.text)).toEqual(["", ""]);
    expect(parsed.every((entry) => entry.title === undefined)).toBe(true);
    expect(parsed.every((entry) => entry.providerMaxAgeHours === 24)).toBe(true);
    expect(parsed.every((entry) => entry.providerStatus === "no result matched the requested URL")).toBe(true);
    expect(parsed.every((entry) => isCacheableContentEntry(entry))).toBe(false);
  });

  it("does not let a smaller cached response satisfy a larger request", () => {
    expect(isContentCacheEntryUsable(entry({ requestedMaxCharacters: 500, text: "x".repeat(500) }), 12000, 24, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(entry({ requestedMaxCharacters: 12000, text: "x".repeat(500) }), 500, 24, NOW)).toBe(true);
  });

  it("uses an entry only when its fetch age satisfies the current maxAgeHours", () => {
    const elevenHoursOld = entry({ fetchedAt: NOW - 11 * HOUR_MS });
    const twentyFiveHoursOld = entry({ fetchedAt: NOW - 25 * HOUR_MS });

    expect(isContentCacheEntryUsable(elevenHoursOld, 1000, 24, NOW)).toBe(true);
    expect(isContentCacheEntryUsable(elevenHoursOld, 1000, 720, NOW)).toBe(true);
    expect(isContentCacheEntryUsable(twentyFiveHoursOld, 1000, 24, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(twentyFiveHoursOld, 1000, 48, NOW)).toBe(true);
  });

  it("rejects a 720h-provider-allowance entry for a 1h request even when locally fresh", () => {
    // The provider may have served content already 720 hours old, so a
    // locally fresh entry can never satisfy a 1h freshness request.
    const seeded = entry({ fetchedAt: NOW, providerMaxAgeHours: 720 });
    expect(isContentCacheEntryUsable(seeded, 1000, 1, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(entry({ fetchedAt: NOW, providerMaxAgeHours: 1 }), 1000, 1, NOW)).toBe(false);
  });

  it("checks the combined local-age-plus-provider-allowance budget with a strict boundary", () => {
    // Provider allowance 1h: exactly 1h of local age reaches the 2h budget.
    const oneHourOld = entry({ fetchedAt: NOW - HOUR_MS, providerMaxAgeHours: 1 });
    const justUnderOneHourOld = entry({ fetchedAt: NOW - HOUR_MS + 1, providerMaxAgeHours: 1 });
    expect(isContentCacheEntryUsable(oneHourOld, 1000, 2, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(justUnderOneHourOld, 1000, 2, NOW)).toBe(true);
    // The local age must fit the budget on its own too: allowance 1h with a
    // 1.5h-old entry cannot satisfy a 2h request (1.5h + 1h > 2h).
    expect(isContentCacheEntryUsable(entry({ fetchedAt: NOW - 1.5 * HOUR_MS, providerMaxAgeHours: 1 }), 1000, 2, NOW)).toBe(false);
  });

  it("reuses a stricter prior provider allowance under a looser request while the combined budget fits", () => {
    // Fetched under a strict 1h allowance: usable by a later 24h request while
    // the combined age fits, but never by an equally strict 1h request.
    const strictPrior = entry({ fetchedAt: NOW - HOUR_MS, providerMaxAgeHours: 1 });
    expect(isContentCacheEntryUsable(strictPrior, 1000, 24, NOW)).toBe(true);
    expect(isContentCacheEntryUsable(strictPrior, 1000, 1, NOW)).toBe(false);
    // Once the combined age passes the later budget, it stops being usable.
    expect(isContentCacheEntryUsable(entry({ fetchedAt: NOW - 23.5 * HOUR_MS, providerMaxAgeHours: 1 }), 1000, 24, NOW)).toBe(false);
  });

  it("treats a future fetchedAt as zero local age without making the entry usable beyond its allowance", () => {
    // Clock skew backwards: the negative local age is floored at zero, so the
    // combined budget still counts the full provider allowance.
    const future = entry({ fetchedAt: NOW + 5 * HOUR_MS, providerMaxAgeHours: 1 });
    expect(isContentCacheEntryUsable(future, 1000, 1, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(future, 1000, 2, NOW)).toBe(true);
  });

  it("never treats legacy or invalid providerMaxAgeHours entries as cache hits", () => {
    expect(isContentCacheEntryUsable(entry({ providerMaxAgeHours: undefined }), 1000, 720, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(entry({ providerMaxAgeHours: Number.NaN }), 1000, 720, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(entry({ providerMaxAgeHours: Number.POSITIVE_INFINITY }), 1000, 720, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(entry({ providerMaxAgeHours: -1 }), 1000, 720, NOW)).toBe(false);
    expect(isContentCacheEntryUsable(entry({ providerMaxAgeHours: "24" as unknown as number }), 1000, 720, NOW)).toBe(false);
  });

  it("does not cache failed or empty provider entries", () => {
    expect(isCacheableContentEntry(entry({ exaStatus: { status: "success" }, text: "ok" }))).toBe(true);
    expect(isCacheableContentEntry(entry({ exaStatus: { status: "error", message: "fetch failed" }, text: "" }))).toBe(false);
    expect(isCacheableContentEntry(entry({ exaStatus: { statusCode: 500 }, text: "server error" }))).toBe(false);
    expect(isCacheableContentEntry(entry({ exaStatus: { ok: false }, text: "blocked" }))).toBe(false);
    expect(isCacheableContentEntry(entry({ exaStatus: { status: "success" }, text: "" }))).toBe(false);
  });

  it("applies failure detection to providerStatus for the new providers", () => {
    expect(isCacheableContentEntry(entry({ provider: "firecrawl_scrape", providerStatus: { success: true, statusCode: 200 }, text: "ok" }))).toBe(true);
    expect(isCacheableContentEntry(entry({ provider: "firecrawl_scrape", providerStatus: { success: false }, text: "body" }))).toBe(false);
    expect(isCacheableContentEntry(entry({ provider: "exa_contents", providerStatus: { statusCode: 404 }, text: "body" }))).toBe(false);
  });

  it("deduplicates cache misses while preserving original duplicate indices", () => {
    const misses = dedupeContentMisses([
      { index: 0, normalizedUrl: "https://example.com/a", cacheKey: "a" },
      { index: 1, normalizedUrl: "https://example.com/b", cacheKey: "b" },
      { index: 2, normalizedUrl: "https://example.com/a", cacheKey: "a" },
      { index: 3, normalizedUrl: "https://example.com/b", cacheKey: "b" },
    ]);

    expect(misses.map((miss) => miss.normalizedUrl)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(misses[0].misses.map((miss) => miss.index)).toEqual([0, 2]);
    expect(misses[1].misses.map((miss) => miss.index)).toEqual([1, 3]);
  });

  it("identifies the provider of new and legacy cache entries", () => {
    expect(providerForContentEntry(entry({ provider: "firecrawl_scrape" }))).toBe("firecrawl_scrape");
    expect(providerForContentEntry(entry({ provider: "exa_contents" }))).toBe("exa_contents");
    expect(providerForContentEntry(entry({ exaStatus: { status: "success" } }))).toBe("exa_contents");
    expect(providerForContentEntry(entry())).toBeUndefined();
  });

  it("renders only a bounded generic status label for failed content entries", () => {
    const failed = createFailedContentEntry("https://example.com/a", 1000, "exa_contents");
    expect(failed.providerStatus).toBe("fetch failed");
    expect(failed.text).toBe("");
    expect(isCacheableContentEntry(failed)).toBe(false);
    expect(formatContentCacheEntryForTool(failed, false, 1000).statusLabel).toBe("fetch failed");

    // Failure-like provider statuses collapse to the generic label; their
    // free-text diagnostic fields never reach model-visible output.
    const failureStatus = formatContentCacheEntryForTool(
      entry({ provider: "exa_contents", providerStatus: { status: "error", message: "provider diagnostic detail" }, text: "body" }),
      false,
      1000,
    );
    expect(failureStatus.statusLabel).toBe("fetch failed");

    // Non-failure statuses surface only their short provider status field.
    const success = formatContentCacheEntryForTool(
      entry({ provider: "exa_contents", providerStatus: { status: "completed", message: "internal note" }, text: "body" }),
      false,
      1000,
    );
    expect(success.statusLabel).toBe("completed");
  });
});
