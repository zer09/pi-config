import { describe, expect, it } from "bun:test";
import {
  classifyPrimaryFailure,
  fallbackReasonFromGrounding,
  isGroundingFallbackAllowed,
  isUsableGroundingAttempt,
} from "../src/grounding-failure.js";
import { EXA_EMPTY_QUERY_MESSAGE } from "./helpers.js";
import type { GroundingAttempt, NormalizedGeminiGroundingResponse, RawHttpResponse } from "../src/types.js";

function googleErrorBody(message: string, status = "INVALID_ARGUMENT", code = 400): unknown {
  return { error: { code, message, status } };
}

/** Reproduces Google's wire encoding, which escapes `>` as a \u003e sequence. */
function googleErrorBodyText(message: string, status = "INVALID_ARGUMENT", code = 400): string {
  return `${JSON.stringify(googleErrorBody(message, status, code), null, 2).replace(/>/g, "\\u003e")}\n`;
}

function makeAttempt(partner: "parallel" | "exa", response: Partial<RawHttpResponse>, normalized?: NormalizedGeminiGroundingResponse): GroundingAttempt {
  return {
    provider: partner === "parallel" ? "gemini-parallel-grounding" : "gemini-exa-grounding",
    partner,
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
    normalized,
  };
}

function cleanNormalized(overrides: Partial<NormalizedGeminiGroundingResponse> = {}): NormalizedGeminiGroundingResponse {
  return {
    answer: "Grounded answer.",
    finishReason: "STOP",
    cleanSuccess: true,
    sources: [{ groundingId: 0, title: "Docs", url: "https://example.com/docs" }],
    supports: [],
    webSearchQueries: [],
    ...overrides,
  };
}

describe("grounding failure classification", () => {
  it("classifies the nested Exa empty-query error from body JSON", () => {
    const attempt = makeAttempt("exa", {
      bodyText: googleErrorBodyText(EXA_EMPTY_QUERY_MESSAGE),
      bodyJson: googleErrorBody(EXA_EMPTY_QUERY_MESSAGE),
    });
    expect(classifyPrimaryFailure(attempt)).toBe("EXA_EMPTY_QUERY");
  });

  it("classifies from body text when parsed JSON is unavailable", () => {
    const bodyText = googleErrorBodyText(EXA_EMPTY_QUERY_MESSAGE);
    expect(bodyText).toContain("\\u003e=1 characters");
    expect(classifyPrimaryFailure(makeAttempt("exa", { bodyText }))).toBe("EXA_EMPTY_QUERY");
  });

  it("tolerates whitespace and escaped-quote differences", () => {
    const message =
      'Exa AI API returned  bad request error.\n Please check your request. {"error":"Invalid request body | Validation error: Too small: expected string to have >= 1 characters at \\\\\\"query\\\\\\""}';
    expect(classifyPrimaryFailure(makeAttempt("exa", { bodyJson: googleErrorBody(message) }))).toBe("EXA_EMPTY_QUERY");
  });

  it("does not classify a different field whose name starts with query", () => {
    for (const field of ["queryType", "queryParams", "query_rewrites"]) {
      const message = `Exa AI API returned bad request error. Please check your request. {"error":"Invalid request body | Validation error: Too small: expected string to have >=1 characters at \\"${field}\\""}`;
      expect(classifyPrimaryFailure(makeAttempt("exa", { bodyJson: googleErrorBody(message) }))).toBeUndefined();
      expect(classifyPrimaryFailure(makeAttempt("exa", { bodyText: googleErrorBodyText(message) }))).toBeUndefined();
    }
  });

  it("classifies an unquoted query field location", () => {
    const message =
      "Exa AI API returned bad request error. Please check your request. Validation error: Too small: expected string to have >=1 characters at query";
    expect(classifyPrimaryFailure(makeAttempt("exa", { bodyJson: googleErrorBody(message) }))).toBe("EXA_EMPTY_QUERY");
  });

  it("does not classify an unrelated HTTP 400", () => {
    const message = "Invalid JSON payload received. Unknown name \"exaAiSearch\" at 'tools[0]'.";
    expect(classifyPrimaryFailure(makeAttempt("exa", { bodyJson: googleErrorBody(message) }))).toBeUndefined();
  });

  it("does not classify an HTTP 429 that mentions query", () => {
    const message = "Quota exceeded for query requests per minute.";
    const attempt = makeAttempt("exa", {
      status: 429,
      statusText: "Too Many Requests",
      bodyJson: googleErrorBody(message, "RESOURCE_EXHAUSTED", 429),
    });
    expect(classifyPrimaryFailure(attempt)).toBeUndefined();
  });

  it("does not classify an Exa authentication or quota error", () => {
    const message =
      'Exa AI API returned bad request error. Please check your request. {"error":"Invalid API key","tag":"UNAUTHORIZED"}';
    expect(classifyPrimaryFailure(makeAttempt("exa", { bodyJson: googleErrorBody(message) }))).toBeUndefined();
  });
});

