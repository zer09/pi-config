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
    label: "CM Execute File",
    description: "Run code over one local file without returning the full file. Print only the needed answer/snippet.",
    promptSnippet: "Run code over one local file without returning the full file.",
    promptGuidelines: [
      "Use ctx_execute_file for read-only analysis of one large local file when you need a focused computed answer/snippet instead of the full file.",
      "For ctx_execute_file, print only the needed result/snippet from the analysis code; do not dump the full file.",
    ],
    parameters: ctxExecuteFileSchema,
  },
  {
    name: "ctx_batch_execute",
    label: "CM Batch Execute",
    description: "Run diagnostic shell commands, index large output, and return snippets matching queries.",
    promptSnippet: "Run diagnostic shell commands, index noisy output, and return query-matched snippets.",
    promptGuidelines: [
      "Use ctx_batch_execute for diagnostic shell command sets, tests/builds/lints/typechecks, logs, or other output likely to exceed concise terminal output.",
      "For ctx_batch_execute, provide specific queries so indexed output returns focused snippets; use concurrency: 1 for tests/builds or state-sensitive commands.",
      "For ctx_batch_execute, do not wrap commands in bash -lc, sh -c, eval, heredocs, or pipe-to-shell; pass the real command directly.",
    ],
    parameters: ctxBatchExecuteSchema,
  },
  {
    name: "ctx_search",
    label: "CM Search",
    description: "Search previously indexed context-mode output and return small matching snippets.",
    promptSnippet: "Search previously indexed context-mode command/file output.",
    promptGuidelines: [
      "Use ctx_search to search output previously indexed by ctx_batch_execute or ctx_execute_file before rerunning noisy diagnostics.",
      "For ctx_search, use exact error strings, IDs, filenames, or terms from earlier indexed output; pass source to narrow results when known.",
    ],
    parameters: ctxSearchSchema,
  },
] as const satisfies ReadonlyArray<{
  name: LeanToolName;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: readonly string[];
  parameters: JsonSchema;
}>;

export function getLeanToolDefinitionPayloads() {
  return LEAN_TOOL_METADATA.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: [...tool.promptGuidelines],
    parameters: tool.parameters,
  }));
}
