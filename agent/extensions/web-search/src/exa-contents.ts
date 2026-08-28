/**
 * Direct Exa /contents client.
 *
 * Exports the per-URL batch content fetch used by fetch_contents for URLs
 * whose Firecrawl Scrape attempt failed. Deprecated `context` and
 * `livecrawl` fields are not used; freshness is controlled with
 * `maxAgeHours`.
 */
import { postJson, type PostJsonResult } from "./http.js";

/**
 * Calls Exa /contents for normalized URLs and captures the raw HTTP exchange.
 *
 * The result is returned even for transport failures and non-2xx HTTP
 * statuses so the raw failure context stays available to the diagnostic
 * record builder; callers decide usability from `error` and `rawResponse`.
 *
 * @param params - Normalized URLs, maximum characters per URL, maximum cache age in hours, Exa API key, and optional abort signal.
 * @returns The captured request, response, and error for the Exa /contents call.
 */
export async function callExaContents(params: {
  urls: string[];
  maxCharacters: number;
  maxAgeHours: number;
  exaApiKey: string;
  signal?: AbortSignal;
}): Promise<PostJsonResult> {
  return postJson({
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
      maxAgeHours: params.maxAgeHours,
    },
    signal: params.signal,
  });
}
