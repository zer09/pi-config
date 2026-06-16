/**
 * Registration for the `codegraph_files` Pi tool.
 *
 * The tool lists CodeGraph-indexed source files from file metadata only. It is
 * for file discovery and index inspection; it deliberately does not read source
 * contents, leaving exact source reads to `codegraph_node`.
 */

import path from "node:path";
import type { FileRecord } from "@colbymchenry/codegraph";
import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { expandHome, isPathInside, normalizeSlashes, stripAtPath } from "../paths.ts";
import { formatSize, textResult } from "../result.ts";
import { createStringEnumSchema, ProjectPathSchema } from "../tool-parameters.ts";
import type { ExtensionAPI, ExtensionContext, FilesFormat, FilesToolParams, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";

const FILES_FORMAT_VALUES = ["tree", "flat", "grouped"] as const;
const MAX_FILES_LIMIT = 500;
const OFFSET_ONLY_PAGE_SIZE = 100;

interface NormalizedFilters {
  readonly pathInput?: string;
  readonly pathFilter: string;
  readonly pattern?: string;
  readonly patternRegex?: RegExp;
  readonly query?: string;
  readonly language?: string;
  readonly errorsOnly: boolean;
}

interface FilePage {
  readonly files: readonly FileRecord[];
  readonly offset: number;
  readonly limit?: number;
  readonly offsetOnlyDefault: boolean;
}

/**
 * Register the codegraph_files tool with Pi.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 */
export function registerFilesTool(pi: ExtensionAPI, manager: GraphManager): void {
  const tool: ToolDefinition<FilesToolParams> = {
    name: "codegraph_files",
    label: "CodeGraph Files",
    description: `List indexed source files from CodeGraph without reading contents. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "List indexed source files with CodeGraph",
    promptGuidelines: [
      "Use codegraph_files to discover indexed source files, verify whether a source file is indexed, or browse files by path/language/error state.",
      "Use codegraph_files instead of raw find/rg --files only when the question is specifically about CodeGraph-indexed source files.",
      "Do not use codegraph_files to read contents; use codegraph_node for one indexed source file/symbol and raw read for docs/configs/unindexed files.",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Filter to indexed files under this directory/file path, e.g. \"src/components\". Root-ish values such as /, ., and ./ list all indexed files." })),
      pattern: Type.Optional(Type.String({ description: "Glob pattern matched against indexed file paths, e.g. \"*.tsx\" or \"**/*.test.ts\"." })),
      format: Type.Optional(createStringEnumSchema(FILES_FORMAT_VALUES, { description: "Output format: tree, flat, or grouped. Defaults to tree.", default: "tree" })),
      includeMetadata: Type.Optional(Type.Boolean({ description: "Include compact language, symbol, and error-count metadata. Defaults to true.", default: true })),
      maxDepth: Type.Optional(Type.Integer({ description: "Maximum directory depth to show in tree format. Defaults to unlimited.", minimum: 1, maximum: 20 })),
      query: Type.Optional(Type.String({ description: "Case-insensitive substring filter matched against indexed file paths." })),
      language: Type.Optional(Type.String({ description: "Exact language filter, case-insensitive, e.g. \"typescript\"." })),
      errorsOnly: Type.Optional(Type.Boolean({ description: "Only include files with extraction errors.", default: false })),
      includeStats: Type.Optional(Type.Boolean({ description: "Include size, modifiedAt, indexedAt, and error-count stats.", default: false })),
      limit: Type.Optional(Type.Integer({ description: `Maximum files to render after filtering/sorting. Omit for all matches; max ${MAX_FILES_LIMIT}.`, minimum: 1, maximum: MAX_FILES_LIMIT })),
      offset: Type.Optional(Type.Integer({ description: "Number of matching files to skip before rendering. Defaults to 0.", minimum: 0 })),
      projectPath: ProjectPathSchema,
    }),
    async execute(
      _toolCallId: string,
      params: FilesToolParams,
      signal: AbortSignal | undefined,
      onUpdate: ToolUpdateHandler | undefined,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });

      const allFiles = graph.cg.getFiles();
      const filters = normalizeFilters(params, graph.root);
      const format = coerceFormat(params.format);
      const includeMetadata = params.includeMetadata !== false;
      const includeStats = params.includeStats === true;
      const maxDepth = coerceMaxDepth(params.maxDepth);
      const matchedFiles = allFiles
        .filter((file) => matchesFilters(file, filters))
        .sort(compareFilePath);
      const page = paginateFiles(matchedFiles, params);
      const output = renderFilesOutput({
        root: graph.root,
        total: allFiles.length,
        matched: matchedFiles.length,
        page,
        format,
        includeMetadata,
        includeStats,
        maxDepth,
        filters,
      });

      return textResult(manager.withWarningPrefix(graph, output), {
        root: graph.root,
        total: allFiles.length,
        matched: matchedFiles.length,
        shown: page.files.length,
        offset: page.offset,
        limit: page.limit,
        filters: detailsFilters(filters),
        format,
        snapshot: graph.snapshot,
      });
    },
  };

  pi.registerTool(tool);
}

function normalizeFilters(params: FilesToolParams, root: string): NormalizedFilters {
  const pattern = params.pattern?.trim() ? normalizeSlashes(params.pattern.trim()) : undefined;
  const query = normalizeQuery(params.query);
  const language = params.language?.trim().toLowerCase() || undefined;
  const pathInput = params.path?.trim() || undefined;
  return {
    pathInput,
    pathFilter: normalizeFilesPathFilter(pathInput, root),
    pattern,
    patternRegex: pattern ? globToRegex(pattern) : undefined,
    query,
    language,
    errorsOnly: params.errorsOnly === true,
  };
}

function normalizeQuery(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return normalizeSlashes(stripAtPath(value.trim())).toLowerCase();
}

function normalizeFilesPathFilter(value: string | undefined, root: string): string {
  const stripped = stripAtPath(value?.trim() || "");
  if (isRootishPath(stripped)) return "";

  let raw = expandHome(stripped);
  if (path.isAbsolute(raw)) {
    const absolute = path.resolve(raw);
    if (isPathInside(root, absolute)) {
      raw = path.relative(root, absolute);
    }
  }

  let normalized = normalizeSlashes(raw.trim());
  if (isRootishPath(normalized)) return "";
  normalized = normalized
    .replace(/^(?:\.?\/+)+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function isRootishPath(value: string): boolean {
  const normalized = normalizeSlashes(value.trim());
  return normalized === "" || normalized === "." || /^\.?\/+$/u.test(normalized);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(escaped);
}

function matchesFilters(file: FileRecord, filters: NormalizedFilters): boolean {
  const filePath = normalizeSlashes(file.path);
  if (filters.pathFilter && !fileUnderPath(filePath, filters.pathFilter)) return false;
  if (filters.patternRegex && !filters.patternRegex.test(filePath)) return false;
  if (filters.query && !filePath.toLowerCase().includes(filters.query)) return false;
  if (filters.language && String(file.language).toLowerCase() !== filters.language) return false;
  if (filters.errorsOnly && errorCount(file) === 0) return false;
  return true;
}

function fileUnderPath(filePath: string, filter: string): boolean {
  return filePath === filter || filePath.startsWith(`${filter}/`);
}

function compareFilePath(a: FileRecord, b: FileRecord): number {
  return a.path.localeCompare(b.path);
}

function coerceFormat(format: FilesToolParams["format"]): FilesFormat {
  return FILES_FORMAT_VALUES.includes(format as FilesFormat) ? (format as FilesFormat) : "tree";
}

function coerceMaxDepth(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function paginateFiles(files: readonly FileRecord[], params: FilesToolParams): FilePage {
  const offset = coerceOffset(params.offset);
  let limit = coerceOptionalLimit(params.limit);
  let offsetOnlyDefault = false;
  if (limit === undefined && offset > 0) {
    limit = OFFSET_ONLY_PAGE_SIZE;
    offsetOnlyDefault = true;
  }
  const pageFiles = limit === undefined ? files.slice(offset) : files.slice(offset, offset + limit);
  return { files: pageFiles, offset, limit, offsetOnlyDefault };
}

function coerceOffset(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, n);
}

function coerceOptionalLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(MAX_FILES_LIMIT, Math.floor(value)));
}

function renderFilesOutput(options: {
  readonly root: string;
  readonly total: number;
  readonly matched: number;
  readonly page: FilePage;
  readonly format: FilesFormat;
  readonly includeMetadata: boolean;
  readonly includeStats: boolean;
  readonly maxDepth?: number;
  readonly filters: NormalizedFilters;
}): string {
  const lines = formatHeader(options);

  if (options.total === 0) {
    lines.push("", "No files indexed. Run CodeGraph indexing first, or use codegraph_status to inspect index state.");
    return lines.join("\n");
  }

  if (options.matched === 0) {
    lines.push("", "No indexed files match the provided filters.");
    return lines.join("\n");
  }

  if (options.page.files.length === 0) {
    lines.push("", `No files on this page. Matched ${options.matched} files, but offset is ${options.page.offset}.`);
    lines.push(...formatPaginationFooter(options.page, options.matched));
    return lines.join("\n");
  }

  lines.push("");
  switch (options.format) {
    case "flat":
      lines.push(...formatFilesFlat(options.page.files, options.includeMetadata, options.includeStats));
      break;
    case "grouped":
      lines.push(...formatFilesGrouped(options.page.files, options.includeMetadata, options.includeStats));
      break;
    case "tree":
    default:
      lines.push(...formatFilesTree(options.page.files, options.includeMetadata, options.includeStats, options.maxDepth));
      break;
  }
  lines.push(...formatPaginationFooter(options.page, options.matched));
  return lines.join("\n");
}

function formatHeader(options: {
  readonly root: string;
  readonly total: number;
  readonly matched: number;
  readonly page: FilePage;
  readonly format: FilesFormat;
  readonly filters: NormalizedFilters;
}): string[] {
  const shown = options.page.files.length;
  const showing = shown > 0 ? `${options.page.offset + 1}-${options.page.offset + shown}` : "0";
  const lines = [
    "# Indexed files",
    "",
    `- root: ${options.root}`,
    `- total indexed files: ${options.total}`,
    `- matched files: ${options.matched}`,
    `- showing: ${showing}`,
    `- format: ${options.format}`,
  ];
  const filters = formatActiveFilters(options.filters);
  if (filters.length) {
    lines.push("- filters:");
    lines.push(...filters.map((filter) => `  - ${filter}`));
  }
  return lines;
}

function formatActiveFilters(filters: NormalizedFilters): string[] {
  const lines: string[] = [];
  if (filters.pathInput !== undefined) {
    lines.push(`path: ${JSON.stringify(filters.pathInput)}${filters.pathFilter ? ` → ${filters.pathFilter}` : " → <root>"}`);
  }
  if (filters.pattern) lines.push(`pattern: ${JSON.stringify(filters.pattern)}`);
  if (filters.query) lines.push(`query: ${JSON.stringify(filters.query)}`);
  if (filters.language) lines.push(`language: ${JSON.stringify(filters.language)}`);
  if (filters.errorsOnly) lines.push("errorsOnly: true");
  return lines;
}

function formatPaginationFooter(page: FilePage, matched: number): string[] {
  const lines: string[] = [];
  if (page.offsetOnlyDefault) {
    lines.push("", `No \`limit\` was provided with \`offset\`; using ${page.limit} files for this page.`);
  }
  if (page.limit !== undefined && page.offset + page.files.length < matched) {
    lines.push("", `Showing ${page.files.length} of ${matched} matched files. Increase \`offset\` to ${page.offset + page.files.length} for the next page.`);
  }
  return lines;
}

