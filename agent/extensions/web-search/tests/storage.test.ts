import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStoredResponse, responsePath, writeStoredResponse } from "../src/storage.js";
import type { GroundingAttempt, StoredCodeSearchResponse, StoredSearchResponse } from "../src/types.js";

const GOOGLE_KEY = "google-secret-key";
const PARALLEL_KEY = "parallel-secret-key";
const EXA_KEY = "exa-secret-key";
const FIRECRAWL_KEY = "firecrawl-secret-key";
const secrets = [
  { label: "GOOGLE_CLOUD_API_KEY", value: GOOGLE_KEY },
  { label: "PARALLEL_API_KEY", value: PARALLEL_KEY },
  { label: "EXA_API_KEY", value: EXA_KEY },
  { label: "FIRECRAWL_API_KEY", value: FIRECRAWL_KEY },
];

function groundingAttempt(status: number, headers: Record<string, string>, body: unknown): GroundingAttempt {
  return {
    provider: "gemini-parallel-grounding",
    partner: "parallel",
    model: "gemini-3.5-flash",
    requestStartedAt: "2026-07-30T00:00:00.000Z",
    elapsedMs: 1200,
    rawRequest: {
      method: "POST",
      url: "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash:generateContent",
      headers,
      body,
    },
    rawResponse: { status, statusText: "", headers: {}, bodyText: `status ${status}` },
  };
}

function storedRecord(responseId: string, attempts: GroundingAttempt[]): StoredSearchResponse {
  const primary = attempts[attempts.length - 1]!;
  return {
    schemaVersion: 2,
    responseId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    tool: "web_search",
    depth: "standard",
    selectedProvider: "gemini-parallel-grounding",
    query: "Does gemini-3.5-flash support Parallel grounding?",
    model: primary.model,
    attempts,
    provider: "gemini-parallel-grounding",
    request: primary.rawRequest,
    response: primary.rawResponse,
    primary,
    primaryAttempts: attempts.length > 1 ? attempts : undefined,
    normalized: null,
    fallback: null,
  };
}

function storedCodeRecord(responseId: string): StoredCodeSearchResponse {
  return {
    schemaVersion: 2,
    responseId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    tool: "web_code_search",
    focus: "developer_sources",
    selectedProvider: "firecrawl-developer",
    query: "zod validation",
    degraded: false,
    attempts: [
      {
        provider: "firecrawl-developer",
        requestStartedAt: "2026-07-30T00:00:00.000Z",
        elapsedMs: 500,
        rawRequest: {
          method: "POST",
          url: "https://api.firecrawl.dev/v2/search/developer",
          headers: { Authorization: `Bearer ${FIRECRAWL_KEY}` },
          body: { query: "zod validation", k: 10, passages: 2, nested: { key: EXA_KEY, deep: [PARALLEL_KEY] } },
        },
        rawResponse: { status: 200, statusText: "", headers: {}, bodyText: "{}" },
      },
    ],
  };
}

describe("stored response reads", () => {
  it("returns a friendly not-found error without exposing filesystem paths", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wse-storage-test-"));
    try {
      await readStoredResponse(cacheDir, "wse_missing_deadbeef");
      throw new Error("expected readStoredResponse to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Stored response wse_missing_deadbeef was not found or has expired.");
      expect(message).not.toContain(cacheDir);
      expect(message).not.toContain("ENOENT");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("does not serialize attempt history for a single-attempt record", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wse-storage-test-"));
    try {
      const record = storedRecord("wse_legacy_0123456789abcdef", [
        groundingAttempt(200, { "x-goog-api-key": GOOGLE_KEY }, { tools: [{ parallelAiSearch: { api_key: PARALLEL_KEY } }] }),
      ]);
      await writeStoredResponse(cacheDir, record, secrets);

      expect(await readFile(responsePath(cacheDir, record.responseId), "utf8")).not.toContain("primaryAttempts");

      const read = await readStoredResponse(cacheDir, record.responseId);
      expect(read.primaryAttempts).toBeUndefined();
      expect(read.primary.rawResponse?.status).toBe(200);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("round-trips two attempts and redacts all four secrets in each of them", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wse-storage-test-"));
    try {
      const record = storedRecord("wse_retry_0123456789abcdef", [
        groundingAttempt(400, { "x-goog-api-key": GOOGLE_KEY }, { tools: [{ parallelAiSearch: { api_key: PARALLEL_KEY } }] }),
        groundingAttempt(200, { "x-goog-api-key": GOOGLE_KEY }, { tools: [{ parallelAiSearch: { api_key: PARALLEL_KEY } }] }),
      ]);
      await writeStoredResponse(cacheDir, record, secrets);

      const read = await readStoredResponse(cacheDir, record.responseId);
      expect(read.primaryAttempts).toHaveLength(2);
      expect(read.primaryAttempts?.[0]?.rawResponse?.status).toBe(400);
      expect(read.primaryAttempts?.[1]?.rawResponse?.status).toBe(200);
      expect(read.primary.rawResponse?.status).toBe(200);

      const serialized = JSON.stringify(read);
      expect(serialized).not.toContain(GOOGLE_KEY);
      expect(serialized).not.toContain(PARALLEL_KEY);
      expect(serialized).not.toContain(EXA_KEY);
      expect(serialized).not.toContain(FIRECRAWL_KEY);
      for (const storedAttempt of read.primaryAttempts ?? []) {
        expect(storedAttempt.rawRequest?.headers["x-goog-api-key"]).toBe("[REDACTED_GOOGLE_CLOUD_API_KEY]");
        expect(JSON.stringify(storedAttempt.rawRequest?.body)).toContain("[REDACTED_PARALLEL_API_KEY]");
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("redacts Firecrawl bearer headers and nested Exa/Parallel copies in code-search records", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wse-storage-test-"));
    try {
      const record = storedCodeRecord("wse_code_0123456789abcdef");
      await writeStoredResponse(cacheDir, record, secrets);

      const serialized = await readFile(responsePath(cacheDir, record.responseId), "utf8");
      expect(serialized).not.toContain(FIRECRAWL_KEY);
      expect(serialized).not.toContain(EXA_KEY);
      expect(serialized).not.toContain(PARALLEL_KEY);
      expect(serialized).not.toContain(GOOGLE_KEY);
      const parsed = JSON.parse(serialized) as StoredCodeSearchResponse;
      expect(parsed.attempts[0].rawRequest?.headers.Authorization).toBe("Bearer [REDACTED_FIRECRAWL_API_KEY]");
      const body = JSON.stringify(parsed.attempts[0].rawRequest?.body);
      expect(body).toContain("[REDACTED_EXA_API_KEY]");
      expect(body).toContain("[REDACTED_PARALLEL_API_KEY]");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
