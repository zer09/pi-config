import type { JsonSchema } from "./types.js";

export const webSearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      minLength: 1,
      description:
        "Complete research question or investigation task. Do not use a terse keyword list or Google-style search operators; embed exact names, commands, errors, package names, versions, repos, dates, config keys, file extensions, and source preferences in prose when relevant.",
    },
    depth: {
      type: "string",
      enum: ["standard", "deep"],
      description:
        "Optional research depth. Omit or use standard for ordinary grounded research; use deep for exhaustive research where higher latency is acceptable.",
    },
  },
  required: ["query"],
} satisfies JsonSchema;

export const webCodeSearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      minLength: 1,
      description:
        "Complete developer-research question or investigation task stated in prose. Embed exact package names, SDK names, APIs, error messages, and configuration keys inside a sentence that states what is needed.",
    },
    focus: {
      type: "string",
      enum: ["developer_sources", "implementation_examples"],
      description:
        'Required search focus. Use "developer_sources" for authoritative documentation, READMEs, issues, pull requests, and API contracts. Use "implementation_examples" for exact syntax, working snippets, and implementation patterns.',
    },
  },
  required: ["query", "focus"],
} satisfies JsonSchema;

export const fetchContentsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    uris: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
      description: "Explicit URLs to fetch as full Markdown text.",
    },
    maxCharacters: {
      type: "integer",
      minimum: 1,
      description: "Maximum Markdown characters to return per URL. Defaults to 12000.",
    },
    maxAgeHours: {
      type: "integer",
      minimum: 0,
      maximum: 720,
      description:
        "Maximum acceptable age in hours for cached or provider-cached content. Defaults to 24. Use 0 to bypass local caching and request fresh content.",
    },
  },
  required: ["uris"],
} satisfies JsonSchema;