function formatFilesFlat(files: readonly FileRecord[], includeMetadata: boolean, includeStats: boolean): string[] {
  const lines = ["## Files", ""];
  for (const file of files) {
    if (includeStats) {
      lines.push(`- ${file.path}`);
      lines.push(...formatFileStats(file));
    } else if (includeMetadata) {
      lines.push(`- ${file.path} (${formatCompactMetadata(file, { includeLanguage: true })})`);
    } else {
      lines.push(`- ${file.path}`);
    }
  }
  return lines;
}

function formatFilesGrouped(files: readonly FileRecord[], includeMetadata: boolean, includeStats: boolean): string[] {
  const byLanguage = new Map<string, FileRecord[]>();
  for (const file of files) {
    const language = String(file.language);
    const existing = byLanguage.get(language) ?? [];
    existing.push(file);
    byLanguage.set(language, existing);
  }

  const lines = ["## Files by Language", ""];
  const groups = [...byLanguage.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [language, languageFiles] of groups) {
    lines.push(`### ${language} (${languageFiles.length})`);
    for (const file of languageFiles.sort(compareFilePath)) {
      if (includeStats) {
        lines.push(`- ${file.path}`);
        lines.push(...formatFileStats(file));
      } else if (includeMetadata) {
        lines.push(`- ${file.path} (${formatCompactMetadata(file, { includeLanguage: false })})`);
      } else {
        lines.push(`- ${file.path}`);
      }
    }
    lines.push("");
  }
  return trimTrailingBlank(lines);
}

