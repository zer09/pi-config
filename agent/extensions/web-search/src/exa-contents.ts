/**
 * Direct Exa /contents client.
 *
 * Exports the low-level content fetch call used by fetch_contents after cache
 * misses have been normalized and deduplicated.
 */
import { postJson } from "./http.js";
import type { RawHttpRequest, RawHttpResponse } from "./types.js";

/**
 * Calls Exa /contents for normalized URLs and captures the raw HTTP response.
 *
 * @param params - Normalized URLs, maximum characters per URL, Exa API key, and optional abort signal.
 * @returns The captured raw request and response for the Exa /contents call.
 * @throws Error when Exa /contents fails before a response or returns a non-2xx HTTP status.
 */
export async function callExaContents(params: {
  urls: string[];
  maxCharacters: number;
  exaApiKey: string;
  signal?: AbortSignal;
}): Promise<{ rawRequest: RawHttpRequest; rawResponse: RawHttpResponse }> {
  const raw = await postJson({
    url: "https://api.exa.ai/contents",
    headers: {
      "x-api-key": params.exaApiKey,
      "Content-Type": "application/json",
    },
    body: {
      urls: params.urls,
      text: {
        maxCharacters: params.maxCharacters,
      },
    },
    signal: params.signal,
  });
  const status = raw.rawResponse?.status;
  if (raw.error || !raw.rawResponse || !status || status < 200 || status >= 300) {
    throw new Error(`Exa /contents failed${status ? ` with HTTP ${status}` : ""}${raw.error ? `: ${raw.error}` : ""}`);
  }
  return { rawRequest: raw.rawRequest, rawResponse: raw.rawResponse };
}
