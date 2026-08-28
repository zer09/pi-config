import { formatGeminiGroundingMarkdown } from "./gemini-grounding-markdown.js";
import { MAX_TAVILY_RESULT_URL_CHARS } from "./limits.js";
import { redactString, type SecretForRedaction } from "./redact.js";
import { stripTerminalControlSequences } from "./terminal-sanitize.js";
import type {
  ContentCacheEntry,
  NormalizedGeminiGroundingResponse,
  NormalizedCodeSearchResult,
  NormalizedTavilySearchResponse,
} from "./types.js";

/** Deterministic cap for model-visible tool output shared by the content and code formatters. */
const MAX_TOOL_OUTPUT_CHARACTERS = 50_000;

/** Model-visible bound for one Tavily result title. */
const MAX_TAVILY_TITLE_CHARS = 500;
/** Model-visible bound for one Tavily result snippet. */
const MAX_TAVILY_SNIPPET_CHARS = 4_000;

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
 * Bounded model-visible text for a web_search call where no provider
 * produced a usable result. Provider-error diagnostics stay in private
 * details and stored records and never enter this output.
 */
export function formatWebSearchUnavailable(): string {
  return [
    "Web search could not produce usable results for this query.",
    "Retry the same query, or verify provider configuration and quota.",
  ].join(" ");
}

/** Truncates to exactly maxChars ending with the deterministic marker. */
function boundWithMarker(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const marker = `[truncated at ${maxChars} characters]`;
  return value.slice(0, maxChars - marker.length) + marker;
}

/** Redacts every configured secret, then strips terminal control sequences. */
function prepareTavilyString(value: string, secrets: SecretForRedaction[]): string {
  return stripTerminalControlSequences(redactString(value, secrets));
}

/**
 * Shared formatted representation of one retained Tavily result after
 * redaction sanitation. The delivered document and the safe details count
 * both derive from this shape, so text and count cannot diverge.
 */
export type TavilyFormattedResult = {
  title: string;
  url: string;
  snippet: string;
};

/**
 * Retained formatted Tavily results, in provider order, after redaction
 * sanitation.
 *
 * Every provider string is redacted, terminal-stripped, trimmed, and
 * whitespace-collapsed before it is bounded: titles at 500 characters,
 * snippets at 4000. URLs are never truncated; normalization already dropped
 * results with URLs over the bound, and any survivor whose URL redaction
 * expands past the bound is dropped here too. URL drops happen before any
 * display indexing, so callers can index the retained list contiguously.
 */
export function formatTavilyRetainedResults(
  normalized: NormalizedTavilySearchResponse,
  secrets: SecretForRedaction[],
): TavilyFormattedResult[] {
  const retained: TavilyFormattedResult[] = [];
  for (const result of normalized.results) {
    const url = prepareTavilyString(result.url, secrets).trim();
    // Drop, never truncate: a URL over the bound cannot be rendered whole.
    if (url.length === 0 || url.length > MAX_TAVILY_RESULT_URL_CHARS) continue;
    retained.push({
      url,
      title: boundWithMarker(
        prepareTavilyString(result.title, secrets).replace(/\s+/g, " ").trim(),
        MAX_TAVILY_TITLE_CHARS,
      ),
      snippet: boundWithMarker(
        prepareTavilyString(result.content, secrets).replace(/\s+/g, " ").trim(),
        MAX_TAVILY_SNIPPET_CHARS,
      ),
    });
  }
  return retained;
}

/** One rendered result block with its contiguous zero-based display index. */
function tavilyResultBlock(result: TavilyFormattedResult, displayIndex: number): string {
  return `### [${displayIndex}] ${result.title.length > 0 ? result.title : `Result ${displayIndex + 1}`}\nURL: ${result.url}\n${result.snippet}`;
}

/** The delivered degraded document plus the delivered result-block count. */
export type TavilyDeliveredDocument = {
  text: string;
  resultCount: number;
};

/**
 * Builds the delivered degraded source document from the retained results.
 *
 * Display indices are contiguous and zero-based over the retained blocks, so
 * a dropped URL never leaves an index gap, and a result without a title uses
 * the deterministic `Result N` label from that same display index. The
 * document is assembled from whole result blocks and capped at 50 000
 * characters with a deterministic truncation marker that fits, so a URL can
 * never be cut; `resultCount` counts exactly the blocks delivered here,
 * including whole-block total-cap truncation.
 */
export function formatTavilyDeliveredDocument(
  normalized: NormalizedTavilySearchResponse,
  secrets: SecretForRedaction[],
): TavilyDeliveredDocument {
  const blocks = formatTavilyRetainedResults(normalized, secrets).map((result, displayIndex) =>
    tavilyResultBlock(result, displayIndex),
  );

  const parts: string[] = ["## Search results"];
  let truncatedFrom = -1;
  for (const block of blocks) {
    const candidate = [...parts, block].join("\n\n");
    if (candidate.length > MAX_TOOL_OUTPUT_CHARACTERS) {
      truncatedFrom = parts.length - 1;
      break;
    }
    parts.push(block);
  }
  if (truncatedFrom === -1) return { text: parts.join("\n\n"), resultCount: blocks.length };

  // The marker must fit: drop whole trailing blocks until it does.
  const total = blocks.length;
  let marker = tavilyTruncationMarker(total - truncatedFrom, total);
  while (parts.length > 1 && parts.join("\n\n").length + 2 + marker.length > MAX_TOOL_OUTPUT_CHARACTERS) {
    parts.pop();
    truncatedFrom = parts.length - 1;
    marker = tavilyTruncationMarker(total - truncatedFrom, total);
  }
  return { text: `${parts.join("\n\n")}\n\n${marker}`, resultCount: parts.length - 1 };
}

/**
 * Renders the selected Tavily results as the degraded ordered source
 * document. No citations, answer, or error text is synthesized; the calling
 * model synthesizes and cites from the document.
 */
export function formatTavilySearchDocument(
  normalized: NormalizedTavilySearchResponse,
  secrets: SecretForRedaction[],
): string {
  return formatTavilyDeliveredDocument(normalized, secrets).text;
}

function tavilyTruncationMarker(omitted: number, total: number): string {
  return `[Output truncated at ${MAX_TOOL_OUTPUT_CHARACTERS} characters. ${omitted} of ${total} results omitted.]`;
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
