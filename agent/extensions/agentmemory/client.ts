import { DEFAULT_URL } from "./constants.ts";
import { createPlaintextBearerAuthGuard, sanitizeUrlForDisplay } from "./security.ts";
import type { McpToolResponse, ToolParams } from "./types.ts";

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

export async function callAgentMemory<T>(
  pathname: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    baseUrl?: string;
  },
): Promise<T | null> {
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
    if (!response.ok) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export async function callAgentMemoryMcpTool(name: string, args: ToolParams, pathname = "mcp/call"): Promise<McpToolResponse | null> {
  return await callAgentMemory<McpToolResponse>(pathname, {
    body: { name, arguments: args },
  });
}
