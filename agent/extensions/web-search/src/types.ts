export type WebSearchDepth = "standard" | "deep";
export type CodeSearchFocus = "developer_sources" | "implementation_examples";
export type GroundingPartner = "parallel" | "exa";
export type ParallelGroundingMode = "basic" | "advanced";
export type CodeSearchProvider = "firecrawl-developer" | "exa-code";
export type ContentProvider = "firecrawl_scrape" | "exa_contents";

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

/** Budget for the Gemini + Exa grounding fallback attempt. */
export type ExaGroundingBudget = {
  type: "fast";
  numResults: number;
  maxHighlightCharacters: number;
};

/** Token budget for the Exa Code client; `"dynamic"` or an integer 50..100000. */
export type ExaCodeTokens = "dynamic" | number;

export type SearchConfig = {
  googleCloudApiKeyEnv: string;
  parallelApiKeyEnv: string;
  exaApiKeyEnv: string;
  firecrawlApiKeyEnv: string;
  model: string;
  webSearch: {
    defaultDepth: WebSearchDepth;
    parallel: { standardMode: ParallelGroundingMode; deepMode: ParallelGroundingMode };
    exa: { standard: ExaGroundingBudget; deep: ExaGroundingBudget };
  };
  codeSearch: {
    firecrawl: { k: number; passages: number };
    exaCode: { tokensNum: ExaCodeTokens };
  };
  contents: {
    defaultMaxAgeHours: number;
    concurrency: number;
    scrapeTimeoutMs: number;
  };
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

export type NormalizedGeminiGroundingResponse = {
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

/** One Gemini grounding attempt through a specific search partner. */
export type GroundingAttempt = {
  provider: "gemini-parallel-grounding" | "gemini-exa-grounding";
  partner: GroundingPartner;
  model: string;
  requestStartedAt: string;
  elapsedMs: number;
  rawRequest?: RawHttpRequest;
  rawResponse?: RawHttpResponse;
  normalized?: NormalizedGeminiGroundingResponse;
  error?: string;
};

/** Provider failure classes recognized exactly enough to act on. */
export type PrimaryFailureCode = "EXA_EMPTY_QUERY";

/** One developer/code search attempt through one provider. */
export type CodeSearchAttempt = {
  provider: CodeSearchProvider;
  requestStartedAt: string;
  elapsedMs: number;
  rawRequest?: RawHttpRequest;
  rawResponse?: RawHttpResponse;
  normalized?: NormalizedCodeSearchResult;
  error?: string;
};

export type FirecrawlDeveloperArtifact = {
  id?: string;
  type?: string;
  url?: string;
  title?: string;
  passages: string[];
};

export type NormalizedFirecrawlDeveloperSearch = {
  success: boolean;
  artifacts: FirecrawlDeveloperArtifact[];
  coverage?: Record<string, unknown>;
  reranked?: boolean;
  resultCount: number;
};

export type NormalizedExaCodeSearch = {
  response: string;
  resultsCount?: number;
  requestId?: string;
  costDollars?: unknown;
  searchTime?: number;
  outputTokens?: number;
};

export type NormalizedCodeSearchResult = NormalizedFirecrawlDeveloperSearch | NormalizedExaCodeSearch;

export type NormalizedFirecrawlScrape = {
  markdown: string;
  title?: string;
  sourceUrl?: string;
  statusCode?: number;
  warning?: string;
};

/** One per-URL content fetch attempt through one provider. */
export type ContentFetchAttempt = {
  provider: ContentProvider;
  url: string;
  requestStartedAt: string;
  elapsedMs: number;
  rawRequest?: RawHttpRequest;
  rawResponse?: RawHttpResponse;
  normalized?: NormalizedFirecrawlScrape;
  error?: string;
};

/**
 * Stored record for the web_search tool.
 *
 * New fields (schemaVersion, tool, depth, selectedProvider, attempts) are
 * written on every store. The legacy mirrored fields keep describing the final
 * attempt so pre-existing raw-response consumers stay correct.
 */
export type StoredSearchResponse = {
  schemaVersion: number;
  responseId: string;
  createdAt: number;
  expiresAt: number;
  tool: "web_search";
  depth: WebSearchDepth;
  selectedProvider: "gemini-parallel-grounding" | "gemini-exa-grounding" | "none";
  query: string;
  model: string;
  attempts: GroundingAttempt[];
  provider: string;
  request?: RawHttpRequest;
  response?: RawHttpResponse;
  primary: GroundingAttempt;
  /** Present only after a retry; when absent, treat history as `[primary]`. */
  primaryAttempts?: GroundingAttempt[];
  normalized?: NormalizedGeminiGroundingResponse | null;
  fallback: GroundingAttempt | null;
  googleResponseId?: string;
};

/** Stored record for the web_code_search tool. */
export type StoredCodeSearchResponse = {
  schemaVersion: number;
  responseId: string;
  createdAt: number;
  expiresAt: number;
  tool: "web_code_search";
  focus: CodeSearchFocus;
  selectedProvider: CodeSearchProvider | "none";
  query: string;
  attempts: CodeSearchAttempt[];
  degraded: boolean;
};

export type StoredToolRecord = StoredSearchResponse | StoredCodeSearchResponse;

export type ContentCacheEntry = {
  url: string;
  normalizedUrl: string;
  fetchedAt: number;
  expiresAt: number;
  requestedMaxCharacters: number;
  title?: string;
  text: string;
  provider?: ContentProvider;
  providerStatus?: unknown;
  /** Legacy field from records written before provider metadata existed. */
  exaStatus?: unknown;
  rawResult?: unknown;
};
