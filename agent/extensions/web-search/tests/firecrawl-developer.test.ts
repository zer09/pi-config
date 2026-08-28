import { afterEach, describe, expect, it } from "bun:test";
import {
  callFirecrawlDeveloperSearch,
  isUsableFirecrawlDeveloperSearch,
  parseFirecrawlDeveloperResponse,
} from "../src/firecrawl-developer.js";
import { formatCodeSearchResult } from "../src/format.js";
import { jsonResponse, mockFetch } from "./helpers.js";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

function install(handler: Parameters<typeof mockFetch>[0]) {
  const mock = mockFetch(handler);
  restore = mock.restore;
  return mock.calls;
}

const fullResponse = {
  success: true,
  results: [
    {
      id: "issue:owner/repo#123",
      type: "issue",
      url: "https://github.com/owner/repo/issues/123",
      title: "Optional title",
      passages: [{ text: "Matched Markdown passage." }, { text: "  " }, { text: "Second passage." }],
    },
    {
      id: "readme:owner/repo",
      type: "readme",
      url: "https://github.com/owner/repo#readme",
      passages: [],
    },
  ],
  coverage: { doc: "ok", issue: "ok", pull_request: "ok", readme: "ok" },
  reranked: true,
};

describe("Firecrawl Developer Index parsing", () => {
  it("normalizes result fields, passages, coverage, and reranking", () => {
    const normalized = parseFirecrawlDeveloperResponse(fullResponse);

    expect(normalized.success).toBe(true);
    expect(normalized.resultCount).toBe(2);
    expect(normalized.coverage).toEqual(fullResponse.coverage);
    expect(normalized.reranked).toBe(true);
    expect(normalized.artifacts[0]).toEqual({
      id: "issue:owner/repo#123",
      type: "issue",
      url: "https://github.com/owner/repo/issues/123",
      title: "Optional title",
      passages: ["Matched Markdown passage.", "Second passage."],
    });
  });

  it("tolerates absent titles and drops unusable passages", () => {
    const normalized = parseFirecrawlDeveloperResponse(fullResponse);

    expect(normalized.artifacts[1]).toEqual({
      id: "readme:owner/repo",
      type: "readme",
      url: "https://github.com/owner/repo#readme",
      title: undefined,
      passages: [],
    });
  });

  it("drops artifacts without a usable URL and recomputes resultCount", () => {
    const normalized = parseFirecrawlDeveloperResponse({
      success: true,
      results: [
        fullResponse.results[0],
        { id: "title-only", type: "issue", title: "No URL artifact", passages: [] },
        { id: "passages-only", type: "doc", passages: [{ text: "Passage without a URL." }] },
        { id: "blank-url", type: "doc", url: "   ", passages: [{ text: "Blank URL artifact." }] },
      ],
    });

    expect(normalized.artifacts).toHaveLength(1);
    expect(normalized.artifacts[0].id).toBe("issue:owner/repo#123");
    expect(normalized.resultCount).toBe(1);
  });

  it("reports zero usable results when every artifact lacks a URL", () => {
    const normalized = parseFirecrawlDeveloperResponse({
      success: true,
      results: [{ id: "title-only", type: "issue", title: "No URL artifact", passages: [{ text: "Orphan passage." }] }],
    });

    expect(normalized.resultCount).toBe(0);
    expect(isUsableFirecrawlDeveloperSearch({
      provider: "firecrawl-developer",
      requestStartedAt: "",
      elapsedMs: 0,
      rawResponse: { status: 200, statusText: "", headers: {}, bodyText: "" },
      normalized,
    })).toBe(false);
  });

  it("treats success !== true and zero usable results as unusable", () => {
    const failing = parseFirecrawlDeveloperResponse({ success: false, results: fullResponse.results });
    expect(failing.success).toBe(false);
    expect(isUsableFirecrawlDeveloperSearch({
      provider: "firecrawl-developer",
      requestStartedAt: "",
      elapsedMs: 0,
      rawResponse: { status: 200, statusText: "", headers: {}, bodyText: "" },
      normalized: failing,
    })).toBe(false);

    const empty = parseFirecrawlDeveloperResponse({ success: true, results: [] });
    expect(empty.resultCount).toBe(0);
    expect(isUsableFirecrawlDeveloperSearch({
      provider: "firecrawl-developer",
      requestStartedAt: "",
      elapsedMs: 0,
      rawResponse: { status: 200, statusText: "", headers: {}, bodyText: "" },
      normalized: empty,
    })).toBe(false);
  });

  it("sends the documented request shape and optional bearer auth", async () => {
    const calls = install([jsonResponse(fullResponse)]);
    const attempt = await callFirecrawlDeveloperSearch({
      query: "how do I configure retries",
      k: 10,
      passages: 2,
      firecrawlApiKey: "firecrawl-key",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.firecrawl.dev/v2/search/developer");
    expect(calls[0]!.headers.Authorization).toBe("Bearer firecrawl-key");
    expect(calls[0]!.body).toEqual({ query: "how do I configure retries", k: 10, passages: 2 });
    expect("types" in calls[0]!.body).toBe(false);
    expect(attempt.provider).toBe("firecrawl-developer");
    expect(attempt.normalized?.resultCount).toBe(2);
  });

  it("omits the Authorization header when no key is configured", async () => {
    const calls = install([jsonResponse(fullResponse)]);
    await callFirecrawlDeveloperSearch({ query: "q", k: 10, passages: 2 });

    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect("Authorization" in calls[0]!.headers).toBe(false);
  });

  it("includes the types filter only when requested", async () => {
    const calls = install([jsonResponse(fullResponse)]);
    await callFirecrawlDeveloperSearch({ query: "q", k: 10, passages: 2, types: ["doc", "readme"] });

    expect(calls[0]!.body.types).toEqual(["doc", "readme"]);
  });
});

describe("Firecrawl Developer output formatting", () => {
  it("renders ranked artifacts with type, title or URL fallback, URL, and passages", () => {
    const normalized = parseFirecrawlDeveloperResponse(fullResponse);
    const output = formatCodeSearchResult("how do I configure retries", normalized);

    expect(output).toContain("Developer sources for: how do I configure retries");
    expect(output).toContain("1. [issue] Optional title");
    expect(output).toContain("   URL: https://github.com/owner/repo/issues/123");
    expect(output).toContain("   - Matched Markdown passage.");
    expect(output).toContain("2. [readme] https://github.com/owner/repo#readme");
  });

  it("never renders URL-less artifacts in model-visible output", () => {
    const normalized = parseFirecrawlDeveloperResponse({
      success: true,
      results: [
        fullResponse.results[0],
        { id: "title-only", type: "issue", title: "No URL artifact", passages: [{ text: "Orphan passage text." }] },
      ],
    });
    const output = formatCodeSearchResult("how do I configure retries", normalized);

    expect(output).toContain("URL: https://github.com/owner/repo/issues/123");
    expect(output).not.toContain("No URL artifact");
    expect(output).not.toContain("Orphan passage text.");
  });
});
