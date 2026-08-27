import "./pi-tui-mock.js";
import { describe, expect, it } from "bun:test";
import type {
  CodeSearchAttempt,
  GroundingAttempt,
  NormalizedCodeSearchResult,
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
    // The top-level normalized references the bounded selected attempt's
    // normalized copy, never an unbounded duplicate of the raw value.
    expect(built.normalized).toBe(built.attempts[2]!.normalized);
    expect(built.normalized).not.toBe(final.normalized);
    expect(built.normalized?.sourcesTotal).toBe(2);
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

describe("arbitrary diagnostic metadata hardening", () => {
  const omission = { diagnosticPreview: "[unserializable diagnostic value omitted]", diagnosticPreviewTruncated: false };

  it("replaces a deeply nested JSON-parsed usage value with the exact omission marker", () => {
    // JSON.parse builds nesting far deeper than any recursive walker can
    // survive, proving a provider response body can carry this shape.
    const deep = JSON.parse('{"a":'.repeat(50_000) + "1" + "}".repeat(50_000));
    const normalized = { ...cleanNormalized, usage: deep };
    const attempt = groundingAttempt("parallel", rawResponse(200, {}), normalized);

    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [attempt],
      exaAttempts: [],
      selected: attempt,
      secrets: [],
    });

    expect(built.attempts[0]!.normalized!.usage).toEqual(omission);
    // The usable outcome survives; only the pathological metadata is omitted.
    expect(built.attempts[0]!.normalized!.answer).toBe("Grounded answer.");
    expect(built.normalized!.answer).toBe("Grounded answer.");
  });

  it("replaces a cyclic injected usage value with the exact omission marker without throwing", () => {
    const cyclic: Record<string, unknown> = { promptTokenCount: 1 };
    cyclic.self = cyclic;
    const normalized = { ...cleanNormalized, usage: cyclic };
    const attempt = groundingAttempt("parallel", rawResponse(200, {}), normalized);

    const built = buildStoredRecord({
      ...common,
      depth: "standard",
      parallelAttempts: [attempt],
      exaAttempts: [],
      selected: attempt,
      secrets: [],
    });

    expect(built.attempts[0]!.normalized!.usage).toEqual(omission);
    expect(built.attempts[0]!.normalized!.answer).toBe("Grounded answer.");
    // Ordinary small metadata keeps its shape on the same record.
    expect(built.attempts[0]!.normalized!.googleResponseId).toBe("google-response-1");
  });

  it("keeps code-search coverage hardening so a pathological value cannot mask a usable outcome", () => {
    const cyclic: Record<string, unknown> = { blocked: true };
    cyclic.cycle = cyclic;
    const normalized: NormalizedFirecrawlDeveloperSearch = {
      success: true,
      artifacts: [{ id: "a1", type: "doc", url: "https://example.com/a", title: "Usable", passages: ["passage"] }],
      coverage: cyclic,
      resultCount: 1,
    };
    const attempt = firecrawlAttempt(normalized);

    const built = buildStoredCodeSearchRecord({
      ...common,
      focus: "developer_sources",
      attempts: [attempt],
      selected: attempt,
      degraded: false,
      secrets: [],
    });

    expect(built.attempts[0]!.normalized!.coverage).toEqual(omission);
    const stored = built.attempts[0]!.normalized as NormalizedFirecrawlDeveloperSearch;
    expect(stored.artifacts[0]!.title).toBe("Usable");
    expect(stored.artifacts[0]!.passages).toEqual(["passage"]);
    expect(built.selectedProvider).toBe("firecrawl-developer");
  });
});

