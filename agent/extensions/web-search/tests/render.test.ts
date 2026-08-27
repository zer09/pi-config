import "./pi-tui-mock.js";
import { describe, expect, it } from "bun:test";
import type { ToolResult } from "../src/types.js";

// Imported dynamically so the pi-tui stub is registered before render.ts loads.
const { createWebSearchCallRenderer, createWebSearchResultRenderer } = await import("../src/render.js");

const theme = { bold: (text: string) => text, fg: (_name: string, text: string) => text };

function renderCall(toolName: "web_search" | "web_code_search" | "fetch_contents", args: unknown): string {
  return (createWebSearchCallRenderer(toolName)(args, theme, {}) as { render: () => string[] }).render().join("\n");
}

function detailsLine(
  toolName: "web_search" | "web_code_search" | "fetch_contents",
  details: Record<string, unknown>,
  expanded = false,
): string {
  const renderer = createWebSearchResultRenderer(toolName);
  const result: ToolResult = { content: [{ type: "text", text: "Answer text." }], details };
  const lines = renderer(result, { expanded, isPartial: false }, theme, {}).render(400) as string[];
  const line = lines.find((entry) => entry.startsWith("Details: "));
  if (!line) throw new Error(`no details line rendered in: ${JSON.stringify(lines)}`);
  return line.slice("Details: ".length);
}

describe("call summary rendering", () => {
  it("renders the web_search query and depth", () => {
    const summary = renderCall("web_search", { query: "How does MJML work?", depth: "deep" });
    expect(summary).toContain("Web Search");
    expect(summary).toContain('query="How does MJML work?"');
    expect(summary).toContain("depth=deep");
  });

  it("omits the depth label when not requested", () => {
    expect(renderCall("web_search", { query: "q" })).not.toContain("depth=");
  });

  it("renders the web_code_search query and focus", () => {
    const summary = renderCall("web_code_search", { query: "Zod validation", focus: "developer_sources" });
    expect(summary).toContain("Web Code Search");
    expect(summary).toContain('query="Zod validation"');
    expect(summary).toContain("focus=developer_sources");
  });

  it("renders fetch_contents URL count, max characters, and freshness", () => {
    const summary = renderCall("fetch_contents", { uris: ["a", "b"], maxCharacters: 5000, maxAgeHours: 0 });
    expect(summary).toContain("Fetch Contents");
    expect(summary).toContain("urls=2");
    expect(summary).toContain("maxChars=5000");
    expect(summary).toContain("maxAgeHours=0");
  });

  it("omits absent optional fetch_contents labels", () => {
    const summary = renderCall("fetch_contents", { uris: ["a"] });
    expect(summary).toContain("urls=1");
    expect(summary).not.toContain("maxChars=");
    expect(summary).not.toContain("maxAgeHours=");
  });
});

describe("web_search result details rendering", () => {
  it("describes a clean Parallel answer", () => {
    expect(
      detailsLine("web_search", {
        responseId: "wse_abc",
        answerProvider: "gemini-parallel-grounding",
        attemptCount: 1,
        primaryStatus: 200,
        primaryFirstFailureCode: null,
        primaryFinalFailureCode: null,
        fallbackUsed: false,
        sourceCount: 14,
        supportCount: 14,
      }),
    ).toBe("provider=gemini-parallel-grounding attempts=1 sources=14 supports=14 responseId=wse_abc");
  });

  it("describes an Exa grounding fallback answer", () => {
    expect(
      detailsLine("web_search", {
        responseId: "wse_abc",
        answerProvider: "gemini-exa-grounding",
        attemptCount: 2,
        primaryStatus: 429,
        primaryFirstFailureCode: null,
        primaryFinalFailureCode: null,
        fallbackUsed: true,
        fallbackFrom: "parallel",
        sourceCount: 9,
        supportCount: 9,
      }),
    ).toBe("provider=gemini-exa-grounding attempts=2 fallbackFrom=parallel sources=9 supports=9 responseId=wse_abc");
  });

  it("does not fabricate zeros for minimal details", () => {
    expect(detailsLine("web_search", { responseId: "wse_abc" })).toBe(
      "provider=gemini-parallel-grounding attempts=1 responseId=wse_abc",
    );
  });

  it("keeps the same provider summary when expanded", () => {
    const details = {
      responseId: "wse_abc",
      answerProvider: "gemini-exa-grounding",
      attemptCount: 2,
      fallbackUsed: true,
      fallbackFrom: "parallel",
      sourceCount: 3,
    };
    expect(detailsLine("web_search", details, true)).toBe(detailsLine("web_search", details, false));
  });

  it("strips terminal control sequences from diagnostic values", () => {
    const escape = String.fromCharCode(27);
    expect(
      detailsLine("web_search", {
        responseId: `wse_${escape}[31mabc`,
        answerProvider: "gemini-parallel-grounding",
        attemptCount: 1,
      }),
    ).toBe("provider=gemini-parallel-grounding attempts=1 responseId=wse_abc");
  });
});

describe("web_code_search result details rendering", () => {
  it("describes a primary Firecrawl answer", () => {
    expect(
      detailsLine("web_code_search", {
        responseId: "wse_abc",
        focus: "developer_sources",
        answerProvider: "firecrawl-developer",
        attemptCount: 1,
        fallbackUsed: false,
        degraded: false,
        resultCount: 10,
      }),
    ).toBe("provider=firecrawl-developer focus=developer_sources attempts=1 results=10 responseId=wse_abc");
  });

  it("shows the degraded status for the Exa developer-source fallback", () => {
    expect(
      detailsLine("web_code_search", {
        responseId: "wse_abc",
        focus: "developer_sources",
        answerProvider: "exa-code",
        attemptCount: 2,
        fallbackUsed: true,
        fallbackFrom: "firecrawl-developer",
        degraded: true,
        resultCount: 15,
      }),
    ).toBe(
      "provider=exa-code focus=developer_sources attempts=2 fallbackFrom=firecrawl-developer degraded=true results=15 responseId=wse_abc",
    );
  });

  it("omits the result count when the provider did not report one", () => {
    expect(
      detailsLine("web_code_search", {
        responseId: "wse_abc",
        focus: "implementation_examples",
        answerProvider: "exa-code",
        attemptCount: 1,
      }),
    ).toBe("provider=exa-code focus=implementation_examples attempts=1 responseId=wse_abc");
  });
});

describe("fetch_contents result details rendering", () => {
  it("shows the URL count, cache hits, and character total", () => {
    expect(
      detailsLine("fetch_contents", {
        results: [
          { normalizedUrl: "https://a", fromCache: true, characterCount: 10 },
          { normalizedUrl: "https://b", fromCache: false, characterCount: 20 },
        ],
      }),
    ).toBe("2 URLs, cache hits 1/2, chars=30");
  });

  it("renders zero-state details without crashing", () => {
    expect(detailsLine("fetch_contents", {})).toBe("0 URLs, cache hits 0/0, chars=0");
  });
});
