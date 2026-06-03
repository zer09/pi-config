import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import {
  containsSecretLikeContent,
  createPlaintextBearerAuthGuard,
  isSecurityEnabled,
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

type McpResource = {
  uri?: string;
  name?: string;
  description?: string;
  mimeType?: string;
};
type McpResourceContent = {
  uri?: string;
  mimeType?: string;
  text?: string;
};
type McpResourcesResponse = {
  resources?: McpResource[];
  error?: string;
  [key: string]: unknown;
};
type McpResourceReadResponse = {
  contents?: McpResourceContent[];
  error?: string;
  [key: string]: unknown;
};
type McpPromptArgument = {
  name?: string;
  description?: string;
  required?: boolean;
};
type McpPrompt = {
  name?: string;
  description?: string;
  arguments?: McpPromptArgument[];
};
type McpPromptsResponse = {
  prompts?: McpPrompt[];
  error?: string;
  [key: string]: unknown;
};
type McpPromptMessage = {
  role?: string;
  content?: unknown;
};
type McpPromptGetResponse = {
  messages?: McpPromptMessage[];
  error?: string;
  [key: string]: unknown;
};

type ToolParams = Record<string, unknown>;
type McpToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  prepare?: (params: ToolParams) => ToolParams;
  guard?: (params: ToolParams) => string | null;
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

const KNOWN_MCP_RESOURCE_PATTERNS: RegExp[] = [
  /^agentmemory:\/\/status$/,
  /^agentmemory:\/\/project\/[^/{}]+\/profile$/,
  /^agentmemory:\/\/project\/[^/{}]+\/recent$/,
  /^agentmemory:\/\/memories\/latest$/,
  /^agentmemory:\/\/graph\/stats$/,
  /^agentmemory:\/\/team\/[^/{}]+\/profile$/,
];
const KNOWN_MCP_PROMPTS = new Set(["recall_context", "session_handoff", "detect_patterns"]);

const GATED_CONFIRM = (phrase: string) => Type.String({ description: `Required exact confirmation phrase: ${phrase}` });

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
  {
    name: "memory_slot_list",
    label: "Memory Slot List",
    description: "List read-only AgentMemory slots, including pinned, project, and global slots",
    parameters: Type.Object({}),
  },
  {
    name: "memory_slot_get",
    label: "Memory Slot Get",
    description: "Read one AgentMemory slot by label",
    parameters: Type.Object({
      label: Type.String({ description: "Slot label" }),
    }),
  },
];

