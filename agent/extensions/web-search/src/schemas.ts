import type { JsonSchema } from "./types.js";

export const webSearchExaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      minLength: 1,
      description: "Search query or research question.",
    },
    mode: {
      type: "string",
      enum: ["auto", "web", "code"],
      description: "Fallback routing only. Primary always tries native Gemini+Exa grounding first.",
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
      description: "Grounding chunk IDs shown in Source Grounding Supports.",
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
      description: "Explicit URLs to fetch as full Markdown text through Exa /contents.",
    },
    maxCharacters: {
      type: "integer",
      minimum: 1,
      description: "Maximum Markdown characters Exa should return per URL. Defaults to 12000.",
    },
  },
  required: ["uris"],
} satisfies JsonSchema;