function formatFilesTree(files: readonly FileRecord[], includeMetadata: boolean, includeStats: boolean, maxDepth?: number): string[] {
  interface TreeNode {
    readonly name: string;
    readonly children: Map<string, TreeNode>;
    file?: FileRecord;
  }

  const root: TreeNode = { name: "", children: new Map() };
  for (const file of files) {
    const parts = normalizeSlashes(file.path).split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      if (!current.children.has(part)) current.children.set(part, { name: part, children: new Map() });
      current = current.children.get(part)!;
      if (i === parts.length - 1) current.file = file;
    }
  }

  const lines = ["## Project Structure", ""];
  const renderNode = (node: TreeNode, prefix: string, isLast: boolean, depth: number): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (node.name) {
      let line = prefix + connector + node.name;
      if (node.file && (includeMetadata || includeStats)) {
        line += ` (${formatCompactMetadata(node.file, { includeLanguage: true, includeStats })})`;
      }
      lines.push(line);
    }

    const children = [...node.children.values()].sort((a, b) => {
      const aIsDir = a.children.size > 0 && !a.file;
      const bIsDir = b.children.size > 0 && !b.file;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      const nextPrefix = node.name ? prefix + childPrefix : prefix;
      renderNode(child, nextPrefix, i === children.length - 1, depth + 1);
    }
  };

  renderNode(root, "", true, 0);
  return lines;
}

