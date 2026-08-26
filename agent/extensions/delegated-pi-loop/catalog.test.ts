import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_CATALOG_DEFAULT_LIMIT,
  MODEL_CATALOG_MAX_LIMIT,
  modelCatalogToolResult,
  renderModelCatalogReport,
  searchModelCatalog,
} from "./catalog.ts";
import { loadRoutingConfig, validateRoutingConfig } from "./routing.ts";

function syntheticCatalogConfig(mutate?: (document: Record<string, unknown>) => void) {
  const document: Record<string, unknown> = {
    version: 2,
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    disabledProviders: [],
    models: {
      "gpt-9-sol": {
        providers: {
          "openai-codex": { thinking: ["minimal", "high", "max"], default: "high" },
          "openai-codex-alt": { thinking: ["high"], default: "high" },
        },
      },
      "glm-9": {
        providers: {
          "zai": { thinking: ["low", "high"], default: "high" },
        },
      },
      "muse-9": {
        providers: {
          "opencode-go": { thinking: ["off", "low"], default: "low" },
        },
      },
    },
    profiles: {
      gate: {
        overridePolicy: "rejected",
        tiers: [{ model: "gpt-9-sol", thinking: "high", providers: ["openai-codex", "openai-codex-alt"] }],
      },
    },
    assignments: {
      solution: ["gate"],
      review: ["gate"],
      implementation: "gate",
      remediation: "gate",
      verification: "gate",
      oracle: "gate",
    },
  };
  mutate?.(document);
  return validateRoutingConfig(document);
}

test("query matches configured model ids case-insensitively as a substring", () => {
  const config = syntheticCatalogConfig();
  const report = searchModelCatalog(config, { query: "GPT-9" });
  assert.equal(report.totalMatches, 1);
  assert.equal(report.matches[0]?.model, "gpt-9-sol");
  assert.equal(report.matches[0]?.routes.length, 2);
  // Inner fragments match too, and matching never touches provider names.
  assert.deepEqual(
    searchModelCatalog(config, { query: "-sol" }).matches.map((match) => match.model),
    ["gpt-9-sol"],
  );
  assert.equal(searchModelCatalog(config, { query: "codex" }).totalMatches, 0);
  assert.equal(searchModelCatalog(config, { query: "muse" }).matches[0]?.model, "muse-9");
});

test("each match lists only compatible configured routes with thinking levels and defaults", () => {
  const config = syntheticCatalogConfig();
  const match = searchModelCatalog(config, { query: "gpt-9-sol" }).matches[0]!;
  assert.deepEqual(match.routes, [
    { provider: "openai-codex", thinking: ["minimal", "high", "max"], default: "high" },
    { provider: "openai-codex-alt", thinking: ["high"], default: "high" },
  ]);
  const glm = searchModelCatalog(config, { query: "glm" }).matches[0]!;
  assert.deepEqual(glm.routes, [{ provider: "zai", thinking: ["low", "high"], default: "high" }]);
});

test("the provider filter keeps only the exact configured provider routes", () => {
  const config = syntheticCatalogConfig();
  const report = searchModelCatalog(config, { query: "gpt", provider: "openai-codex-alt" });
  assert.equal(report.totalMatches, 1);
  assert.deepEqual(report.matches[0]?.routes.map((route) => route.provider), ["openai-codex-alt"]);
  // An exact unknown provider id filters out every route, so the model is omitted.
  assert.equal(searchModelCatalog(config, { query: "gpt", provider: "openai-codex-cgpt9" }).totalMatches, 0);
  // The provider filter is exact, not a substring match.
  assert.equal(searchModelCatalog(config, { query: "gpt", provider: "openai-codex-x" }).totalMatches, 0);
});

test("the thinking filter keeps only routes that support the configured level", () => {
  const config = syntheticCatalogConfig();
  const report = searchModelCatalog(config, { query: "gpt", thinking: "minimal" });
  assert.equal(report.totalMatches, 1);
  assert.deepEqual(report.matches[0]?.routes.map((route) => route.provider), ["openai-codex"]);
  // muse-9 supports only off/low: a high filter omits it entirely.
  assert.equal(searchModelCatalog(config, { query: "muse", thinking: "high" }).totalMatches, 0);
  assert.equal(searchModelCatalog(config, { query: "muse", thinking: "off" }).totalMatches, 1);
  // An unconfigured thinking level is a bounded input error.
  assert.throws(
    () => searchModelCatalog(config, { query: "gpt", thinking: "ultra" }),
    /delegate_model_catalog invalid input: thinking "ultra" is not a configured thinking level/,
  );
});

