import { describe, expect, it } from "bun:test";
import { dedupeContentMisses, isCacheableContentEntry, isContentCacheEntryUsable } from "../src/content-cache.js";
import { parseExaContentsResults } from "../src/content-parser.js";
import type { ContentCacheEntry } from "../src/types.js";

function entry(overrides: Partial<ContentCacheEntry> = {}): ContentCacheEntry {
  return {
    url: "https://example.com/a",
    normalizedUrl: "https://example.com/a",
    fetchedAt: 1,
    expiresAt: 2,
    requestedMaxCharacters: 1000,
    text: "abcdef",
    ...overrides,
  };
}

describe("fetch_contents cache policy", () => {
  it("records requested maxCharacters on parsed Exa /contents results", () => {
    const [parsed] = parseExaContentsResults({
      data: {
        results: [{ url: "https://example.com/a", title: "A", text: "abcdef" }],
        statuses: [{ status: "success" }],
      },
      requestedUrls: ["https://example.com/a"],
      requestedMaxCharacters: 500,
      ttlMs: 1000,
      now: 10,
    });

    expect(parsed.requestedMaxCharacters).toBe(500);
    expect(parsed.expiresAt).toBe(1010);
    expect(parsed.text).toBe("abcdef");
  });

  it("does not let a smaller cached response satisfy a larger request", () => {
    expect(isContentCacheEntryUsable(entry({ requestedMaxCharacters: 500, text: "x".repeat(500) }), 12000)).toBe(false);
    expect(isContentCacheEntryUsable(entry({ requestedMaxCharacters: 12000, text: "x".repeat(500) }), 500)).toBe(true);
  });

  it("does not cache failed or empty Exa /contents entries", () => {
    expect(isCacheableContentEntry(entry({ exaStatus: { status: "success" }, text: "ok" }))).toBe(true);
    expect(isCacheableContentEntry(entry({ exaStatus: { status: "error", message: "fetch failed" }, text: "" }))).toBe(false);
    expect(isCacheableContentEntry(entry({ exaStatus: { statusCode: 500 }, text: "server error" }))).toBe(false);
    expect(isCacheableContentEntry(entry({ exaStatus: { ok: false }, text: "blocked" }))).toBe(false);
    expect(isCacheableContentEntry(entry({ exaStatus: { status: "success" }, text: "" }))).toBe(false);
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
});
