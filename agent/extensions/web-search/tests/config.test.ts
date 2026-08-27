import { describe, expect, it } from "bun:test";
import { configFromRaw, DEFAULT_CONFIG, expandHome } from "../src/config.js";

describe("config defaults", () => {
  it("uses the documented provider-neutral defaults", () => {
    const config = configFromRaw({});

    expect(config.googleCloudApiKeyEnv).toBe("GOOGLE_CLOUD_API_KEY");
    expect(config.parallelApiKeyEnv).toBe("PARALLEL_API_KEY");
    expect(config.exaApiKeyEnv).toBe("EXA_API_KEY");
    expect(config.firecrawlApiKeyEnv).toBe("FIRECRAWL_API_KEY");
    expect(config.model).toBe("gemini-3.5-flash");
    expect(config.webSearch.defaultDepth).toBe("standard");
    expect(config.webSearch.parallel).toEqual({ standardMode: "basic", deepMode: "advanced" });
    expect(config.webSearch.exa.standard).toEqual({ type: "fast", numResults: 5, maxHighlightCharacters: 2000 });
    expect(config.webSearch.exa.deep).toEqual({ type: "fast", numResults: 10, maxHighlightCharacters: 4000 });
    expect(config.codeSearch.firecrawl).toEqual({ k: 10, passages: 2 });
    expect(config.codeSearch.exaCode.tokensNum).toBe("dynamic");
    expect(config.contents).toEqual({ defaultMaxAgeHours: 24, concurrency: 3, scrapeTimeoutMs: 60_000 });
    expect(config.rawResponseTtlMs).toBe(DEFAULT_CONFIG.rawResponseTtlMs);
    expect(config.contentCacheTtlMs).toBe(DEFAULT_CONFIG.contentCacheTtlMs);
    expect(config.cacheDir).toBe(expandHome("~/.pi/web_search_cache"));
  });

  it("loads the new provider-neutral sections", () => {
    const config = configFromRaw({
      google: { cloudApiKeyEnv: "GOOGLE_ALT" },
      parallel: { apiKeyEnv: "PARALLEL_ALT" },
      exa: { apiKeyEnv: "EXA_ALT" },
      firecrawl: { apiKeyEnv: "FIRECRAWL_ALT" },
      webSearch: {
        model: "gemini-3.5-pro",
        defaultDepth: "deep",
        parallel: { standardMode: "advanced", deepMode: "basic" },
        exaGrounding: {
          standard: { type: "fast", numResults: 3, maxHighlightCharacters: 900 },
          deep: { type: "fast", numResults: 20, maxHighlightCharacters: 8000 },
        },
      },
      codeSearch: { firecrawl: { k: 5, passages: 1 }, exaCode: { tokensNum: 2000 } },
      contents: { defaultMaxAgeHours: 48, concurrency: 6, scrapeTimeoutMs: 30_000 },
      cache: { dir: "/tmp/alt-cache", rawResponseTtlMs: 1000, contentCacheTtlMs: 2000 },
    });

    expect(config.googleCloudApiKeyEnv).toBe("GOOGLE_ALT");
    expect(config.parallelApiKeyEnv).toBe("PARALLEL_ALT");
    expect(config.exaApiKeyEnv).toBe("EXA_ALT");
    expect(config.firecrawlApiKeyEnv).toBe("FIRECRAWL_ALT");
    expect(config.model).toBe("gemini-3.5-pro");
    expect(config.webSearch.defaultDepth).toBe("deep");
    expect(config.webSearch.parallel.standardMode).toBe("advanced");
    expect(config.webSearch.exa.standard.numResults).toBe(3);
    expect(config.webSearch.exa.deep.maxHighlightCharacters).toBe(8000);
    expect(config.codeSearch.exaCode.tokensNum).toBe(2000);
    expect(config.contents.defaultMaxAgeHours).toBe(48);
    expect(config.contents.concurrency).toBe(6);
    expect(config.cacheDir).toBe("/tmp/alt-cache");
    expect(config.rawResponseTtlMs).toBe(1000);
    expect(config.contentCacheTtlMs).toBe(2000);
  });
});

