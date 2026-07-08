/**
 * Registration for the `codegraph_node` Pi tool.
 *
 * The tool supports indexed file mode, symbol mode, and file-disambiguated
 * symbol mode, combining source snippets with caller/callee context from CodeGraph.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, MAX_CODEGRAPH_QUERY_CHARS } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { formatReferenceLine, nodeTitle } from "../node-format.ts";
import { fileExists } from "../paths.ts";
import { registerCodeGraphTool } from "../render.ts";
import { formatSize, textResult } from "../result.ts";
import { findIndexedFiles, formatFileChoices, formatSymbolOutline, lineNumbered } from "../source-files.ts";
import { formatNoMatches, searchMatches } from "../symbol-search.ts";
import { coerceLimit, formatCodeGraphQueryError, ProjectPathSchema, validateQueryText } from "../tool-parameters.ts";
import type { ExtensionAPI, ExtensionContext, NodeToolParams, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";

function formatFileFilteredNoMatches(symbol: string, file: string, alternatives: ReturnType<typeof searchMatches>): string {
  const lines = [`No CodeGraph symbols found for ${JSON.stringify(symbol)} in file matching ${JSON.stringify(file)}.`];

  if (alternatives.length === 0) {
    lines.push("", "Try codegraph_search with a broader query.");
    return lines.join("\n");
  }

  lines.push("", `Matches for ${JSON.stringify(symbol)} exist outside that file:`);
  for (const match of alternatives) {
    const node = match.node;
    lines.push(`- ${node.name} (${node.kind}) — ${node.filePath}:${node.startLine}`);
  }
  lines.push("", "Call again without `file` to inspect all definitions, or pass the correct file path.");
  return lines.join("\n");
}

/**
 * Register the codegraph_node tool with Pi.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 */
