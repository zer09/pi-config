import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import {
  containsSecretLikeContent,
  createPlaintextBearerAuthGuard,
  redactSecretLikeText,
  redactSecretLikeValue,
  sanitizeTextForDisplay,
  sanitizeUrlForDisplay,
} from "./security.js";

type TextBlock = { type?: string; text?: string };
type AssistantMessage = { role?: string; content?: unknown };
type SmartSearchResult = {
  title?: string;
  narrative?: string;
  type?: string;
  combinedScore?: number;
  score?: number;
  observation?: {
    title?: string;
    narrative?: string;
    type?: string;
  };
};

type HealthResponse = {
  status?: string;
  service?: string;
  version?: string;
  health?: {
    status?: string;
    notes?: string[];
  };
};

type McpToolResponse = {
  content?: TextBlock[];
  error?: string;
  isError?: boolean;
  [key: string]: unknown;
};

type ToolParams = Record<string, unknown>;
type McpToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  prepare?: (params: ToolParams) => ToolParams;
};

const DEFAULT_URL = process.env.AGENTMEMORY_URL || "http://localhost:3111";
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(EXTENSION_DIR, "skills");
const guardPlaintextBearerAuth = createPlaintextBearerAuthGuard();
const TOOL_GUIDANCE = [
  "agentmemory is available for cross-session memory.",
  "Use memory_search or memory_smart_search to recall prior decisions, preferences, bugs, and workflows.",
  "Use memory_file_history for file-specific prior work and memory_commit_lookup for commit provenance.",
  "Use memory_save only for durable non-secret facts worth remembering beyond this session.",
].join(" ");

const OPTIONAL_LIMIT = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10, description: "Maximum results" }));
const OPTIONAL_PROJECT = Type.Optional(Type.String({ description: "Project identifier" }));
const STRING_OR_STRING_ARRAY = (description: string) => Type.Union([
  Type.String({ description }),
  Type.Array(Type.String(), { description }),
]);

const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "memory_smart_search",
    label: "Memory Smart Search",
    description: "Hybrid semantic and keyword search over AgentMemory with progressive disclosure",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      expandIds: Type.Optional(Type.String({ description: "Comma-separated observation IDs to expand" })),
      limit: OPTIONAL_LIMIT,
    }),
  },
  {
    name: "memory_recall",
    label: "Memory Recall",
    description: "Recall relevant observations from prior AgentMemory sessions",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: OPTIONAL_LIMIT,
      format: Type.Optional(Type.Union([
        Type.Literal("full"),
        Type.Literal("compact"),
        Type.Literal("narrative"),
      ], { description: "Result format" })),
      token_budget: Type.Optional(Type.Integer({ minimum: 1, description: "Optional token budget" })),
    }),
  },
  {
    name: "memory_sessions",
    label: "Memory Sessions",
    description: "List recent AgentMemory sessions with status and observation counts",
    parameters: Type.Object({}),
  },
  {
    name: "memory_file_history",
    label: "Memory File History",
    description: "Get AgentMemory history for specific files",
    parameters: Type.Object({
      files: STRING_OR_STRING_ARRAY("Comma-separated file paths or an array of file paths"),
      sessionId: Type.Optional(Type.String({ description: "Current session ID to exclude" })),
    }),
    prepare(params) {
      const files = params.files;
      return {
        ...params,
        files: Array.isArray(files) ? files.filter((file) => typeof file === "string" && file.trim()).join(",") : files,
      };
    },
  },
  {
    name: "memory_timeline",
    label: "Memory Timeline",
    description: "Get chronological AgentMemory observations around an anchor point",
    parameters: Type.Object({
      anchor: Type.String({ description: "Anchor point: ISO date or keyword" }),
      project: OPTIONAL_PROJECT,
      before: Type.Optional(Type.Integer({ minimum: 0, description: "Observations before anchor" })),
      after: Type.Optional(Type.Integer({ minimum: 0, description: "Observations after anchor" })),
    }),
  },
  {
    name: "memory_patterns",
    label: "Memory Patterns",
    description: "Detect recurring patterns across AgentMemory sessions",
    parameters: Type.Object({
      project: OPTIONAL_PROJECT,
    }),
  },
  {
    name: "memory_profile",
    label: "Memory Profile",
    description: "Read a user or project AgentMemory profile with concepts and file patterns",
    parameters: Type.Object({
      project: Type.String({ description: "Stable project identifier" }),
      refresh: Type.Optional(Type.Boolean({ description: "Force profile rebuild" })),
    }),
  },
  {
    name: "memory_commit_lookup",
    label: "Memory Commit Lookup",
    description: "Look up AgentMemory sessions linked to a git commit SHA",
    parameters: Type.Object({
      sha: Type.String({ description: "Full git commit SHA" }),
    }),
  },
  {
    name: "memory_commits",
    label: "Memory Commits",
    description: "List recent commits linked to AgentMemory sessions",
    parameters: Type.Object({
      branch: Type.Optional(Type.String({ description: "Filter by branch name" })),
      repo: Type.Optional(Type.String({ description: "Filter by remote URL" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100, description: "Maximum commits" })),
    }),
  },
  {
    name: "memory_diagnose",
    label: "Memory Diagnose",
    description: "Run read-only AgentMemory diagnostics",
    parameters: Type.Object({
      categories: Type.Optional(Type.String({ description: "Comma-separated diagnostic categories" })),
    }),
  },
  {
    name: "memory_verify",
    label: "Memory Verify",
    description: "Verify and inspect provenance for an AgentMemory ID",
    parameters: Type.Object({
      id: Type.String({ description: "Memory or observation ID to verify" }),
    }),
  },
  {
    name: "memory_lesson_recall",
    label: "Memory Lesson Recall",
    description: "Recall durable lessons from AgentMemory",
    parameters: Type.Object({
      query: Type.String({ description: "Lesson search query" }),
      project: OPTIONAL_PROJECT,
      limit: OPTIONAL_LIMIT,
      minConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: "Minimum confidence" })),
    }),
  },
];

