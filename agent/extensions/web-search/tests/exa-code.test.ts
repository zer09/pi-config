import { afterEach, describe, expect, it } from "bun:test";
import { callExaCodeSearch, isUsableExaCodeSearch, parseExaCodeResponse } from "../src/exa-code.js";
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

function callClient(signal?: AbortSignal) {
  return callExaCodeSearch({
    query: "Zod request body validation example",
    exaApiKey: "exa-key",
    tokensNum: "dynamic",
    signal,
  });
}

describe("Exa Code parsing", () => {
  it("prefers response over text and parses numeric metadata", () => {
    const parsed = parseExaCodeResponse({
      response: "From response",
      text: "From text",
      resultsCount: 15,
      requestId: "req-1",
      costDollars: { total: 0.01 },
      searchTime: 1.25,
      outputTokens: 1247,
    });

    expect(parsed.response).toBe("From response");
    expect(parsed.resultsCount).toBe(15);
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.costDollars).toEqual({ total: 0.01 });
    expect(parsed.searchTime).toBe(1.25);
    expect(parsed.outputTokens).toBe(1247);
  });

  it("falls back to text and leaves non-numeric resultsCount undefined", () => {
    expect(parseExaCodeResponse({ text: "From text" }).response).toBe("From text");
    expect(parseExaCodeResponse({}).response).toBe("");
    expect(parseExaCodeResponse({ response: "a", resultsCount: "10" }).resultsCount).toBeUndefined();
  });

  it("sends the documented Context request shape", async () => {
    const calls = install([jsonResponse({ response: "Context answer", resultsCount: 10 })]);
    const attempt = await callClient();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.exa.ai/context");
    expect(calls[0]!.headers["x-api-key"]).toBe("exa-key");
    expect(calls[0]!.body).toEqual({ query: "Zod request body validation example", tokensNum: "dynamic" });
    expect(attempt.provider).toBe("exa-code");
    expect(attempt.normalized?.response).toBe("Context answer");
    expect(attempt.normalized?.resultsCount).toBe(10);
  });

  it("treats only 2xx responses with non-empty text as usable", () => {
    const base = { requestStartedAt: "", elapsedMs: 0 };

    const usable = {
      ...base,
      provider: "exa-code" as const,
      rawResponse: { status: 200, statusText: "", headers: {}, bodyText: "" },
      normalized: parseExaCodeResponse({ response: "ok" }),
    };
    expect(isUsableExaCodeSearch(usable)).toBe(true);

    const empty = { ...usable, normalized: parseExaCodeResponse({ response: "  " }) };
    expect(isUsableExaCodeSearch(empty)).toBe(false);

    const failing = { ...usable, rawResponse: { status: 500, statusText: "", headers: {}, bodyText: "" } };
    expect(isUsableExaCodeSearch(failing)).toBe(false);
  });

  it("treats an explicit resultsCount of 0 as unusable even with non-empty text", () => {
    const base = { requestStartedAt: "", elapsedMs: 0 };
    const attempt = {
      ...base,
      provider: "exa-code" as const,
      rawResponse: { status: 200, statusText: "", headers: {}, bodyText: "" },
      normalized: parseExaCodeResponse({ response: "some non-empty context", resultsCount: 0 }),
    };

    expect(isUsableExaCodeSearch(attempt)).toBe(false);

    // Missing and non-numeric resultsCount stay compatible with non-empty text.
    expect(isUsableExaCodeSearch({ ...attempt, normalized: parseExaCodeResponse({ response: "ok" }) })).toBe(true);
    expect(
      isUsableExaCodeSearch({ ...attempt, normalized: parseExaCodeResponse({ response: "ok", resultsCount: "0" }) }),
    ).toBe(true);
  });
});
