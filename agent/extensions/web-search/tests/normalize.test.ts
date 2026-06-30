import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractBenchmarkResponseJson, normalizeGeminiExaResponse } from "../src/normalize.js";
import { formatCleanGeminiSuccess } from "../src/format.js";
import type { NormalizedGeminiExaResponse } from "../src/types.js";

const CODE_FIXTURE = new URL("./fixtures/gemini-exa-code-sample-response.json", import.meta.url);
const GLOBAL_ENDPOINT_FIXTURE = new URL("./fixtures/gemini-exa-code-sample-global-endpoint-response.json", import.meta.url);
const NONCODE_FIXTURE = new URL("./fixtures/gemini-exa-grounding-response.json", import.meta.url);

async function loadFixture(path: URL): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("Gemini+Exa response normalizer", () => {
  it("parses the coding benchmark answer, sources, supports, and queries", async () => {
    const fixture = await loadFixture(CODE_FIXTURE);
    const normalized = normalizeGeminiExaResponse(extractBenchmarkResponseJson(fixture));

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
    const normalized = normalizeGeminiExaResponse(extractBenchmarkResponseJson(fixture));

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
    const normalized = normalizeGeminiExaResponse(extractBenchmarkResponseJson(fixture));
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
    const normalized = normalizeGeminiExaResponse(extractBenchmarkResponseJson(fixture));
    const output = formatCleanGeminiSuccess(normalized, "wse_test");

    expect(output).toContain("process.env.GOOGLE_CLOUD_API_KEY` [2, 3].");
    expect(output).toContain("contents.highlights.maxCharacters: 2000` [0].");
    expect(output).toContain("maximum character length for highlights from the search results [0].");
    expect(output).toContain("### Sources:");
    expect(output).not.toContain("\n [0] [0] [2, 3]");
  });

  it("keeps a Sources section when no sources are returned", () => {
    const normalized: NormalizedGeminiExaResponse = {
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
    const normalized: NormalizedGeminiExaResponse = {
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
