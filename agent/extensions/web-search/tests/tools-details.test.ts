import "./pi-tui-mock.js";
import { describe, expect, it } from "bun:test";
import type {
  CodeSearchAttempt,
  GroundingAttempt,
  NormalizedGeminiGroundingResponse,
  NormalizedFirecrawlDeveloperSearch,
  RawHttpRequest,
  RawHttpResponse,
  StoredSearchResponse,
} from "../src/types.js";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { buildStoredRecord, buildStoredCodeSearchRecord, detailsForSearch, detailsForCodeSearch } = await import("../src/tools.js");
const { expectNoSecretFragments } = await import("./helpers.js");

const EXA_EMPTY_QUERY_MESSAGE =
  'Exa AI API returned bad request error. Please check your request. {"requestId":"abc","error":"Invalid request body | Validation error: Too small: expected string to have >=1 characters at \\"query\\"","tag":"INVALID_REQUEST_BODY"}';

const cleanNormalized: NormalizedGeminiGroundingResponse = {
  answer: "Grounded answer.",
  finishReason: "STOP",
  cleanSuccess: true,
  sources: [
    { groundingId: 0, title: "Docs", url: "https://example.com/docs" },
    { groundingId: 1, title: "Blog", url: "https://example.com/blog" },
  ],
  supports: [{ text: "Grounded answer.", groundingChunkIndices: [0] }],
  webSearchQueries: ["parallel grounding", "gemini 3.5 flash"],
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

function groundingAttempt(
  partner: "parallel" | "exa",
  response: RawHttpResponse,
  normalized?: NormalizedGeminiGroundingResponse,
): GroundingAttempt {
  return {
    provider: partner === "parallel" ? "gemini-parallel-grounding" : "gemini-exa-grounding",
    partner,
    model: "gemini-3.5-flash",
    requestStartedAt: "2026-07-30T00:00:00.000Z",
    elapsedMs: 1200,
    rawResponse: response,
    normalized,
  };
}

function emptyQueryAttempt(): GroundingAttempt {
  return groundingAttempt(
    "exa",
    rawResponse(400, { error: { code: 400, message: EXA_EMPTY_QUERY_MESSAGE, status: "INVALID_ARGUMENT" } }),
  );
}

function cleanParallelAttempt(): GroundingAttempt {
  return groundingAttempt("parallel", rawResponse(200, {}), cleanNormalized);
}

function cleanExaAttempt(): GroundingAttempt {
  return groundingAttempt("exa", rawResponse(200, {}), cleanNormalized);
}

function firecrawlAttempt(normalized: NormalizedFirecrawlDeveloperSearch): CodeSearchAttempt {
  return {
    provider: "firecrawl-developer",
    requestStartedAt: "2026-07-30T00:00:00.000Z",
    elapsedMs: 900,
    rawResponse: rawResponse(200, {}),
    normalized,
  };
}

function exaCodeAttempt(resultsCount?: number): CodeSearchAttempt {
  return {
    provider: "exa-code",
    requestStartedAt: "2026-07-30T00:00:01.000Z",
    elapsedMs: 800,
    rawResponse: rawResponse(200, {}),
    normalized: { response: "code context", resultsCount, requestId: "req-1" },
  };
}

const common = { responseId: "wse_test_0123456789abcdef", now: 1_000, ttlMs: 60_000, query: "q", secrets: [] };

describe("stored web_search record construction", () => {
  it("omits attempt history for an ordinary single attempt and mirrors legacy fields", () => {
    const parallel = cleanParallelAttempt();
    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [parallel],
      exaAttempts: [],
      selected: parallel,
    });

    expect(built.schemaVersion).toBe(2);
    expect(built.tool).toBe("web_search");
    expect(built.depth).toBe("standard");
    expect(built.selectedProvider).toBe("gemini-parallel-grounding");
    expect(built.attempts).toHaveLength(1);
    expect(built.primaryAttempts).toBeUndefined();
    expect(JSON.parse(JSON.stringify(built))).not.toHaveProperty("primaryAttempts");
    expect(built.provider).toBe("gemini-parallel-grounding");
    expect(built.normalized?.cleanSuccess).toBe(true);
    expect(built.googleResponseId).toBe("google-response-1");
    expect(detailsForSearch(built).attemptCount).toBe(1);
  });

  it("stores Parallel and Exa attempts chronologically", () => {
    const parallel = { ...cleanParallelAttempt(), normalized: undefined, rawResponse: rawResponse(503, { error: { message: "upstream" } }) };
    const first = { ...emptyQueryAttempt(), rawRequest: rawRequest("first") };
    const final = { ...cleanExaAttempt(), rawRequest: rawRequest("final") };
    const built = buildStoredRecord({
      ...common,
      depth: "deep",
      parallelAttempts: [parallel],
      exaAttempts: [first, final],
      selected: final,
    });

    expect(built.attempts.map((attempt) => attempt.provider)).toEqual([
      "gemini-parallel-grounding",
      "gemini-exa-grounding",
      "gemini-exa-grounding",
    ]);
    // Storage normalization applies to every stored attempt: the duplicate
    // parsed bodyJson copy is dropped and the request body is stored as a
    // bounded serialized string.
    expect(built.attempts.map((attempt) => attempt.rawResponse?.bodyJson)).toEqual([undefined, undefined, undefined]);
    expect(built.attempts.map((attempt) => attempt.rawRequest?.body)).toEqual([
      undefined,
      JSON.stringify({ attempt: "first" }),
      JSON.stringify({ attempt: "final" }),
    ]);
    // Legacy mirrors all derive from the same bounded attempts.
    expect(built.fallback).toBe(built.attempts[2]);
    expect(built.request).toBe(built.attempts[2]!.rawRequest);
    expect(built.response).toBe(built.attempts[2]!.rawResponse);
    expect(built.response?.status).toBe(200);
    expect(built.normalized).toBe(final.normalized);
    expect(detailsForSearch(built).attemptCount).toBe(3);
  });
});

