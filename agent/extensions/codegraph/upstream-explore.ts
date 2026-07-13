import { createRequire } from "node:module";
import type { CodeGraphInstance } from "./types.ts";

interface UpstreamToolResult {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly isError?: boolean;
}

interface UpstreamToolHandler {
  executeReadTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
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

function platformToolsModuleId(): string {
  return `${codeGraphPlatformPackageName()}/lib/dist/mcp/tools.js`;
}

function compatibilityError(reason: string, moduleId = platformToolsModuleId()): Error {
  return new Error(
    `CodeGraph ${installedCodeGraphVersion()} upstream Explore compatibility error in ${moduleId}: ${reason}. ` +
      "The private adapter must be reviewed when upgrading @colbymchenry/codegraph.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateUpstreamResult(value: unknown): UpstreamToolResult {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw compatibilityError("ToolHandler.executeReadTool() returned a result without a content array");
  }
  if (value.isError !== undefined && typeof value.isError !== "boolean") {
    throw compatibilityError("ToolHandler.executeReadTool() returned a non-boolean isError value");
  }

  const content = value.content.map((block, index) => {
    if (!isRecord(block) || typeof block.type !== "string") {
      throw compatibilityError(`ToolHandler.executeReadTool() returned an invalid content block at index ${index}`);
    }
    if (block.type === "text" && typeof block.text !== "string") {
      throw compatibilityError(`ToolHandler.executeReadTool() returned a text block without string text at index ${index}`);
    }
    return {
      type: block.type,
      ...(typeof block.text === "string" ? { text: block.text } : {}),
    };
  });

  return { content, ...(typeof value.isError === "boolean" ? { isError: value.isError } : {}) };
}

function repairTruncatedSourceFence(output: string): string {
  // Upstream can place its truncation notice before the final closing fence.
  // Move that metadata outside the fence so agents do not read it as source.
  const fences = output.match(/^```[^\r\n]*\r?$/gm) ?? [];
  if (fences.length % 2 === 0) return output;

  const marker = /^\.\.\. \(output truncated to budget;[^\r\n]*\r?$/m.exec(output);
  if (!marker || marker.index === undefined) return output;

  const newline = output.includes("\r\n") ? "\r\n" : "\n";
  const warning =
    "> ⚠️ Upstream Explore output truncated to budget inside the final source block. " +
    "The visible source lines are verbatim, but the final block is incomplete. " +
    "Run another codegraph_explore with specific names for omitted areas.";
  return `${output.slice(0, marker.index)}\`\`\`${newline}${newline}${warning}${output.slice(marker.index + marker[0].length)}`;
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
    throw compatibilityError("the module does not export a ToolHandler constructor", moduleId);
  }

  return ToolHandler as UpstreamToolHandlerConstructor;
}

export async function executeUpstreamExplore(
  cg: CodeGraphInstance,
  params: UpstreamExploreParams,
  loadToolHandler: () => UpstreamToolHandlerConstructor = loadUpstreamToolHandler,
): Promise<string> {
  const ToolHandler = loadToolHandler();
  let handler: UpstreamToolHandler;
  try {
    handler = new ToolHandler(cg);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw compatibilityError(`ToolHandler could not be constructed: ${reason}`);
  }
  if (!handler || typeof handler.executeReadTool !== "function") {
    throw compatibilityError("ToolHandler does not expose executeReadTool()");
  }

  const args: Record<string, unknown> = { query: params.query };
  if (params.maxFiles !== undefined) args.maxFiles = params.maxFiles;

  // GraphManager already selected and freshened this graph. The read dispatch
  // preserves full Explore behavior without applying MCP-only allowlists,
  // project routing, or watcher notices a second time.
  const result = validateUpstreamResult(await handler.executeReadTool("codegraph_explore", args));
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

  return repairTruncatedSourceFence(text);
}
