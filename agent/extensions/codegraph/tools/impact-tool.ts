/**
 * Registration for the `codegraph_impact` Pi tool.
 *
 * The tool estimates the blast radius for candidate symbol definitions using
 * CodeGraph's impact-radius traversal.
 */

import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, MAX_CODEGRAPH_QUERY_CHARS } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { formatSubgraphImpact } from "../node-format.ts";
import { registerCodeGraphTool } from "../render.ts";
import { formatSize, textResult } from "../result.ts";
import { formatNoMatches, searchMatches } from "../symbol-search.ts";
import { coerceLimit, createLimitSchema, formatCodeGraphQueryError, ProjectPathSchema, validateQueryText } from "../tool-parameters.ts";
import type { ExtensionAPI, ExtensionContext, ImpactToolParams, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";

/**
 * Register the codegraph_impact tool with Pi.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 */
export function registerImpactTool(pi: ExtensionAPI, manager: GraphManager): void {
  const tool: ToolDefinition<ImpactToolParams> = {
    name: "codegraph_impact",
    label: "CodeGraph Impact",
    description: `Estimate the blast radius of changing an indexed symbol. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Estimate CodeGraph refactor impact for a symbol",
    promptGuidelines: [
      "Use codegraph_impact before broad refactors of indexed symbols to estimate blast radius.",
    ],
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol name to inspect.", minLength: 1, maxLength: MAX_CODEGRAPH_QUERY_CHARS }),
      file: Type.Optional(Type.String({ description: "Optional file path/suffix to disambiguate the symbol." })),
      depth: Type.Optional(Type.Integer({ description: "Traversal depth for impact analysis (default 2, max 5).", minimum: 1, maximum: 5, default: 2 })),
      limit: createLimitSchema(60, 200),
      projectPath: ProjectPathSchema,
    }),
    async execute(
      _toolCallId: string,
      params: ImpactToolParams,
      signal: AbortSignal | undefined,
      onUpdate: ToolUpdateHandler | undefined,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      const symbol = validateQueryText(params.symbol, "Symbol name");
      if (!symbol.ok) return textResult(symbol.message);

      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 60, 200);
      const depth = coerceLimit(params.depth, 2, 5);
      let matches: ReturnType<typeof searchMatches>;
      try {
        matches = searchMatches(graph.cg, symbol.value, { file: params.file, limit: Math.min(10, limit) });
      } catch (error) {
        const message = formatCodeGraphQueryError(error);
        if (message) return textResult(message, { root: graph.root, snapshot: graph.snapshot });
        throw error;
      }
      if (matches.length === 0) return textResult(formatNoMatches(symbol.value, params.file), { root: graph.root, snapshot: graph.snapshot });

      const sections = matches.map((match) => formatSubgraphImpact(match.node, graph.cg.getImpactRadius(match.node.id, depth), limit));
      return textResult(manager.withWarningPrefix(graph, sections.join("\n\n")), { root: graph.root, definitions: matches.length, depth, snapshot: graph.snapshot });
    },
  };

  registerCodeGraphTool(pi, tool);
}