describe("web_search details contract", () => {
  it("reports the Parallel provider for a clean primary", () => {
    const parallel = cleanParallelAttempt();
    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [parallel],
      exaAttempts: [],
      selected: parallel,
    });
    const details = detailsForSearch(built);

    expect(details.answerProvider).toBe("gemini-parallel-grounding");
    expect(details.depth).toBe("standard");
    expect(details.attemptCount).toBe(1);
    expect(details.sourceCount).toBe(2);
    expect(details.supportCount).toBe(1);
    expect(details.queryCount).toBe(2);
    expect(details.primaryFirstFailureCode).toBeNull();
    expect(details.primaryFinalFailureCode).toBeNull();
    expect(details.primaryStatus).toBe(200);
    expect(details.fallbackUsed).toBe(false);
    expect(details.fallbackFrom).toBeNull();
  });

  it("reports the Exa fallback answer with its own grounding counts", () => {
    const parallel = groundingAttempt("parallel", rawResponse(429, { error: { message: "quota" } }));
    const exa = cleanExaAttempt();
    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [parallel],
      exaAttempts: [exa],
      selected: exa,
    });
    const details = detailsForSearch(built);

    expect(details.answerProvider).toBe("gemini-exa-grounding");
    expect(details.fallbackUsed).toBe(true);
    expect(details.fallbackFrom).toBe("parallel");
    expect(details.fallbackReason).toContain("Gemini+Parallel returned HTTP 429");
    expect(details.sourceCount).toBe(2);
    expect(details.attemptProviders).toEqual(["gemini-parallel-grounding", "gemini-exa-grounding"]);
  });

  it("suppresses grounding counts and provider labels when both partners fail", () => {
    const parallel = groundingAttempt("parallel", rawResponse(500, { error: { message: "boom" } }));
    const built = buildStoredRecord({
      ...common,
      depth: "deep",
      parallelAttempts: [parallel],
      exaAttempts: [emptyQueryAttempt()],
      selected: undefined,
    });
    const details = detailsForSearch(built);

    expect(details.answerProvider).toBeNull();
    expect(details.selectedProvider).toBe("none");
    expect(details.sourceCount).toBeNull();
    expect(details.supportCount).toBeNull();
    expect(details.queryCount).toBeNull();
    expect(details.primaryStatus).toBe(500);
    expect(details.primaryFirstFailureCode).toBeNull();
    expect(details.primaryFinalFailureCode).toBeNull();
  });

  it("tolerates legacy records without schema, attempts, or depth fields", () => {
    const legacy = {
      responseId: "wse_legacy_0123456789abcdef",
      createdAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
      provider: "gemini-exa-grounding",
      model: "gemini-3.5-flash",
      query: "legacy query",
      primary: cleanExaAttempt(),
      normalized: cleanNormalized,
      fallback: null,
      googleResponseId: "google-response-1",
    } as unknown as StoredSearchResponse;

    const details = detailsForSearch(legacy);

    expect(details.attemptCount).toBe(1);
    expect(details.depth).toBe("standard");
    expect(details.answerProvider).toBe("gemini-exa-grounding");
    expect(details.sourceCount).toBe(2);
  });
});