function normalizeBaseUrl(url: string): string {
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

function configuredBaseUrl(): string {
  return normalizeBaseUrl(process.env.AGENTMEMORY_URL || DEFAULT_URL);
}

function displayBaseUrl(): string {
  return sanitizeUrlForDisplay(configuredBaseUrl());
}

function getText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [] as string[];
      const block = part as TextBlock;
      if (block.type === "text" && typeof block.text === "string") return [block.text];
      return [] as string[];
    })
    .join("\n")
    .trim();
}

function getLastAssistantText(messages: unknown[]): string {
  for (const msg of [...messages].reverse()) {
    if (!msg || typeof msg !== "object") continue;
    const assistant = msg as AssistantMessage;
    if (assistant.role !== "assistant") continue;
    const text = getText(assistant.content);
    if (text) return text;
  }
  return "";
}

function formatSearchResults(results: SmartSearchResult[]): string {
  if (!results.length) return "No relevant memories found.";
  return results
    .slice(0, 5)
    .map((result, index) => {
      const obs = result.observation ?? result;
      const title = sanitizeTextForDisplay(obs.title?.trim() || `Memory ${index + 1}`);
      const narrative = sanitizeTextForDisplay(obs.narrative?.trim() || "");
      const type = sanitizeTextForDisplay(obs.type?.trim() || "memory");
      const score = result.combinedScore ?? result.score;
      const scoreText = typeof score === "number" ? ` [score=${score.toFixed(3)}]` : "";
      return `- ${title} (${type})${scoreText}${narrative ? `: ${narrative}` : ""}`;
    })
    .join("\n");
}

function formatMcpResult(result: McpToolResponse): string {
  const text = getText(result.content);
  if (text) return sanitizeTextForDisplay(text);
  if (typeof result.error === "string" && result.error.trim()) return sanitizeTextForDisplay(result.error.trim());
  return sanitizeTextForDisplay(JSON.stringify(redactSecretLikeValue(result), null, 2));
}

function cleanArgs(params: ToolParams): ToolParams {
  const args: ToolParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    args[key] = sanitizeForLookup(value);
  }
  return args;
}

function sanitizeForLookup(value: unknown): unknown {
  return redactSecretLikeValue(value);
}

