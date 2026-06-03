import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Type } from "typebox";

import { callAgentMemory, callAgentMemoryMcpTool, configuredBaseUrl, displayBaseUrl, guardPlaintextBearerAuth } from "./client.ts";
import { SKILLS_DIR, TOOL_GUIDANCE } from "./constants.ts";
import { buildPiDiagnostics, formatPiDiagnosticsFooter, formatPolicyDriftWarning, isFollowupDiagnostic } from "./diagnostics.ts";
import {
  cleanArgs,
  containsBlockedSecret,
  formatMcpPromptGet,
  formatMcpPrompts,
  formatMcpResourceRead,
  formatMcpResources,
  formatMcpResult,
  formatSearchResults,
  getLastAssistantText,
  protectDisplayText,
  protectText,
  sanitizeForLookup,
} from "./formatting.ts";
import {
  hasInvalidSaveParams,
  isKnownMcpPromptName,
  isKnownMcpResourceUri,
  normalizeMcpResourceUri,
  normalizeSaveParams,
  parsePromptArguments,
  stripLocalGuardParams,
  validatePromptArguments,
} from "./params.ts";
import { OPTIONAL_PROJECT, STRING_OR_STRING_ARRAY } from "./schemas.ts";
import { GATED_MCP_TOOL_DEFINITIONS, MCP_TOOL_DEFINITIONS } from "./tool-definitions.ts";
import type {
  AgentMemoryStatusContext,
  FollowupDiagnosticResponse,
  HealthResponse,
  McpPromptGetResponse,
  McpPromptsResponse,
  McpResourceReadResponse,
  McpResourcesResponse,
  McpToolDefinition,
  SmartSearchResult,
  ToolParams,
} from "./types.ts";

type AgentMemoryToolResult = AgentToolResult<ToolParams>;

