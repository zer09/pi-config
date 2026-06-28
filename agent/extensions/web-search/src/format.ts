import type { ContentCacheEntry, FallbackRoute, GroundingSource, NormalizedGeminiExaResponse } from "./types.js";

const MAX_SEGMENT_CHARACTERS = 800;
const MAX_FETCH_CONTENT_OUTPUT_CHARACTERS = 50_000;

function compactSegmentText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_SEGMENT_CHARACTERS) return compact;
  return `${compact.slice(0, MAX_SEGMENT_CHARACTERS - 1)}…`;
}

export function formatCleanGeminiSuccess(normalized: NormalizedGeminiExaResponse, responseId: string): string {
  const lines: string[] = [normalized.answer.trimEnd(), "", "## Source Grounding Supports (claim annotations)", ""];
  lines.push("These are grounded claims/spans from the answer. Each bracketed ID points to a source held in this response's grounding metadata.");
  lines.push(`Use the bracketed IDs with fetch_grounding({ responseId: "${responseId}", groundingIds: [ids...] }) to resolve URLs.`);
  lines.push("Use fetch_contents({ uris: [...] }) only if full page Markdown is needed.");
  lines.push("");

  if (normalized.supports.length === 0) {
    lines.push("No grounding support annotations were returned.");
  } else {
    normalized.supports.forEach((support) => {
      lines.push(`- [${support.groundingChunkIndices.join(", ")}] — "${compactSegmentText(support.text)}"`);
    });
  }

  lines.push("", "## Raw response ID", "", responseId);
  return lines.join("\n");
}

export function formatFallbackResult(answer: string, provider: FallbackRoute, reason: string, responseId: string): string {
  return [
    answer.trimEnd(),
    "",
    "## Source Grounding Supports (claim annotations)",
    "",
    "Unavailable for this fallback provider.",
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

function formatSource(source: GroundingSource): string {
  const title = source.title?.trim() || source.domain || source.url || "Untitled source";
  const url = source.url ? ` — ${source.url}` : "";
  const domain = source.domain ? ` (${source.domain})` : "";
  return `${source.groundingId}. ${title}${url}${domain}`;
}

export function formatGroundingSources(responseId: string, sources: GroundingSource[]): string {
  if (sources.length === 0) {
    return [
      `Grounding sources for response ${responseId}:`,
      "",
      "No matching grounding sources were found in the stored response.",
      "",
      "Use web_search again or check the groundingIds from Source Grounding Supports.",
    ].join("\n");
  }

  return [
    `Grounding sources for response ${responseId}:`,
    "",
    ...sources.map(formatSource),
    "",
    "Use fetch_contents({ uris: [...] }) to retrieve full page Markdown.",
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