export function registerNodeTool(pi: ExtensionAPI, manager: GraphManager): void {
  const tool: ToolDefinition<NodeToolParams> = {
    name: "codegraph_node",
    label: "CodeGraph Node",
    description: `Read one indexed symbol's source/trail or one indexed source file with line numbers. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Read one indexed symbol or source file with CodeGraph",
    promptGuidelines: [
      "Use codegraph_node for one indexed symbol body, optionally with file to disambiguate, or one indexed source file; prefer it over read for indexed source because it includes graph context.",
      "Use codegraph_node for exact source after codegraph_explore when one specific indexed symbol or file needs more detail.",
      "When both symbol and file are provided, file filters symbol results instead of reading the whole file.",
    ],
    parameters: Type.Object({
      symbol: Type.Optional(Type.String({ description: "Symbol name to inspect. When provided, the tool runs symbol mode; optional file filters/disambiguates matches.", minLength: 1, maxLength: MAX_CODEGRAPH_QUERY_CHARS })),
      file: Type.Optional(Type.String({ description: "Indexed file path/suffix. With symbol, filters symbol mode; without symbol, reads that file." })),
      includeCode: Type.Optional(Type.Boolean({ description: "Include source code for symbol mode.", default: true })),
      offset: Type.Optional(Type.Integer({ description: "1-indexed starting line for file mode.", minimum: 1 })),
      limit: Type.Optional(Type.Integer({ description: "Maximum lines/results to return.", minimum: 1 })),
      symbolsOnly: Type.Optional(Type.Boolean({ description: "In file mode, return indexed symbols instead of source.", default: false })),
      projectPath: ProjectPathSchema,
    }),
    async execute(
      _toolCallId: string,
      params: NodeToolParams,
      signal: AbortSignal | undefined,
      onUpdate: ToolUpdateHandler | undefined,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      let symbolValue: string | undefined;
      if (params.symbol !== undefined) {
        const symbol = validateQueryText(params.symbol, "Symbol name");
        if (!symbol.ok) return textResult(symbol.message);
        symbolValue = symbol.value;
      } else if (!params.file?.trim()) {
        return textResult("codegraph_node requires either `symbol` or `file`.");
      }

      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });

      if (symbolValue !== undefined) {
        const definitionLimit = coerceLimit(params.limit, 5, 25);
        const fileFilter = params.file?.trim() || undefined;
        let matches: ReturnType<typeof searchMatches>;
        let alternatives: ReturnType<typeof searchMatches> = [];
        try {
          matches = searchMatches(graph.cg, symbolValue, { file: fileFilter, limit: definitionLimit });
          if (matches.length === 0 && fileFilter) {
            alternatives = searchMatches(graph.cg, symbolValue, { limit: definitionLimit });
          }
        } catch (error) {
          const message = formatCodeGraphQueryError(error);
          if (message) return textResult(message, { root: graph.root, snapshot: graph.snapshot });
          throw error;
        }
        if (matches.length === 0) {
          if (fileFilter) {
            return textResult(formatFileFilteredNoMatches(symbolValue, fileFilter, alternatives), { root: graph.root, alternatives: alternatives.length, snapshot: graph.snapshot });
          }
          return textResult(formatNoMatches(symbolValue), { root: graph.root, snapshot: graph.snapshot });
        }

        const sections: string[] = [];
        for (const match of matches) {
          const node = match.node;
          sections.push(`## ${nodeTitle(node)}`);
          if (params.includeCode ?? true) {
            const code = await graph.cg.getCode(node.id);
            if (typeof code === "string" && code) sections.push("", "```" + node.language, code, "```");
            else sections.push("", "_No source available for this symbol._");
          }
          const callers = graph.cg.getCallers(node.id, 1).slice(0, 8);
          const callees = graph.cg.getCallees(node.id, 1).slice(0, 8);
          sections.push("", "### Callers", callers.length ? callers.map((ref) => formatReferenceLine(ref, "calls here")).join("\n") : "No callers found.");
          sections.push("", "### Callees", callees.length ? callees.map((ref) => formatReferenceLine(ref, "called")).join("\n") : "No callees found.");
          sections.push("");
        }
        return textResult(manager.withWarningPrefix(graph, sections.join("\n").trimEnd()), { root: graph.root, definitions: matches.length, snapshot: graph.snapshot });
      }

      if (params.file) {
        const matches = findIndexedFiles(graph.cg, params.file);
        if (matches.length === 0) {
          return textResult(`No indexed file matches ${JSON.stringify(params.file)}. Use raw read for docs/configs/unindexed files, or codegraph_status if the index may be stale.`, { root: graph.root, snapshot: graph.snapshot });
        }
        if (matches.length > 1) {
          return textResult(formatFileChoices(matches, params.file), { root: graph.root, matches: matches.length, snapshot: graph.snapshot });
        }
        const file = matches[0]!;
        const nodes = graph.cg.getNodesInFile(file.path);
        const allDependents = graph.cg.getFileDependents(file.path);
        const dependents = allDependents.slice(0, 20);
        const header = [`# ${file.path}`, ``, `- language: ${file.language}`, `- indexed symbols: ${nodes.length}`, `- dependents: ${dependents.length}${dependents.length ? ` (${dependents.join(", ")}${allDependents.length > dependents.length ? ", ..." : ""})` : ""}`, ""];

        if (params.symbolsOnly) {
          return textResult(manager.withWarningPrefix(graph, header.join("\n") + formatSymbolOutline(nodes)), { root: graph.root, file: file.path, snapshot: graph.snapshot });
        }

        const absoluteFile = path.join(graph.root, file.path);
        if (!(await fileExists(absoluteFile))) {
          return textResult(`Indexed file is missing on disk: ${absoluteFile}. Run codegraph_status/sync or inspect deleted-file changes.`, { root: graph.root, file: file.path, snapshot: graph.snapshot });
        }
        const source = await readFile(absoluteFile, "utf8");
        const numbered = lineNumbered(source, params.offset, params.limit);
        const range = numbered.shownStart > 0
          ? `(lines ${numbered.shownStart}-${numbered.shownEnd} of ${numbered.total})`
          : numbered.total === 0
            ? `(no source lines; file is empty)`
            : `(no source lines at offset ${params.offset}; file has ${numbered.total} lines)`;
        return textResult(manager.withWarningPrefix(graph, `${header.join("\n")}## Source ${range}\n\n${numbered.text}`), { root: graph.root, file: file.path, range, snapshot: graph.snapshot });
      }

      return textResult("codegraph_node requires either `symbol` or `file`.", { root: graph.root, snapshot: graph.snapshot });
    },
  };

  registerCodeGraphTool(pi, tool);
}