function gatedToolsEnabled(): boolean {
  return process.env.AGENTMEMORY_PI_ENABLE_GATED === "1";
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

  async function getFollowupDiagnostic() {
    const result = await callAgentMemory<FollowupDiagnosticResponse>("diagnostics/followup", { method: "GET" });
    return isFollowupDiagnostic(result) ? result : null;
  }

  async function getPiDiagnostics(health?: HealthResponse | null) {
    const effectiveHealth = health === undefined ? await getHealth() : health;
    const followup = effectiveHealth ? await getFollowupDiagnostic() : null;
    return {
      text: formatPiDiagnosticsFooter(effectiveHealth, followup),
      details: buildPiDiagnostics(effectiveHealth, followup),
    };
  }

  async function refreshStatus(ctx: AgentMemoryStatusContext) {
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
      async execute(_toolCallId, params): Promise<AgentMemoryToolResult> {
        const prepared = tool.prepare ? tool.prepare(params as ToolParams) : params as ToolParams;
        const refusal = tool.guard?.(prepared);
        if (refusal) {
          return {
            content: [{ type: "text", text: refusal }],
            details: { ok: false, tool: tool.name, reason: "gated-guard" },
          };
        }
        const args = cleanArgs(stripLocalGuardParams(prepared));
        const result = await callAgentMemoryMcpTool(tool.name, args, "mcp/call");
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
        const diagnostics = tool.name === "memory_diagnose" ? await getPiDiagnostics() : { text: "", details: null };
        return {
          content: [{ type: "text", text: [formatMcpResult(result), diagnostics.text].filter(Boolean).join("\n\n") }],
          details: { tool: tool.name, result: sanitizeForLookup(result), piDiagnostics: sanitizeForLookup(diagnostics.details) },
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
      const status = protectDisplayText(health.status || health.health?.status || "unknown");
      const version = health.version ? ` v${protectDisplayText(health.version)}` : "";
      const drift = formatPolicyDriftWarning(health);
      ctx.ui.notify(
        `agentmemory ${status}${version}${drift ? `; ${drift}` : ""}`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "memory_health",
    label: "Memory Health",
    description: "Check whether the local agentmemory server is reachable and healthy",
    parameters: Type.Object({}),
    async execute(): Promise<AgentMemoryToolResult> {
      const health = await getHealth();
      if (!health) {
        return {
          content: [{ type: "text", text: `agentmemory is unreachable at ${displayBaseUrl()}` }],
          details: { ok: false },
        };
      }
      const diagnostics = await getPiDiagnostics(health);
      const statusText = `agentmemory status: ${protectDisplayText(health.status || health.health?.status || "unknown")}${health.version ? ` (v${protectDisplayText(health.version)})` : ""}`;
      return {
        content: [
          {
            type: "text",
            text: [statusText, diagnostics.text].filter(Boolean).join("\n\n"),
          },
        ],
        details: { ...(sanitizeForLookup(health) as ToolParams), piDiagnostics: sanitizeForLookup(diagnostics.details) },
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
    async execute(_toolCallId, params): Promise<AgentMemoryToolResult> {
      const query = protectText(params.query);
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
    async execute(_toolCallId, params): Promise<AgentMemoryToolResult> {
      const rawArgs = params as ToolParams;
      if (containsBlockedSecret(rawArgs)) {
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
      if (containsBlockedSecret(args)) {
        return {
          content: [{ type: "text", text: "Refusing to save memory: content appears to contain a secret-looking value. Replace credential values with environment variable names or placeholders." }],
          details: { ok: false, reason: "secret-like-content" },
        };
      }

      const mcpResult = await callAgentMemoryMcpTool("memory_save", args, "mcp/call");
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

  pi.registerTool({
    name: "memory_mcp_resources",
    label: "Memory MCP Resources",
    description: "List read-only AgentMemory MCP resources exposed by the AgentMemory server",
    parameters: Type.Object({}),
    async execute(): Promise<AgentMemoryToolResult> {
      const result = await callAgentMemory<McpResourcesResponse>("mcp/resources", { method: "GET" });
      if (!result) {
        return {
          content: [{ type: "text", text: `Failed to list AgentMemory MCP resources; agentmemory may be unreachable at ${displayBaseUrl()}.` }],
          details: { ok: false, endpoint: "mcp/resources" },
        };
      }
      if (typeof result.error === "string" && result.error.trim()) {
        return {
          content: [{ type: "text", text: `memory_mcp_resources failed: ${formatMcpResources(result)}` }],
          details: { ok: false, result: sanitizeForLookup(result) },
        };
      }
      return {
        content: [{ type: "text", text: formatMcpResources(result) }],
        details: { result: sanitizeForLookup(result) },
      };
    },
  });

  pi.registerTool({
    name: "memory_mcp_resource_read",
    label: "Memory MCP Resource Read",
    description: "Read one read-only AgentMemory MCP resource by exact agentmemory:// URI",
    parameters: Type.Object({
      uri: Type.String({ description: "Exact AgentMemory MCP resource URI to read" }),
    }),
    async execute(_toolCallId, params): Promise<AgentMemoryToolResult> {
      const uri = normalizeMcpResourceUri((params as ToolParams).uri);
      if (!uri || !isKnownMcpResourceUri(uri)) {
        return {
          content: [{ type: "text", text: "Refusing to read AgentMemory MCP resource: uri must be an exact agentmemory:// URI matching a known read-only resource template." }],
          details: { ok: false, reason: "invalid-resource-uri" },
        };
      }
      if (containsBlockedSecret({ uri })) {
        return {
          content: [{ type: "text", text: "Refusing to read AgentMemory MCP resource: uri appears to contain a secret-looking value." }],
          details: { ok: false, reason: "secret-like-uri" },
        };
      }
      const result = await callAgentMemory<McpResourceReadResponse>("mcp/resources/read", { body: { uri } });
      if (!result) {
        return {
          content: [{ type: "text", text: `Failed to read AgentMemory MCP resource; agentmemory may be unreachable at ${displayBaseUrl()}.` }],
          details: { ok: false, uri },
        };
      }
      if (typeof result.error === "string" && result.error.trim()) {
        return {
          content: [{ type: "text", text: `memory_mcp_resource_read failed: ${formatMcpResourceRead(result)}` }],
          details: { ok: false, uri, result: sanitizeForLookup(result) },
        };
      }
      return {
        content: [{ type: "text", text: formatMcpResourceRead(result) }],
        details: { uri, result: sanitizeForLookup(result) },
      };
    },
  });

  pi.registerTool({
    name: "memory_mcp_prompts",
    label: "Memory MCP Prompts",
    description: "List AgentMemory MCP prompt templates available for agent review",
    parameters: Type.Object({}),
    async execute(): Promise<AgentMemoryToolResult> {
      const result = await callAgentMemory<McpPromptsResponse>("mcp/prompts", { method: "GET" });
      if (!result) {
        return {
          content: [{ type: "text", text: `Failed to list AgentMemory MCP prompts; agentmemory may be unreachable at ${displayBaseUrl()}.` }],
          details: { ok: false, endpoint: "mcp/prompts" },
        };
      }
      if (typeof result.error === "string" && result.error.trim()) {
        return {
          content: [{ type: "text", text: `memory_mcp_prompts failed: ${formatMcpPrompts(result)}` }],
          details: { ok: false, result: sanitizeForLookup(result) },
        };
      }
      return {
        content: [{ type: "text", text: formatMcpPrompts(result) }],
        details: { result: sanitizeForLookup(result) },
      };
    },
  });

  pi.registerTool({
    name: "memory_mcp_prompt_get",
    label: "Memory MCP Prompt Get",
    description: "Get an AgentMemory MCP prompt by name and arguments; returns prompt text for review, not automatic execution",
    parameters: Type.Object({
      name: Type.String({ description: "Prompt name: recall_context, session_handoff, or detect_patterns" }),
      arguments: Type.Optional(Type.Union([
        Type.Record(Type.String(), Type.Unknown(), { description: "Prompt arguments object" }),
        Type.String({ description: "Prompt arguments as a JSON object string" }),
      ], { description: "Prompt arguments as an object or JSON string" })),
    }),
    async execute(_toolCallId, params): Promise<AgentMemoryToolResult> {
      const rawParams = params as ToolParams;
      const name = typeof rawParams.name === "string" ? rawParams.name.trim() : "";
      if (!isKnownMcpPromptName(name)) {
        return {
          content: [{ type: "text", text: "Refusing to get AgentMemory MCP prompt: name must be recall_context, session_handoff, or detect_patterns." }],
          details: { ok: false, reason: "invalid-prompt-name" },
        };
      }
      const parsedArguments = parsePromptArguments(rawParams.arguments);
      if ("error" in parsedArguments) {
        return {
          content: [{ type: "text", text: `Refusing to get AgentMemory MCP prompt: ${parsedArguments.error}.` }],
          details: { ok: false, reason: "invalid-prompt-arguments" },
        };
      }
      const validationError = validatePromptArguments(name, parsedArguments.args);
      if (validationError) {
        return {
          content: [{ type: "text", text: `Refusing to get AgentMemory MCP prompt: ${validationError}.` }],
          details: { ok: false, reason: "invalid-prompt-arguments" },
        };
      }
      const args = cleanArgs(parsedArguments.args);
      const result = await callAgentMemory<McpPromptGetResponse>("mcp/prompts/get", { body: { name, arguments: args } });
      if (!result) {
        return {
          content: [{ type: "text", text: `Failed to get AgentMemory MCP prompt; agentmemory may be unreachable at ${displayBaseUrl()}.` }],
          details: { ok: false, name },
        };
      }
      if (typeof result.error === "string" && result.error.trim()) {
        return {
          content: [{ type: "text", text: `memory_mcp_prompt_get failed: ${formatMcpPromptGet(result)}` }],
          details: { ok: false, name, result: sanitizeForLookup(result) },
        };
      }
      return {
        content: [{ type: "text", text: formatMcpPromptGet(result) }],
        details: { name, result: sanitizeForLookup(result) },
      };
    },
  });

  for (const tool of MCP_TOOL_DEFINITIONS) registerMcpTool(tool);
  if (gatedToolsEnabled()) {
    for (const tool of GATED_MCP_TOOL_DEFINITIONS) registerMcpTool(tool);
  }

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

    const query = protectText(lastPrompt);
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
          tool_input: protectText(lastPrompt).slice(0, 500),
          tool_output: protectText(assistantText).slice(0, 4000),
        },
      },
    });
  });
}