test("limit defaults to 10, accepts 1..20, and reports truncation", () => {
  const config = syntheticCatalogConfig();
  // Default limit: a three-match catalog returns all three.
  const full = searchModelCatalog(config, { query: "9" });
  assert.equal(full.totalMatches, 3);
  assert.equal(full.returned, 3);
  assert.equal(full.truncated, false);

  const limited = searchModelCatalog(config, { query: "9", limit: 1 });
  assert.equal(limited.totalMatches, 3);
  assert.equal(limited.returned, 1);
  assert.equal(limited.truncated, true);
  assert.equal(limited.matches.length, 1);
  // Out-of-range and non-integer limits are bounded input errors.
  assert.throws(() => searchModelCatalog(config, { query: "9", limit: 0 }), /limit must be an integer between 1 and 20/);
  assert.throws(() => searchModelCatalog(config, { query: "9", limit: 21 }), /limit must be an integer between 1 and 20/);
  assert.throws(() => searchModelCatalog(config, { query: "9", limit: 1.5 }), /limit must be an integer between 1 and 20/);
  assert.equal(MODEL_CATALOG_DEFAULT_LIMIT, 10);
  assert.equal(MODEL_CATALOG_MAX_LIMIT, 20);
});

test("a zero-match result is bounded and never dumps the catalog", () => {
  const config = syntheticCatalogConfig();
  const report = searchModelCatalog(config, { query: "does-not-exist" });
  assert.equal(report.totalMatches, 0);
  assert.deepEqual(report.matches, []);
  const text = renderModelCatalogReport(report);
  assert.match(text, /totalMatches=0 returned=0/);
  assert.match(text, /No configured delegate model matches the given filters\./);
  for (const configured of ["gpt-9-sol", "glm-9", "muse-9", "zai", "openai-codex"]) {
    assert.ok(!text.includes(configured), `zero-match output must not mention ${configured}`);
  }
  const toolResult = modelCatalogToolResult(config, { query: "does-not-exist" });
  assert.equal(toolResult.content.length, 1);
  assert.deepEqual(toolResult.details, { totalMatches: 0, returned: 0, truncated: false });
});

test("output is deterministic, bounded, and indicates truncation", () => {
  const config = syntheticCatalogConfig();
  const first = renderModelCatalogReport(searchModelCatalog(config, { query: "9" }));
  const second = renderModelCatalogReport(searchModelCatalog(config, { query: "9" }));
  assert.equal(first, second);
  assert.match(first, /totalMatches=3 returned=3$/m);
  assert.ok(!first.includes("truncated=true"));
  const truncated = renderModelCatalogReport(searchModelCatalog(config, { query: "9", limit: 2 }));
  assert.match(truncated, /totalMatches=3 returned=2 truncated=true/);
  assert.ok(truncated.includes("glm-9"));
  assert.ok(!truncated.includes("muse-9"));
  // Models and providers render in sorted id order regardless of key order.
  const reordered = syntheticCatalogConfig((document) => {
    const models = document.models as Record<string, unknown>;
    const entries = Object.entries(models).reverse();
    for (const key of Object.keys(models)) delete models[key];
    Object.assign(models, Object.fromEntries(entries));
  });
  assert.equal(
    renderModelCatalogReport(searchModelCatalog(reordered, { query: "9" })),
    first,
  );
});

test("blank queries and providers are bounded input errors", () => {
  const config = syntheticCatalogConfig();
  assert.throws(() => searchModelCatalog(config, { query: "  " }), /query must be a non-empty, non-whitespace-only string/);
  assert.throws(() => searchModelCatalog(config, { query: "gpt", provider: " " }), /provider must be a non-empty, non-whitespace-only string when provided/);
});

test("disabled providers never appear in catalog routes", () => {
  const config = syntheticCatalogConfig((document) => {
    document.disabledProviders = ["openai-codex-alt"];
  });
  const report = searchModelCatalog(config, { query: "gpt" });
  assert.deepEqual(report.matches[0]?.routes.map((route) => route.provider), ["openai-codex"]);
  // A provider filter naming a disabled provider removes every route, so the
  // model is omitted: the returned combinations stay usable in overrides.
  assert.equal(searchModelCatalog(config, { query: "gpt", provider: "openai-codex-alt" }).totalMatches, 0);
});

test("the shipped routing snapshot is searchable end to end", () => {
  const config = loadRoutingConfig();
  const report = searchModelCatalog(config, { query: "gpt-5.6-sol", provider: "openai-codex-cgpt5" });
  assert.equal(report.totalMatches, 1);
  assert.equal(report.matches[0]?.model, "gpt-5.6-sol");
  assert.deepEqual(
    report.matches[0]?.routes.map((route) => ({ provider: route.provider, default: route.default })),
    [{ provider: "openai-codex-cgpt5", default: "high" }],
  );
  assert.match(report.matches[0]!.routes[0]!.thinking.join(","), /minimal/);
  // A query matching several shipped models stays bounded by the default limit.
  const broad = searchModelCatalog(config, { query: "gpt" });
  assert.ok(broad.totalMatches >= 2);
  assert.ok(broad.matches.length <= MODEL_CATALOG_DEFAULT_LIMIT);
});
