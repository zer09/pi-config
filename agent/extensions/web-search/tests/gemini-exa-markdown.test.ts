import { describe, expect, it } from "bun:test";
import { formatGeminiExaMarkdown } from "../src/gemini-exa-markdown.js";
import type { NormalizedGeminiExaResponse } from "../src/types.js";

function normalizedResponse(overrides: Partial<NormalizedGeminiExaResponse>): NormalizedGeminiExaResponse {
  return {
    answer: "",
    cleanSuccess: true,
    finishReason: "STOP",
    sources: [],
    supports: [],
    webSearchQueries: [],
    ...overrides,
  };
}

describe("Gemini+Exa Markdown renderer edge cases", () => {
  it("coalesces duplicate same-position citations into one sorted marker", () => {
    const answer = "Shared claim.";
    const output = formatGeminiExaMarkdown(
      normalizedResponse({
        answer,
        supports: [
          { text: "Shared claim.", endIndex: answer.length, groundingChunkIndices: [1] },
          { text: "Shared claim.", endIndex: answer.length, groundingChunkIndices: [0, 1] },
        ],
      }),
    );

    expect(output).toBe("Shared claim [0, 1].\n\n### Sources:\n\nNo sources returned.\n");
  });

  it("does not add leading whitespace for a citation inserted at index zero", () => {
    const output = formatGeminiExaMarkdown(
      normalizedResponse({
        answer: "Bounds.",
        supports: [{ text: "", endIndex: 0, groundingChunkIndices: [0] }],
      }),
    );

    expect(output).toBe("[0]Bounds.\n\n### Sources:\n\nNo sources returned.\n");
  });
});
