import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Backend, LeanToolName, RegisteredCtxTool, ToolResult } from "./types.js";

export const REQUIRED_CTX_TOOLS: LeanToolName[] = ["ctx_execute_file", "ctx_batch_execute", "ctx_search"];

export type BackendLoadDeps = {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  requireResolve?: (id: string) => string;
  importModule?: (specifier: string) => Promise<Record<string, unknown>>;
  home?: string;
};

export function resolveContextModeServer(deps: BackendLoadDeps = {}): string | null {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;

  const fromEnv = env.CONTEXT_MODE_ROOT;
  if (fromEnv) {
    const p = resolve(fromEnv, "server.bundle.mjs");
    if (exists(p)) return p;
  }

  try {
    const requireResolve = deps.requireResolve ?? createRequire(import.meta.url).resolve;
    const cli = requireResolve("context-mode/cli");
    const p = resolve(dirname(cli), "server.bundle.mjs");
    if (exists(p)) return p;
  } catch {
    // Fall through to missing-backend error.
  }

  return null;
}

let backendPromise: Promise<Backend> | null = null;

export function resetBackendCache(): void {
  backendPromise = null;
}

function prepareBackendEnv(projectDir: string, deps: BackendLoadDeps): void {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
  env.PI_CONFIG_DIR ??= resolve(home, ".pi");
  env.CONTEXT_MODE_PROJECT_DIR = projectDir;
  env.CONTEXT_MODE_DIR ??= resolve(home, ".pi", "context-mode");
}

function validateRegisteredTool(value: unknown): value is RegisteredCtxTool {
  const tool = value as RegisteredCtxTool | undefined;
  return !!tool && typeof tool.name === "string" && typeof tool.handler === "function";
}

export async function loadBackend(projectDir: string, deps: BackendLoadDeps = {}): Promise<Backend> {
  if (backendPromise) return backendPromise;

  backendPromise = (async () => {
    const serverBundle = resolveContextModeServer(deps);
    if (!serverBundle) {
      throw new Error(
        "context-mode backend not found. Run npm install in ~/.pi/agent/extensions/context-mode or set CONTEXT_MODE_ROOT.",
      );
    }

    prepareBackendEnv(projectDir, deps);

    const importModule = deps.importModule ?? ((specifier: string) => import(specifier));
    const mod = await importModule(pathToFileURL(serverBundle).href);
    const registered = mod.REGISTERED_CTX_TOOLS;
    if (!Array.isArray(registered)) {
      throw new Error("context-mode backend did not export REGISTERED_CTX_TOOLS");
    }

    const tools = new Map<string, RegisteredCtxTool>();
    for (const candidate of registered) {
      if (validateRegisteredTool(candidate)) tools.set(candidate.name, candidate);
    }

    for (const required of REQUIRED_CTX_TOOLS) {
      if (!tools.has(required)) throw new Error(`context-mode backend missing ${required}`);
    }

    if (typeof mod.withProjectDirOverride !== "function") {
      throw new Error("context-mode backend missing withProjectDirOverride");
    }

    return {
      tools,
      withProjectDirOverride: mod.withProjectDirOverride as Backend["withProjectDirOverride"],
    };
  })();

  backendPromise.catch(() => {
    backendPromise = null;
  });

  return backendPromise;
}

function parseArgsWithUpstreamSchema(tool: RegisteredCtxTool, args: Record<string, unknown>): Record<string, unknown> {
  const parser = tool.config?.inputSchema?.parse;
  if (typeof parser !== "function") return args;

  try {
    const parsed = parser(args);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("schema parser returned a non-object value");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid arguments for ${tool.name}: ${message}`);
  }
}

export function normalizeCtxResult(toolName: string, result: unknown): ToolResult {
  if (typeof result === "string") return { content: [{ type: "text", text: result }], details: { tool: toolName } };

  const maybe = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | undefined;
  const text = Array.isArray(maybe?.content)
    ? maybe.content
        .filter((item) => item?.type === "text" && typeof item.text === "string")
        .map((item) => item.text as string)
        .join("\n")
    : result === undefined || result === null
      ? ""
      : JSON.stringify(result, null, 2);

  if (maybe?.isError) {
    throw new Error(text || `${toolName} returned an error`);
  }

  return {
    content: [{ type: "text", text }],
    details: { tool: toolName },
  };
}

export async function callCtxTool(
  projectDir: string,
  name: LeanToolName,
  args: Record<string, unknown>,
  deps: BackendLoadDeps = {},
): Promise<ToolResult> {
  prepareBackendEnv(projectDir, deps);
  const backend = await loadBackend(projectDir, deps);
  const tool = backend.tools.get(name);
  if (!tool) throw new Error(`Unsupported context-mode tool: ${name}`);

  const parsedArgs = parseArgsWithUpstreamSchema(tool, args);
  const result = await backend.withProjectDirOverride({ projectDir }, async () => tool.handler(parsedArgs));
  return normalizeCtxResult(name, result);
}
