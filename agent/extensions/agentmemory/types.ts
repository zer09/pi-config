import { Type } from "typebox";

export type TextBlock = { type?: string; text?: string };
export type AssistantMessage = { role?: string; content?: unknown };

export type SmartSearchResult = {
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

export type HealthResponse = {
  status?: string;
  service?: string;
  version?: string;
  health?: {
    status?: string;
    notes?: string[];
  };
};

export type FollowupDiagnosticResponse = {
  success?: boolean;
  windowSeconds?: number;
  agentInitiatedSearches?: number;
  followupWithinWindow?: number;
  rate?: number;
  caveat?: string;
  [key: string]: unknown;
};

export type PolicyMetadata = {
  lastCheckedVersion?: string;
  lastCheckedCommit?: string;
  toolCount?: number;
};

export type McpToolResponse = {
  content?: TextBlock[];
  error?: string;
  isError?: boolean;
  [key: string]: unknown;
};

export type McpResource = {
  uri?: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

export type McpResourceContent = {
  uri?: string;
  mimeType?: string;
  text?: string;
};

export type McpResourcesResponse = {
  resources?: McpResource[];
  error?: string;
  [key: string]: unknown;
};

export type McpResourceReadResponse = {
  contents?: McpResourceContent[];
  error?: string;
  [key: string]: unknown;
};

export type McpPromptArgument = {
  name?: string;
  description?: string;
  required?: boolean;
};

export type McpPrompt = {
  name?: string;
  description?: string;
  arguments?: McpPromptArgument[];
};

export type McpPromptsResponse = {
  prompts?: McpPrompt[];
  error?: string;
  [key: string]: unknown;
};

export type McpPromptMessage = {
  role?: string;
  content?: unknown;
};

export type McpPromptGetResponse = {
  messages?: McpPromptMessage[];
  error?: string;
  [key: string]: unknown;
};

export type ToolParams = Record<string, unknown>;

export type McpToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  prepare?: (params: ToolParams) => ToolParams;
  guard?: (params: ToolParams) => string | null;
};

export type AgentMemoryStatusContext = {
  hasUI?: boolean;
  ui?: { setStatus: (key: string, text: string) => void };
};
