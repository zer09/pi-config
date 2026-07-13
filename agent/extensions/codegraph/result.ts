/**
 * Tool result and output truncation helpers for the CodeGraph Pi extension.
 *
 * Tool modules use these helpers to keep response truncation behavior identical
 * across all CodeGraph tools and to attach structured truncation diagnostics.
 */

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "./constants.ts";
import { scanMarkdownFences } from "./markdown-fences.ts";
import type { ToolResult, TruncationResult } from "./types.ts";

/**
 * Format a byte count with the compact units used in tool descriptions.
 *
 * @param bytes - Number of bytes to format.
 * @returns Human-readable size such as `512B`, `12KB`, or `1.5MB`.
 *
 * @example
 * ```ts
 * formatSize(1536); // "1.5KB"
 * ```
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) {
    const value = (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace(/\.0$/, "");
    return `${value}KB`;
  }
  const value = (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace(/\.0$/, "");
  return `${value}MB`;
}

/**
 * Truncate output from the head while respecting byte and line limits.
 *
 * @param content - Full text content.
 * @param options - Maximum bytes and maximum lines to preserve.
 * @returns Truncated content plus before/after counters.
 *
 * @example
 * ```ts
 * const truncated = truncateHead(markdown, { maxBytes: 1024, maxLines: 100 });
 * ```
 */
function logicalLineCount(value: string): number {
  if (!value) return 0;

  let lines = 1;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\n") lines++;
    else if (character === "\r" && value[index + 1] !== "\n") lines++;
  }
  return lines;
}

function truncateLogicalPrefix(
  content: string,
  options: { readonly maxBytes: number; readonly maxLines: number },
): string {
  if (!content || options.maxBytes <= 0 || options.maxLines <= 0) return "";

  let bytes = 0;
  let lines = 1;
  let end = 0;
  for (const character of content) {
    const isLineEnding =
      character === "\n" ||
      (character === "\r" && content[end + 1] !== "\n");
    if (isLineEnding && lines >= options.maxLines) break;

    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > options.maxBytes) break;
    bytes += characterBytes;
    end += character.length;
    if (isLineEnding) lines++;
  }
  return content.slice(0, end);
}

function retainedLineCount(retained: string, original: string): number {
  let lines = logicalLineCount(retained);
  // The existing head contract can retain CR while omitting the LF that follows
  // it. Count that split CRLF as the final shown line, not as an empty new line.
  if (retained.endsWith("\r") && original[retained.length] === "\n") lines--;
  return lines;
}

export function truncateHead(content: string, options: { readonly maxBytes: number; readonly maxLines: number }): TruncationResult {
  const totalBytes = Buffer.byteLength(content, "utf8");
  const totalLines = logicalLineCount(content);
  if (totalBytes <= options.maxBytes && totalLines <= options.maxLines) {
    return { content, truncated: false, totalLines, outputLines: totalLines, totalBytes, outputBytes: totalBytes };
  }

  const truncated = truncateLogicalPrefix(content, options);
  return {
    content: truncated,
    truncated: true,
    totalLines,
    outputLines: retainedLineCount(truncated, content),
    totalBytes,
    outputBytes: Buffer.byteLength(truncated, "utf8"),
  };
}

const MAX_FENCE_CLOSURE_LENGTH = 1024;

interface ProtectedMarkdown {
  readonly retained: string;
  readonly body: string;
}

function protectTruncatedMarkdown(content: string): ProtectedMarkdown {
  const activeFence = scanMarkdownFences(content).activeFence;
  if (!activeFence) return { retained: content, body: content };

  // A delimiter can occupy almost the entire byte budget. Rather than double
  // model-visible output, omit that active block and keep Pi's notice outside it.
  if (activeFence.length > MAX_FENCE_CLOSURE_LENGTH) {
    const retained = content.slice(0, activeFence.openingStart);
    return { retained, body: retained };
  }

  const closingFence = activeFence.character.repeat(activeFence.length);
  if (content.endsWith("\n")) return { retained: content, body: `${content}${closingFence}` };
  if (content.endsWith("\r")) return { retained: content, body: `${content}\n${closingFence}` };
  return {
    retained: content,
    body: `${content}${activeFence.openingEol || "\n"}${closingFence}`,
  };
}

/**
 * Build a Pi text result with standard CodeGraph output truncation.
 *
 * @param content - Markdown/text response body.
 * @param details - Additional structured details for Pi diagnostics.
 * @returns A Pi-compatible text tool result.
 *
 * @example
 * ```ts
 * return textResult("No symbols found.", { count: 0 });
 * ```
 */
export function textResult(content: string, details: Record<string, unknown> = {}): ToolResult {
  let truncation = truncateHead(content, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  let body = truncation.content;
  if (truncation.truncated) {
    const protectedMarkdown = protectTruncatedMarkdown(body);
    body = protectedMarkdown.body;
    if (protectedMarkdown.retained !== truncation.content) {
      truncation = {
        ...truncation,
        content: protectedMarkdown.retained,
        outputLines: logicalLineCount(protectedMarkdown.retained),
        outputBytes: Buffer.byteLength(protectedMarkdown.retained, "utf8"),
      };
    }
    body += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
    body += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
    body += ` Reduce the query/limit or use a narrower codegraph_node/codegraph_search call.]`;
  }
  return {
    content: [{ type: "text", text: body }],
    details: { ...details, truncation },
  };
}