describe("web_code_search stored record and details", () => {
  const codeCommon = { ...common, focus: "developer_sources" as const };

  it("records the schema version, focus, selected provider, and attempts", () => {
    const primary = firecrawlAttempt({ success: true, artifacts: [], resultCount: 0 });
    const fallback = exaCodeAttempt(15);
    const built = buildStoredCodeSearchRecord({
      ...codeCommon,
      attempts: [primary, fallback],
      selected: fallback,
      degraded: true,
    });

    expect(built.schemaVersion).toBe(2);
    expect(built.tool).toBe("web_code_search");
    expect(built.focus).toBe("developer_sources");
    expect(built.selectedProvider).toBe("exa-code");
    expect(built.degraded).toBe(true);

    const details = detailsForCodeSearch(built);
    expect(details.answerProvider).toBe("exa-code");
    expect(details.fallbackUsed).toBe(true);
    expect(details.fallbackFrom).toBe("firecrawl-developer");
    expect(details.degraded).toBe(true);
    expect(details.resultCount).toBe(15);
    expect(details.requestId).toBe("req-1");
  });

  it("reports coverage and reranked for a selected Firecrawl result", () => {
    const primary = firecrawlAttempt({
      success: true,
      artifacts: [{ id: "doc:a", type: "doc", url: "https://a", passages: ["p"] }],
      coverage: { doc: "ok" },
      reranked: true,
      resultCount: 1,
    });
    const built = buildStoredCodeSearchRecord({
      ...codeCommon,
      attempts: [primary],
      selected: primary,
      degraded: false,
    });

    const details = detailsForCodeSearch(built);
    expect(details.fallbackUsed).toBe(false);
    expect(details.resultCount).toBe(1);
    expect(details.coverage).toEqual({ doc: "ok" });
    expect(details.reranked).toBe(true);
  });

  it("reports a null provider and zero fallback when nothing succeeded", () => {
    const built = buildStoredCodeSearchRecord({
      ...codeCommon,
      attempts: [firecrawlAttempt({ success: false, artifacts: [], resultCount: 0 })],
      selected: undefined,
      degraded: false,
    });

    const details = detailsForCodeSearch(built);
    expect(details.answerProvider).toBeNull();
    expect(details.fallbackUsed).toBe(false);
    expect(details.resultCount).toBeNull();
  });
});

