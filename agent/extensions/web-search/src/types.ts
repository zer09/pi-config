export type WebSearchMode = "auto" | "web" | "code";
export type FallbackRoute = "exa_search" | "code_search";

export type JsonSchema = Record<string, unknown>;

export type ToolTextContent = { type: "text"; text: string };

export type ToolResult = {
  content: ToolTextContent[];
  details?: Record<string, unknown>;
  terminate?: boolean;
};

export type ToolRenderThemeLike = {
  fg?: (name: string, value: string) => string;
  bold?: (value: string) => string;
};

export type ToolRenderOptionsLike = {
  expanded?: boolean;
  isPartial?: boolean;
};

export type ToolRenderContextLike = {
  lastComponent?: unknown;
};

export type ToolRegistration = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: JsonSchema;
  renderCall?: (args: unknown, theme: ToolRenderThemeLike, context?: ToolRenderContextLike) => unknown;
  renderResult?: (
    result: ToolResult,
    options: ToolRenderOptionsLike,
    theme: ToolRenderThemeLike,
    context?: ToolRenderContextLike,
  ) => unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (result: Partial<ToolResult>) => void,
    ctx?: ExtensionContextLike,
  ) => Promise<ToolResult>;
};

export type ExtensionApiLike = {
  registerTool(tool: ToolRegistration): void;
};

export type ExtensionContextLike = {
  cwd?: string;
  signal?: AbortSignal;
};

export type SearchConfig = {
  googleCloudApiKeyEnv: string;
  exaApiKeyEnv: string;
  model: string;
  searchType: string;
  numResults: number;
  maxHighlightCharacters: number;
  cacheDir: string;
  rawResponseTtlMs: number;
  contentCacheTtlMs: number;
};

export type GroundingSource = {
  groundingId: number;
  title?: string;
  url?: string;
  domain?: string;
};

export type GroundingSupport = {
  text: string;
  groundingChunkIndices: number[];
  startIndex?: number;
  endIndex?: number;
};

export type NormalizedGeminiExaResponse = {
  answer: string;
  finishReason?: string;
  cleanSuccess: boolean;
  sources: GroundingSource[];
  supports: GroundingSupport[];
  webSearchQueries: string[];
  usage?: unknown;
  googleResponseId?: string;
  modelVersion?: string;
  promptBlockReason?: string;
};

export type RawHttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
};

export type RawHttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: unknown;
};

export type PrimaryAttempt = {
  provider: "gemini-exa-grounding";
  model: string;
  requestStartedAt: string;
  elapsedMs: number;
  rawRequest?: RawHttpRequest;
  rawResponse?: RawHttpResponse;
  normalized?: NormalizedGeminiExaResponse;
  error?: string;
};

export type FallbackAttempt = {
  used: true;
  provider: FallbackRoute;
  reason: string;
  requestStartedAt: string;
  elapsedMs: number;
  rawRequest?: RawHttpRequest;
  rawResponse?: RawHttpResponse;
  answer: string;
  costDollars?: unknown;
  resultCount?: number;
  error?: string;
};

export type StoredSearchResponse = {
  responseId: string;
  createdAt: number;
  expiresAt: number;
  provider: "gemini-exa-grounding";
  model: string;
  query: string;
  request?: RawHttpRequest;
  response?: RawHttpResponse;
  primary: PrimaryAttempt;
  normalized?: NormalizedGeminiExaResponse | null;
  fallback: FallbackAttempt | null;
  googleResponseId?: string;
};

export type ContentCacheEntry = {
  url: string;
  normalizedUrl: string;
  fetchedAt: number;
  expiresAt: number;
  requestedMaxCharacters: number;
  title?: string;
  text: string;
  exaStatus?: unknown;
  rawResult?: unknown;
};
