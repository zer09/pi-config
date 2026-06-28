import type { JsonSchema } from "./types.js";

export const webSearchExaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      minLength: 1,
      description:
        "Plain-English search request. Prefer detailed natural-language questions/descriptions; include exact names, errors, versions, dates, or desired source types when relevant.",
    },
    mode: {
      type: "string",
      enum: ["auto", "web", "code"],
      description:
        "Optional fallback routing hint. Use auto by default; use web for general web/docs/news and code for code-oriented results."
    },
  },
  required: ["query"],
} satisfies JsonSchema;

export const fetchGroundingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    responseId: {
      type: "string",
      minLength: 1,
      description: "Raw response ID returned by web_search.",
    },
    groundingIds: {
      type: "array",
      items: { type: "integer", minimum: 0 },
      description: "Source support IDs shown in a web_search result."
    },
  },
  required: ["responseId", "groundingIds"],
} satisfies JsonSchema;

export const fetchContentsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    uris: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
      description: "Explicit URLs to fetch as full Markdown text."
    },
    maxCharacters: {
      type: "integer",
      minimum: 1,
      description: "Maximum Markdown characters to return per URL. Defaults to 12000."
    },
  },
  required: ["uris"],
} satisfies JsonSchema;
