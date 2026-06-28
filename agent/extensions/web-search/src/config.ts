import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asPositiveInteger, asRecordOrEmpty, asTrimmedNonEmptyString } from "./value-guards.js";
import type { SearchConfig } from "./types.js";

export const ONE_MONTH_MS = 2_592_000_000;
export const DEFAULT_CACHE_DIR = "~/.pi/web_search_cache";
const CONFIG_FILE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../config.json");
export const DEFAULT_CONFIG: SearchConfig = {
  googleCloudApiKeyEnv: "GOOGLE_CLOUD_API_KEY",
  exaApiKeyEnv: "EXA_API_KEY",
  model: "gemini-2.5-flash",
  searchType: "auto",
  numResults: 5,
  maxHighlightCharacters: 2000,
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

async function readConfigFile(): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(CONFIG_FILE_PATH, "utf8");
    return asRecordOrEmpty(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Failed to read web_search config: ${(error as Error).message}`);
  }
}

export async function loadConfig(): Promise<SearchConfig> {
  const raw = await readConfigFile();
  const google = asRecordOrEmpty(raw.google);
  const exa = asRecordOrEmpty(raw.exa);
  const grounding = asRecordOrEmpty(raw.geminiExaGrounding);

  const cacheDir = expandHome(optionalString(grounding.cacheDir, DEFAULT_CONFIG.cacheDir));

  return {
    googleCloudApiKeyEnv: optionalString(google.cloudApiKeyEnv, DEFAULT_CONFIG.googleCloudApiKeyEnv),
    exaApiKeyEnv: optionalString(exa.apiKeyEnv, DEFAULT_CONFIG.exaApiKeyEnv),
    model: optionalString(grounding.model, DEFAULT_CONFIG.model),
    searchType: optionalString(grounding.searchType, DEFAULT_CONFIG.searchType),
    numResults: optionalPositiveInteger(grounding.numResults, DEFAULT_CONFIG.numResults),
    maxHighlightCharacters: optionalPositiveInteger(
      grounding.maxHighlightCharacters,
      DEFAULT_CONFIG.maxHighlightCharacters,
    ),
    cacheDir: resolve(cacheDir),
    rawResponseTtlMs: optionalPositiveInteger(grounding.rawResponseTtlMs, DEFAULT_CONFIG.rawResponseTtlMs),
    contentCacheTtlMs: optionalPositiveInteger(grounding.contentCacheTtlMs, DEFAULT_CONFIG.contentCacheTtlMs),
  };
}

export function readConfiguredEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
