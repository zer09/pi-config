import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SearchConfig } from "./types.js";

export const ONE_MONTH_MS = 2_592_000_000;
export const DEFAULT_CACHE_DIR = "~/.pi/web_search_exa";
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function optionalPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function readConfigFile(): Promise<Record<string, unknown>> {
  const configPath = join(expandHome(DEFAULT_CACHE_DIR), "config.json");
  try {
    const text = await readFile(configPath, "utf8");
    return asRecord(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Failed to read web_search config: ${(error as Error).message}`);
  }
}

export async function loadConfig(): Promise<SearchConfig> {
  const raw = await readConfigFile();
  const google = asRecord(raw.google);
  const exa = asRecord(raw.exa);
  const grounding = asRecord(raw.geminiExaGrounding);

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
    rawResponseTtlMs: optionalPositiveNumber(grounding.rawResponseTtlMs, DEFAULT_CONFIG.rawResponseTtlMs),
    contentCacheTtlMs: optionalPositiveNumber(grounding.contentCacheTtlMs, DEFAULT_CONFIG.contentCacheTtlMs),
  };
}

export function readConfiguredEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
