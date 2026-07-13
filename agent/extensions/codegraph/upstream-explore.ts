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

const UPSTREAM_TRUNCATION_MARKER =
  "... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. " +
  "For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)";
const TRUNCATED_SOURCE_WARNING =
  "> ⚠️ Upstream Explore output truncated to budget inside the final source block. " +
  "The visible source lines are verbatim, but the final block is incomplete. " +
  "Run another codegraph_explore with specific names for omitted areas.";

class UpstreamExploreCompatibilityError extends Error {
  override readonly name = "UpstreamExploreCompatibilityError";
}

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
  return new UpstreamExploreCompatibilityError(
    `CodeGraph ${installedCodeGraphVersion()} upstream Explore compatibility error in ${moduleId}: ${reason}. ` +
      "The private adapter must be reviewed when upgrading @colbymchenry/codegraph.",
  );
}

function isCompatibilityError(value: unknown): value is UpstreamExploreCompatibilityError {
  try {
    return value instanceof UpstreamExploreCompatibilityError;
  } catch {
    return false;
  }
}

function thrownReason(value: unknown): string {
  try {
    if (value instanceof Error) return value.message || value.name;
  } catch {
    // A hostile proxy can throw from instanceof or its Error getters.
  }
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    for (const property of ["message", "reason"] as const) {
      try {
        const detail = Reflect.get(value, property);
        if (typeof detail === "string" && detail) return detail;
      } catch {
        // Try the other conventional detail without stringifying the object.
      }
    }
    return `${typeof value} thrown without a string message or reason`;
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArrayIndex(key: PropertyKey, length: number): boolean {
  if (typeof key !== "string" || key === "") return false;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function inspectUpstreamResult(value: unknown): UpstreamToolResult {
  if (!isRecord(value)) {
    throw compatibilityError("ToolHandler.executeReadTool() returned a non-object result");
  }

  const rawContent = value.content;
  if (!Array.isArray(rawContent)) {
    throw compatibilityError("ToolHandler.executeReadTool() returned a result without a content array");
  }
  const rawIsError = value.isError;
  if (rawIsError !== undefined && typeof rawIsError !== "boolean") {
    throw compatibilityError("ToolHandler.executeReadTool() returned a non-boolean isError value");
  }

  // Count actual indexes before iterating so a huge sparse length cannot cause
  // a matching allocation or an unbounded walk over missing entries.
  const contentLength = rawContent.length;
  const ownIndexCount = Reflect.ownKeys(rawContent)
    .filter((key) => isArrayIndex(key, contentLength))
    .length;
  if (ownIndexCount !== contentLength) {
    throw compatibilityError("ToolHandler.executeReadTool() returned a sparse content array");
  }

  const content: Array<{ type: string; text?: string }> = [];
  for (let index = 0; index < contentLength; index++) {
    const block = rawContent[index];
    if (!isRecord(block)) {
      throw compatibilityError(`ToolHandler.executeReadTool() returned an invalid content block at index ${index}`);
    }
    const type = block.type;
    if (typeof type !== "string") {
      throw compatibilityError(`ToolHandler.executeReadTool() returned an invalid content block at index ${index}`);
    }
    if (type === "text") {
      const text = block.text;
      if (typeof text !== "string") {
        throw compatibilityError(`ToolHandler.executeReadTool() returned a text block without string text at index ${index}`);
      }
      content.push({ type, text });
    } else {
      content.push({ type });
    }
  }

  return { content, ...(typeof rawIsError === "boolean" ? { isError: rawIsError } : {}) };
}

function validateUpstreamResult(value: unknown): UpstreamToolResult {
  try {
    return inspectUpstreamResult(value);
  } catch (error) {
    if (isCompatibilityError(error)) throw error;
    throw compatibilityError(
      `ToolHandler.executeReadTool() returned a result that could not be inspected: ${thrownReason(error)}`,
    );
  }
}

interface MarkdownLine {
  readonly start: number;
  readonly contentEnd: number;
  readonly eol: string;
  readonly text: string;
}

function markdownLines(value: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index !== value.length && value[index] !== "\n") continue;
    const contentEnd = index > start && value[index - 1] === "\r" ? index - 1 : index;
    const eol = index === value.length ? "" : contentEnd === index - 1 ? "\r\n" : "\n";
    lines.push({ start, contentEnd, eol, text: value.slice(start, contentEnd) });
    start = index + 1;
  }
  return lines;
}

function repairTruncatedSourceFence(output: string): string {
  // Match the pinned marker exactly. Near misses must force adapter review
  // instead of letting this private compatibility layer rewrite new formats.
  const lines = markdownLines(output);
  const fences = lines.filter((line) => /^```[^`\r\n]*$/.test(line.text));
  if (fences.length % 2 === 0) return output;

  const finalFence = fences.at(-1)!;
  const marker = lines.find(
    (line) => line.start > finalFence.start && line.text === UPSTREAM_TRUNCATION_MARKER,
  );
  if (!marker) return output;

  let newline = marker.eol;
  if (!newline) {
    for (let index = lines.indexOf(marker) - 1; index >= 0; index--) {
      if (lines[index]!.eol) {
        newline = lines[index]!.eol;
        break;
      }
    }
  }
  if (!newline) newline = "\n";

  return `${output.slice(0, marker.start)}\`\`\`${newline}${newline}${TRUNCATED_SOURCE_WARNING}${output.slice(marker.contentEnd)}`;
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
    throw compatibilityError(`the platform handler could not be loaded: ${thrownReason(error)}`, moduleId);
  }

  let ToolHandler: unknown;
  try {
    ToolHandler = Reflect.get(loaded as object, "ToolHandler");
  } catch (error) {
    throw compatibilityError(`the ToolHandler export could not be inspected: ${thrownReason(error)}`, moduleId);
  }
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
  let ToolHandler: UpstreamToolHandlerConstructor;
  try {
    ToolHandler = loadToolHandler();
  } catch (error) {
    if (isCompatibilityError(error)) throw error;
    throw compatibilityError(`ToolHandler could not be loaded: ${thrownReason(error)}`);
  }

  let handler: UpstreamToolHandler;
  try {
    handler = new ToolHandler(cg);
  } catch (error) {
    throw compatibilityError(`ToolHandler could not be constructed: ${thrownReason(error)}`);
  }

  let executeReadTool: UpstreamToolHandler["executeReadTool"];
  try {
    executeReadTool = handler?.executeReadTool;
  } catch (error) {
    throw compatibilityError(`ToolHandler.executeReadTool could not be inspected: ${thrownReason(error)}`);
  }
  if (typeof executeReadTool !== "function") {
    throw compatibilityError("ToolHandler does not expose executeReadTool()");
  }

  const args: Record<string, unknown> = { query: params.query };
  if (params.maxFiles !== undefined) args.maxFiles = params.maxFiles;

  // GraphManager already selected and freshened this graph. The read dispatch
  // preserves full Explore behavior without applying MCP-only allowlists,
  // project routing, or watcher notices a second time.
  const result = validateUpstreamResult(await executeReadTool.call(handler, "codegraph_explore", args));
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
