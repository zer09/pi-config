import "./pi-tui-mock.js";
import { describe, expect, it } from "bun:test";
import type {
  FallbackAttempt,
  NormalizedGeminiExaResponse,
  PrimaryAttempt,
  RawHttpRequest,
  RawHttpResponse,
  StoredSearchResponse,
} from "../src/types.js";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { buildStoredRecord, detailsForSearch } = await import("../src/tools.js");

const EXA_EMPTY_QUERY_MESSAGE =
  'Exa AI API returned bad request error. Please check your request. {"requestId":"abc","error":"Invalid request body | Validation error: Too small: expected string to have >=1 characters at \\"query\\"","tag":"INVALID_REQUEST_BODY"}';

const cleanNormalized: NormalizedGeminiExaResponse = {
  answer: "Grounded answer.",
  finishReason: "STOP",
  cleanSuccess: true,
  sources: [
    { groundingId: 0, title: "Docs", url: "https://example.com/docs" },
    { groundingId: 1, title: "Blog", url: "https://example.com/blog" },
  ],
  supports: [{ text: "Grounded answer.", groundingChunkIndices: [0] }],
  webSearchQueries: ["exa grounding", "gemini 3.5 flash"],
  googleResponseId: "google-response-1",
};

function rawRequest(label: string): RawHttpRequest {
  return {
    method: "POST",
    url: "https://example.invalid/generateContent",
    headers: { "x-goog-api-key": "test-only-google-key" },
    body: { attempt: label },
  };
}

function rawResponse(status: number, bodyJson?: unknown): RawHttpResponse {
  return { status, statusText: "", headers: {}, bodyText: JSON.stringify(bodyJson ?? {}), bodyJson };
}

function attempt(response: RawHttpResponse, normalized?: NormalizedGeminiExaResponse): PrimaryAttempt {
  return {
    provider: "gemini-exa-grounding",
    model: "gemini-3.5-flash",
    requestStartedAt: "2026-07-30T00:00:00.000Z",
    elapsedMs: 1200,
    rawResponse: response,
    normalized,
  };
}

function emptyQueryAttempt(): PrimaryAttempt {
  return attempt(rawResponse(400, { error: { code: 400, message: EXA_EMPTY_QUERY_MESSAGE, status: "INVALID_ARGUMENT" } }));
}

function cleanAttempt(): PrimaryAttempt {
  return attempt(rawResponse(200, {}), cleanNormalized);
}

function fallbackAttempt(provider: "exa_search" | "code_search", resultCount?: number): FallbackAttempt {
  return {
    used: true,
    provider,
    reason: "Gemini native Exa grounding sent Exa an empty search query.",
    requestStartedAt: "2026-07-30T00:00:01.000Z",
    elapsedMs: 1800,
    answer: "Fallback answer",
    resultCount,
  };
}

function record(params: {
  attempts: PrimaryAttempt[];
  fallback?: FallbackAttempt | null;
  includeAttemptHistory?: boolean;
}): StoredSearchResponse {
  const primary = params.attempts[params.attempts.length - 1]!;
  return {
    responseId: "wse_test_0123456789abcdef",
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    provider: "gemini-exa-grounding",
    model: primary.model,
    query: "Does gemini-3.5-flash support Exa grounding?",
    response: primary.rawResponse,
    primary,
    primaryAttempts: params.includeAttemptHistory === false ? undefined : params.attempts,
    normalized: primary.normalized ?? null,
    fallback: params.fallback ?? null,
    googleResponseId: primary.normalized?.googleResponseId,
  };
}

describe("stored record construction", () => {
  const common = { responseId: "wse_test_0123456789abcdef", now: 1_000, ttlMs: 60_000, query: "q" };

  it("omits attempt history for an ordinary single attempt", () => {
    const built = buildStoredRecord({ ...common, primaryAttempts: [cleanAttempt()], fallback: null });

    expect(built.primaryAttempts).toBeUndefined();
    expect(JSON.parse(JSON.stringify(built))).not.toHaveProperty("primaryAttempts");
    expect(detailsForSearch(built).primaryAttemptCount).toBe(1);
  });

  it("stores both attempts chronologically after a retry", () => {
    // Each attempt carries a distinct request/response so final-attempt mirroring
    // cannot pass by both values being undefined.
    const first = { ...emptyQueryAttempt(), rawRequest: rawRequest("first") };
    const final = { ...cleanAttempt(), rawRequest: rawRequest("final") };
    const built = buildStoredRecord({ ...common, primaryAttempts: [first, final], fallback: null });

    expect(built.primaryAttempts).toEqual([first, final]);
    expect(built.primary).toBe(final);
    expect(built.request).toBe(final.rawRequest);
    expect(built.request?.body).toEqual({ attempt: "final" });
    expect(built.request).not.toBe(first.rawRequest);
    expect(built.response).toBe(final.rawResponse);
    expect(built.response?.status).toBe(200);
    expect(built.normalized).toBe(final.normalized);
    expect(built.normalized?.cleanSuccess).toBe(true);
    expect(built.googleResponseId).toBe(final.normalized?.googleResponseId);
    expect(built.googleResponseId).toBe("google-response-1");
    expect(detailsForSearch(built).primaryAttemptCount).toBe(2);
  });
});

