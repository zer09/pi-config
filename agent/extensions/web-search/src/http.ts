/**
 * Shared HTTP transport for the web-search extension.
 *
 * Exports the POST/JSON helper used by provider-specific clients while
 * preserving raw request/response snapshots for storage and diagnostics.
 */
import type { RawHttpRequest, RawHttpResponse } from "./types.js";

/** Parameters for issuing a JSON POST request and capturing its raw shape. */
export type PostJsonParams = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
};

/** Captured result of a JSON POST request, including transport failures. */
export type PostJsonResult = {
  requestStartedAt: string;
  elapsedMs: number;
  rawRequest: RawHttpRequest;
  rawResponse?: RawHttpResponse;
  error?: string;
};

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function parseJsonMaybe(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Sends a JSON POST request and records request/response metadata.
 *
 * @param params - URL, headers, body, and optional abort signal for the request.
 * @returns The captured HTTP exchange, or an error string when fetch fails before a response.
 */
export async function postJson(params: PostJsonParams): Promise<PostJsonResult> {
  const startedMs = Date.now();
  const requestStartedAt = new Date(startedMs).toISOString();
  const rawRequest: RawHttpRequest = {
    method: "POST",
    url: params.url,
    headers: params.headers,
    body: params.body,
  };

  try {
    const response = await fetch(params.url, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(params.body),
      signal: params.signal,
    });
    const bodyText = await response.text();
    return {
      requestStartedAt,
      elapsedMs: Date.now() - startedMs,
      rawRequest,
      rawResponse: {
        status: response.status,
        statusText: response.statusText,
        headers: headersToRecord(response.headers),
        bodyText,
        bodyJson: parseJsonMaybe(bodyText),
      },
    };
  } catch (error) {
    return {
      requestStartedAt,
      elapsedMs: Date.now() - startedMs,
      rawRequest,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
