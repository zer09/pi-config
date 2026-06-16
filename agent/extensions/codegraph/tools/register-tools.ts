/**
 * Tool registration orchestrator for the CodeGraph Pi extension.
 *
 * This module keeps the public extension entrypoint small while preserving the
 * original tool registration order and delegating each tool to a focused file.
 */

import type { GraphManager } from "../graph-manager.ts";
import type { ExtensionAPI } from "../types.ts";
import { registerCalleesTool } from "./callees-tool.ts";
import { registerCallersTool } from "./callers-tool.ts";
import { registerExploreTool } from "./explore-tool.ts";
import { registerFilesTool } from "./files-tool.ts";
import { registerImpactTool } from "./impact-tool.ts";
import { registerNodeTool } from "./node-tool.ts";
import { registerSearchTool } from "./search-tool.ts";
import { registerStatusTool } from "./status-tool.ts";

/**
 * Register all CodeGraph tools with Pi in the original order.
 *
 * @param pi - Pi extension API.
 * @param manager - Shared graph lifecycle manager.
 * @returns Nothing.
 *
 * @example
 * ```ts
 * registerCodeGraphTools(pi, manager);
 * ```
 */
export function registerCodeGraphTools(pi: ExtensionAPI, manager: GraphManager): void {
  registerExploreTool(pi, manager);
  registerSearchTool(pi, manager);
  registerFilesTool(pi, manager);
  registerCallersTool(pi, manager);
  registerCalleesTool(pi, manager);
  registerImpactTool(pi, manager);
  registerNodeTool(pi, manager);
  registerStatusTool(pi, manager);
}