describe("legacy config compatibility", () => {
  it("keeps loading legacy google, exa, and geminiExaGrounding settings", () => {
    const config = configFromRaw({
      google: { cloudApiKeyEnv: "LEGACY_GOOGLE" },
      exa: { apiKeyEnv: "LEGACY_EXA" },
      geminiExaGrounding: {
        model: "gemini-3.5-flash-legacy",
        cacheDir: "/tmp/legacy-cache",
        rawResponseTtlMs: 1111,
        contentCacheTtlMs: 2222,
        numResults: 7,
        maxHighlightCharacters: 1500,
      },
    });

    expect(config.googleCloudApiKeyEnv).toBe("LEGACY_GOOGLE");
    expect(config.exaApiKeyEnv).toBe("LEGACY_EXA");
    expect(config.model).toBe("gemini-3.5-flash-legacy");
    expect(config.cacheDir).toBe("/tmp/legacy-cache");
    expect(config.rawResponseTtlMs).toBe(1111);
    expect(config.contentCacheTtlMs).toBe(2222);
    // The legacy single Exa budget covered every grounding request, so it
    // continues to load for both depth budgets.
    expect(config.webSearch.exa.standard).toEqual({ type: "fast", numResults: 7, maxHighlightCharacters: 1500 });
    expect(config.webSearch.exa.deep).toEqual({ type: "fast", numResults: 7, maxHighlightCharacters: 1500 });
  });

  it("prefers the new exaGrounding section over the legacy budget", () => {
    const config = configFromRaw({
      geminiExaGrounding: { numResults: 7, maxHighlightCharacters: 1500 },
      webSearch: {
        exaGrounding: {
          standard: { type: "fast", numResults: 4, maxHighlightCharacters: 1200 },
          deep: { type: "fast", numResults: 12, maxHighlightCharacters: 5000 },
        },
      },
    });

    expect(config.webSearch.exa.standard.numResults).toBe(4);
    expect(config.webSearch.exa.deep.numResults).toBe(12);
  });

  it("ignores the legacy searchType value", () => {
    const config = configFromRaw({ geminiExaGrounding: { searchType: "auto" } });
    expect(config.webSearch.exa.standard.type).toBe("fast");
    expect(config.webSearch.exa.deep.type).toBe("fast");
  });

  it("falls back to defaults for invalid enum and range values", () => {
    const config = configFromRaw({
      webSearch: { defaultDepth: "extreme", parallel: { standardMode: "turbo" } },
      contents: { defaultMaxAgeHours: 999, concurrency: -1 },
    });

    expect(config.webSearch.defaultDepth).toBe("standard");
    expect(config.webSearch.parallel.standardMode).toBe("basic");
    expect(config.contents.defaultMaxAgeHours).toBe(24);
    expect(config.contents.concurrency).toBe(3);
  });

  it("honors configured concurrency only for integers 1 through 10", () => {
    expect(configFromRaw({ contents: { concurrency: 1 } }).contents.concurrency).toBe(1);
    expect(configFromRaw({ contents: { concurrency: 5 } }).contents.concurrency).toBe(5);
    expect(configFromRaw({ contents: { concurrency: 10 } }).contents.concurrency).toBe(10);
    // Values outside the 1..10 integer range fall back to the default 3,
    // matching the project's silent-fallback config pattern.
    expect(configFromRaw({ contents: { concurrency: 11 } }).contents.concurrency).toBe(3);
    expect(configFromRaw({ contents: { concurrency: 0 } }).contents.concurrency).toBe(3);
    expect(configFromRaw({ contents: { concurrency: -1 } }).contents.concurrency).toBe(3);
    expect(configFromRaw({ contents: { concurrency: 2.5 } }).contents.concurrency).toBe(3);
    expect(configFromRaw({ contents: { concurrency: "3" } }).contents.concurrency).toBe(3);
    expect(configFromRaw({ contents: { concurrency: null } }).contents.concurrency).toBe(3);
    expect(configFromRaw({}).contents.concurrency).toBe(3);
  });
});