describe("grounding usability and fallback eligibility", () => {
  it("accepts a 2xx clean STOP answer with sources", () => {
    const attempt = makeAttempt("parallel", { status: 200, bodyJson: {} }, cleanNormalized());
    expect(isUsableGroundingAttempt(attempt)).toBe(true);
  });

  it("rejects a non-empty answer with no usable source as grounded success", () => {
    const attempt = makeAttempt("parallel", { status: 200, bodyJson: {} }, cleanNormalized({ sources: [] }));
    expect(isUsableGroundingAttempt(attempt)).toBe(false);
  });

  it("rejects non-2xx, unparsed, empty-answer, and safety-blocked attempts", () => {
    expect(isUsableGroundingAttempt(makeAttempt("parallel", { status: 500, bodyJson: {} }, cleanNormalized()))).toBe(false);
    expect(isUsableGroundingAttempt(makeAttempt("parallel", { status: 200, bodyJson: undefined }))).toBe(false);
    expect(
      isUsableGroundingAttempt(makeAttempt("parallel", { status: 200, bodyJson: {} }, cleanNormalized({ answer: "", cleanSuccess: false }))),
    ).toBe(false);
    expect(
      isUsableGroundingAttempt(makeAttempt("parallel", { status: 200, bodyJson: {} }, cleanNormalized({ promptBlockReason: "SAFETY" }))),
    ).toBe(false);
  });

  it("prevents fallback after abort or a prompt safety block", () => {
    const blocked = makeAttempt("parallel", { status: 200, bodyJson: {} }, cleanNormalized({ promptBlockReason: "SAFETY" }));
    expect(isGroundingFallbackAllowed(blocked)).toBe(false);

    const controller = new AbortController();
    controller.abort();
    expect(isGroundingFallbackAllowed(makeAttempt("parallel", { status: 500, bodyJson: {} }), controller.signal)).toBe(false);
    expect(isGroundingFallbackAllowed(makeAttempt("parallel", { status: 500, bodyJson: {} }))).toBe(true);
  });
});

describe("fallback reason strings", () => {
  it("reports the empty-query failure explicitly", () => {
    const attempt = makeAttempt("exa", { bodyJson: googleErrorBody(EXA_EMPTY_QUERY_MESSAGE) });
    expect(fallbackReasonFromGrounding(attempt)).toBe(
      "Gemini native Exa grounding sent Exa an empty search query.",
    );
  });

  it("labels the Parallel partner in generic status handling", () => {
    const attempt = makeAttempt("parallel", { status: 429, statusText: "Too Many Requests", bodyText: "{}" });
    expect(fallbackReasonFromGrounding(attempt)).toBe(
      "Gemini+Parallel returned HTTP 429; quota or rate limiting prevented a clean primary answer.",
    );
  });

  it("reports a missing-sources rejection for a 2xx STOP answer", () => {
    const attempt = makeAttempt("parallel", { status: 200, bodyJson: {} }, cleanNormalized({ sources: [] }));
    expect(fallbackReasonFromGrounding(attempt)).toBe("Gemini+Parallel returned no usable grounding sources.");
  });
});
