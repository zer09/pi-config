import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asPositiveInteger, asRecordOrEmpty, asTrimmedNonEmptyString } from "./value-guards.js";
import type { ExaGroundingBudget, ParallelGroundingMode, SearchConfig, WebSearchDepth } from "./types.js";

export const ONE_MONTH_MS = 2_592_000_000;
export const DEFAULT_CACHE_DIR = "~/.pi/web_search_cache";
export const DEFAULT_CONTENT_MAX_AGE_HOURS = 24;
export const DEFAULT_CONTENT_CONCURRENCY = 3;
export const DEFAULT_SCRAPE_TIMEOUT_MS = 60_000;
export const MS_PER_HOUR = 3_600_000;
const CONFIG_FILE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../config.json");

export const DEFAULT_CONFIG: SearchConfig = {
  googleCloudApiKeyEnv: "GOOGLE_CLOUD_API_KEY",
  parallelApiKeyEnv: "PARALLEL_API_KEY",
  exaApiKeyEnv: "EXA_API_KEY",
  firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
  model: "gemini-3.5-flash",
  webSearch: {
    defaultDepth: "standard",
    parallel: { standardMode: "basic", deepMode: "advanced" },
    exa: {
      standard: { type: "fast", numResults: 5, maxHighlightCharacters: 2000 },
      deep: { type: "fast", numResults: 10, maxHighlightCharacters: 4000 },
    },
  },
  codeSearch: {
    firecrawl: { k: 10, passages: 2 },
    exaCode: { tokensNum: "dynamic" },
  },
  contents: {
    defaultMaxAgeHours: DEFAULT_CONTENT_MAX_AGE_HOURS,
    concurrency: DEFAULT_CONTENT_CONCURRENCY,
    scrapeTimeoutMs: DEFAULT_SCRAPE_TIMEOUT_MS,
  },
  cacheDir: expandHome(DEFAULT_CACHE_DIR),
  rawResponseTtlMs: ONE_MONTH_MS,
  contentCacheTtlMs: ONE_MONTH_MS,
};

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function optionalString(value: unknown, fallback: string): string {
  return asTrimmedNonEmptyString(value) ?? fallback;
}

function optionalPositiveInteger(value: unknown, fallback: number): number {
  return asPositiveInteger(value) ?? fallback;
}

function optionalDepth(value: unknown, fallback: WebSearchDepth): WebSearchDepth {
  return value === "deep" || value === "standard" ? value : fallback;
}

function optionalParallelMode(value: unknown, fallback: ParallelGroundingMode): ParallelGroundingMode {
  return value === "basic" || value === "advanced" ? value : fallback;
}

function optionalMaxAgeHours(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 720 ? value : fallback;
}

function optionalExaBudget(value: unknown, fallback: ExaGroundingBudget): ExaGroundingBudget {
  const record = asRecordOrEmpty(value);
  // Only "fast" is used by this extension: "instant" trades search depth for
  // latency and is not the accepted grounding profile.
  return {
    type: asTrimmedNonEmptyString(record.type) === "fast" ? "fast" : fallback.type,
    numResults: optionalPositiveInteger(record.numResults, fallback.numResults),
    maxHighlightCharacters: optionalPositiveInteger(record.maxHighlightCharacters, fallback.maxHighlightCharacters),
  };
}

