/**
 * Registration for the `codegraph_search` Pi tool.
 *
 * The tool exposes CodeGraph's ranked symbol/text search with an optional node
 * kind filter and shared output truncation.
 */

import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, NODE_KIND_VALUES } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { formatNodeLine } from "../node-format.ts";
import { formatSize, textResult } from "../result.ts";
import { coerceLimit, createLimitSchema, createStringEnumSchema, ProjectPathSchema } from "../tool-parameters.ts";
import type { ExtensionAPI, ExtensionContext, SearchToolParams, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";

/**
 * Register the codegraph_search tool with Pi.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 */
export function registerSearchTool(pi: ExtensionAPI, manager: GraphManager): void {
  const tool: ToolDefinition<SearchToolParams> = {
    name: "codegraph_search",
    label: "CodeGraph Search",
    description: `Find indexed symbols by name or text. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find indexed symbols with CodeGraph",
    promptGuidelines: [
      "Use codegraph_search only to locate indexed symbols by name; use codegraph_explore for understanding an area.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Symbol name or text to search for." }),
      kind: Type.Optional(createStringEnumSchema(NODE_KIND_VALUES, { description: "Optional node kind filter." })),
      limit: createLimitSchema(20),
      projectPath: ProjectPathSchema,
    }),
    async execute(
      _toolCallId: string,
      params: SearchToolParams,
      signal: AbortSignal | undefined,
      onUpdate: ToolUpdateHandler | undefined,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 20);
      const results = graph.cg.searchNodes(params.query, {
        limit,
        kinds: params.kind ? [params.kind] : undefined,
      });
      const lines = results.length
        ? results.map((result) => formatNodeLine(result.node, { score: result.score }))
        : [`No CodeGraph symbols found for ${JSON.stringify(params.query)}.`];
      return textResult(manager.withWarningPrefix(graph, lines.join("\n")), { root: graph.root, count: results.length, snapshot: graph.snapshot });
    },
  };

  pi.registerTool(tool);
}