function formatCompactMetadata(file: FileRecord, options: { readonly includeLanguage: boolean; readonly includeStats?: boolean }): string {
  const parts: string[] = [];
  if (options.includeLanguage) parts.push(String(file.language));
  parts.push(plural(file.nodeCount, "symbol"));
  const errors = errorCount(file);
  if (errors > 0 || options.includeStats) parts.push(plural(errors, "error"));
  if (options.includeStats) {
    parts.push(formatSize(file.size));
    parts.push(`modified ${formatTimestamp(file.modifiedAt)}`);
    parts.push(`indexed ${formatTimestamp(file.indexedAt)}`);
  }
  return parts.join(", ");
}

function formatFileStats(file: FileRecord): string[] {
  return [
    `  - language: ${file.language}`,
    `  - symbols: ${file.nodeCount}`,
    `  - size: ${formatSize(file.size)}`,
    `  - modifiedAt: ${formatTimestamp(file.modifiedAt)}`,
    `  - indexedAt: ${formatTimestamp(file.indexedAt)}`,
    `  - errors: ${errorCount(file)}`,
  ];
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "unknown";
  }
}

function errorCount(file: FileRecord): number {
  return file.errors?.length ?? 0;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function trimTrailingBlank(lines: string[]): string[] {
  while (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function detailsFilters(filters: NormalizedFilters): Record<string, unknown> {
  return {
    path: filters.pathFilter || undefined,
    pathInput: filters.pathInput,
    pattern: filters.pattern,
    query: filters.query,
    language: filters.language,
    errorsOnly: filters.errorsOnly || undefined,
  };
}
