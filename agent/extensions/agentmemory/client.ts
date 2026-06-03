import { DEFAULT_URL } from "./constants.ts";
import { createPlaintextBearerAuthGuard, sanitizeUrlForDisplay } from "./security.ts";
import type { McpToolResponse, ToolParams } from "./types.ts";

type AgentMemoryRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  baseUrl?: string;
};

type AgentMemoryHttpResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; status: number; error: string; body?: unknown };

export const guardPlaintextBearerAuth = createPlaintextBearerAuthGuard();

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString()
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+(?::[^\s/?#@]*)?@/gi, "$1")
      .replace(/\/+$/, "");
  } catch {
    return trimmed
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+(?::[^\s/?#@]*)?@/gi, "$1")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

export function configuredBaseUrl(): string {
  return normalizeBaseUrl(process.env.AGENTMEMORY_URL || DEFAULT_URL);
}

export function displayBaseUrl(): string {
  return sanitizeUrlForDisplay(configuredBaseUrl());
}

function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false } {
  if (!text) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function responseErrorText(status: number, text: string, parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const error = (parsed as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error.trim();
    const message = (parsed as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (text.trim()) return text.trim();
  return `HTTP ${status}`;
}

export async function callAgentMemoryDetailed<T>(
  pathname: string,
  options?: AgentMemoryRequestOptions,
): Promise<AgentMemoryHttpResult<T> | null> {
  const baseUrl = normalizeBaseUrl(options?.baseUrl || process.env.AGENTMEMORY_URL || DEFAULT_URL);
  const method = options?.method || "POST";
  const url = `${baseUrl}/agentmemory/${pathname.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = {};
  const secret = process.env.AGENTMEMORY_SECRET;
  guardPlaintextBearerAuth(baseUrl, secret);
  if (options?.body !== undefined) headers["Content-Type"] = "application/json";
  if (secret) headers.Authorization = `Bearer ${secret}`;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const parsed = parseJsonText(text);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: responseErrorText(response.status, text, parsed.ok ? parsed.value : undefined),
        body: parsed.ok ? parsed.value : undefined,
      };
    }
    if (!parsed.ok) return null;
    return { ok: true, value: parsed.value as T | null };
  } catch {
    return null;
  }
}

export async function callAgentMemory<T>(pathname: string, options?: AgentMemoryRequestOptions): Promise<T | null> {
  const result = await callAgentMemoryDetailed<T>(pathname, options);
  return result?.ok ? result.value : null;
}

export async function callAgentMemoryMcpTool(
  name: string,
  args: ToolParams,
  pathname = "mcp/call",
  options?: { includeHttpErrors?: boolean },
): Promise<McpToolResponse | null> {
  const result = await callAgentMemoryDetailed<McpToolResponse>(pathname, {
    body: { name, arguments: args },
  });
  if (!result) return null;
  if (result.ok) return result.value;
  if (!options?.includeHttpErrors) return null;
  return {
    isError: true,
    error: result.error,
    httpStatus: result.status,
    upstream: result.body,
  };
}