async function readConfigFile(): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(CONFIG_FILE_PATH, "utf8");
    return asRecordOrEmpty(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Failed to read web_search config: ${(error as Error).message}`);
  }
}

/**
 * Builds the effective config from a parsed config record.
 *
 * Split from `loadConfig` so the legacy-compatibility mapping stays
 * deterministically testable without touching the optional config file.
 */
export function configFromRaw(raw: Record<string, unknown>): SearchConfig {
  const google = asRecordOrEmpty(raw.google);
  const parallel = asRecordOrEmpty(raw.parallel);
  const exa = asRecordOrEmpty(raw.exa);
  const firecrawl = asRecordOrEmpty(raw.firecrawl);
  const webSearch = asRecordOrEmpty(raw.webSearch);
  const codeSearch = asRecordOrEmpty(raw.codeSearch);
  const contents = asRecordOrEmpty(raw.contents);
  const cache = asRecordOrEmpty(raw.cache);
  // Legacy section that predated provider routing.
  const legacyGrounding = asRecordOrEmpty(raw.geminiExaGrounding);
  const legacyExaGrounding = asRecordOrEmpty(webSearch.exaGrounding);

  const parallelSection = asRecordOrEmpty(webSearch.parallel);
  const firecrawlSection = asRecordOrEmpty(codeSearch.firecrawl);
  const exaCodeSection = asRecordOrEmpty(codeSearch.exaCode);

  // Legacy `geminiExaGrounding` values still load when the new
  // `webSearch.exaGrounding` section is absent: the old single budget applied
  // to every Exa grounding request, so it covers both depth budgets.
  const legacyGroundingBudget: ExaGroundingBudget | undefined =
    asPositiveInteger(legacyGrounding.numResults) !== undefined ||
    asPositiveInteger(legacyGrounding.maxHighlightCharacters) !== undefined
      ? {
          type: "fast",
          numResults: optionalPositiveInteger(legacyGrounding.numResults, DEFAULT_CONFIG.webSearch.exa.standard.numResults),
          maxHighlightCharacters: optionalPositiveInteger(
            legacyGrounding.maxHighlightCharacters,
            DEFAULT_CONFIG.webSearch.exa.standard.maxHighlightCharacters,
          ),
        }
      : undefined;

  const cacheDir = expandHome(
    optionalString(
      cache.dir,
      optionalString(legacyGrounding.cacheDir, optionalString(webSearch.cacheDir, DEFAULT_CONFIG.cacheDir)),
    ),
  );

  return {
    googleCloudApiKeyEnv: optionalString(google.cloudApiKeyEnv, DEFAULT_CONFIG.googleCloudApiKeyEnv),
    parallelApiKeyEnv: optionalString(parallel.apiKeyEnv, DEFAULT_CONFIG.parallelApiKeyEnv),
    exaApiKeyEnv: optionalString(exa.apiKeyEnv, DEFAULT_CONFIG.exaApiKeyEnv),
    firecrawlApiKeyEnv: optionalString(firecrawl.apiKeyEnv, DEFAULT_CONFIG.firecrawlApiKeyEnv),
    model: optionalString(webSearch.model, optionalString(legacyGrounding.model, DEFAULT_CONFIG.model)),
    webSearch: {
      defaultDepth: optionalDepth(webSearch.defaultDepth, DEFAULT_CONFIG.webSearch.defaultDepth),
      parallel: {
        standardMode: optionalParallelMode(parallelSection.standardMode, DEFAULT_CONFIG.webSearch.parallel.standardMode),
        deepMode: optionalParallelMode(parallelSection.deepMode, DEFAULT_CONFIG.webSearch.parallel.deepMode),
      },
      exa: {
        standard: optionalExaBudget(legacyExaGrounding.standard, legacyGroundingBudget ?? DEFAULT_CONFIG.webSearch.exa.standard),
        deep: optionalExaBudget(legacyExaGrounding.deep, legacyGroundingBudget ?? DEFAULT_CONFIG.webSearch.exa.deep),
      },
    },
    codeSearch: {
      firecrawl: {
        k: optionalPositiveInteger(firecrawlSection.k, DEFAULT_CONFIG.codeSearch.firecrawl.k),
        passages: optionalPositiveInteger(firecrawlSection.passages, DEFAULT_CONFIG.codeSearch.firecrawl.passages),
      },
      exaCode: {
        tokensNum:
          exaCodeSection.tokensNum === "dynamic"
            ? "dynamic"
            : typeof exaCodeSection.tokensNum === "number" &&
                Number.isInteger(exaCodeSection.tokensNum) &&
                exaCodeSection.tokensNum >= 50 &&
                exaCodeSection.tokensNum <= 100000
              ? exaCodeSection.tokensNum
              : DEFAULT_CONFIG.codeSearch.exaCode.tokensNum,
      },
    },
    contents: {
      defaultMaxAgeHours: optionalMaxAgeHours(contents.defaultMaxAgeHours, DEFAULT_CONFIG.contents.defaultMaxAgeHours),
      concurrency: optionalPositiveInteger(contents.concurrency, DEFAULT_CONFIG.contents.concurrency),
      scrapeTimeoutMs: optionalPositiveInteger(contents.scrapeTimeoutMs, DEFAULT_CONFIG.contents.scrapeTimeoutMs),
    },
    cacheDir: resolve(cacheDir),
    rawResponseTtlMs: optionalPositiveInteger(
      cache.rawResponseTtlMs,
      optionalPositiveInteger(legacyGrounding.rawResponseTtlMs, DEFAULT_CONFIG.rawResponseTtlMs),
    ),
    contentCacheTtlMs: optionalPositiveInteger(
      cache.contentCacheTtlMs,
      optionalPositiveInteger(legacyGrounding.contentCacheTtlMs, DEFAULT_CONFIG.contentCacheTtlMs),
    ),
  };
}

/**
 * Loads the optional extension config with provider-neutral sections.
 *
 * Legacy `google`, `exa`, and `geminiExaGrounding` settings keep loading when
 * the new sections are absent so an existing local config file does not break.
 */
export async function loadConfig(): Promise<SearchConfig> {
  return configFromRaw(await readConfigFile());
}

export function readConfiguredEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
