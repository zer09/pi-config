/**
 * Tool result and output truncation helpers for the CodeGraph Pi extension.
 *
 * Tool modules use these helpers to keep response truncation behavior identical
 * across all CodeGraph tools and to attach structured truncation diagnostics.
 */

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "./constants.ts";
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
function utf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";

  let bytes = 0;
  let end = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    end += char.length;
  }
  return value.slice(0, end);
}

export function truncateHead(content: string, options: { readonly maxBytes: number; readonly maxLines: number }): TruncationResult {
  const totalBytes = Buffer.byteLength(content, "utf8");
  const totalLines = content.length === 0 ? 0 : content.split("\n").length;
  if (totalBytes <= options.maxBytes && totalLines <= options.maxLines) {
    return { content, truncated: false, totalLines, outputLines: totalLines, totalBytes, outputBytes: totalBytes };
  }

  const lines = content.split("\n");
  const output: string[] = [];
  let outputBytes = 0;
  for (const line of lines) {
    if (output.length >= options.maxLines) break;
    const prefix = output.length === 0 ? "" : "\n";
    const chunk = `${prefix}${line}`;
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    if (outputBytes + chunkBytes > options.maxBytes) {
      const remaining = Math.max(0, options.maxBytes - outputBytes);
      const partial = utf8Prefix(chunk, remaining);
      if (partial) output.push(partial);
      break;
    }
    output.push(chunk);
    outputBytes += chunkBytes;
  }
  const truncated = output.join("");
  const finalBytes = Buffer.byteLength(truncated, "utf8");
  const outputLines = truncated.length === 0 ? 0 : truncated.split("\n").length;
  return { content: truncated, truncated: true, totalLines, outputLines, totalBytes, outputBytes: finalBytes };
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
  const truncation = truncateHead(content, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  let body = truncation.content;
  if (truncation.truncated) {
    body += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
    body += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
    body += ` Reduce the query/limit or use a narrower codegraph_node/codegraph_search call.]`;
  }
  return {
    content: [{ type: "text", text: body }],
    details: { ...details, truncation },
  };
}
