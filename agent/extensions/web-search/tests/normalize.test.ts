import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { extractBenchmarkResponseJson, normalizeGeminiExaResponse } from "../src/normalize.js";
import { formatCleanGeminiSuccess } from "../src/format.js";

const CODE_FIXTURE = "/home/gc/.pi/gemini-exa-grounding-native-exa-raw-benchmark.json";
const NONCODE_FIXTURE = "/home/gc/.pi/gemini-exa-grounding-native-exa-noncode-raw-benchmark.json";

async function loadFixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("Gemini+Exa response normalizer", () => {
  it("parses the coding benchmark answer, sources, supports, and queries", async () => {
    const fixture = await loadFixture(CODE_FIXTURE);
    const normalized = normalizeGeminiExaResponse(extractBenchmarkResponseJson(fixture));

    expect(normalized.cleanSuccess).toBe(true);
    expect(normalized.finishReason).toBe("STOP");
    expect(normalized.googleResponseId).toBe("tA9Aaq-cHNvRir4PyrCEuQ8");
    expect(normalized.answer).toContain("validateBody");
    expect(normalized.answer).toContain("```typescript");
    expect(normalized.answer).toContain("\n\n### 1. Define your Zod Schema");
    expect(normalized.sources).toHaveLength(4);
    expect(normalized.sources[0]).toEqual({
      groundingId: 0,
      title: "Using Zod with Express | Full Stack TypeScript - Steve Kinney",
      url: "https://stevekinney.com/courses/full-stack-typescript/using-zod-with-express",
      domain: "stevekinney.com",
    });
    expect(normalized.supports).toHaveLength(6);
    expect(normalized.supports[0].groundingChunkIndices).toEqual([0]);
    expect(normalized.webSearchQueries).toEqual([
      "Zod Express request body validation typescript",
      "Zod Express middleware example typescript",
      "Zod TypeScript Express validation snippet",
    ]);
  });

  it("parses the non-code benchmark with the same response shape", async () => {
    const fixture = await loadFixture(NONCODE_FIXTURE);
    const normalized = normalizeGeminiExaResponse(extractBenchmarkResponseJson(fixture));

    expect(normalized.cleanSuccess).toBe(true);
    expect(normalized.finishReason).toBe("STOP");
    expect(normalized.googleResponseId).toBe("YBNAasygOLKK89kPwpLp8A4");
    expect(normalized.answer).toContain("NASA's Artemis II mission");
    expect(normalized.sources).toHaveLength(9);
    expect(normalized.supports).toHaveLength(5);
    expect(normalized.webSearchQueries).toContain("Artemis II crew members");
  });

  it("formats clean output with real answer newlines and no fallback/provider noise", async () => {
    const fixture = await loadFixture(NONCODE_FIXTURE);
    const normalized = normalizeGeminiExaResponse(extractBenchmarkResponseJson(fixture));
    const output = formatCleanGeminiSuccess(normalized, "wse_test");

    expect(output).toContain("Here are the latest major updates regarding NASA's Artemis II mission schedule and crew:\n\n*");
    expect(output).toContain("## Source Grounding Supports (claim annotations)");
    expect(output).toContain("Use the bracketed IDs");
    expect(output).toContain("fetch_grounding({ responseId: \"wse_test\", groundingIds: [ids...] })");
    expect(output).toMatch(/^- \[[0-9, ]+\] — "/m);
    expect(output).not.toMatch(/^\d+\. \[[0-9, ]+\] — "/m);
    expect(output).toContain("## Raw response ID\n\nwse_test");
    expect(output).not.toContain("## Fallback");
    expect(output).not.toContain("finishReason");
    expect(output).not.toContain("gemini-2.5-flash");
  });
});