describe("web_search details contract", () => {
  it("reports Gemini as the answer provider for a clean primary", () => {
    const details = detailsForSearch(record({ attempts: [cleanAttempt()] }));

    expect(details.answerProvider).toBe("gemini-exa-grounding");
    expect(details.primaryAttemptCount).toBe(1);
    expect(details.sourceCount).toBe(2);
    expect(details.supportCount).toBe(1);
    expect(details.queryCount).toBe(2);
    expect(details.primaryFirstFailureCode).toBeNull();
    expect(details.primaryFinalFailureCode).toBeNull();
    expect(details.primaryFinalStatus).toBe(200);
    expect(details.fallbackUsed).toBe(false);
    expect(details.fallbackResultCount).toBeNull();
  });

  it("preserves the first failure code when the retry succeeds", () => {
    const details = detailsForSearch(record({ attempts: [emptyQueryAttempt(), cleanAttempt()] }));

    expect(details.answerProvider).toBe("gemini-exa-grounding");
    expect(details.primaryAttemptCount).toBe(2);
    expect(details.primaryFirstFailureCode).toBe("EXA_EMPTY_QUERY");
    expect(details.primaryFinalFailureCode).toBeNull();
    expect(details.primaryFinalStatus).toBe(200);
    expect(details.sourceCount).toBe(2);
  });

  it("describes the fallback provider and suppresses Gemini counts", () => {
    const details = detailsForSearch(
      record({ attempts: [emptyQueryAttempt()], fallback: fallbackAttempt("code_search", 10) }),
    );

    expect(details.answerProvider).toBe("code_search");
    expect(details.primaryAttemptCount).toBe(1);
    expect(details.primaryFinalStatus).toBe(400);
    expect(details.primaryFinalFailureCode).toBe("EXA_EMPTY_QUERY");
    expect(details.fallbackResultCount).toBe(10);
    expect(details.sourceCount).toBeNull();
    expect(details.supportCount).toBeNull();
    expect(details.queryCount).toBeNull();
  });

  it("reports both attempts when the retry also failed", () => {
    const details = detailsForSearch(
      record({
        attempts: [emptyQueryAttempt(), emptyQueryAttempt()],
        fallback: fallbackAttempt("exa_search", 5),
      }),
    );

    expect(details.answerProvider).toBe("exa_search");
    expect(details.primaryAttemptCount).toBe(2);
    expect(details.primaryFirstFailureCode).toBe("EXA_EMPTY_QUERY");
    expect(details.primaryFinalFailureCode).toBe("EXA_EMPTY_QUERY");
    expect(details.fallbackResultCount).toBe(5);
  });

  it("treats a stored record without attempt history as a single attempt", () => {
    const details = detailsForSearch(
      record({ attempts: [cleanAttempt()], includeAttemptHistory: false }),
    );

    expect(details.primaryAttemptCount).toBe(1);
    expect(details.primaryFirstFailureCode).toBeNull();
    expect(details.sourceCount).toBe(2);
  });

  it("keeps the first failure visible when the retry failed differently", () => {
    const details = detailsForSearch(
      record({
        attempts: [emptyQueryAttempt(), attempt(rawResponse(429, { error: { code: 429, message: "Quota exceeded." } }))],
        fallback: fallbackAttempt("exa_search"),
      }),
    );

    expect(details.primaryAttemptCount).toBe(2);
    expect(details.primaryFirstFailureCode).toBe("EXA_EMPTY_QUERY");
    expect(details.primaryFinalFailureCode).toBeNull();
    expect(details.primaryFinalStatus).toBe(429);
    expect(details.fallbackResultCount).toBeNull();
  });
});
