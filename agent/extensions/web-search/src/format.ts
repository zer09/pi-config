import { formatGeminiExaMarkdown } from "./gemini-exa-markdown.js";
import type { ContentCacheEntry, FallbackRoute, NormalizedGeminiExaResponse } from "./types.js";

const MAX_FETCH_CONTENT_OUTPUT_CHARACTERS = 50_000;

/**
 * Formats a clean Gemini+Exa grounding result for tool output.
 *
 * @param normalized - Normalized Gemini response returned by the primary provider.
 * @param _responseId - Stored response identifier retained for API compatibility.
 * @returns Context-ready Markdown with inline citations and Sources.
 */
export function formatCleanGeminiSuccess(normalized: NormalizedGeminiExaResponse, _responseId: string): string {
  return formatGeminiExaMarkdown(normalized);
}

/**
 * Formats fallback provider output when Gemini+Exa grounding is unavailable.
 *
 * @param answer - Text produced by the selected fallback provider.
 * @param provider - Fallback provider that produced the answer.
 * @param reason - Reason the primary Gemini+Exa provider was bypassed or rejected.
 * @param responseId - Stored response identifier retained for diagnostics.
 * @returns Markdown containing the fallback answer and diagnostic metadata.
 */
export function formatFallbackResult(answer: string, provider: FallbackRoute, reason: string, responseId: string): string {
  return [
    answer.trimEnd(),
    "",
    "## Fallback",
    "",
    `Fallback: ${provider}`,
    `Fallback reason: ${reason}`,
    "",
    "## Raw response ID",
    "",
    responseId,
  ].join("\n");
}

export type FormattedContentEntry = ContentCacheEntry & {
  fromCache: boolean;
  statusLabel?: string;
};

export function formatFetchedContents(entries: FormattedContentEntry[]): string {
  const lines: string[] = ["Fetched full Markdown content:", ""];

  entries.forEach((entry, index) => {
    lines.push(`## ${index + 1}. ${entry.title?.trim() || entry.normalizedUrl}`);
    lines.push(`URL: ${entry.normalizedUrl}`);
    lines.push(`Source: ${entry.fromCache ? "disk cache" : "Exa /contents"}`);
    if (entry.statusLabel) lines.push(`Status: ${entry.statusLabel}`);
    lines.push("");
    lines.push(entry.text?.trimEnd() || "[No Markdown text returned]");
    if (index < entries.length - 1) lines.push("", "---", "");
  });

  const output = lines.join("\n");
  if (output.length <= MAX_FETCH_CONTENT_OUTPUT_CHARACTERS) return output;
  return `${output.slice(0, MAX_FETCH_CONTENT_OUTPUT_CHARACTERS)}\n\n[Output truncated at ${MAX_FETCH_CONTENT_OUTPUT_CHARACTERS} characters. The fetched content was still cached on disk; call fetch_contents with fewer uris or a smaller maxCharacters value if more focused context is needed.]`;
}