describe("stored normalized grounding bounds", () => {
  const secret = "wse-normalized-secret-" + "n".repeat(40);
  const secrets = [{ label: "WSE_TEST_GOOGLE_KEY", value: secret }];
  const common = { responseId: "wse_norm_0123456789abcdef", now: 1_000, ttlMs: 60_000, secrets };

  function oversizedGroundingAttempt(): GroundingAttempt {
    return {
      provider: "gemini-parallel-grounding",
      partner: "parallel",
      model: "gemini-3.5-flash",
      requestStartedAt: "2026-07-30T00:00:00.000Z",
      elapsedMs: 10,
      rawRequest: {
        method: "POST",
        // Oversized provider request URL: stored through the URL bound.
        url: "https://example.invalid/" + "u".repeat(700),
        headers: {},
        body: { query: "q" },
      },
      rawResponse: rawResponse(200, {}),
      normalized: {
        answer: "a".repeat(30_000) + secret,
        finishReason: "STOP",
        cleanSuccess: true,
        sources: Array.from({ length: 40 }, (_, i) => ({
          groundingId: i,
          title: "t".repeat(600),
          url: `https://example.com/s/${i}/` + "p".repeat(600),
          domain: "d".repeat(600),
        })),
        supports: Array.from({ length: 40 }, (_, i) => ({
          text: "x".repeat(600),
          groundingChunkIndices: Array.from({ length: 40 }, (_, j) => i + j),
        })),
        webSearchQueries: Array.from({ length: 40 }, () => "w".repeat(600)),
        usage: { promptTokenCount: 5, nested: { blob: "z".repeat(30_000) + secret } },
        googleResponseId: "g".repeat(600),
        modelVersion: "m".repeat(600),
        promptBlockReason: undefined,
      },
    };
  }

  it("bounds every normalized grounding field with caps and total/omitted counters", () => {
    const attempt = oversizedGroundingAttempt();
    const built = buildStoredRecord({
      ...common,
      query: "q",
      depth: "standard",
      parallelAttempts: [attempt],
      exaAttempts: [],
      selected: attempt,
    });

    const stored = built.attempts[0]!.normalized!;
    expect(stored.answer.length).toBe(20_000);
    expect(stored.answer.endsWith("[truncated at 20000 characters]")).toBe(true);
    expect(stored.sources).toHaveLength(25);
    expect(stored.sourcesTotal).toBe(40);
    expect(stored.sourcesOmitted).toBe(15);
    expect(stored.sources[0]!.title!.length).toBeLessThanOrEqual(500);
    expect(stored.sources[0]!.url!.length).toBeLessThanOrEqual(500);
    expect(stored.sources[0]!.url).toMatch(/\[\+sha256:[0-9a-f]{12}\]$/);
    expect(stored.sources[0]!.domain!.length).toBeLessThanOrEqual(500);
    expect(stored.supports).toHaveLength(25);
    expect(stored.supportsTotal).toBe(40);
    expect(stored.supportsOmitted).toBe(15);
    expect(stored.supports[0]!.groundingChunkIndices).toHaveLength(25);
    expect(stored.supports[0]!.chunkIndicesTotal).toBe(40);
    expect(stored.supports[0]!.chunkIndicesOmitted).toBe(15);
    expect(stored.supports[0]!.text.length).toBeLessThanOrEqual(500);
    expect(stored.webSearchQueries).toHaveLength(25);
    expect(stored.webSearchQueriesTotal).toBe(40);
    expect(stored.webSearchQueriesOmitted).toBe(15);
    expect(stored.webSearchQueries[0]!.length).toBeLessThanOrEqual(500);
    expect(stored.googleResponseId!.length).toBeLessThanOrEqual(500);
    expect(stored.modelVersion!.length).toBeLessThanOrEqual(500);
    // Oversized arbitrary usage becomes the explicit bounded preview wrapper.
    const usage = stored.usage as Record<string, unknown>;
    expect(typeof usage.diagnosticPreview).toBe("string");
    expect((usage.diagnosticPreview as string).length).toBe(20_000);
    expect(usage.diagnosticPreviewTruncated).toBe(true);
    // The bounded request URL keeps the digest suffix.
    expect(built.attempts[0]!.rawRequest!.url.length).toBe(500);
    expect(built.attempts[0]!.rawRequest!.url).toMatch(/\[\+sha256:[0-9a-f]{12}\]$/);
    // The raw oversized values never survive anywhere in the record.
    const serialized = JSON.stringify(built);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("a".repeat(21_000));
  });

  it("keeps ordinary small usage and small collections in their normal shape", () => {
    const attempt: GroundingAttempt = {
      ...oversizedGroundingAttempt(),
      normalized: {
        answer: "short answer",
        finishReason: "STOP",
        cleanSuccess: true,
        sources: [{ groundingId: 0, title: "Docs", url: "https://example.com/docs" }],
        supports: [{ text: "support", groundingChunkIndices: [0] }],
        webSearchQueries: ["q"],
        usage: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
        googleResponseId: "resp-1",
        modelVersion: "gemini-3.5-flash",
      },
    };
    const built = buildStoredRecord({
      ...common,
      query: "q",
      depth: "standard",
      parallelAttempts: [attempt],
      exaAttempts: [],
      selected: attempt,
    });

    const stored = built.attempts[0]!.normalized!;
    expect(stored.usage).toEqual({ promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 });
    expect(stored.sources).toEqual([{ groundingId: 0, title: "Docs", url: "https://example.com/docs", domain: undefined }]);
    expect(stored.answer).toBe("short answer");
  });

  it("bounds the stored main-record query at 2000 characters with redaction before truncation", () => {
    const attempt = oversizedGroundingAttempt();
    // The secret crosses the 2000-character cutoff of the stored query.
    const query = "a".repeat(1_900) + secret + "b".repeat(600);
    const built = buildStoredRecord({
      ...common,
      query,
      depth: "standard",
      parallelAttempts: [attempt],
      exaAttempts: [],
      selected: attempt,
    });

    expect(built.query.length).toBe(2_000);
    expect(built.query.endsWith("[truncated at 2000 characters]")).toBe(true);
    expect(built.query).toContain("[REDACTED_WSE_TEST_GOOGLE_KEY]");
    expect(built.query).not.toContain(secret);
    expectNoSecretFragments(JSON.stringify(built), secret);
  });

  it("derives a bounded fallbackReason in details from the bounded stored attempt", () => {
    const attempt: GroundingAttempt = {
      provider: "gemini-parallel-grounding",
      partner: "parallel",
      model: "gemini-3.5-flash",
      requestStartedAt: "2026-07-30T00:00:00.000Z",
      elapsedMs: 10,
      // Transport error text is provider-controlled and oversized.
      error: "e".repeat(5_000) + secret,
    };
    const fallback: GroundingAttempt = {
      provider: "gemini-exa-grounding",
      partner: "exa",
      model: "gemini-3.5-flash",
      requestStartedAt: "2026-07-30T00:00:01.000Z",
      elapsedMs: 10,
      rawResponse: rawResponse(200, {}),
      normalized: cleanNormalized,
    };
    const built = buildStoredRecord({
      ...common,
      query: "q",
      depth: "standard",
      parallelAttempts: [attempt],
      exaAttempts: [fallback],
      selected: fallback,
    });

    const details = detailsForSearch(built);
    expect(details.fallbackUsed).toBe(true);
    expect(typeof details.fallbackReason).toBe("string");
    // The embedded error comes from the bounded stored attempt: bounded and
    // redacted, while raw provider errors stay absent from details.
    expect((details.fallbackReason as string).length).toBeLessThanOrEqual(800);
    expect(details.fallbackReason).not.toContain(secret);
    expectNoSecretFragments(details.fallbackReason as string, secret);
  });
});

