import type { RoutingConfig } from "./routing.ts";
import type { ThinkingLevel, ToolResult } from "./types.ts";

/**
 * Read-only search over the validated top-level routing models catalog. The
 * tool exists only so the parent can resolve a partial or unknown model name
 * into an exact configured combination before an explicitly requested
 * one-run routing substitution; it never invokes `pi --list-models`, never
 * spawns a delegate, and never mutates routing.
 */

export const MODEL_CATALOG_DEFAULT_LIMIT = 10;
export const MODEL_CATALOG_MAX_LIMIT = 20;

/** Raw model-visible tool parameters; validation stays authoritative here. */
export interface ModelCatalogToolParams {
  readonly query: string;
  readonly provider?: string;
  readonly thinking?: string;
  readonly limit?: number;
}

/** One configured provider route compatible with the active filters. */
export interface CatalogRouteSummary {
  readonly provider: string;
  readonly thinking: readonly ThinkingLevel[];
  readonly default: ThinkingLevel;
}

export interface CatalogMatch {
  readonly model: string;
  readonly routes: readonly CatalogRouteSummary[];
}

export interface ModelCatalogReport {
  /** Number of configured models matching every filter; never bounded by limit. */
  readonly totalMatches: number;
  readonly returned: number;
  readonly truncated: boolean;
  readonly matches: readonly CatalogMatch[];
}

function failQuery(message: string): never {
  throw new Error(`delegate_model_catalog invalid input: ${message}`);
}

/**
 * Searches the routing snapshot's models catalog. Matching is a
 * case-insensitive substring test on configured model ids; the optional
 * provider filter is an exact configured provider id; the optional thinking
 * filter keeps only routes that support that configured level. A model whose
 * every route was filtered out is omitted entirely, disabled providers never
 * appear (an override on them could not produce a route), and output order is
 * deterministic: models and providers sorted by id.
 */
export function searchModelCatalog(config: RoutingConfig, params: ModelCatalogToolParams): ModelCatalogReport {
  if (typeof params.query !== "string" || params.query.trim().length === 0) {
    failQuery("query must be a non-empty, non-whitespace-only string");
  }
  if (params.provider !== undefined && (typeof params.provider !== "string" || params.provider.trim().length === 0)) {
    failQuery("provider must be a non-empty, non-whitespace-only string when provided");
  }
  if (
    params.thinking !== undefined
    && (typeof params.thinking !== "string" || !(config.thinkingLevels as readonly string[]).includes(params.thinking))
  ) {
    failQuery(`thinking "${String(params.thinking)}" is not a configured thinking level`);
  }
  const limit = params.limit ?? MODEL_CATALOG_DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > MODEL_CATALOG_MAX_LIMIT) {
    failQuery(`limit must be an integer between 1 and ${MODEL_CATALOG_MAX_LIMIT}`);
  }

  const needle = params.query.trim().toLowerCase();
  const matches: CatalogMatch[] = [];
  for (const model of Object.keys(config.models).sort()) {
    if (!model.toLowerCase().includes(needle)) continue;
    const routes = Object.entries(config.models[model]!.providers)
      .filter(([provider, capability]) =>
        (params.provider === undefined || provider === params.provider)
        && (params.thinking === undefined || capability.thinking.includes(params.thinking as ThinkingLevel))
        && !config.disabledProviders.includes(provider))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([provider, capability]) => ({
        provider,
        thinking: capability.thinking,
        default: capability.default,
      }));
    if (routes.length === 0) continue;
    matches.push({ model, routes });
  }
  const totalMatches = matches.length;
  const returned = Math.min(limit, totalMatches);
  return {
    totalMatches,
    returned,
    truncated: totalMatches > returned,
    matches: matches.slice(0, returned),
  };
}

/** Compact deterministic model-visible text; a zero-match result never dumps the catalog. */
export function renderModelCatalogReport(report: ModelCatalogReport): string {
  const header = `totalMatches=${report.totalMatches} returned=${report.returned}${report.truncated ? " truncated=true" : ""}`;
  if (report.matches.length === 0) {
    return `${header}\nNo configured delegate model matches the given filters.`;
  }
  const lines = [header];
  for (const match of report.matches) {
    lines.push(`model ${match.model}`);
    for (const route of match.routes) {
      lines.push(`  provider ${route.provider} | thinking ${route.thinking.join(", ")} | default ${route.default}`);
    }
  }
  return lines.join("\n");
}

/** Tool execution wrapper: validate, search the snapshot, and render bounded output. */
export function modelCatalogToolResult(config: RoutingConfig, params: ModelCatalogToolParams): ToolResult {
  const report = searchModelCatalog(config, params);
  return {
    content: [{ type: "text", text: renderModelCatalogReport(report) }],
    details: { totalMatches: report.totalMatches, returned: report.returned, truncated: report.truncated },
  };
}
