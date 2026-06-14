/**
 * Symbol search and disambiguation helpers for CodeGraph tools.
 *
 * This module combines exact name lookups with ranked CodeGraph search results,
 * deduplicates symbols, and applies optional file filters for caller/callee,
 * impact, and node symbol mode.
 */

import type { NodeKind, SearchResult } from "@colbymchenry/codegraph";
import { fileMatches, normalizeFileFilter } from "./source-files.ts";
import type { CodeGraphInstance } from "./types.ts";

function sortSearchResults(results: readonly SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => b.score - a.score || a.node.filePath.localeCompare(b.node.filePath) || a.node.startLine - b.node.startLine);
}

function uniqueNodes(results: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.node.id)) continue;
    seen.add(result.node.id);
    out.push(result);
  }
  return out;
}

/** Options for symbol search helper queries. */
export interface SearchMatchesOptions {
  /** Optional file path/suffix filter. */
  readonly file?: string;
  /** Maximum returned matches. */
  readonly limit?: number;
  /** Optional CodeGraph node-kind filters. */
  readonly kinds?: readonly NodeKind[];
}

/**
 * Find candidate definitions for a symbol using exact and ranked search.
 *
 * @param cg - Open CodeGraph instance.
 * @param symbol - Symbol text to find.
 * @param options - Optional file, limit, and node-kind filters.
 * @returns Deduplicated, score-sorted symbol matches.
 */
export function searchMatches(cg: CodeGraphInstance, symbol: string, options: SearchMatchesOptions = {}): SearchResult[] {
  const query = symbol.trim();
  const searchLimit = Math.max(options.limit ?? 10, 50);
  const exact = /^[\w$#:.<>-]+$/.test(query)
    ? cg.getNodesByName(query).map((node) => ({ node, score: 1 }))
    : [];
  const ranked = cg.searchNodes(query, { limit: searchLimit, kinds: options.kinds ? [...options.kinds] : undefined });
  let results = uniqueNodes(sortSearchResults([...exact, ...ranked]));
  if (options.file) {
    const filter = normalizeFileFilter(options.file)!;
    results = results.filter((result) => fileMatches(result.node.filePath, filter));
  }
  return results.slice(0, options.limit ?? 10);
}

/**
 * Format the standard no-symbol-matches message.
 *
 * @param symbol - Symbol text that did not match.
 * @param file - Optional file filter used in the search.
 * @returns User-facing no-match message.
 */
export function formatNoMatches(symbol: string, file?: string): string {
  const fileNote = file ? ` in file matching ${file}` : "";
  return `No CodeGraph symbols found for ${JSON.stringify(symbol)}${fileNote}. Try codegraph_search with a broader query.`;
}
