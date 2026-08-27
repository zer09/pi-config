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

/** Status classes recorded for one fetch_contents provider attempt. */
export type FetchAttemptStatus =
  | "success"
  | "http_error"
  | "transport_error"
  | "unusable_response"
  | "aborted"
  | "skipped";

/** Safe normalized result metadata kept for one fetch_contents provider attempt. */
export type NormalizedFetchAttempt = {
  success: boolean;
  statusCode?: number;
  markdownCharacters?: number;
  perUrl?: Array<{ url: string; ok: boolean; textCharacters: number }>;
  /** Total per-URL entries before the retention cap (stored form only). */
  perUrlTotal?: number;
  /** Per-URL entries omitted from storage by the retention cap. */
  perUrlOmitted?: number;
};

/** One chronological provider attempt recorded by a fetch_contents call. */
export type FetchContentsAttempt = {
  provider: ContentProvider;
  urls: string[];
  /** Total URLs on this attempt before the per-attempt retention cap (stored form only). */
  urlsTotal?: number;
  /** URLs omitted from storage by the per-attempt retention cap. */
  urlsOmitted?: number;
  requestStartedAt: string;
  elapsedMs: number;
  rawRequest?: RawHttpRequest;
  rawResponse?: RawHttpResponse;
  normalized?: NormalizedFetchAttempt;
  status: FetchAttemptStatus;
  error?: string;
  skippedReason?: string;
};

/**
 * Mutable sink filled by the fetch_contents orchestrator during execution.
 *
 * `dispatchOrdinal` is internal bookkeeping: assigned synchronously before
 * each attempt starts, used as the canonical storage order, and stripped
 * before the record persists.
 */
export type FetchContentsDiagnostics = {
  attempts: Array<FetchContentsAttempt & { dispatchOrdinal?: number }>;
};

/** Per-URL safe result metadata for the fetch_contents stored record. */
export type StoredFetchResult = {
  normalizedUrl: string;
  provider: ContentProvider | null;
  fromCache: boolean;
  status: string | null;
};

/** Stored record for the fetch_contents tool. */
export type StoredFetchContentsResponse = {
  schemaVersion: number;
  responseId: string;
  createdAt: number;
  expiresAt: number;
  tool: "fetch_contents";
  request: {
    urlCount: number | null;
    uniqueUrlCount: number | null;
    maxCharacters: number | null;
    maxAgeHours: number | null;
  };
  results: StoredFetchResult[];
  /** Total per-URL results before the retention cap. */
  resultsTotal: number;
  /** Results omitted from storage by the retention cap. */
  resultsOmitted: number;
  attempts: FetchContentsAttempt[];
  /** Total attempts before the retention cap. */
  attemptsTotal: number;
  /** Attempts omitted from storage by the retention cap. */
  attemptsOmitted: number;
};

/** Safe diagnostic record persisted for a local preflight failure. */
export type StoredPreflightRecord = {
  schemaVersion: number;
  responseId: string;
  createdAt: number;
  expiresAt: number;
  tool: "web_search" | "web_code_search" | "fetch_contents";
  phase: "preflight";
  category: string;
  error: string;
  metadata?: Record<string, unknown>;
  attempts: [];
};

export type StoredToolRecord =
  | StoredSearchResponse
  | StoredCodeSearchResponse
  | StoredFetchContentsResponse
  | StoredPreflightRecord;

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