function isStringOrStringArray(value: unknown): boolean {
  return typeof value === "string" || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function hasInvalidSaveParams(params: ToolParams): boolean {
  if (typeof params.content !== "string") return true;
  if (params.type !== undefined && params.type !== "" && typeof params.type !== "string") return true;
  if (params.project !== undefined && params.project !== "" && typeof params.project !== "string") return true;
  for (const key of ["concepts", "files"] as const) {
    const value = params[key];
    if (value !== undefined && value !== "" && !isStringOrStringArray(value)) return true;
  }
  return false;
}

function normalizeSaveParams(params: ToolParams): ToolParams {
  const normalized: ToolParams = { content: params.content };
  for (const key of ["type", "concepts", "files", "project"] as const) {
    const value = params[key];
    if (value === undefined || value === "") continue;
    normalized[key] = Array.isArray(value) ? value.filter((entry) => entry.trim()).join(",") : value;
  }
  if (!normalized.type) normalized.type = "fact";
  return normalized;
}

async function callAgentMemory<T>(
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

async function callAgentMemoryMcpTool(name: string, args: ToolParams): Promise<McpToolResponse | null> {
  return await callAgentMemory<McpToolResponse>("mcp/call", {
    body: { name, arguments: args },
  });
}

export default function agentmemoryExtension(pi: ExtensionAPI) {
  if (process.env.PI_DELEGATE_CHILD) return;

  if (process.env.AGENTMEMORY_REQUIRE_HTTPS === "1") {
    guardPlaintextBearerAuth(
      configuredBaseUrl(),
      process.env.AGENTMEMORY_SECRET,
    );
  }
  let sessionId = `ephemeral-${randomUUID().slice(0, 8)}`;
  let currentProject = process.cwd();
  let lastPrompt = "";
  let lastHealthOk = false;

  async function getHealth() {
    return await callAgentMemory<HealthResponse>("health", { method: "GET" });
  }

  async function refreshStatus(ctx: { hasUI?: boolean; ui?: { setStatus: (key: string, text: string) => void } }) {
    const health = await getHealth();
    lastHealthOk = !!health && (health.status === "healthy" || health.health?.status === "healthy");
    if (ctx.hasUI === false || !ctx.ui) return;
    ctx.ui.setStatus("agentmemory", lastHealthOk ? "🧠 agentmemory" : "🧠 agentmemory off");
  }

  function registerMcpTool(tool: McpToolDefinition) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_toolCallId, params) {
        const prepared = tool.prepare ? tool.prepare(params as ToolParams) : params as ToolParams;
        const args = cleanArgs(prepared);
        const result = await callAgentMemoryMcpTool(tool.name, args);
        if (!result) {
          return {
            content: [{ type: "text", text: `Failed to call ${tool.name}; agentmemory may be unreachable at ${displayBaseUrl()}.` }],
            details: { ok: false, tool: tool.name },
          };
        }
        if (result.isError) {
          return {
            content: [{ type: "text", text: `${tool.name} failed: ${formatMcpResult(result)}` }],
            details: { ok: false, tool: tool.name, result: sanitizeForLookup(result) },
          };
        }
        return {
          content: [{ type: "text", text: formatMcpResult(result) }],
          details: { tool: tool.name, result: sanitizeForLookup(result) },
        };
      },
    });
  }

  pi.on("resources_discover", async () => ({
    skillPaths: [SKILLS_DIR],
  }));

  pi.registerCommand("agentmemory-status", {
    description: "Check local agentmemory server health",
    handler: async (_args, ctx) => {
      if (ctx.hasUI === false || !ctx.ui) return;
      const health = await getHealth();
      if (!health) {
        ctx.ui.notify(`agentmemory is unreachable at ${displayBaseUrl()}`, "warning");
        return;
      }
      const status = sanitizeTextForDisplay(health.status || health.health?.status || "unknown");
      const version = health.version ? ` v${sanitizeTextForDisplay(health.version)}` : "";
      ctx.ui.notify(
        `agentmemory ${status}${version}`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "memory_health",
    label: "Memory Health",
    description: "Check whether the local agentmemory server is reachable and healthy",
    parameters: Type.Object({}),
    async execute() {
      const health = await getHealth();
      if (!health) {
        return {
          content: [{ type: "text", text: `agentmemory is unreachable at ${displayBaseUrl()}` }],
          details: { ok: false },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `agentmemory status: ${sanitizeTextForDisplay(health.status || health.health?.status || "unknown")}${health.version ? ` (v${sanitizeTextForDisplay(health.version)})` : ""}`,
          },
        ],
        details: sanitizeForLookup(health),
      };
    },
  });

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search agentmemory for cross-session project memory, prior decisions, bugs, and user preferences",
    parameters: Type.Object({
      query: Type.String({ description: "What to search for in memory" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5, description: "Maximum results" })),
    }),
    async execute(_toolCallId, params) {
      const query = redactSecretLikeText(params.query);
      const result = await callAgentMemory<{ results?: SmartSearchResult[] }>("smart-search", {
        body: { query, limit: params.limit ?? 5 },
      });
      const results = result?.results || [];
      return {
        content: [{ type: "text", text: formatSearchResults(results) }],
        details: { query, results: sanitizeForLookup(results) },
      };
    },
  });

  pi.registerTool({
    name: "memory_save",
    label: "Memory Save",
    description: "Save a durable fact, convention, workflow, preference, or bug fix into agentmemory",
    parameters: Type.Object({
      content: Type.String({ description: "What should be remembered" }),
      type: Type.Optional(Type.String({ description: "Memory type", default: "fact" })),
      concepts: Type.Optional(STRING_OR_STRING_ARRAY("Key concepts")),
      files: Type.Optional(STRING_OR_STRING_ARRAY("Relevant file paths")),
      project: OPTIONAL_PROJECT,
    }),
    async execute(_toolCallId, params) {
      const rawArgs = params as ToolParams;
      if (containsSecretLikeContent(rawArgs)) {
        return {
          content: [{ type: "text", text: "Refusing to save memory: content appears to contain a secret-looking value. Replace credential values with environment variable names or placeholders." }],
          details: { ok: false, reason: "secret-like-content" },
        };
      }
      if (hasInvalidSaveParams(rawArgs)) {
        return {
          content: [{ type: "text", text: "Refusing to save memory: content and metadata fields must be strings or string arrays." }],
          details: { ok: false, reason: "invalid-save-params" },
        };
      }
      const args = normalizeSaveParams(rawArgs);
      if (containsSecretLikeContent(args)) {
        return {
          content: [{ type: "text", text: "Refusing to save memory: content appears to contain a secret-looking value. Replace credential values with environment variable names or placeholders." }],
          details: { ok: false, reason: "secret-like-content" },
        };
      }

      const mcpResult = await callAgentMemoryMcpTool("memory_save", args);
      if (mcpResult?.isError) {
        return {
          content: [{ type: "text", text: `memory_save failed: ${formatMcpResult(mcpResult)}` }],
          details: { ok: false, result: sanitizeForLookup(mcpResult) },
        };
      }
      const result = mcpResult || await callAgentMemory<Record<string, unknown>>("remember", { body: args });
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to save memory to agentmemory." }],
          details: { ok: false },
        };
      }
      return {
        content: [{ type: "text", text: `Saved memory (${args.type || "fact"}).` }],
        details: { ok: true, type: args.type || "fact" },
      };
    },
  });

  for (const tool of MCP_TOOL_DEFINITIONS) registerMcpTool(tool);

  pi.on("session_start", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    sessionId = sessionFile ? basename(sessionFile).replace(/\.[^.]+$/, "") : `ephemeral-${randomUUID().slice(0, 8)}`;
    currentProject = process.cwd();
    await refreshStatus(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentProject = event.systemPromptOptions.cwd || process.cwd();
    lastPrompt = event.prompt?.trim() || "";
    if (!lastPrompt) return;

    const query = redactSecretLikeText(lastPrompt);
    const result = await callAgentMemory<{ results?: SmartSearchResult[] }>("smart-search", {
      body: { query, limit: 5 },
    });
    const results = result?.results || [];
    const recallBlock = results.length
      ? [
          "Relevant long-term memory from agentmemory:",
          formatSearchResults(results),
        ].join("\n")
      : "";

    await refreshStatus(ctx);
    return {
      systemPrompt: [event.systemPrompt, TOOL_GUIDANCE, recallBlock].filter(Boolean).join("\n\n"),
    };
  });

  pi.on("agent_end", async (event) => {
    if (!lastHealthOk || !lastPrompt) return;
    const assistantText = getLastAssistantText(event.messages as unknown[]);
    if (!assistantText) return;
    void callAgentMemory("observe", {
      body: {
        hookType: "post_tool_use",
        sessionId,
        project: currentProject,
        cwd: currentProject,
        timestamp: new Date().toISOString(),
        data: {
          tool_name: "conversation",
          tool_input: redactSecretLikeText(lastPrompt).slice(0, 500),
          tool_output: redactSecretLikeText(assistantText).slice(0, 4000),
        },
      },
    });
  });
}
