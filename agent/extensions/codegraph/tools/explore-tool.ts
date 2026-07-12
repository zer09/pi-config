/**
 * Registration for the `codegraph_explore` Pi tool.
 *
 * The tool delegates readiness/sync decisions to GraphManager and then runs
 * CodeGraph's full upstream Explore handler against the selected graph.
 */

import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, MAX_CODEGRAPH_QUERY_CHARS } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { registerCodeGraphTool } from "../render.ts";
import { formatSize, textResult } from "../result.ts";
import { formatCodeGraphQueryError, ProjectPathSchema, validateQueryText } from "../tool-parameters.ts";
import type { ExploreToolParams, ExtensionAPI, ExtensionContext, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";
import { executeUpstreamExplore } from "../upstream-explore.ts";

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
    description: `Explore indexed source for a question, flow, bug, or area. Returns line-numbered source, relationships, and blast radius where available using CodeGraph's adaptive output budget. Emergency output cap: ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Explore indexed source with upstream CodeGraph retrieval",
    promptGuidelines: [
      "Use codegraph_explore first for indexed source-code architecture, flows, bugs, what/where, or how-does-X-work questions; treat returned source as already read.",
      "Give codegraph_explore a concise question and include exact symbol or file names when known; split unrelated flows into separate calls.",
      "Codegraph_explore locates evidence using identifiers, text, and graph relationships; reason over the returned source yourself for causal or behavioral answers.",
      "Use codegraph_explore instead of grep/read exploration for indexed source code; fall back to raw file tools only for docs/configs/unindexed or explicitly stale files.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Concise question or symbol/file names to explore. Exact identifiers improve precision.", minLength: 1, maxLength: MAX_CODEGRAPH_QUERY_CHARS }),
      maxFiles: Type.Optional(Type.Integer({ description: "Maximum files whose source may be included. Omit for CodeGraph's project-size-adaptive default.", minimum: 1, maximum: 20 })),
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
      let output: string;
      try {
        signal?.throwIfAborted();
        const maxFiles = typeof params.maxFiles === "number" && Number.isFinite(params.maxFiles)
          ? Math.max(1, Math.min(20, Math.floor(params.maxFiles)))
          : undefined;
        const exploreParams = maxFiles === undefined
          ? { query: query.value }
          : { query: query.value, maxFiles };
        output = await executeUpstreamExplore(graph.cg, exploreParams);
        signal?.throwIfAborted();
      } catch (error) {
        const message = formatCodeGraphQueryError(error);
        if (message) return textResult(message, { root: graph.root, snapshot: graph.snapshot });
        throw error;
      }
      return textResult(manager.withWarningPrefix(graph, output), { root: graph.root, snapshot: graph.snapshot });
    },
  };

  registerCodeGraphTool(pi, tool);
}