describe("stored normalized code-search bounds", () => {
  const secret = "wse-code-norm-secret-" + "c".repeat(40);
  const secrets = [{ label: "WSE_TEST_FIRECRAWL_KEY", value: secret }];
  const common = { responseId: "wse_code_norm_01234567", now: 1_000, ttlMs: 60_000, query: "q", focus: "developer_sources" as const, secrets };

  it("caps Firecrawl artifacts and passages with counters and bounds every field", () => {
    const attempt: CodeSearchAttempt = {
      provider: "firecrawl-developer",
      requestStartedAt: "2026-07-30T00:00:00.000Z",
      elapsedMs: 10,
      rawResponse: rawResponse(200, {}),
      normalized: {
        success: true,
        artifacts: Array.from({ length: 40 }, (_, i) => ({
          id: "i".repeat(600),
          type: "doc",
          url: `https://example.com/a/${i}/` + "u".repeat(600),
          title: "t".repeat(600),
          passages: Array.from({ length: 40 }, () => "p".repeat(600) + secret),
        })),
        coverage: { doc: "ok", note: "n".repeat(30) },
        reranked: true,
        resultCount: 40,
      },
    };
    const built = buildStoredCodeSearchRecord({
      ...common,
      attempts: [attempt],
      selected: attempt,
      degraded: false,
    });

    const stored = built.attempts[0]!.normalized! as NormalizedFirecrawlDeveloperSearch;
    expect(stored.artifacts).toHaveLength(25);
    expect(stored.artifactsTotal).toBe(40);
    expect(stored.artifactsOmitted).toBe(15);
    const artifact = stored.artifacts[0]!;
    expect(artifact.passages).toHaveLength(25);
    expect(artifact.passagesTotal).toBe(40);
    expect(artifact.passagesOmitted).toBe(15);
    expect(artifact.passages[0]!.length).toBeLessThanOrEqual(500);
    expect(artifact.id!.length).toBeLessThanOrEqual(500);
    expect(artifact.title!.length).toBeLessThanOrEqual(500);
    expect(artifact.url!.length).toBeLessThanOrEqual(500);
    expect(artifact.url).toMatch(/\[\+sha256:[0-9a-f]{12}\]$/);
    // Ordinary small coverage keeps its normal shape.
    expect(stored.coverage).toEqual({ doc: "ok", note: "n".repeat(30) });
    expect(stored.reranked).toBe(true);
    const serialized = JSON.stringify(built);
    expect(serialized).not.toContain(secret);
    expectNoSecretFragments(serialized, secret);
  });

  it("wraps oversized coverage in an explicit bounded preview and keeps small cost fields", () => {
    const oversizedCoverage = { blob: "x".repeat(2_000) };
    const firecrawl: CodeSearchAttempt = {
      provider: "firecrawl-developer",
      requestStartedAt: "2026-07-30T00:00:00.000Z",
      elapsedMs: 10,
      rawResponse: rawResponse(200, {}),
      normalized: {
        success: true,
        artifacts: [],
        coverage: oversizedCoverage,
        resultCount: 0,
      },
    };
    const exa: CodeSearchAttempt = {
      provider: "exa-code",
      requestStartedAt: "2026-07-30T00:00:01.000Z",
      elapsedMs: 10,
      rawResponse: rawResponse(200, {}),
      normalized: {
        response: "r".repeat(30_000),
        resultsCount: 12,
        requestId: "q".repeat(600),
        costDollars: 0.0123,
        searchTime: 0.5,
        outputTokens: 4_000,
      },
    };
    const built = buildStoredCodeSearchRecord({
      ...common,
      attempts: [firecrawl, exa],
      selected: exa,
      degraded: true,
    });

    const firecrawlStored = built.attempts[0]!.normalized! as NormalizedFirecrawlDeveloperSearch;
    const coverage = firecrawlStored.coverage as Record<string, unknown>;
    expect(typeof coverage.diagnosticPreview).toBe("string");
    expect((coverage.diagnosticPreview as string).length).toBeLessThanOrEqual(500);
    expect(coverage.diagnosticPreviewTruncated).toBe(true);

    const exaStored = built.attempts[1]!.normalized as Extract<NormalizedCodeSearchResult, { response: string }>;
    expect(exaStored.response.length).toBe(20_000);
    expect(exaStored.response.endsWith("[truncated at 20000 characters]")).toBe(true);
    expect(exaStored.requestId!.length).toBeLessThanOrEqual(500);
    // Ordinary numeric cost fields keep their shape.
    expect(exaStored.costDollars).toBe(0.0123);
    expect(exaStored.searchTime).toBe(0.5);
    expect(exaStored.outputTokens).toBe(4_000);
  });
});
