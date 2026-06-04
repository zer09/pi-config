import { Type } from "typebox";

import { containsBlockedSecret } from "./formatting.ts";
import { stripLocalGuardParams } from "./params.ts";
import { GATED_CONFIRM, OPTIONAL_LIMIT, OPTIONAL_PROJECT, STRING_OR_STRING_ARRAY } from "./schemas.ts";
import type { McpToolDefinition, ToolParams } from "./types.ts";

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "memory_smart_search",
    label: "Memory Smart Search",
    description: "Hybrid semantic and keyword search over AgentMemory with progressive disclosure",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      expandIds: Type.Optional(Type.String({ description: "Comma-separated observation IDs to expand" })),
      limit: OPTIONAL_LIMIT,
    }),
    guard: (params) => requireNonEmptyString("memory_smart_search", "query", params),
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

export const GATED_MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
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
      confirm: GATED_CONFIRM("consolidate agentmemory"),
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
      confirm: GATED_CONFIRM("audit agentmemory"),
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
      confirm: GATED_CONFIRM("save agentmemory lesson"),
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
      confirm: GATED_CONFIRM("reflect agentmemory"),
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
      confirm: GATED_CONFIRM("list agentmemory insights"),
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

function requireNonEmptyString(toolName: string, field: string, params: ToolParams): string | null {
  const value = params[field];
  if (typeof value === "string" && value.trim()) return null;
  return `Refusing ${toolName}: ${field} must be a non-empty string.`;
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
    case "memory_consolidate":
      return { expected: "consolidate agentmemory" };
    case "memory_audit":
      return { expected: "audit agentmemory" };
    case "memory_lesson_save":
      return { expected: "save agentmemory lesson" };
    case "memory_reflect":
      return { expected: "reflect agentmemory" };
    case "memory_insight_list":
      return { expected: "list agentmemory insights" };
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
      return { error: `${name} has no local confirmation policy` };
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
