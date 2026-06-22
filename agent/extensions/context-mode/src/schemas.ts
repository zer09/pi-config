import type { JsonSchema, LeanToolName } from "./types.js";

export const SUPPORTED_LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "shell",
  "ruby",
  "go",
  "rust",
  "php",
  "perl",
  "r",
  "elixir",
  "csharp",
] as const;

export const ctxExecuteFileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: {
      type: "string",
      description: "File path, absolute or relative to project root.",
    },
    language: {
      type: "string",
      enum: [...SUPPORTED_LANGUAGES],
      description: "Runtime language for the analysis code.",
    },
    code: {
      type: "string",
      description: "Code that reads FILE_CONTENT and prints only the result.",
    },
    timeout: {
      type: "number",
      minimum: 0,
      description: "Optional timeout in milliseconds.",
    },
    intent: {
      type: "string",
      description: "Optional search intent if printed output is large.",
    },
  },
  required: ["path", "language", "code"],
} satisfies JsonSchema;

export const ctxBatchExecuteSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    commands: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          command: { type: "string" },
        },
        required: ["label", "command"],
      },
      description: "Commands to run for large/noisy diagnostic output.",
    },
    queries: {
      type: "array",
      items: { type: "string" },
      description: "Specific search queries for relevant snippets.",
    },
    timeout: {
      type: "number",
      minimum: 0,
      description: "Optional timeout in milliseconds.",
    },
    concurrency: {
      type: "integer",
      minimum: 1,
      maximum: 4,
      description: "Parallel command limit. Default 1; use 1 for tests/builds.",
    },
    cwd: {
      type: "string",
      description: "Optional working directory. Defaults to project root.",
    },
  },
  required: ["commands", "queries"],
} satisfies JsonSchema;

export const ctxSearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    queries: {
      type: "array",
      items: { type: "string" },
      description: "Specific terms to search for. Use exact IDs/errors when possible.",
    },
    source: {
      type: "string",
      description: "Optional source label filter.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      description: "Max results per query.",
    },
    contentType: {
      type: "string",
      enum: ["code", "prose"],
      description: "Optional content type filter.",
    },
  },
  required: ["queries"],
} satisfies JsonSchema;

export const LEAN_TOOL_METADATA = [
  {
    name: "ctx_execute_file",
    label: "ctx_execute_file",
    description: "Run code over one local file without returning the full file. Print only the needed answer/snippet.",
    parameters: ctxExecuteFileSchema,
  },
  {
    name: "ctx_batch_execute",
    label: "ctx_batch_execute",
    description: "Run diagnostic shell commands, index large output, and return snippets matching queries.",
    parameters: ctxBatchExecuteSchema,
  },
  {
    name: "ctx_search",
    label: "ctx_search",
    description: "Search previously indexed context-mode output and return small matching snippets.",
    parameters: ctxSearchSchema,
  },
] as const satisfies ReadonlyArray<{
  name: LeanToolName;
  label: LeanToolName;
  description: string;
  parameters: JsonSchema;
}>;

export function getLeanToolDefinitionPayloads() {
  return LEAN_TOOL_METADATA.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