const GATED_MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "memory_export",
    label: "Memory Export",
    description: "Export all AgentMemory data as JSON; gated broad private operation",
    parameters: Type.Object({
      confirm: GATED_CONFIRM("export agentmemory"),
    }),
    guard: (params) => guardGatedTool("memory_export", params),
  },
  {
    name: "memory_consolidate",
    label: "Memory Consolidate",
    description: "Run the AgentMemory memory consolidation pipeline; gated mutating operation",
    parameters: Type.Object({
      tier: Type.Optional(Type.String({ description: "Target tier: episodic, semantic, or procedural" })),
    }),
    guard: (params) => guardGatedTool("memory_consolidate", params),
  },
  {
    name: "memory_audit",
    label: "Memory Audit",
    description: "View AgentMemory audit trail entries; gated broad private inspection",
    parameters: Type.Object({
      operation: Type.Optional(Type.String({ description: "Filter by operation type" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50, description: "Maximum audit entries" })),
    }),
    guard: (params) => guardGatedTool("memory_audit", params),
  },
  {
    name: "memory_governance_delete",
    label: "Memory Governance Delete",
    description: "Delete specific AgentMemory memories with audit trail; gated destructive operation",
    parameters: Type.Object({
      memoryIds: Type.String({ description: "Comma-separated memory IDs to delete" }),
      reason: Type.Optional(Type.String({ description: "Reason for deletion" })),
      confirm: GATED_CONFIRM("delete memories:<comma-separated sorted ids>"),
    }),
    guard: (params) => guardGatedTool("memory_governance_delete", params),
  },
  {
    name: "memory_heal",
    label: "Memory Heal",
    description: "Auto-fix AgentMemory diagnostic issues; gated mutating operation unless dryRun is true",
    parameters: Type.Object({
      categories: Type.Optional(Type.String({ description: "Comma-separated categories to heal" })),
      dryRun: Type.Optional(Type.Union([
        Type.Boolean({ description: "Report fixes without applying them" }),
        Type.String({ description: "Set to 'true' for dry run" }),
      ])),
      confirm: Type.Optional(GATED_CONFIRM("heal agentmemory")),
    }),
    guard: (params) => guardGatedTool("memory_heal", params),
  },
  {
    name: "memory_lesson_save",
    label: "Memory Lesson Save",
    description: "Save a durable lesson learned; gated additional write path",
    parameters: Type.Object({
      content: Type.String({ description: "The lesson learned" }),
      context: Type.Optional(Type.String({ description: "When or where this lesson applies" })),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: "Initial confidence" })),
      project: OPTIONAL_PROJECT,
      tags: Type.Optional(Type.String({ description: "Comma-separated tags" })),
    }),
    guard: (params) => guardGatedTool("memory_lesson_save", params),
  },
  {
    name: "memory_reflect",
    label: "Memory Reflect",
    description: "Synthesize higher-order AgentMemory insights via reflection; gated LLM-backed operation",
    parameters: Type.Object({
      project: OPTIONAL_PROJECT,
      maxClusters: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum concept clusters to process" })),
    }),
    guard: (params) => guardGatedTool("memory_reflect", params),
  },
  {
    name: "memory_insight_list",
    label: "Memory Insight List",
    description: "List synthesized AgentMemory insights; gated broad private inspection",
    parameters: Type.Object({
      project: OPTIONAL_PROJECT,
      minConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: "Minimum confidence threshold" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50, description: "Maximum insights" })),
    }),
    guard: (params) => guardGatedTool("memory_insight_list", params),
  },
  {
    name: "memory_slot_create",
    label: "Memory Slot Create",
    description: "Create a named AgentMemory slot; gated persistent-state write",
    parameters: Type.Object({
      label: Type.String({ description: "Slot label" }),
      content: Type.Optional(Type.String({ description: "Initial slot content" })),
      sizeLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20000, description: "Maximum characters" })),
      description: Type.Optional(Type.String({ description: "What this slot is for" })),
      pinned: Type.Optional(Type.Union([
        Type.Boolean({ description: "Whether to include in context injection" }),
        Type.String({ description: "'false' to exclude from context injection" }),
      ])),
      scope: Type.Optional(Type.Union([
        Type.Literal("project"),
        Type.Literal("global"),
      ], { description: "Slot scope" })),
      confirm: GATED_CONFIRM("create slot:<label>"),
    }),
    guard: (params) => guardGatedTool("memory_slot_create", params),
  },
  {
    name: "memory_slot_append",
    label: "Memory Slot Append",
    description: "Append text to an AgentMemory slot; gated persistent-state write",
    parameters: Type.Object({
      label: Type.String({ description: "Slot label" }),
      text: Type.String({ description: "Text to append" }),
      confirm: GATED_CONFIRM("append slot:<label>"),
    }),
    guard: (params) => guardGatedTool("memory_slot_append", params),
  },
  {
    name: "memory_slot_replace",
    label: "Memory Slot Replace",
    description: "Replace AgentMemory slot content; gated persistent-state overwrite",
    parameters: Type.Object({
      label: Type.String({ description: "Slot label" }),
      content: Type.String({ description: "New full content" }),
      confirm: GATED_CONFIRM("replace slot:<label>"),
    }),
    guard: (params) => guardGatedTool("memory_slot_replace", params),
  },
  {
    name: "memory_slot_delete",
    label: "Memory Slot Delete",
    description: "Delete an AgentMemory slot; gated destructive persistent-state operation",
    parameters: Type.Object({
      label: Type.String({ description: "Slot label" }),
      confirm: GATED_CONFIRM("delete slot:<label>"),
    }),
    guard: (params) => guardGatedTool("memory_slot_delete", params),
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
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [] as string[];
      const block = part as TextBlock;
      if ((block.type === undefined || block.type === "text") && typeof block.text === "string") return [block.text];
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

function securityEnabled(): boolean {
  return isSecurityEnabled(process.env);
}

function containsBlockedSecret(value: unknown): boolean {
  return securityEnabled() && containsSecretLikeContent(value);
}

function protectText(text: string): string {
  return securityEnabled() ? redactSecretLikeText(text) : text;
}

function protectDisplayText(text: string): string {
  return securityEnabled() ? sanitizeTextForDisplay(text) : text;
}

function protectValue(value: unknown): unknown {
  return securityEnabled() ? redactSecretLikeValue(value) : value;
}

function formatSearchResults(results: SmartSearchResult[]): string {
  if (!results.length) return "No relevant memories found.";
  return results
    .slice(0, 5)
    .map((result, index) => {
      const obs = result.observation ?? result;
      const title = protectDisplayText(obs.title?.trim() || `Memory ${index + 1}`);
      const narrative = protectDisplayText(obs.narrative?.trim() || "");
      const type = protectDisplayText(obs.type?.trim() || "memory");
      const score = result.combinedScore ?? result.score;
      const scoreText = typeof score === "number" ? ` [score=${score.toFixed(3)}]` : "";
      return `- ${title} (${type})${scoreText}${narrative ? `: ${narrative}` : ""}`;
    })
    .join("\n");
}

function formatMcpResult(result: McpToolResponse): string {
  const text = getText(result.content);
  if (text) return protectDisplayText(text);
  if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
  return protectDisplayText(JSON.stringify(protectValue(result), null, 2));
}

function formatJsonResult(value: unknown): string {
  return protectDisplayText(JSON.stringify(protectValue(value), null, 2));
}

function formatMcpResources(result: McpResourcesResponse): string {
  const resources = Array.isArray(result.resources) ? result.resources : [];
  if (!resources.length) {
    if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
    return formatJsonResult(result);
  }
  return resources
    .map((resource) => {
      const name = protectDisplayText(resource.name?.trim() || "Unnamed resource");
      const uri = protectDisplayText(resource.uri?.trim() || "UNKNOWN");
      const description = protectDisplayText(resource.description?.trim() || "No description");
      const mimeType = protectDisplayText(resource.mimeType?.trim() || "unknown MIME type");
      return `- ${name} (${uri}, ${mimeType}): ${description}`;
    })
    .join("\n");
}

function formatMcpResourceRead(result: McpResourceReadResponse): string {
  const contents = Array.isArray(result.contents) ? result.contents : [];
  const text = contents
    .map((content) => typeof content?.text === "string" ? content.text : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (text) return protectDisplayText(text);
  if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
  return formatJsonResult(result);
}

function formatMcpPrompts(result: McpPromptsResponse): string {
  const prompts = Array.isArray(result.prompts) ? result.prompts : [];
  if (!prompts.length) {
    if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
    return formatJsonResult(result);
  }
  return prompts
    .map((prompt) => {
      const name = protectDisplayText(prompt.name?.trim() || "Unnamed prompt");
      const description = protectDisplayText(prompt.description?.trim() || "No description");
      const args = Array.isArray(prompt.arguments) && prompt.arguments.length
        ? prompt.arguments.map((arg) => `${protectDisplayText(arg.name?.trim() || "argument")}${arg.required ? " required" : " optional"}`).join(", ")
        : "no arguments";
      return `- ${name}: ${description} (args: ${args})`;
    })
    .join("\n");
}

function formatMcpPromptGet(result: McpPromptGetResponse): string {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const text = messages
    .map((message) => getText(message.content))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (text) return protectDisplayText(text);
  if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
  return formatJsonResult(result);
}

function isPlainObject(value: unknown): value is ToolParams {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parsePromptArguments(value: unknown): { args: ToolParams } | { error: string } {
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

function validatePromptArguments(name: string, args: ToolParams): string | null {
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

function normalizeMcpResourceUri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const uri = value.trim();
  return uri ? uri : null;
}

function isKnownMcpResourceUri(uri: string): boolean {
  if (!uri.startsWith("agentmemory://")) return false;
  if (/[{}]/.test(uri)) return false;
  return KNOWN_MCP_RESOURCE_PATTERNS.some((pattern) => pattern.test(uri));
}

function gatedToolsEnabled(): boolean {
  return process.env.AGENTMEMORY_PI_ENABLE_GATED === "1";
}

function stripLocalGuardParams(params: ToolParams): ToolParams {
  const { confirm, ...upstreamArgs } = params;
  return upstreamArgs;
}

function normalizeCsv(value: unknown): string {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

function normalizedLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isDryRun(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function confirmationForGatedTool(name: string, params: ToolParams): { expected?: string; error?: string } {
  switch (name) {
    case "memory_export":
      return { expected: "export agentmemory" };
    case "memory_governance_delete": {
      const ids = normalizeCsv(params.memoryIds);
      if (!ids) return { error: "memoryIds is required before confirmation" };
      return { expected: `delete memories:${ids}` };
    }
    case "memory_heal":
      return isDryRun(params.dryRun) ? {} : { expected: "heal agentmemory" };
    case "memory_slot_create": {
      const label = normalizedLabel(params.label);
      if (!label) return { error: "label is required before confirmation" };
      return { expected: `create slot:${label}` };
    }
    case "memory_slot_append": {
      const label = normalizedLabel(params.label);
      if (!label) return { error: "label is required before confirmation" };
      return { expected: `append slot:${label}` };
    }
    case "memory_slot_replace": {
      const label = normalizedLabel(params.label);
      if (!label) return { error: "label is required before confirmation" };
      return { expected: `replace slot:${label}` };
    }
    case "memory_slot_delete": {
      const label = normalizedLabel(params.label);
      if (!label) return { error: "label is required before confirmation" };
      return { expected: `delete slot:${label}` };
    }
    default:
      return {};
  }
}

function guardGatedTool(name: string, params: ToolParams): string | null {
  const upstreamArgs = stripLocalGuardParams(params);
  if (containsBlockedSecret(upstreamArgs)) {
    return "Refusing gated AgentMemory operation: parameters appear to contain a secret-looking value. Replace credential values with environment variable names or placeholders.";
  }
  const confirmation = confirmationForGatedTool(name, params);
  if (confirmation.error) return `Refusing gated AgentMemory operation: ${confirmation.error}.`;
  if (!confirmation.expected) return null;
  const actual = typeof params.confirm === "string" ? params.confirm.trim() : "";
  if (actual === confirmation.expected) return null;
  return `Refusing gated AgentMemory operation. Set confirm to ${JSON.stringify(confirmation.expected)} to proceed.`;
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
  return protectValue(value);
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
        const refusal = tool.guard?.(prepared);
        if (refusal) {
          return {
            content: [{ type: "text", text: refusal }],
            details: { ok: false, tool: tool.name, reason: "gated-guard" },
          };
        }
        const args = cleanArgs(stripLocalGuardParams(prepared));
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
      const status = protectDisplayText(health.status || health.health?.status || "unknown");
      const version = health.version ? ` v${protectDisplayText(health.version)}` : "";
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
            text: `agentmemory status: ${protectDisplayText(health.status || health.health?.status || "unknown")}${health.version ? ` (v${protectDisplayText(health.version)})` : ""}`,
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
    async execute(_toolCallId, params) {
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

  pi.registerTool({
    name: "memory_mcp_resources",
    label: "Memory MCP Resources",
    description: "List read-only AgentMemory MCP resources exposed by the AgentMemory server",
    parameters: Type.Object({}),
    async execute() {
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
    async execute(_toolCallId, params) {
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
    async execute() {
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
    async execute(_toolCallId, params) {
      const rawParams = params as ToolParams;
      const name = typeof rawParams.name === "string" ? rawParams.name.trim() : "";
      if (!KNOWN_MCP_PROMPTS.has(name)) {
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
