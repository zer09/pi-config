import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractBenchmarkResponseJson, normalizeGeminiGroundingResponse } from "../src/grounding-normalize.js";
import { formatCleanGeminiSuccess } from "../src/format.js";
import { isUsableGroundingAttempt } from "../src/grounding-failure.js";
import type { NormalizedGeminiGroundingResponse } from "../src/types.js";

const CODE_FIXTURE = new URL("./fixtures/gemini-exa-code-sample-response.json", import.meta.url);
const GLOBAL_ENDPOINT_FIXTURE = new URL("./fixtures/gemini-exa-code-sample-global-endpoint-response.json", import.meta.url);
const NONCODE_FIXTURE = new URL("./fixtures/gemini-exa-grounding-response.json", import.meta.url);

async function loadFixture(path: URL): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizeSegments(parts: unknown[], segments: Record<string, unknown>[]): NormalizedGeminiGroundingResponse {
  return normalizeGeminiGroundingResponse({
    candidates: [{
      finishReason: "STOP",
      content: { parts },
      groundingMetadata: {
        groundingChunks: [{ web: { title: "Docs", uri: "https://example.com/docs" } }],
        groundingSupports: segments.map((segment) => ({ segment, groundingChunkIndices: [0] })),
      },
    }],
  });
}

describe("Gemini grounding response normalizer", () => {
  it("normalizes equivalent Parallel and Exa grounding metadata identically", () => {
    // Gemini returns the same generateContent shape for both partners; only
    // the request tool payload differs.
    const groundingMetadata = {
      webSearchQueries: ["parallel vs exa grounding"],
      groundingChunks: [{ web: { title: "Docs", uri: "https://example.com/docs", domain: "example.com" } }],
      groundingSupports: [{ segment: { text: "Same shape.", endIndex: 10 }, groundingChunkIndices: [0] }],
    };
    const bodyFor = (tool: unknown) => ({
      responseId: "google-response-1",
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Same shape." }] }, groundingMetadata }],
      tools: [tool],
    });

    const parallel = normalizeGeminiGroundingResponse(bodyFor({ parallelAiSearch: { customConfigs: { mode: "basic" } } }));
    const exa = normalizeGeminiGroundingResponse(bodyFor({ exaAiSearch: { api_key: "k", customConfigs: { type: "fast" } } }));

    expect(parallel).toEqual(exa);
    expect(parallel.cleanSuccess).toBe(true);
    expect(parallel.sources).toEqual([
      { groundingId: 0, title: "Docs", url: "https://example.com/docs", domain: "example.com" },
    ]);
    expect(parallel.supports[0].groundingChunkIndices).toEqual([0]);
  });
  it("parses the coding benchmark answer, sources, supports, and queries", async () => {
    const fixture = await loadFixture(CODE_FIXTURE);
    const normalized = normalizeGeminiGroundingResponse(extractBenchmarkResponseJson(fixture));

    expect(normalized.cleanSuccess).toBe(true);
    expect(normalized.finishReason).toBe("STOP");
    expect(normalized.googleResponseId).toBe("1HRDao3vDaOW4vEP5YfJkAE");
    expect(normalized.answer).toContain("callGeminiWithExaGrounding");
    expect(normalized.answer).toContain("```typescript");
    expect(normalized.answer).toContain("gcloud auth login");
    expect(normalized.sources).toHaveLength(5);
    expect(normalized.sources[0]).toEqual({
      groundingId: 0,
      title: "Grounding with Exa web search  |  Gemini Enterprise Agent Platform  |  Google Cloud Documentation",
      url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-exa",
      domain: "google.com",
    });
    expect(normalized.supports).toHaveLength(3);
    expect(normalized.supports[0].groundingChunkIndices).toEqual([0, 1]);
    expect(normalized.webSearchQueries).toEqual([
      "Gemini API generateContent exaAiSearch tool",
      "Google Cloud Vertex AI Gemini Exa integration",
      "Gemini API raw fetch Node.js TypeScript generateContent",
      "Exa AI Search API key",
      "gcloud auth print-access-token Node.js",
      "Vertex AI Gemini API generateContent request body tools",
    ]);
  });

  it("parses the non-code benchmark with the same response shape", async () => {
    const fixture = await loadFixture(NONCODE_FIXTURE);
    const normalized = normalizeGeminiGroundingResponse(extractBenchmarkResponseJson(fixture));

    expect(normalized.cleanSuccess).toBe(true);
    expect(normalized.finishReason).toBe("STOP");
    expect(normalized.googleResponseId).toBe("XG5DarSTBpGwk7QPvcvvgQY");
    expect(normalized.answer).toContain("The integration of Google Gemini and Exa");
    expect(normalized.sources).toHaveLength(5);
    expect(normalized.supports).toHaveLength(12);
    expect(normalized.webSearchQueries).toContain("Gemini Exa integration official documentation");
  });

  it("formats clean output with inline citations and a Sources section", async () => {
    const fixture = await loadFixture(NONCODE_FIXTURE);
    const normalized = normalizeGeminiGroundingResponse(extractBenchmarkResponseJson(fixture));
    const output = formatCleanGeminiSuccess(normalized, "wse_test");

    expect(output).toContain("ensuring freshness and factual accuracy [0, 1, 2].");
    expect(output).toContain("\n\n- **Grounding LLM Responses:**");
    expect(output).toContain("### Sources:");
    expect(output).toContain("[1] Grounding with Exa web search | Gemini Enterprise Agent Platform | Google Cloud Documentation - https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-exa");
    expect(output).not.toContain("## Grounding Metadata");
    expect(output).not.toContain("fetch_grounding");
    expect(output).not.toContain("## Raw response ID");
    expect(output).not.toContain("wse_test");
    expect(output).not.toContain("## Fallback");
  });

  it("formats multipart answers with citations after later text parts", async () => {
    const fixture = await loadFixture(GLOBAL_ENDPOINT_FIXTURE);
    const normalized = normalizeGeminiGroundingResponse(extractBenchmarkResponseJson(fixture));
    const output = formatCleanGeminiSuccess(normalized, "wse_test");

    expect(output).toContain("process.env.GOOGLE_CLOUD_API_KEY` [2, 3].");
    expect(output).toContain("contents.highlights.maxCharacters: 2000` [0].");
    expect(output).toContain("maximum character length for highlights from the search results [0].");
    expect(output).toContain("### Sources:");
    expect(output).not.toContain("\n [0] [0] [2, 3]");
  });

  describe("UTF-8 citation positions", () => {
    const sourcesSection = "\n\n### Sources:\n\n[0] Docs - https://example.com/docs\n";
    const unpositioned = { text: "Café.", startIndex: undefined, endIndex: undefined, groundingChunkIndices: [0] };

    it.each([
      {
        name: "accented bytes with omitted partIndex and startIndex",
        parts: [{ text: "Café." }], segment: { text: "Café.", endIndex: 6 },
        indexes: [0, 5], output: "Café [0].",
      },
      {
        name: "accented bytes with explicit partIndex",
        parts: [{ text: "Café." }], segment: { text: "é.", partIndex: 0, startIndex: 3, endIndex: 6 },
        indexes: [3, 5], output: "Café [0].",
      },
      {
        name: "first-Part bytes in a multipart answer without partIndex",
        parts: [{ text: "Café." }, { text: " Tail." }], segment: { text: "Café.", endIndex: 6 },
        indexes: [0, 5], output: "Café [0]. Tail.",
      },
      {
        name: "emoji bytes without partIndex",
        parts: [{ text: "😀 Café." }], segment: { text: "Café.", startIndex: 5, endIndex: 11 },
        indexes: [3, 8], output: "😀 Café [0].",
      },
      {
        name: "later-Part local ASCII bytes",
        parts: [{ text: "First. " }, { text: "Second." }],
        segment: { text: "Second.", partIndex: 1, startIndex: 0, endIndex: 7 },
        indexes: [7, 14], output: "First. Second [0].",
      },
      {
        name: "legacy global ASCII bytes without partIndex",
        parts: [{ text: "First. " }, { text: "Second." }],
        segment: { text: "Second.", startIndex: 7, endIndex: 14 },
        indexes: [7, 14], output: "First. Second [0].",
      },
      {
        name: "non-ASCII and emoji before a later Part with omitted startIndex",
        parts: [{ text: "é😀 " }, { text: "Second." }], segment: { text: "Second.", partIndex: 1, endIndex: 7 },
        indexes: [4, 11], output: "é😀 Second [0].",
      },
      {
        name: "accented later-Part bytes after an emoji",
        parts: [{ text: "😀 " }, { text: "Café." }],
        segment: { text: "Café.", partIndex: 1, startIndex: 0, endIndex: 6 },
        indexes: [3, 8], output: "😀 Café [0].",
      },
      {
        name: "repeated claims without searching for segment text",
        parts: [{ text: "Café. Café." }], segment: { text: "Café.", startIndex: 7, endIndex: 13 },
        indexes: [6, 11], output: "Café. Café [0].",
      },
      {
        name: "repeated claims in a later Part",
        parts: [{ text: "Café. " }, { text: "Café." }], segment: { text: "Café.", partIndex: 1, endIndex: 6 },
        indexes: [6, 11], output: "Café. Café [0].",
      },
      {
        name: "original Part indices across non-text entries",
        parts: [{ functionCall: { name: "lookup" } }, { text: "é😀 " }, { inlineData: {} }, { text: "Café." }],
        segment: { text: "Café.", partIndex: 3, startIndex: 0, endIndex: 6 },
        indexes: [4, 9], output: "é😀 Café [0].",
      },
      {
        name: "zero endIndex without leading whitespace",
        parts: [{ text: "Bounds." }], segment: { text: "", endIndex: 0 },
        indexes: [0, 0], output: "[0]Bounds.",
      },
      {
        name: "an empty text Part",
        parts: [{ text: "" }, { text: "Bounds." }], segment: { text: "", partIndex: 0, endIndex: 0 },
        indexes: [0, 0], output: "[0]Bounds.",
      },
      {
        name: "a startIndex after a complete emoji",
        parts: [{ text: "😀." }], segment: { text: ".", partIndex: 0, startIndex: 4, endIndex: 5 },
        indexes: [2, 3], output: "😀 [0].",
      },
    ])("renders $name", ({ parts, segment, indexes, output }) => {
      const normalized = normalizeSegments(parts, [segment]);

      expect(normalized.supports).toEqual([{
        text: segment.text, startIndex: indexes[0], endIndex: indexes[1], groundingChunkIndices: [0],
      }]);
      expect(normalized.cleanSuccess).toBe(true);
      expect(formatCleanGeminiSuccess(normalized, "wse_test")).toBe(output + sourcesSection);
    });

    it.each([undefined, null, false, "0", {}, [], NaN, Infinity, -1, 0.5, 1, 2, 3].map((partIndex) => ({ partIndex })))(
      "does not fall back to global bytes for explicit partIndex $partIndex",
      ({ partIndex }) => {
        const normalized = normalizeSegments(
          [{ text: "Café." }, { functionCall: { name: "lookup" } }, { text: 42 }],
          [{ text: "Café.", partIndex, startIndex: 0, endIndex: 6 }],
        );

        expect(normalized.supports).toEqual([unpositioned]);
        expect(formatCleanGeminiSuccess(normalized, "wse_test")).toBe("Café." + sourcesSection);
      },
    );

    it.each([undefined, null, false, "0", NaN, Infinity, -1, 0.5, 4, 7])(
      "clears a valid endIndex when startIndex is invalid: %p",
      (startIndex) => {
        const normalized = normalizeSegments([{ text: "Café." }], [{ text: "Café.", startIndex, endIndex: 6 }]);

        expect(normalized.supports).toEqual([unpositioned]);
        expect(formatCleanGeminiSuccess(normalized, "wse_test")).toBe("Café." + sourcesSection);
      },
    );

    it.each([undefined, null, false, "6", NaN, Infinity, -1, 0.5, 4, 7])(
      "clears both positions when endIndex is invalid: %p",
      (endIndex) => {
        const normalized = normalizeSegments([{ text: "Café." }], [{ text: "Café.", startIndex: 0, endIndex }]);

        expect(normalized.supports).toEqual([unpositioned]);
        expect(formatCleanGeminiSuccess(normalized, "wse_test")).toBe("Café." + sourcesSection);
      },
    );

    it.each([1, 2, 3])("rejects start and end byte offsets inside an emoji: %i", (offset) => {
      const normalized = normalizeSegments([{ text: "😀." }], [
        { text: "😀.", startIndex: offset, endIndex: 5 },
        { text: "😀.", startIndex: 0, endIndex: offset },
      ]);

      expect(normalized.supports).toEqual([{ ...unpositioned, text: "😀." }, { ...unpositioned, text: "😀." }]);
      expect(formatCleanGeminiSuccess(normalized, "wse_test")).toBe("😀." + sourcesSection);
    });

    it.each([
      { name: "reversed offsets", segment: { startIndex: 5, endIndex: 3 } },
      { name: "an endIndex outside its Part but inside the answer", segment: { partIndex: 0, endIndex: 7 } },
      { name: "an invalid local startIndex with a valid endIndex", segment: { partIndex: 0, startIndex: 7, endIndex: 6 } },
      { name: "a missing endIndex", segment: {} },
    ])("keeps supports unpositioned for $name", ({ segment }) => {
      const normalized = normalizeSegments([{ text: "Café." }, { text: " Tail." }], [{ text: "Café.", ...segment }]);

      expect(normalized.supports).toEqual([unpositioned]);
      expect(formatCleanGeminiSuccess(normalized, "wse_test")).toBe("Café. Tail." + sourcesSection);
    });

    it("preserves support counts, sources, and provider usability when positions are invalid", () => {
      const normalized = normalizeSegments([{ text: "Café." }], [
        { text: "Café.", partIndex: null, endIndex: 6 },
        { text: "Café.", startIndex: 4, endIndex: 6 },
        { text: "Café.", endIndex: 4 },
        { text: "Café." },
      ]);

      expect(normalized.answer).toBe("Café.");
      expect(normalized.supports).toEqual(Array(4).fill(unpositioned));
      expect(normalized.sources).toHaveLength(1);
      expect(isUsableGroundingAttempt({
        provider: "gemini-exa-grounding", partner: "exa", model: "test-model",
        requestStartedAt: "2026-01-01T00:00:00.000Z", elapsedMs: 0,
        rawResponse: { status: 200, statusText: "OK", headers: {}, bodyText: "" },
        normalized,
      })).toBe(true);
      expect(formatCleanGeminiSuccess(normalized, "wse_test")).toBe("Café." + sourcesSection);
    });
  });

  it("keeps a Sources section when no sources are returned", () => {
    const normalized: NormalizedGeminiGroundingResponse = {
      answer: "Citation but no source.",
      cleanSuccess: true,
      finishReason: "STOP",
      sources: [],
      supports: [
        {
          text: "Citation but no source.",
          endIndex: "Citation but no source.".length,
          groundingChunkIndices: [0],
        },
      ],
      webSearchQueries: [],
    };

    expect(formatCleanGeminiSuccess(normalized, "wse_test")).toBe(
      "Citation but no source [0].\n\n### Sources:\n\nNo sources returned.\n",
    );
  });

  it("does not render a dangling dash for sources without URLs", () => {
    const normalized: NormalizedGeminiGroundingResponse = {
      answer: "Title-only source.",
      cleanSuccess: true,
      finishReason: "STOP",
      sources: [{ groundingId: 0, title: "Title Only" }],
      supports: [],
      webSearchQueries: [],
    };

    const output = formatCleanGeminiSuccess(normalized, "wse_test");

    expect(output).toContain("### Sources:\n\n[0] Title Only\n");
    expect(output).not.toContain("[0] Title Only - ");
  });
});
