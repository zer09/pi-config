/**
 * Registration for the `codegraph_status` Pi tool.
 *
 * The tool reports initialization, freshness, sync TTL, watcher, and stale-index
 * state. It may initialize a safe unindexed root according to the configured
 * auto-init policy, and may confirm a full reindex for stale indexes.
 */

import { Type } from "typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../constants.ts";
import type { GraphManager } from "../graph-manager.ts";
import { registerCodeGraphTool } from "../render.ts";
import { formatSize, textResult } from "../result.ts";
import { formatStatus } from "../status-format.ts";
import { ProjectPathSchema } from "../tool-parameters.ts";
import type { ExtensionAPI, ExtensionContext, StatusToolParams, ToolDefinition, ToolResult, ToolUpdateHandler } from "../types.ts";

/**
 * Register the codegraph_status tool with Pi.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 */
export function registerStatusTool(pi: ExtensionAPI, manager: GraphManager): void {
  const tool: ToolDefinition<StatusToolParams> = {
    name: "codegraph_status",
    label: "CodeGraph Status",
    description: `Report CodeGraph index health, initialization, staleness, pending changes, and extension sync state. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Check CodeGraph index and sync health",
    promptGuidelines: [
      "Use codegraph_status when unsure whether an indexed project is initialized, stale, syncing, pending changes, or needs full reindex.",
    ],
    parameters: Type.Object({
      projectPath: ProjectPathSchema,
    }),
    async execute(
      _toolCallId: string,
      params: StatusToolParams,
      signal: AbortSignal | undefined,
      onUpdate: ToolUpdateHandler | undefined,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      const explicitProjectPath = typeof params.projectPath === "string" && params.projectPath.trim() !== "";
      let snapshot = await manager.buildStatusSnapshot(params.projectPath, ctx, { explicitProjectPath });
      let initMessage: string | undefined;

      if (!snapshot.initialized && snapshot.candidateRoot && !snapshot.unsafeReason) {
        const init = await manager.initializeGraph(snapshot.candidateRoot, ctx, onUpdate, signal);
        initMessage = init.message;
        if (init.entry) {
          snapshot = await manager.buildStatusSnapshot(init.entry.root, ctx, { explicitProjectPath: true });
        }
      } else if (snapshot.initialized && snapshot.indexStale) {
        const graph = await manager.ensureReady(params.projectPath, ctx, onUpdate, signal);
        if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
        snapshot = graph.snapshot;
        initMessage = graph.syncWarning;
      }

      return textResult(formatStatus(snapshot, initMessage), { snapshot });
    },
  };

  registerCodeGraphTool(pi, tool);
}
