/**
 * Shared deterministic test helpers for the web-search extension.
 *
 * All provider HTTP calls go through a stubbed global fetch, every cache uses
 * a temporary directory, and environment variables use test-only names so no
 * real credential can be read or written.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { SearchConfig } from "../src/types.js";

/**
 * Asserts that no partial prefix (4 or more characters) of the secret value
 * survives in the text. Bounding a string before redacting it would leave
 * exactly such fragments when a secret crosses a truncation cutoff.
 */
export function expectNoSecretFragments(text: string, secret: string): void {
  for (let length = secret.length - 1; length >= 4; length -= 1) {
    expect(text).not.toContain(secret.slice(0, length));
  }
}

export type FetchCall = { url: string; body: any; headers: Record<string, string> };

const originalFetch = globalThis.fetch;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type FetchHandler = Response[] | ((call: FetchCall, index: number) => Response | Promise<Response>);

/**
 * Stubs globalThis.fetch, recording every call's URL, parsed JSON body, and
 * headers. Returns the call log and a restore function; tests must call
 * restore after each case.
 */
export function mockFetch(handler: FetchHandler): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  let index = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    // Read headers from the plain object so the original casing used by the
    // provider clients is preserved in the call log.
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
      for (const [key, value] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[key] = value;
      }
    }
    const rawBody = typeof init?.body === "string" ? init.body : "";
    const call: FetchCall = { url: String(input), body: rawBody ? JSON.parse(rawBody) : undefined, headers };
    calls.push(call);
    const response = typeof handler === "function" ? await handler(call, index) : handler[index];
    index += 1;
    if (!response) throw new Error(`unexpected fetch call ${index}: ${call.url}`);
    return response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

export async function tempCacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wse-test-"));
}

/** Test-only environment-variable names; never the real provider names. */
export const TEST_ENV_NAMES = {
  googleCloudApiKeyEnv: "WSE_TEST_GOOGLE_KEY",
  parallelApiKeyEnv: "WSE_TEST_PARALLEL_KEY",
  exaApiKeyEnv: "WSE_TEST_EXA_KEY",
  firecrawlApiKeyEnv: "WSE_TEST_FIRECRAWL_KEY",
} as const;

export const TEST_KEYS = {
  google: "test-google-key",
  parallel: "test-parallel-key",
  exa: "test-exa-key",
  firecrawl: "test-firecrawl-key",
} as const;

export function setTestEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

export function clearTestEnv(): void {
  setTestEnv({
    [TEST_ENV_NAMES.googleCloudApiKeyEnv]: undefined,
    [TEST_ENV_NAMES.parallelApiKeyEnv]: undefined,
    [TEST_ENV_NAMES.exaApiKeyEnv]: undefined,
    [TEST_ENV_NAMES.firecrawlApiKeyEnv]: undefined,
  });
}

export function testConfig(overrides: Partial<SearchConfig> = {}): SearchConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...TEST_ENV_NAMES,
    ...overrides,
  };
}

export function testConfigWithCache(cacheDir: string, overrides: Partial<SearchConfig> = {}): SearchConfig {
  return testConfig({ cacheDir, ...overrides });
}

/** A clean Gemini grounding success body usable for either partner. */
export function cleanGroundingBody(answer = "Grounded answer."): unknown {
  return {
    responseId: "google-response-1",
    modelVersion: "gemini-3.5-flash",
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: answer }] },
        groundingMetadata: {
          webSearchQueries: ["test query"],
          groundingChunks: [{ web: { title: "Docs", uri: "https://example.com/docs" } }],
          groundingSupports: [{ segment: { text: answer, endIndex: answer.length }, groundingChunkIndices: [0] }],
        },
      },
    ],
  };
}

export function googleErrorBody(message: string, status = 400, label = "INVALID_ARGUMENT"): unknown {
  return { error: { code: status, message, status: label } };
}

export const EXA_EMPTY_QUERY_MESSAGE =
  'Exa AI API returned bad request error. Please check your request. {"requestId":"abc","error":"Invalid request body | Validation error: Too small: expected string to have >=1 characters at \\"query\\"","tag":"INVALID_REQUEST_BODY"}';
