import { createRequire } from "node:module";
import type { CodeGraphInstance } from "./types.ts";

interface UpstreamToolResult {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly isError?: boolean;
}

interface UpstreamToolHandler {
  executeReadTool(toolName: string, args: Record<string, unknown>): Promise<UpstreamToolResult>;
}

type UpstreamToolHandlerConstructor = new (cg: CodeGraphInstance) => UpstreamToolHandler;
type ModuleLoader = (moduleId: string) => unknown;

export interface UpstreamExploreParams {
  readonly query: string;
  readonly maxFiles?: number;
}

const nodeRequire = createRequire(import.meta.url);

export function codeGraphPlatformPackageName(
  platform = process.platform,
  arch = process.arch,
): string {
  return `@colbymchenry/codegraph-${platform}-${arch}`;
}

function installedCodeGraphVersion(): string {
  try {
    const packageJson = nodeRequire("@colbymchenry/codegraph/package.json") as { readonly version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

// Full Explore currently lives behind CodeGraph's MCP module rather than its
// public SDK. Keep this deep import isolated so package upgrades have one
// compatibility boundary to review and test.
export function loadUpstreamToolHandler(
  loadModule: ModuleLoader = nodeRequire,
  platform = process.platform,
  arch = process.arch,
): UpstreamToolHandlerConstructor {
  const packageName = codeGraphPlatformPackageName(platform, arch);
  const moduleId = `${packageName}/lib/dist/mcp/tools.js`;
  let loaded: unknown;

  try {
    loaded = loadModule(moduleId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load CodeGraph ${installedCodeGraphVersion()} upstream Explore handler from ${moduleId}: ${reason}`,
    );
  }

  const ToolHandler = (loaded as { readonly ToolHandler?: unknown } | null)?.ToolHandler;
  if (typeof ToolHandler !== "function") {
    throw new Error(
      `CodeGraph ${installedCodeGraphVersion()} upstream Explore module ${moduleId} does not export a ToolHandler constructor. ` +
        "The private adapter must be reviewed when upgrading @colbymchenry/codegraph.",
    );
  }

  return ToolHandler as UpstreamToolHandlerConstructor;
}

export async function executeUpstreamExplore(
  cg: CodeGraphInstance,
  params: UpstreamExploreParams,
  loadToolHandler: () => UpstreamToolHandlerConstructor = loadUpstreamToolHandler,
): Promise<string> {
  const ToolHandler = loadToolHandler();
  const handler = new ToolHandler(cg);
  if (!handler || typeof handler.executeReadTool !== "function") {
    throw new Error(
      `CodeGraph ${installedCodeGraphVersion()} upstream ToolHandler does not expose executeReadTool(). ` +
        "The private adapter must be reviewed when upgrading @colbymchenry/codegraph.",
    );
  }

  const args: Record<string, unknown> = { query: params.query };
  if (params.maxFiles !== undefined) args.maxFiles = params.maxFiles;

  // GraphManager already selected and freshened this graph. The read dispatch
  // preserves full Explore behavior without applying MCP-only allowlists,
  // project routing, or watcher notices a second time.
  const result = await handler.executeReadTool("codegraph_explore", args);
  const text = result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");

  if (result.isError) {
    throw new Error(text || "CodeGraph upstream Explore failed without an error message.");
  }
  if (!text) {
    throw new Error("CodeGraph upstream Explore returned no text output.");
  }

  return text;
}
