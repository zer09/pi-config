/**
 * Registration for the `codegraph_explore` Pi tool.
 *
 * The tool delegates readiness/sync decisions to GraphManager and then asks
 * CodeGraph to build a Markdown context bundle for a natural-language query.
 */

import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, MAX_CODEGRAPH_QUERY_CHARS } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { formatSize, textResult } from "../result.ts";
import { coerceLimit, createLimitSchema, formatCodeGraphQueryError, ProjectPathSchema, validateQueryText } from "../tool-parameters.ts";
import type { ExploreToolParams, ExtensionAPI, ExtensionContext, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";

/**
 * Register the codegraph_explore tool with Pi.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 *
 * @example
 * ```ts
 * registerExploreTool(pi, manager);
 * ```
 */
export function registerExploreTool(pi: ExtensionAPI, manager: GraphManager): void {
  const tool: ToolDefinition<ExploreToolParams> = {
    name: "codegraph_explore",
    label: "CodeGraph Explore",
    description: `Explore relevant indexed code context for a question, flow, bug, or area. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Explore indexed source code context with CodeGraph",
    promptGuidelines: [
      "Use codegraph_explore first for indexed source-code architecture, flow, bug, what/where, or how-does-X-work questions; treat returned source as already read.",
      "Use codegraph_explore instead of grep/read exploration for indexed source code; fall back to raw file tools only for docs/configs/unindexed or stale files.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Natural-language question or symbol/file names to explore.", minLength: 1, maxLength: MAX_CODEGRAPH_QUERY_CHARS }),
      maxNodes: createLimitSchema(30, 200),
      includeCode: Type.Optional(Type.Boolean({ description: "Include source blocks in the response.", default: true })),
      projectPath: ProjectPathSchema,
    }),
    async execute(
      _toolCallId: string,
      params: ExploreToolParams,
      signal: AbortSignal | undefined,
      onUpdate: ToolUpdateHandler | undefined,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      const query = validateQueryText(params.query, "codegraph_explore query");
      if (!query.ok) return textResult(query.message);

      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      let output: unknown;
      try {
        output = await graph.cg.buildContext(query.value, {
          maxNodes: coerceLimit(params.maxNodes, 30, 200),
          includeCode: params.includeCode ?? true,
          format: "markdown",
        });
      } catch (error) {
        const message = formatCodeGraphQueryError(error);
        if (message) return textResult(message, { root: graph.root, snapshot: graph.snapshot });
        throw error;
      }
      return textResult(manager.withWarningPrefix(graph, String(output)), { root: graph.root, snapshot: graph.snapshot });
    },
  };

  pi.registerTool(tool);
}
