/**
 * Registration for the `codegraph_callers` Pi tool.
 *
 * The tool finds candidate definitions for a symbol and reports direct callers
 * for each match, preserving the original multi-definition behavior.
 */

import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { formatReferenceLine, nodeTitle } from "../node-format.ts";
import { formatSize, textResult } from "../result.ts";
import { formatNoMatches, searchMatches } from "../symbol-search.ts";
import { coerceLimit, createLimitSchema, ProjectPathSchema } from "../tool-parameters.ts";
import type { ExtensionAPI, ExtensionContext, SymbolToolParams, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";

/**
 * Register the codegraph_callers tool with Pi.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 */
export function registerCallersTool(pi: ExtensionAPI, manager: GraphManager): void {
  const tool: ToolDefinition<SymbolToolParams> = {
    name: "codegraph_callers",
    label: "CodeGraph Callers",
    description: `Find what calls an indexed function/method/symbol. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find CodeGraph call sites for a symbol",
    promptGuidelines: [
      "Use codegraph_callers before refactoring a named indexed symbol to find update sites and callback registrations.",
    ],
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol name to inspect." }),
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
      const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 10, 50);
      const matches = searchMatches(graph.cg, params.symbol, { file: params.file, limit });
      if (matches.length === 0) return textResult(formatNoMatches(params.symbol, params.file), { root: graph.root, snapshot: graph.snapshot });

      const sections: string[] = [];
      for (const match of matches) {
        const callers = graph.cg.getCallers(match.node.id, 1).slice(0, limit);
        sections.push(`## Callers of ${nodeTitle(match.node)}`);
        sections.push(callers.length ? callers.map((ref) => formatReferenceLine(ref, "calls here")).join("\n") : "No callers found.");
        sections.push("");
      }
      return textResult(manager.withWarningPrefix(graph, sections.join("\n").trimEnd()), { root: graph.root, definitions: matches.length, snapshot: graph.snapshot });
    },
  };

  pi.registerTool(tool);
}
