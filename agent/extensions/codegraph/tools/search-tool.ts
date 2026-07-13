/**
 * Registration for the `codegraph_search` Pi tool.
 *
 * The tool exposes CodeGraph's ranked symbol-metadata search with an optional
 * node kind filter and shared output truncation.
 */

import type { SearchResult } from "@colbymchenry/codegraph";
import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, MAX_CODEGRAPH_QUERY_CHARS, NODE_KIND_VALUES } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { formatNodeLine } from "../node-format.ts";
import { registerCodeGraphTool } from "../render.ts";
import { formatSize, textResult } from "../result.ts";
import { coerceLimit, createLimitSchema, createStringEnumSchema, formatCodeGraphQueryError, ProjectPathSchema, validateQueryText } from "../tool-parameters.ts";
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
    description: `Search indexed symbol metadata, such as names, docstrings, and signatures—not arbitrary source text or string literals. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find indexed symbols with CodeGraph",
    promptGuidelines: [
      "Use codegraph_search only to locate indexed symbols; it searches symbol metadata, not arbitrary file contents or string literals. Use codegraph_explore for understanding an area.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Text to search for in indexed symbol metadata; arbitrary source text and string literals are not searched.", minLength: 1, maxLength: MAX_CODEGRAPH_QUERY_CHARS }),
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
      const query = validateQueryText(params.query, "codegraph_search query");
      if (!query.ok) return textResult(query.message);

      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 20);
      let results: SearchResult[];
      try {
        results = graph.cg.searchNodes(query.value, {
          limit,
          kinds: params.kind ? [params.kind] : undefined,
        });
      } catch (error) {
        const message = formatCodeGraphQueryError(error);
        if (message) return textResult(message, { root: graph.root, snapshot: graph.snapshot });
        throw error;
      }
      const lines = results.length
        ? results.map((result) => formatNodeLine(result.node, { score: result.score }))
        : [
            `No CodeGraph symbols found for ${JSON.stringify(query.value)}. codegraph_search searches indexed symbol metadata, not arbitrary source text or string literals.`,
          ];
      return textResult(manager.withWarningPrefix(graph, lines.join("\n")), { root: graph.root, count: results.length, snapshot: graph.snapshot });
    },
  };

  registerCodeGraphTool(pi, tool);
}
