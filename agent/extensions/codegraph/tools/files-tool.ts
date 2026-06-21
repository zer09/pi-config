/**
 * Registration for the `codegraph_files` Pi tool.
 *
 * The tool lists CodeGraph-indexed source files from file metadata only. It is
 * for file discovery and index inspection; it deliberately does not read source
 * contents, leaving exact source reads to `codegraph_node`.
 */

import type { FileRecord } from "@colbymchenry/codegraph";
import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { registerCodeGraphTool } from "../render.ts";
import { formatSize, textResult } from "../result.ts";
import { createStringEnumSchema, ProjectPathSchema } from "../tool-parameters.ts";
import type { ExtensionAPI, ExtensionContext, FilesFormat, FilesToolParams, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";
import { detailsFilters, matchesFilters, normalizeFilters } from "./files/filters.ts";
import { paginateFiles } from "./files/pagination.ts";
import { renderFilesOutput } from "./files/render.ts";
import { FILES_FORMAT_VALUES, MAX_FILES_LIMIT } from "./files/types.ts";

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

  registerCodeGraphTool(pi, tool);
}

function coerceFormat(format: FilesToolParams["format"]): FilesFormat {
  return FILES_FORMAT_VALUES.includes(format as FilesFormat) ? (format as FilesFormat) : "tree";
}

function coerceMaxDepth(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function compareFilePath(a: FileRecord, b: FileRecord): number {
  return a.path.localeCompare(b.path);
}
