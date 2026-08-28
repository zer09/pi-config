import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { cacheKeyForUrl, normalizeUrl } from "../src/url.js";

describe("URL normalization and cache keys", () => {
  it("normalizes URL fragments, host case, and default ports", () => {
    expect(normalizeUrl(" HTTPS://Example.COM:443/docs?q=Zod#section ")).toBe("https://example.com/docs?q=Zod");
    expect(normalizeUrl("http://Example.com:80/path#frag")).toBe("http://example.com/path");
  });

  it("hashes the normalized URL for content cache keys", () => {
    const normalized = "https://example.com/docs?q=Zod";
    expect(cacheKeyForUrl(normalized)).toBe(createHash("sha256").update(normalized).digest("hex"));
    expect(cacheKeyForUrl(normalizeUrl("https://EXAMPLE.com/docs?q=Zod#ignored"))).toBe(cacheKeyForUrl(normalized));
  });
});
