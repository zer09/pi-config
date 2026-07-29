import "./pi-tui-mock.js";
import { describe, expect, it } from "bun:test";
import type { ToolResult } from "../src/types.js";

// Imported dynamically so the pi-tui stub is registered before render.ts loads.
const { createWebSearchResultRenderer } = await import("../src/render.js");

const theme = { bold: (text: string) => text, fg: (_name: string, text: string) => text };
const renderer = createWebSearchResultRenderer("web_search");

function detailsLine(details: Record<string, unknown>, expanded = false): string {
  const result: ToolResult = { content: [{ type: "text", text: "Answer text." }], details };
  const lines = renderer(result, { expanded, isPartial: false }, theme, {}).render(400) as string[];
  const line = lines.find((entry) => entry.startsWith("Details: "));
  if (!line) throw new Error(`no details line rendered in: ${JSON.stringify(lines)}`);
  return line.slice("Details: ".length);
}

describe("web_search result details rendering", () => {
  it("describes a clean primary answer", () => {
    expect(
      detailsLine({
        responseId: "wse_abc",
        answerProvider: "gemini-exa-grounding",
        primaryAttemptCount: 1,
        primaryFinalStatus: 200,
        primaryFirstFailureCode: null,
        primaryFinalFailureCode: null,
        fallbackUsed: false,
        sourceCount: 14,
        supportCount: 14,
      }),
    ).toBe("provider=gemini-exa-grounding attempts=1 sources=14 supports=14 responseId=wse_abc");
  });

  it("shows the recovered first failure after a successful retry", () => {
    expect(
      detailsLine({
        responseId: "wse_abc",
        answerProvider: "gemini-exa-grounding",
        primaryAttemptCount: 2,
        primaryFinalStatus: 200,
        primaryFirstFailureCode: "EXA_EMPTY_QUERY",
        primaryFinalFailureCode: null,
        fallbackUsed: false,
        sourceCount: 14,
        supportCount: 14,
      }),
    ).toBe(
      "provider=gemini-exa-grounding attempts=2 firstError=EXA_EMPTY_QUERY sources=14 supports=14 responseId=wse_abc",
    );
  });

  it("describes an exa_search fallback answer without Gemini counts", () => {
    expect(
      detailsLine({
        responseId: "wse_abc",
        answerProvider: "exa_search",
        primaryAttemptCount: 2,
        primaryFinalStatus: 400,
        primaryFirstFailureCode: "EXA_EMPTY_QUERY",
        primaryFinalFailureCode: "EXA_EMPTY_QUERY",
        fallbackUsed: true,
        fallbackProvider: "exa_search",
        fallbackResultCount: 5,
        sourceCount: null,
        supportCount: null,
      }),
    ).toBe("provider=exa_search attempts=2 results=5 primaryError=EXA_EMPTY_QUERY responseId=wse_abc");
  });

  it("describes a code_search fallback answer with its result count", () => {
    expect(
      detailsLine({
        responseId: "wse_abc",
        answerProvider: "code_search",
        primaryAttemptCount: 1,
        primaryFinalStatus: 400,
        primaryFirstFailureCode: null,
        primaryFinalFailureCode: null,
        fallbackUsed: true,
        fallbackProvider: "code_search",
        fallbackResultCount: 10,
        sourceCount: null,
        supportCount: null,
      }),
    ).toBe("provider=code_search attempts=1 results=10 primaryError=HTTP_400 responseId=wse_abc");
  });

  it("omits the result count when the fallback did not report one", () => {
    expect(
      detailsLine({
        responseId: "wse_abc",
        answerProvider: "exa_search",
        primaryAttemptCount: 1,
        primaryFinalStatus: 400,
        fallbackUsed: true,
        fallbackProvider: "exa_search",
        fallbackResultCount: null,
        sourceCount: null,
        supportCount: null,
      }),
    ).toBe("provider=exa_search attempts=1 primaryError=HTTP_400 responseId=wse_abc");
  });

  it("reports a non-STOP finish reason instead of an HTTP 200 error label", () => {
    const summary = detailsLine({
      responseId: "wse_abc",
      answerProvider: "exa_search",
      primaryAttemptCount: 1,
      primaryFinalStatus: 200,
      primaryFinishReason: "MAX_TOKENS",
      primaryFirstFailureCode: null,
      primaryFinalFailureCode: null,
      fallbackUsed: true,
      fallbackProvider: "exa_search",
      fallbackResultCount: 5,
      sourceCount: null,
      supportCount: null,
    });

    expect(summary).toBe("provider=exa_search attempts=1 results=5 finishReason=MAX_TOKENS responseId=wse_abc");
    expect(summary).not.toContain("HTTP_200");
  });

  it("omits the finish reason for a clean STOP primary that still needed fallback", () => {
    const summary = detailsLine({
      responseId: "wse_abc",
      answerProvider: "exa_search",
      primaryAttemptCount: 1,
      primaryFinalStatus: 200,
      primaryFinishReason: "STOP",
      fallbackUsed: true,
      fallbackProvider: "exa_search",
      fallbackResultCount: 5,
    });

    expect(summary).toBe("provider=exa_search attempts=1 results=5 responseId=wse_abc");
    expect(summary).not.toContain("HTTP_200");
  });

  it("does not fabricate zeros for minimal details", () => {
    expect(detailsLine({ responseId: "wse_abc" })).toBe(
      "provider=gemini-exa-grounding attempts=1 responseId=wse_abc",
    );
  });

  it("keeps the same provider summary when expanded", () => {
    const details = {
      responseId: "wse_abc",
      answerProvider: "code_search",
      primaryAttemptCount: 1,
      primaryFinalStatus: 400,
      fallbackUsed: true,
      fallbackProvider: "code_search",
      fallbackResultCount: 10,
    };
    expect(detailsLine(details, true)).toBe(detailsLine(details, false));
  });

  it("strips terminal control sequences from diagnostic values", () => {
    const escape = String.fromCharCode(27);
    expect(
      detailsLine({
        responseId: `wse_${escape}[31mabc`,
        answerProvider: "exa_search",
        primaryAttemptCount: 1,
        fallbackUsed: true,
        fallbackProvider: "exa_search",
      }),
    ).toBe("provider=exa_search attempts=1 responseId=wse_abc");
  });
});
