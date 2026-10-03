import { callCtxTool, type BackendLoadDeps } from "./backend.js";
import { assertNotAborted, type CallLifecycle } from "./worker-client.js";
import { resolveProjectDir, resolveUserPath } from "./project.js";
import { assertSafeBatchCommand, assertSafeFilePath, assertSafeWorkingDirectory } from "./safety.js";
import { LEAN_TOOL_METADATA, SUPPORTED_LANGUAGES } from "./schemas.js";
import { createCallRenderer, createResultRenderer } from "./rendering.js";
import type { ExtensionContextLike, LeanToolName, ToolRegistration, ToolResult } from "./types.js";

export type CtxExecuteFileParams = {
  path: string;
  language: (typeof SUPPORTED_LANGUAGES)[number];
  code: string;
  timeout?: number;
  intent?: string;
};

export type CtxBatchExecuteParams = {
  commands: Array<{ label: string; command: string }>;
  queries: string[];
  timeout?: number;
  concurrency?: number;
  cwd?: string;
  progressFiles?: string[];
};

export type CtxSearchParams = {
  queries: string[];
  source?: string;
  limit?: number;
  contentType?: "code" | "prose";
};

export const DEFAULT_EXECUTION_TIMEOUT_MS = 300000;

type AnyLeanParams = CtxExecuteFileParams | CtxBatchExecuteParams | CtxSearchParams;

type WrapperDeps = BackendLoadDeps & {
  callTool?: (projectDir: string, name: LeanToolName, args: Record<string, unknown>, lifecycle: CallLifecycle) => Promise<ToolResult>;
};

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${field} must be a non-empty array of strings`);
  }
  return value as string[];
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }
  return value;
}

function optionalIntegerInRange(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function omitUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function getProjectDir(ctx?: ExtensionContextLike): string {
  return resolveProjectDir({ ctx });
}

async function invoke(name: LeanToolName, projectDir: string, args: Record<string, unknown>, deps: WrapperDeps, lifecycle: CallLifecycle): Promise<ToolResult> {
  assertNotAborted(lifecycle.signal);
  if (deps.callTool) return deps.callTool(projectDir, name, args, lifecycle);
  return callCtxTool(projectDir, name, args, deps, lifecycle);
}

export function buildExecuteFileArgs(params: CtxExecuteFileParams, projectDir: string): Record<string, unknown> {
  const path = resolveUserPath(assertString(params.path, "path"), projectDir);
  assertSafeFilePath(path);

  const language = assertString(params.language, "language");
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(language)) {
    throw new Error(`language must be one of: ${SUPPORTED_LANGUAGES.join(", ")}`);
  }

  return omitUndefined({
    path,
    language,
    code: assertString(params.code, "code"),
    timeout: optionalNumber(params.timeout, "timeout") ?? DEFAULT_EXECUTION_TIMEOUT_MS,
    intent: params.intent === undefined ? undefined : assertString(params.intent, "intent"),
  });
}

export function buildBatchExecuteArgs(params: CtxBatchExecuteParams, projectDir: string): Record<string, unknown> {
  if (!Array.isArray(params.commands) || params.commands.length === 0) {
    throw new Error("commands must be a non-empty array");
  }

  const commands = params.commands.map((command, index) => {
    const label = assertString(command?.label, `commands[${index}].label`);
    const shellCommand = assertString(command?.command, `commands[${index}].command`);
    assertSafeBatchCommand(shellCommand);
    return { label, command: shellCommand };
  });

  const concurrency = optionalIntegerInRange(params.concurrency, "concurrency", 1, 4) ?? 1;
  const cwd = params.cwd === undefined ? projectDir : resolveUserPath(assertString(params.cwd, "cwd"), projectDir);
  assertSafeWorkingDirectory(cwd);

  return omitUndefined({
    commands,
    queries: assertStringArray(params.queries, "queries"),
    timeout: optionalNumber(params.timeout, "timeout") ?? DEFAULT_EXECUTION_TIMEOUT_MS,
    concurrency,
    cwd,
    query_scope: "batch",
  });
}

function resolveProgressFiles(value: unknown, cwd: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) throw new Error("progressFiles must be an array of at most 32 paths");
  const paths = value.map((path, index) => {
    const resolved = resolveUserPath(assertString(path, `progressFiles[${index}]`), cwd);
    assertSafeFilePath(resolved);
    return resolved;
  });
  return [...new Set(paths)];
}

function optionalContentType(value: unknown): "code" | "prose" | undefined {
  if (value === undefined || value === "") return undefined;
  if (value !== "code" && value !== "prose") throw new Error("contentType must be 'code' or 'prose'");
  return value;
}

function optionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  return assertString(value, field);
}

export function buildSearchArgs(params: CtxSearchParams): Record<string, unknown> {
  return omitUndefined({
    queries: assertStringArray(params.queries, "queries"),
    source: optionalNonEmptyString(params.source, "source"),
    limit: optionalIntegerInRange(params.limit, "limit", 1, 5),
    contentType: optionalContentType(params.contentType),
  });
}

export async function executeLeanTool(
  name: LeanToolName,
  params: AnyLeanParams,
  ctx?: ExtensionContextLike,
  deps: WrapperDeps = {},
  lifecycle: CallLifecycle = {},
): Promise<ToolResult> {
  assertNotAborted(lifecycle.signal);
  const projectDir = getProjectDir(ctx);
  switch (name) {
    case "ctx_execute_file":
      return invoke(name, projectDir, buildExecuteFileArgs(params as CtxExecuteFileParams, projectDir), deps, lifecycle);
    case "ctx_batch_execute": {
      const batch = params as CtxBatchExecuteParams;
      const args = buildBatchExecuteArgs(batch, projectDir);
      const progressFiles = resolveProgressFiles(batch.progressFiles, args.cwd as string);
      if (progressFiles?.length) lifecycle = { ...lifecycle, progressFiles };
      return invoke(name, projectDir, args, deps, lifecycle);
    }
    case "ctx_search":
      return invoke(name, projectDir, buildSearchArgs(params as CtxSearchParams), deps, lifecycle);
  }
}

const PARTIAL_TEXT: Record<LeanToolName, string> = {
  ctx_execute_file: "running/indexing...",
  ctx_batch_execute: "running/indexing/searching...",
  ctx_search: "searching...",
};

export function createLeanToolRegistrations(deps: WrapperDeps = {}): ToolRegistration[] {
  return LEAN_TOOL_METADATA.map((meta) => ({
    name: meta.name,
    label: meta.label,
    description: meta.description,
    promptSnippet: meta.promptSnippet,
    promptGuidelines: [...meta.promptGuidelines],
    parameters: meta.parameters,
    renderCall: createCallRenderer(meta.name, meta.label),
    renderResult: createResultRenderer(meta.name, PARTIAL_TEXT[meta.name]),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeLeanTool(meta.name, params as AnyLeanParams, ctx, deps, { signal, onUpdate });
    },
  }));
}
