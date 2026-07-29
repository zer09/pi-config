import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStoredResponse, responsePath, writeStoredResponse } from "../src/storage.js";
import type { PrimaryAttempt, StoredSearchResponse } from "../src/types.js";

const GOOGLE_KEY = "google-secret-key";
const EXA_KEY = "exa-secret-key";
const secrets = [
  { label: "GOOGLE_CLOUD_API_KEY", value: GOOGLE_KEY },
  { label: "EXA_API_KEY", value: EXA_KEY },
];

function attempt(status: number): PrimaryAttempt {
  return {
    provider: "gemini-exa-grounding",
    model: "gemini-3.5-flash",
    requestStartedAt: "2026-07-30T00:00:00.000Z",
    elapsedMs: 1200,
    rawRequest: {
      method: "POST",
      url: "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash:generateContent",
      headers: { "x-goog-api-key": GOOGLE_KEY },
      body: { tools: [{ exaAiSearch: { api_key: EXA_KEY } }] },
    },
    rawResponse: { status, statusText: "", headers: {}, bodyText: `status ${status}` },
  };
}

function storedRecord(responseId: string, attempts: PrimaryAttempt[]): StoredSearchResponse {
  const primary = attempts[attempts.length - 1]!;
  return {
    responseId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    provider: "gemini-exa-grounding",
    model: primary.model,
    query: "Does gemini-3.5-flash support Exa grounding?",
    request: primary.rawRequest,
    response: primary.rawResponse,
    primary,
    primaryAttempts: attempts.length > 1 ? attempts : undefined,
    normalized: null,
    fallback: null,
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
      const record = storedRecord("wse_legacy_0123456789abcdef", [attempt(200)]);
      await writeStoredResponse(cacheDir, record, secrets);

      expect(await readFile(responsePath(cacheDir, record.responseId), "utf8")).not.toContain("primaryAttempts");

      const read = await readStoredResponse(cacheDir, record.responseId);
      expect(read.primaryAttempts).toBeUndefined();
      expect(read.primary.rawResponse?.status).toBe(200);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("round-trips two attempts and redacts secrets in each of them", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wse-storage-test-"));
    try {
      const record = storedRecord("wse_retry_0123456789abcdef", [attempt(400), attempt(200)]);
      await writeStoredResponse(cacheDir, record, secrets);

      const read = await readStoredResponse(cacheDir, record.responseId);
      expect(read.primaryAttempts).toHaveLength(2);
      expect(read.primaryAttempts?.[0]?.rawResponse?.status).toBe(400);
      expect(read.primaryAttempts?.[1]?.rawResponse?.status).toBe(200);
      expect(read.primary.rawResponse?.status).toBe(200);

      const serialized = JSON.stringify(read);
      expect(serialized).not.toContain(GOOGLE_KEY);
      expect(serialized).not.toContain(EXA_KEY);
      for (const storedAttempt of read.primaryAttempts ?? []) {
        expect(storedAttempt.rawRequest?.headers["x-goog-api-key"]).toBe("[REDACTED_GOOGLE_CLOUD_API_KEY]");
        expect(JSON.stringify(storedAttempt.rawRequest?.body)).toContain("[REDACTED_EXA_API_KEY]");
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
