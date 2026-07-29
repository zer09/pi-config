import { describe, expect, it } from "bun:test";
import { classifyPrimaryFailure } from "../src/primary-failure.js";
import { fallbackReasonFromPrimary } from "../src/routing.js";
import type { PrimaryAttempt, RawHttpResponse } from "../src/types.js";

const EXA_EMPTY_QUERY_MESSAGE =
  'Exa AI API returned bad request error. Please check your request. {"requestId":"3064f5dba843314f659e27fb0e032b87","error":"Invalid request body | Validation error: Too small: expected string to have >=1 characters at \\"query\\"","tag":"INVALID_REQUEST_BODY"}';

function googleErrorBody(message: string, status = "INVALID_ARGUMENT", code = 400): unknown {
  return { error: { code, message, status } };
}

/** Reproduces Google's wire encoding, which escapes `>` as a \u003e sequence. */
function googleErrorBodyText(message: string, status = "INVALID_ARGUMENT", code = 400): string {
  return `${JSON.stringify(googleErrorBody(message, status, code), null, 2).replace(/>/g, "\\u003e")}\n`;
}

function makePrimary(response: Partial<RawHttpResponse>): PrimaryAttempt {
  return {
    provider: "gemini-exa-grounding",
    model: "gemini-3.5-flash",
    requestStartedAt: "2026-07-30T00:00:00.000Z",
    elapsedMs: 12700,
    rawResponse: {
      status: 400,
      statusText: "Bad Request",
      headers: {},
      bodyText: "",
      ...response,
    },
  };
}

describe("primary failure classification", () => {
  it("classifies the nested Exa empty-query error from body JSON", () => {
    const primary = makePrimary({
      bodyText: googleErrorBodyText(EXA_EMPTY_QUERY_MESSAGE),
      bodyJson: googleErrorBody(EXA_EMPTY_QUERY_MESSAGE),
    });
    expect(classifyPrimaryFailure(primary)).toBe("EXA_EMPTY_QUERY");
  });

  it("classifies from body text when parsed JSON is unavailable", () => {
    const bodyText = googleErrorBodyText(EXA_EMPTY_QUERY_MESSAGE);
    expect(bodyText).toContain("\\u003e=1 characters");
    expect(classifyPrimaryFailure(makePrimary({ bodyText }))).toBe("EXA_EMPTY_QUERY");
  });

  it("tolerates whitespace and escaped-quote differences", () => {
    const message =
      'Exa AI API returned  bad request error.\n Please check your request. {"error":"Invalid request body | Validation error: Too small: expected string to have >= 1 characters at \\\\\\"query\\\\\\""}';
    expect(classifyPrimaryFailure(makePrimary({ bodyJson: googleErrorBody(message) }))).toBe("EXA_EMPTY_QUERY");
  });

  it("does not classify a different field whose name starts with query", () => {
    for (const field of ["queryType", "queryParams", "query_rewrites"]) {
      const message = `Exa AI API returned bad request error. Please check your request. {"error":"Invalid request body | Validation error: Too small: expected string to have >=1 characters at \\"${field}\\""}`;
      expect(classifyPrimaryFailure(makePrimary({ bodyJson: googleErrorBody(message) }))).toBeUndefined();
      expect(classifyPrimaryFailure(makePrimary({ bodyText: googleErrorBodyText(message) }))).toBeUndefined();
    }
  });

  it("classifies an unquoted query field location", () => {
    const message =
      "Exa AI API returned bad request error. Please check your request. Validation error: Too small: expected string to have >=1 characters at query";
    expect(classifyPrimaryFailure(makePrimary({ bodyJson: googleErrorBody(message) }))).toBe("EXA_EMPTY_QUERY");
  });

  it("does not classify an unrelated HTTP 400", () => {
    const message = "Invalid JSON payload received. Unknown name \"exaAiSearch\" at 'tools[0]'.";
    expect(classifyPrimaryFailure(makePrimary({ bodyJson: googleErrorBody(message) }))).toBeUndefined();
  });

  it("does not classify an HTTP 429 that mentions query", () => {
    const message = "Quota exceeded for query requests per minute.";
    const primary = makePrimary({
      status: 429,
      statusText: "Too Many Requests",
      bodyJson: googleErrorBody(message, "RESOURCE_EXHAUSTED", 429),
    });
    expect(classifyPrimaryFailure(primary)).toBeUndefined();
  });

  it("does not classify an Exa authentication or quota error", () => {
    const message =
      'Exa AI API returned bad request error. Please check your request. {"error":"Invalid API key","tag":"UNAUTHORIZED"}';
    expect(classifyPrimaryFailure(makePrimary({ bodyJson: googleErrorBody(message) }))).toBeUndefined();
  });

  it("reports the empty-query failure explicitly as the fallback reason", () => {
    const primary = makePrimary({ bodyJson: googleErrorBody(EXA_EMPTY_QUERY_MESSAGE) });
    expect(fallbackReasonFromPrimary(primary)).toBe(
      "Gemini native Exa grounding sent Exa an empty search query.",
    );
  });

  it("keeps generic status handling for other failures", () => {
    const primary = makePrimary({ status: 429, statusText: "Too Many Requests", bodyText: "{}" });
    expect(fallbackReasonFromPrimary(primary)).toBe(
      "Gemini+Exa returned HTTP 429; quota or rate limiting prevented a clean primary answer.",
    );
  });
});
