import { formatGeminiGroundingMarkdown } from "./gemini-grounding-markdown.js";
import type {
  ContentCacheEntry,
  NormalizedGeminiGroundingResponse,
  NormalizedCodeSearchResult,
} from "./types.js";

/** Deterministic cap for model-visible tool output shared by the content and code formatters. */
const MAX_TOOL_OUTPUT_CHARACTERS = 50_000;

/**
 * Formats a clean Gemini grounding result (either partner) for tool output.
 *
 * @param normalized - Normalized Gemini response returned by the selected grounding partner.
 * @param _responseId - Stored response identifier retained for API compatibility.
 * @returns Context-ready Markdown with inline citations and Sources.
 */
export function formatCleanGeminiSuccess(normalized: NormalizedGeminiGroundingResponse, _responseId: string): string {
  return formatGeminiGroundingMarkdown(normalized);
}

/**
 * Bounded model-visible text for a web_search call where no grounding partner
 * produced a usable answer. Provider-error diagnostics stay in private
 * details and stored records and never enter this output.
 */
export function formatWebSearchUnavailable(): string {
  return [
    "Web search could not produce a grounded answer for this query.",
    "Retry the same query, or verify provider configuration and quota.",
  ].join(" ");
}

/**
 * Bounded model-visible text for a web_code_search call where no provider
 * produced usable results. Provider-error diagnostics stay in private
 * details and stored records and never enter this output.
 */
export function formatCodeSearchUnavailable(): string {
  return [
    "Code search could not produce results for this query.",
    "Retry the same query, or verify provider configuration and quota.",
  ].join(" ");
}

function isFirecrawlDeveloperResult(
  normalized: NormalizedCodeSearchResult,
): normalized is Extract<NormalizedCodeSearchResult, { artifacts: unknown[] }> {
  return "artifacts" in normalized;
}

/**
 * Formats a web_code_search result for tool output.
 *
 * Firecrawl Developer output preserves ranked primary-source artifacts with
 * type, title or URL fallback, URL, and matched Markdown passages. Exa Code
 * output is the provider's implementation-ready code-context document. Both
 * forms are capped at 50 000 characters with a deterministic truncation
 * marker; provider selection and details are unaffected.
 */
export function formatCodeSearchResult(query: string, normalized: NormalizedCodeSearchResult): string {
  const output = formatCodeSearchResultUnbounded(query, normalized);
  const marker = `\n\n[Output truncated at ${MAX_TOOL_OUTPUT_CHARACTERS} characters. Narrow the query or focus for more specific results.]`;
  if (output.length <= MAX_TOOL_OUTPUT_CHARACTERS) return output;
  return `${output.slice(0, MAX_TOOL_OUTPUT_CHARACTERS - marker.length)}${marker}`;
}

function formatCodeSearchResultUnbounded(query: string, normalized: NormalizedCodeSearchResult): string {
  if (isFirecrawlDeveloperResult(normalized)) {
    const lines: string[] = [`Developer sources for: ${query}`, ""];
    normalized.artifacts.forEach((artifact, index) => {
      const title = artifact.title?.trim() || artifact.url || `Result ${index + 1}`;
      const type = artifact.type ?? "source";
      lines.push(`${index + 1}. [${type}] ${title}`);
      if (artifact.url) lines.push(`   URL: ${artifact.url}`);
      if (artifact.passages.length > 0) {
        lines.push("   Passages:");
        for (const passage of artifact.passages) {
          lines.push(`   - ${passage.replace(/\s+/g, " ").trim()}`);
        }
      }
    });
    return lines.join("\n");
  }

  return normalized.response.trimEnd();
}

export type FormattedContentEntry = ContentCacheEntry & {
  fromCache: boolean;
  statusLabel?: string;
};

const PROVIDER_SOURCE_LABELS: Record<string, string> = {
  firecrawl_scrape: "Firecrawl /scrape",
  exa_contents: "Exa /contents",
};

/**
 * Formats fetched content entries for tool output, preserving input order and
 * bounded total output.
 */
export function formatFetchedContents(entries: FormattedContentEntry[]): string {
  const lines: string[] = ["Fetched full Markdown content:", ""];

  entries.forEach((entry, index) => {
    const providerLabel = entry.provider ? PROVIDER_SOURCE_LABELS[entry.provider] ?? entry.provider : undefined;
    lines.push(`## ${index + 1}. ${entry.title?.trim() || entry.normalizedUrl}`);
    lines.push(`URL: ${entry.normalizedUrl}`);
    lines.push(`Source: ${entry.fromCache ? "disk cache" : providerLabel ?? "provider"}`);
    if (entry.statusLabel) lines.push(`Status: ${entry.statusLabel}`);
    lines.push("");
    lines.push(entry.text?.trimEnd() || "[No Markdown text returned]");
    if (index < entries.length - 1) lines.push("", "---", "");
  });

  const output = lines.join("\n");
  if (output.length <= MAX_TOOL_OUTPUT_CHARACTERS) return output;
  return `${output.slice(0, MAX_TOOL_OUTPUT_CHARACTERS)}\n\n[Output truncated at ${MAX_TOOL_OUTPUT_CHARACTERS} characters. The fetched content was still cached on disk; call fetch_contents with fewer uris or a smaller maxCharacters value if more focused context is needed.]`;
}
