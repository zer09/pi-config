/**
 * Indexed source-file lookup and source rendering helpers.
 *
 * The node tool uses this module to resolve user-provided file filters against
 * CodeGraph's indexed file records and to render line-numbered source snippets.
 */

import path from "node:path";
import type { FileRecord, Node } from "@colbymchenry/codegraph";
import { formatNodeLine } from "./node-format.ts";
import { normalizeSlashes, stripAtPath } from "./paths.ts";
import type { CodeGraphInstance } from "./types.ts";

/**
 * Normalize an optional file filter for CodeGraph record matching.
 *
 * @param file - User-provided file path or suffix.
 * @returns Normalized filter, or undefined when empty.
 */
export function normalizeFileFilter(file: string | undefined): string | undefined {
  if (!file?.trim()) return undefined;
  return normalizeSlashes(stripAtPath(file.trim())).replace(/^(?:\.\/)+/, "");
}

/**
 * Check whether an indexed file path matches a user filter.
 *
 * @param filePath - Indexed file path from CodeGraph.
 * @param filter - Normalized or raw user filter.
 * @returns True for exact, suffix, or basename matches.
 */
export function fileMatches(filePath: string, filter: string): boolean {
  const file = normalizeSlashes(filePath);
  const wanted = normalizeSlashes(filter).replace(/^(?:\.\/)+/, "");
  return file === wanted || file.endsWith(`/${wanted}`) || path.posix.basename(file) === wanted;
}

/**
 * Format choices when a file filter matches multiple indexed files.
 *
 * @param files - Matching indexed file records.
 * @param query - Original user query.
 * @returns Markdown prompt asking for a more specific file path.
 */
export function formatFileChoices(files: readonly FileRecord[], query: string): string {
  const lines = [`Multiple indexed files match ${JSON.stringify(query)}. Pass a more specific file path:`, ""];
  for (const file of files.slice(0, 50)) {
    lines.push(`- ${file.path} (${file.language}, ${file.nodeCount} symbols)`);
  }
  if (files.length > 50) lines.push(`- ... ${files.length - 50} more`);
  return lines.join("\n");
}

/**
 * Find indexed files matching a user file filter.
 *
 * @param cg - Open CodeGraph instance.
 * @param file - User file path, suffix, or basename.
 * @returns Matching file records sorted by specificity for suffix matches.
 */
export function findIndexedFiles(cg: CodeGraphInstance, file: string): FileRecord[] {
  const filter = normalizeFileFilter(file);
  if (!filter) return [];
  const files = cg.getFiles();
  const exact = files.filter((record) => normalizeSlashes(record.path) === filter);
  if (exact.length) return exact;
  const suffix = files.filter((record) => fileMatches(record.path, filter));
  return suffix.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
}

/** Result of rendering a source line range with line numbers. */
export interface LineNumberedSource {
  /** Rendered source lines prefixed with line numbers. */
  readonly text: string;
  /** First shown 1-indexed line. */
  readonly shownStart: number;
  /** Last shown 1-indexed line. */
  readonly shownEnd: number;
  /** Total source line count. */
  readonly total: number;
}

/**
 * Render source text with 1-indexed line numbers and optional range limiting.
 *
 * @param content - Full source file content.
 * @param offset - Optional 1-indexed starting line.
 * @param limit - Optional number of lines to show.
 * @returns Rendered line range and counters.
 */
export function lineNumbered(content: string, offset?: number, limit?: number): LineNumberedSource {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const rawStart = typeof offset === "number" && Number.isFinite(offset) ? Math.floor(offset) : 1;
  const start = Math.max(1, rawStart);
  const rawLimit = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : undefined;
  const count = rawLimit !== undefined ? Math.max(1, rawLimit) : lines.length;
  const end = Math.min(lines.length, start + count - 1);
  const selected = lines.slice(start - 1, end).map((line, index) => `${start + index}\t${line}`).join("\n");
  return { text: selected, shownStart: start, shownEnd: end, total: lines.length };
}

/**
 * Format all indexed symbols in one file as a markdown outline.
 *
 * @param nodes - Nodes indexed in a file.
 * @returns Markdown outline, or an empty-state message.
 */
export function formatSymbolOutline(nodes: readonly Node[]): string {
  if (nodes.length === 0) return "No symbols indexed in this file.";
  return [...nodes]
    .sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name))
    .map((node) => formatNodeLine(node))
    .join("\n");
}
