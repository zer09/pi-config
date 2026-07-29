import { afterEach, describe, expect, it } from "bun:test";
import { callCodeSearchFallback } from "../src/exa-search.js";

const originalFetch = globalThis.fetch;

function mockContextResponse(body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

function callFallback() {
  return callCodeSearchFallback({
    query: "Zod request body validation example",
    exaApiKey: "exa-key",
    reason: "primary failed",
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("code_search fallback parsing", () => {
  it("copies a numeric resultsCount into the fallback attempt", async () => {
    mockContextResponse({ response: "Context answer", resultsCount: 10 });
    const fallback = await callFallback();

    expect(fallback.resultCount).toBe(10);
    expect(fallback.answer).toBe("Context answer");
  });

  it("leaves resultCount undefined when resultsCount is missing or non-numeric", async () => {
    mockContextResponse({ response: "Context answer" });
    expect((await callFallback()).resultCount).toBeUndefined();

    mockContextResponse({ response: "Context answer", resultsCount: "10" });
    expect((await callFallback()).resultCount).toBeUndefined();
  });

  it("keeps preferring response over text for the answer", async () => {
    mockContextResponse({ response: "From response", text: "From text" });
    expect((await callFallback()).answer).toBe("From response");

    mockContextResponse({ text: "From text" });
    expect((await callFallback()).answer).toBe("From text");

    mockContextResponse({});
    expect((await callFallback()).answer).toBe("Exa Context API returned no response text.");
  });
});
