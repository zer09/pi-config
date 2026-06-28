import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { assertMode, classifyFallbackRoute, selectFallbackRoute } from "../src/routing.js";
import { cacheKeyForUrl, normalizeUrl } from "../src/url.js";

describe("fallback routing", () => {
  it("uses explicit mode before classification", () => {
    expect(selectFallbackRoute("NASA Artemis II mission schedule and crew", "code")).toBe("code_search");
    expect(selectFallbackRoute("TypeScript Zod Express request body validation snippet", "web")).toBe("exa_search");
  });

  it("keeps auto mode conservative", () => {
    expect(classifyFallbackRoute("latest stable TypeScript version")).toBe("exa_search");
    expect(classifyFallbackRoute("TypeScript Zod Express request body validation snippet")).toBe("code_search");
    expect(classifyFallbackRoute("NASA Artemis II mission schedule and crew")).toBe("exa_search");
    expect(classifyFallbackRoute("Next.js route handler GET endpoint returning JSON code")).toBe("code_search");
  });

  it("defaults absent, null, and empty modes to auto", () => {
    expect(assertMode(undefined)).toBe("auto");
    expect(assertMode(null)).toBe("auto");
    expect(assertMode("")).toBe("auto");
  });
});

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
