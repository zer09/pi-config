/**
 * Registration for the `codegraph_impact` Pi tool.
 *
 * The tool estimates the blast radius for candidate symbol definitions using
 * CodeGraph's impact-radius traversal.
 */

import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { formatSubgraphImpact } from "../node-format.ts";
import { formatSize, textResult } from "../result.ts";
import { formatNoMatches, searchMatches } from "../symbol-search.ts";
import { coerceLimit, createLimitSchema, ProjectPathSchema } from "../tool-parameters.ts";
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
      symbol: Type.String({ description: "Symbol name to inspect." }),
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
      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 60, 200);
      const depth = coerceLimit(params.depth, 2, 5);
      const matches = searchMatches(graph.cg, params.symbol, { file: params.file, limit: Math.min(10, limit) });
      if (matches.length === 0) return textResult(formatNoMatches(params.symbol, params.file), { root: graph.root, snapshot: graph.snapshot });

      const sections = matches.map((match) => formatSubgraphImpact(match.node, graph.cg.getImpactRadius(match.node.id, depth), limit));
      return textResult(manager.withWarningPrefix(graph, sections.join("\n\n")), { root: graph.root, definitions: matches.length, depth, snapshot: graph.snapshot });
    },
  };

  pi.registerTool(tool);
}