describe("stored-record storage normalization bounds", () => {
  const secret = "wse-builder-secret-" + "k".repeat(40);
  const secrets = [{ label: "WSE_TEST_GOOGLE_KEY", value: secret }];
  const redacted = "[REDACTED_WSE_TEST_GOOGLE_KEY]";
  const codeCommon = { ...common, focus: "developer_sources" as const };

  function boundaryGroundingAttempt(): GroundingAttempt {
    return {
      provider: "gemini-parallel-grounding",
      partner: "parallel",
      model: "gemini-3.5-flash",
      requestStartedAt: "2026-07-30T00:00:00.000Z",
      elapsedMs: 10,
      rawRequest: {
        method: "POST",
        url: "https://example.invalid/generateContent",
        headers: { "x-goog-api-key": secret, "x-long": "h".repeat(470) + secret },
        body: { tools: [{ parallelAiSearch: { api_key: secret, padding: "p".repeat(25_000) } }] },
      },
      rawResponse: {
        status: 503,
        statusText: "s".repeat(470) + secret,
        headers: { "x-long": "h".repeat(470) + secret },
        bodyText: "b".repeat(19_900) + secret,
        bodyJson: { nested: secret },
      },
      error: "e".repeat(470) + secret,
    };
  }

  function boundaryCodeSearchAttempt(): CodeSearchAttempt {
    return {
      provider: "firecrawl-developer",
      requestStartedAt: "2026-07-30T00:00:00.000Z",
      elapsedMs: 10,
      rawRequest: {
        method: "POST",
        url: "https://api.firecrawl.dev/v2/search/developer",
        headers: { Authorization: `Bearer ${secret}` },
        body: { query: "q", k: 10, passages: 2 },
      },
      rawResponse: {
        status: 500,
        statusText: "s".repeat(470) + secret,
        headers: { "x-long": "h".repeat(470) + secret },
        bodyText: "b".repeat(19_900) + secret,
        bodyJson: { nested: secret },
      },
      error: "e".repeat(470) + secret,
    };
  }

  it("bounds web_search attempts and every legacy mirror with redaction before truncation", () => {
    const attempt = boundaryGroundingAttempt();
    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [attempt],
      exaAttempts: [],
      selected: attempt,
      secrets,
    });

    const stored = built.attempts[0]!;
    expect(stored.error!.length).toBeLessThanOrEqual(500);
    expect(stored.error).toContain(redacted);
    expect(stored.rawResponse!.statusText.length).toBeLessThanOrEqual(500);
    expect(stored.rawResponse!.statusText).toContain(redacted);
    expect(stored.rawResponse!.headers["x-long"]!.length).toBeLessThanOrEqual(500);
    expect(stored.rawResponse!.headers["x-long"]).toContain(redacted);
    expect(stored.rawResponse!.bodyText!.length).toBeLessThanOrEqual(20_000);
    expect(stored.rawResponse!.bodyText).toContain(redacted);
    expect(stored.rawResponse!.bodyJson).toBeUndefined();
    expect(stored.rawRequest!.headers["x-goog-api-key"]).toBe(redacted);
    expect(stored.rawRequest!.headers["x-long"]!.length).toBeLessThanOrEqual(500);
    // The serialized request body is capped at 20 000 characters with the
    // deterministic marker; the nested secret was replaced before bounding so
    // even the truncated copy carries only the redaction label.
    expect(typeof stored.rawRequest!.body).toBe("string");
    expect(stored.rawRequest!.body!.length).toBe(20_000);
    expect(stored.rawRequest!.body!.endsWith("[truncated at 20000 characters]")).toBe(true);
    expect(stored.rawRequest!.body).toContain(redacted);
    expect(JSON.stringify(built)).not.toContain(secret);
    expectNoSecretFragments(JSON.stringify(built), secret);
    // Every legacy mirror derives from the same bounded attempt.
    expect(built.primary).toBe(stored);
    expect(built.request).toBe(stored.rawRequest);
    expect(built.response).toBe(stored.rawResponse);
    expect(built.selectedProvider).toBe("gemini-parallel-grounding");
  });

  it("bounds web_code_search attempts with redaction before truncation", () => {
    const attempt = boundaryCodeSearchAttempt();
    const built = buildStoredCodeSearchRecord({
      ...codeCommon,
      attempts: [attempt],
      selected: attempt,
      degraded: false,
      secrets,
    });

    const stored = built.attempts[0]!;
    expect(stored.error!.length).toBeLessThanOrEqual(500);
    expect(stored.error).toContain(redacted);
    expect(stored.rawResponse!.statusText.length).toBeLessThanOrEqual(500);
    expect(stored.rawResponse!.statusText).toContain(redacted);
    expect(stored.rawResponse!.headers["x-long"]!.length).toBeLessThanOrEqual(500);
    expect(stored.rawResponse!.headers["x-long"]).toContain(redacted);
    expect(stored.rawResponse!.bodyText!.length).toBeLessThanOrEqual(20_000);
    expect(stored.rawResponse!.bodyText).toContain(redacted);
    expect(stored.rawResponse!.bodyJson).toBeUndefined();
    expect(stored.rawRequest!.headers.Authorization).toBe(`Bearer ${redacted}`);
    expect(typeof stored.rawRequest!.body).toBe("string");
    expect(JSON.parse(stored.rawRequest!.body as string)).toEqual({ query: "q", k: 10, passages: 2 });
    expect(JSON.stringify(built)).not.toContain(secret);
    expectNoSecretFragments(JSON.stringify(built), secret);
    expect(built.selectedProvider).toBe("firecrawl-developer");
  });
});
