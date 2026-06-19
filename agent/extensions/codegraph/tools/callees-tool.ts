/**
 * Registration for the `codegraph_callees` Pi tool.
 *
 * The tool finds candidate definitions for a symbol and reports direct callees
 * for each match.
 */

import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, MAX_CODEGRAPH_QUERY_CHARS } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { formatReferenceLine, nodeTitle } from "../node-format.ts";
import { registerCodeGraphTool } from "../render.ts";
import { formatSize, textResult } from "../result.ts";
import { formatNoMatches, searchMatches } from "../symbol-search.ts";
import { coerceLimit, createLimitSchema, formatCodeGraphQueryError, ProjectPathSchema, validateQueryText } from "../tool-parameters.ts";
import type { ExtensionAPI, ExtensionContext, SymbolToolParams, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";

/**
 * Register the codegraph_callees tool with Pi.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 */
export function registerCalleesTool(pi: ExtensionAPI, manager: GraphManager): void {
  const tool: ToolDefinition<SymbolToolParams> = {
    name: "codegraph_callees",
    label: "CodeGraph Callees",
    description: `Find what an indexed function/method/symbol calls. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find CodeGraph callees for a symbol",
    promptGuidelines: [
      "Use codegraph_callees when the user asks what an indexed symbol calls.",
    ],
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol name to inspect.", minLength: 1, maxLength: MAX_CODEGRAPH_QUERY_CHARS }),
      file: Type.Optional(Type.String({ description: "Optional file path/suffix to disambiguate the symbol." })),
      limit: createLimitSchema(10, 50),
      projectPath: ProjectPathSchema,
    }),
    async execute(
      _toolCallId: string,
      params: SymbolToolParams,
      signal: AbortSignal | undefined,
      onUpdate: ToolUpdateHandler | undefined,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      const symbol = validateQueryText(params.symbol, "Symbol name");
      if (!symbol.ok) return textResult(symbol.message);

      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 10, 50);
      let matches: ReturnType<typeof searchMatches>;
      try {
        matches = searchMatches(graph.cg, symbol.value, { file: params.file, limit });
      } catch (error) {
        const message = formatCodeGraphQueryError(error);
        if (message) return textResult(message, { root: graph.root, snapshot: graph.snapshot });
        throw error;
      }
      if (matches.length === 0) return textResult(formatNoMatches(symbol.value, params.file), { root: graph.root, snapshot: graph.snapshot });

      const sections: string[] = [];
      for (const match of matches) {
        const callees = graph.cg.getCallees(match.node.id, 1).slice(0, limit);
        sections.push(`## Callees of ${nodeTitle(match.node)}`);
        sections.push(callees.length ? callees.map((ref) => formatReferenceLine(ref, "called")).join("\n") : "No callees found.");
        sections.push("");
      }
      return textResult(manager.withWarningPrefix(graph, sections.join("\n").trimEnd()), { root: graph.root, definitions: matches.length, snapshot: graph.snapshot });
    },
  };

  registerCodeGraphTool(pi, tool);
}
