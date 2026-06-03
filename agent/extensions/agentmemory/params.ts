import { KNOWN_MCP_PROMPTS, KNOWN_MCP_RESOURCE_PATTERNS } from "./constants.ts";
import type { ToolParams } from "./types.ts";

export function isPlainObject(value: unknown): value is ToolParams {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parsePromptArguments(value: unknown): { args: ToolParams } | { error: string } {
  if (value === undefined || value === "") return { args: {} };
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (!isPlainObject(parsed)) return { error: "arguments JSON must be an object" };
      return { args: parsed };
    } catch {
      return { error: "arguments must be a JSON object string when provided as text" };
    }
  }
  if (!isPlainObject(value)) return { error: "arguments must be an object or JSON object string" };
  return { args: value };
}

export function validatePromptArguments(name: string, args: ToolParams): string | null {
  if (name === "recall_context") {
    const taskDescription = args.task_description;
    if (typeof taskDescription !== "string" || !taskDescription.trim()) return "task_description argument is required and must be a string";
  }
  if (name === "session_handoff") {
    const sessionId = args.session_id;
    if (typeof sessionId !== "string" || !sessionId.trim()) return "session_id argument is required and must be a string";
  }
  if (name === "detect_patterns") {
    const project = args.project;
    if (project !== undefined && project !== "" && typeof project !== "string") return "project argument must be a string";
  }
  return null;
}

export function normalizeMcpResourceUri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const uri = value.trim();
  return uri ? uri : null;
}

export function isKnownMcpResourceUri(uri: string): boolean {
  if (!uri.startsWith("agentmemory://")) return false;
  if (/[{}]/.test(uri)) return false;
  return KNOWN_MCP_RESOURCE_PATTERNS.some((pattern) => pattern.test(uri));
}

export function isKnownMcpPromptName(name: string): boolean {
  return KNOWN_MCP_PROMPTS.has(name);
}

export function stripLocalGuardParams(params: ToolParams): ToolParams {
  const { confirm, ...upstreamArgs } = params;
  return upstreamArgs;
}

export function isStringOrStringArray(value: unknown): boolean {
  return typeof value === "string" || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function isCoercedScalarString(value: string): boolean {
  return /^(?:null|undefined|true|false|nan|infinity|-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?)$/i.test(value.trim());
}

function hasInvalidMetadataString(value: string): boolean {
  const entries = value.includes(",") ? value.split(",") : [value];
  return entries.some((entry) => {
    const trimmed = entry.trim();
    return !!trimmed && isCoercedScalarString(trimmed);
  });
}

function hasInvalidMetadataValue(value: unknown): boolean {
  if (value === undefined || value === "") return false;
  if (typeof value === "string") return hasInvalidMetadataString(value);
  if (Array.isArray(value)) return value.some((entry) => typeof entry !== "string" || hasInvalidMetadataString(entry));
  return true;
}

export function hasInvalidSaveParams(params: ToolParams): boolean {
  if (typeof params.content !== "string") return true;
  for (const key of ["type", "project", "concepts", "files"] as const) {
    if (hasInvalidMetadataValue(params[key])) return true;
  }
  return false;
}

export function normalizeSaveParams(params: ToolParams): ToolParams {
  const normalized: ToolParams = { content: params.content };
  for (const key of ["type", "concepts", "files", "project"] as const) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      const entries = value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (entries.length) normalized[key] = entries.join(",");
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) normalized[key] = trimmed;
    }
  }
  if (!normalized.type) normalized.type = "fact";
  return normalized;
}
