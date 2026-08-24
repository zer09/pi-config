import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadRoutingConfig,
  oracleModelIds,
  readRoutingConfigFile,
  selectRoutes,
  validateRoutingConfig,
  type RoutingConfig,
} from "./routing.ts";
import { routeKey, roleIsExclusive, roleIsReadOnly } from "./routes.ts";
import { DELEGATE_ROLES } from "./types.ts";
import type { DelegateRole } from "./types.ts";

const CODEX_PROVIDERS = [
  "openai-codex",
  "openai-codex-zahlo",
  "openai-codex-cgpt1",
  "openai-codex-cgpt2",
  "openai-codex-cgpt3",
  "openai-codex-cgpt4",
  "openai-codex-cgpt5",
  "openai-codex-cgpt6",
  "openai-codex-cgpt7",
] as const;

function syntheticConfig(overrides: {
  mutate?: (document: Record<string, unknown>) => void;
}): RoutingConfig {
  const document: Record<string, unknown> = {
    version: 1,
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    disabledProviders: [],
    models: {
      "model-x": {
        providers: {
          "prov-a": { thinking: ["low", "high", "max"], default: "max" },
          "prov-b": { thinking: ["high"], default: "high" },
        },
      },
      "model-y": {
        providers: {
          "prov-a": { thinking: ["low"], default: "low" },
        },
      },
    },
    profiles: {
      "two-tier": {
        tiers: [
          { model: "model-x", thinking: "max", providers: ["prov-a"] },
          { model: "model-y", thinking: "low", providers: ["prov-a"] },
        ],
      },
      pinned: {
        overridePolicy: "rejected",
        tiers: [{ model: "model-x", thinking: "high", providers: ["prov-a", "prov-b"] }],
      },
      all: {
        tiers: [{ model: "model-x", thinking: "high" }],
      },
    },
    roles: {
      "solution-a": { profile: "two-tier" },
      "solution-b": { profile: "two-tier" },
      "solution-c": { profile: "two-tier" },
      "solution-d": { profile: "two-tier" },
      "review-a": { profile: "two-tier" },
      "review-b": { profile: "two-tier" },
      "review-c": { profile: "two-tier" },
      "review-d": { profile: "two-tier" },
      oracle: { profile: "pinned" },
      implementation: { profile: "two-tier" },
      remediation: { profile: "two-tier" },
      verification: { profile: "two-tier" },
    },
    oracleSafety: { selfReviewModelIds: ["model-x"] },
  };
  overrides.mutate?.(document);
  return validateRoutingConfig(document);
}

test("the shipped routing config loads and fails closed on invalid files", async () => {
  const config = loadRoutingConfig();
  assert.equal(config.version, 1);
  assert.deepEqual(config.disabledProviders, []);
  // The cached loader returns the same validated instance.
  assert.equal(loadRoutingConfig(), config);

  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-routing-load-"));
  const missing = path.join(root, "missing.json");
  assert.throws(() => readRoutingConfigFile(missing), /routing config invalid: cannot read/);

  const malformed = path.join(root, "malformed.json");
  await writeFile(malformed, "{not json");
  assert.throws(() => readRoutingConfigFile(malformed), /routing config invalid: .* is not valid JSON/);

  const empty = path.join(root, "not-an-object.json");
  await writeFile(empty, "[]");
  assert.throws(() => readRoutingConfigFile(empty), /routing config invalid: document must be a JSON object/);
});

test("the shipped routing config contains no seekai occurrence", async () => {
  // Regression: the seekai provider was removed from the routing policy
  // entirely (not disabled), so it must not reappear anywhere in the file.
  const text = await readFile(new URL("./routing.json", import.meta.url), "utf8");
  assert.equal(text.includes("seekai"), false);
});

test("the shipped config pins delegate model thinking capabilities", () => {
  const config = loadRoutingConfig();
  assert.deepEqual(config.models["ox-alpha"]?.providers.tokenreply, {
    thinking: ["xhigh"],
    default: "xhigh",
  });
  assert.deepEqual(config.models["claude-fable-5"]?.providers.tokenreply, {
    thinking: ["off"],
    default: "off",
  });
  // agentrouter/claude-opus-5 gained high support with high as its default
  // while keeping the higher xhigh and max levels; tabitoken and gorouter
  // keep their declared levels with high already the default.
  assert.deepEqual(config.models["claude-opus-5"]?.providers.agentrouter, {
    thinking: ["high", "xhigh", "max"],
    default: "high",
  });
  assert.deepEqual(config.models["claude-opus-5-thinking"]?.providers.tabitoken, {
    thinking: ["low", "medium", "high", "xhigh", "max"],
    default: "high",
  });
  assert.deepEqual(config.models["claude-opus-5-thinking"]?.providers.gorouter, {
    thinking: ["low", "medium", "high"],
    default: "high",
  });
  // Gate D runs gpt-5.5 at high across its full provider set; every
  // provider keeps its declared scale with high as the default.
  for (const provider of CODEX_PROVIDERS) {
    assert.deepEqual(
      config.models["gpt-5.5"]?.providers[provider],
      { thinking: ["off", "minimal", "low", "medium", "high", "xhigh"], default: "high" },
      provider,
    );
  }
});

test("config validation rejects structural violations", () => {
  const cases: Array<{ name: string; mutate: (document: Record<string, unknown>) => void; pattern: RegExp }> = [
    {
      name: "wrong version",
      mutate: (document) => {
        document.version = 2;
      },
      pattern: /version must be exactly 1/,
    },
    {
      name: "unknown top-level key",
      mutate: (document) => {
        document.extra = true;
      },
      pattern: /unknown key "extra"/,
    },
    {
      name: "unknown thinking level",
      mutate: (document) => {
        document.thinkingLevels = ["low", "ultra"];
      },
      pattern: /is not a known Pi thinking level/,
    },
    {
      name: "provider default outside its supported levels",
      mutate: (document) => {
        const models = document.models as Record<string, Record<string, unknown>>;
        // A fresh model avoids collateral tier failures, isolating the default check.
        models["model-d"] = { providers: { "prov-a": { thinking: ["low"], default: "max" } } };
      },
      pattern: /default must be one of its supported thinking levels/,
    },
    {
      name: "tier model without capability record",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        const tiers = profiles["two-tier"]!.tiers as Array<Record<string, unknown>>;
        tiers[0]!.model = "model-z";
      },
      pattern: /"model-z" has no capability record/,
    },
    {
      name: "tier thinking unsupported by allowlisted provider",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        const tiers = profiles["two-tier"]!.tiers as Array<Record<string, unknown>>;
        tiers[0]!.thinking = "xhigh";
      },
      pattern: /allowlists provider "prov-a" which does not support "model-x" at thinking "xhigh"/,
    },
    {
      name: "tier allowlist without capability record",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        const tiers = profiles["two-tier"]!.tiers as Array<Record<string, unknown>>;
        tiers[0]!.providers = ["prov-a", "prov-ghost"];
      },
      pattern: /allowlists provider "prov-ghost" without a capability record/,
    },
    {
      name: "missing role mapping",
      mutate: (document) => {
        const roles = document.roles as Record<string, unknown>;
        delete roles.verification;
      },
      pattern: /roles must map exactly every delegate role/,
    },
    {
      name: "extra role mapping",
      mutate: (document) => {
        const roles = document.roles as Record<string, unknown>;
        roles["solution-e"] = { profile: "two-tier" };
      },
      pattern: /roles must map exactly every delegate role/,
    },
    {
      name: "role referencing unknown profile",
      mutate: (document) => {
        const roles = document.roles as Record<string, unknown>;
        roles.verification = { profile: "ghost" };
      },
      pattern: /is not a configured profile/,
    },
    {
      name: "oracle safety model set mismatch",
      mutate: (document) => {
        document.oracleSafety = { selfReviewModelIds: ["model-y"] };
      },
      pattern: /selfReviewModelIds must be exactly every model in the oracle profile's tiers: "model-x"/,
    },
    {
      name: "oracle safety model set missing a tier model",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        (profiles.pinned!.tiers as Array<Record<string, unknown>>).push({ model: "model-y", thinking: "low", providers: ["prov-a"] });
      },
      pattern: /selfReviewModelIds must be exactly every model in the oracle profile's tiers: "model-x", "model-y"/,
    },
    {
      name: "oracle safety model set with an extra model",
      mutate: (document) => {
        document.oracleSafety = { selfReviewModelIds: ["model-x", "model-y"] };
      },
      pattern: /selfReviewModelIds must be exactly every model in the oracle profile's tiers: "model-x"/,
    },
    {
      name: "whitespace-only oracle safety model entry",
      mutate: (document) => {
        document.oracleSafety = { selfReviewModelIds: ["model-x", "  "] };
      },
      pattern: /oracleSafety\.selfReviewModelIds entries must be non-empty, non-whitespace-only strings/,
    },
    {
      name: "disabled provider emptying a tier",
      mutate: (document) => {
        document.disabledProviders = ["prov-a"];
      },
      pattern: /has no eligible provider after disabledProviders/,
    },
    {
      name: "empty profile tiers",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        profiles["two-tier"]!.tiers = [];
      },
      pattern: /profiles.two-tier.tiers must be a non-empty array/,
    },
    {
      name: "duplicate disabled providers",
      mutate: (document) => {
        document.disabledProviders = ["prov-b", "prov-b"];
      },
      pattern: /disabledProviders contains duplicate entry/,
    },
    {
      name: "empty model key",
      mutate: (document) => {
        const models = document.models as Record<string, unknown>;
        models[""] = { providers: { "prov-c": { thinking: ["low"], default: "low" } } };
      },
      pattern: /models keys must not be empty or whitespace-only/,
    },
    {
      // Without this rejection an empty provider key would derive a
      // capability-based route with an empty provider identifier.
      name: "empty provider capability key",
      mutate: (document) => {
        const models = document.models as Record<string, Record<string, unknown>>;
        const modelX = models["model-x"]!.providers as Record<string, unknown>;
        modelX[""] = { thinking: ["low"], default: "low" };
      },
      pattern: /models\.model-x\.providers keys must not be empty or whitespace-only/,
    },
    {
      name: "whitespace-only model key",
      mutate: (document) => {
        const models = document.models as Record<string, unknown>;
        models["  "] = { providers: { "prov-c": { thinking: ["low"], default: "low" } } };
      },
      pattern: /models keys must not be empty or whitespace-only/,
    },
    {
      // A whitespace-only provider key would otherwise derive a route with a
      // blank provider identifier.
      name: "whitespace-only provider capability key",
      mutate: (document) => {
        const models = document.models as Record<string, Record<string, unknown>>;
        const modelX = models["model-x"].providers as Record<string, unknown>;
        modelX["\t"] = { thinking: ["low"], default: "low" };
      },
      pattern: /models\.model-x\.providers keys must not be empty or whitespace-only/,
    },
    {
      name: "whitespace-only tier model reference",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        const tiers = profiles["two-tier"]!.tiers as Array<Record<string, unknown>>;
        tiers[0]!.model = "  ";
      },
      pattern: /profiles\.two-tier\.tiers\[0\]\.model must not be empty or whitespace-only/,
    },
    {
      name: "whitespace-only tier provider allowlist entry",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        const tiers = profiles["two-tier"]!.tiers as Array<Record<string, unknown>>;
        tiers[0]!.providers = ["prov-a", " "];
      },
      pattern: /profiles\.two-tier\.tiers\[0\]\.providers entries must be non-empty, non-whitespace-only strings/,
    },
    {
      name: "whitespace-only disabled provider entry",
      mutate: (document) => {
        document.disabledProviders = ["  "];
      },
      pattern: /disabledProviders entries must be non-empty, non-whitespace-only strings/,
    },
    {
      name: "empty profile key",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, unknown>;
        profiles[""] = { tiers: [{ model: "model-x", thinking: "high" }] };
      },
      pattern: /profiles keys must not be empty or whitespace-only/,
    },
    {
      name: "whitespace-only profile key",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, unknown>;
        profiles["\n"] = { tiers: [{ model: "model-x", thinking: "high" }] };
      },
      pattern: /profiles keys must not be empty or whitespace-only/,
    },
    {
      name: "whitespace-only role profile reference",
      mutate: (document) => {
        const roles = document.roles as Record<string, unknown>;
        roles.oracle = { profile: "  " };
      },
      pattern: /roles\.oracle\.profile must not be empty or whitespace-only/,
    },
    {
      name: "oracle profile policy omitted",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        delete profiles.pinned!.overridePolicy;
      },
      pattern: /profiles\.pinned\.overridePolicy must be "rejected" for the oracle role/,
    },
    {
      name: "oracle profile policy allowed",
      mutate: (document) => {
        const profiles = document.profiles as Record<string, Record<string, unknown>>;
        profiles.pinned!.overridePolicy = "allowed";
      },
      pattern: /profiles\.pinned\.overridePolicy must be "rejected" for the oracle role/,
    },
  ];
  for (const item of cases) {
    assert.throws(() => syntheticConfig({ mutate: item.mutate }), item.pattern, item.name);
  }
  // The unmutated synthetic config validates.
  syntheticConfig({});
});

test("selectRoutes preserves the ordered tier chains for the shipped gate profiles", () => {
  const config = loadRoutingConfig();
  const keys = (role: DelegateRole) => selectRoutes(config, role).map(routeKey);
  const expectedA = [
    "opencode-go/muse-spark-1.2-contributor:xhigh",
    "agentrouter/gpt-5.6-sol:high",
    "tabitoken/claude-opus-5-thinking:high",
    "gorouter/claude-opus-5-thinking:high",
  ];
  const expectedB = [
    "opencode-go/deepseek-v4-flash:max",
    "agentrouter/claude-opus-5:high",
    "tabitoken/claude-opus-5-thinking:high",
    "gorouter/claude-opus-5-thinking:high",
  ];
  const expectedC = [
    "tokenreply/ox-alpha:xhigh",
    "opencode-go/hy3:high",
    "agentrouter/claude-opus-5:high",
    "tabitoken/claude-opus-5-thinking:high",
    "gorouter/claude-opus-5-thinking:high",
  ];
  // Solution and review pairs share one profile and produce identical
  // chains. Every A/B/C tier allowlists exactly one provider after the
  // seekai removal, so the chains are deterministic without a random draw.
  assert.deepEqual(keys("solution-a"), expectedA);
  assert.deepEqual(keys("review-a"), expectedA);
  assert.deepEqual(keys("solution-b"), expectedB);
  assert.deepEqual(keys("review-b"), expectedB);
  assert.deepEqual(keys("solution-c"), expectedC);
  assert.deepEqual(keys("review-c"), expectedC);
  // Single-provider tiers stay deterministic without parent preference or a draw.
  assert.deepEqual(
    selectRoutes(config, "solution-a", undefined, { parentProvider: "gorouter", random: () => 0.99 }).map(routeKey),
    expectedA,
  );
});

test("gate D and the oracle include every configured Codex alias with inherited or random primaries", () => {
  const config = loadRoutingConfig();
  const canonicalD = CODEX_PROVIDERS.map((provider) => `${provider}/gpt-5.5:high`);
  const canonicalOracle = CODEX_PROVIDERS.map((provider) => `${provider}/gpt-5.6-sol:high`);

  // An eligible parent provider becomes the primary without a random draw.
  let randomCalls = 0;
  assert.deepEqual(
    selectRoutes(config, "solution-d", undefined, {
      parentProvider: "openai-codex-cgpt4",
      random: () => {
        randomCalls += 1;
        return 0.99;
      },
    }).map(routeKey),
    ["openai-codex-cgpt4/gpt-5.5:high", ...canonicalD.filter((key) => key !== "openai-codex-cgpt4/gpt-5.5:high")],
  );
  assert.deepEqual(
    selectRoutes(config, "oracle", undefined, { parentProvider: "openai-codex-cgpt5" }).map(routeKey),
    ["openai-codex-cgpt5/gpt-5.6-sol:high", ...canonicalOracle.filter((key) => key !== "openai-codex-cgpt5/gpt-5.6-sol:high")],
  );
  assert.equal(randomCalls, 0);

  // An ineligible parent falls back to exactly one random draw per tier, and
  // the remaining providers follow in stable config order.
  let draws = 0;
  const dRoutes = selectRoutes(config, "solution-d", undefined, {
    parentProvider: "cursor",
    random: () => {
      draws += 1;
      return 0.4; // floor(0.4 * 9) = 3 -> openai-codex-cgpt2
    },
  });
  assert.equal(draws, 1);
  assert.equal(routeKey(dRoutes[0]!), "openai-codex-cgpt2/gpt-5.5:high");
  assert.deepEqual(
    dRoutes.slice(1).map(routeKey),
    canonicalD.filter((key) => key !== "openai-codex-cgpt2/gpt-5.5:high"),
  );

  let oracleDraws = 0;
  const oracleRoutes = selectRoutes(config, "oracle", undefined, {
    parentProvider: "zai",
    random: () => {
      oracleDraws += 1;
      return 0.99; // clamps to the last provider
    },
  });
  assert.equal(oracleDraws, 1);
  assert.equal(routeKey(oracleRoutes[0]!), "openai-codex-cgpt7/gpt-5.6-sol:high");
  assert.deepEqual(
    oracleRoutes.slice(1).map(routeKey),
    canonicalOracle.filter((key) => key !== "openai-codex-cgpt7/gpt-5.6-sol:high"),
  );

  // Cursor and every non-Codex provider stay excluded from the whole chain.
  for (const routes of [selectRoutes(config, "solution-d", undefined, { random: () => 0 }), oracleRoutes]) {
    assert.equal(routes.length, CODEX_PROVIDERS.length);
    for (const route of routes) {
      assert.ok((CODEX_PROVIDERS as readonly string[]).includes(route.provider));
    }
  }
});

test("implementation and remediation use Fable before the GLM fallback while verification stays pinned", () => {
  const config = loadRoutingConfig();
  const implementationRoutes = ["tokenreply/claude-fable-5:off", "zai/glm-5.3:max"];
  assert.deepEqual(selectRoutes(config, "implementation").map(routeKey), implementationRoutes);
  assert.deepEqual(selectRoutes(config, "remediation").map(routeKey), implementationRoutes);
  assert.deepEqual(selectRoutes(config, "verification").map(routeKey), ["openai-codex/gpt-5.6-sol:high"]);
  assert.deepEqual([...oracleModelIds(config)], ["gpt-5.6-sol"]);
});

test("the shipped config keeps exactly four review roles and no dedicated fifth-reviewer profile", () => {
  const config = loadRoutingConfig();
  const reviews = DELEGATE_ROLES.filter((role) => role.startsWith("review-"));
  assert.deepEqual(reviews, ["review-a", "review-b", "review-c", "review-d"]);
  // Review pairs share the solution profiles; no gate-e-style profile exists.
  for (const [role, profile] of [
    ["review-a", "gate-a"],
    ["review-b", "gate-b"],
    ["review-c", "gate-c"],
    ["review-d", "gate-d"],
  ] as const) {
    assert.equal(config.roles[role].profile, profile);
  }
  assert.equal("gate-e" in config.profiles, false);
});

test("a temporary extra reviewer pins one exact route through a reason-required one-run override", () => {
  const config = loadRoutingConfig();
  // A temporary extra reviewer reuses an existing non-exclusive review role;
  // when it must run a distinct route for that one run, the exceptional
  // routingOverride pins it exactly after capability validation.
  assert.deepEqual(
    selectRoutes(config, "review-a", {
      provider: "openai-codex-cgpt5",
      model: "gpt-5.6-sol",
      thinking: "high",
      reason: "temporary extra reviewer on a distinct route",
    }).map(routeKey),
    ["openai-codex-cgpt5/gpt-5.6-sol:high"],
  );
  // The one-run override stays exceptional: the reason is mandatory and the
  // override never changes role classification.
  assert.throws(
    () => selectRoutes(config, "review-a", {
      provider: "openai-codex-cgpt5",
      model: "gpt-5.6-sol",
      thinking: "high",
      reason: "   ",
    }),
    /requires a non-empty reason/,
  );
  assert.equal(roleIsReadOnly("review-a"), true);
  assert.equal(roleIsExclusive("review-a"), false);
  // Without the override the reused role keeps its normal profile chain.
  assert.ok(selectRoutes(config, "review-a", undefined, { random: () => 0 }).length > 1);
});

test("every role selects a non-empty chain of Pi routes", () => {
  const config = loadRoutingConfig();
  for (const role of DELEGATE_ROLES) {
    const routes = selectRoutes(config, role);
    assert.ok(routes.length > 0, `${role} must select at least one route`);
    for (const route of routes) {
      assert.equal(route.kind, "pi");
      assert.ok(route.provider.length > 0);
      assert.ok(route.model.length > 0);
      assert.ok(route.thinking.length > 0);
    }
  }
});

test("the oracle self-review set covers every model across the oracle profile's tiers", () => {
  const twoTier = (order: readonly string[]) => syntheticConfig({
    mutate: (document) => {
      const profiles = document.profiles as Record<string, Record<string, unknown>>;
      (profiles.pinned!.tiers as Array<Record<string, unknown>>).push({ model: "model-y", thinking: "low", providers: ["prov-a"] });
      document.oracleSafety = { selfReviewModelIds: order };
    },
  });
  // Both tier models are guarded members regardless of declaration order.
  for (const config of [twoTier(["model-x", "model-y"]), twoTier(["model-y", "model-x"])]) {
    assert.deepEqual([...oracleModelIds(config)].sort(), ["model-x", "model-y"]);
    assert.equal(oracleModelIds(config).has("model-y"), true);
    assert.equal(oracleModelIds(config).has("model-x"), true);
  }
  // A duplicate tier model still yields the unique model set.
  const duplicated = syntheticConfig({
    mutate: (document) => {
      const profiles = document.profiles as Record<string, Record<string, unknown>>;
      (profiles.pinned!.tiers as Array<Record<string, unknown>>).push({ model: "model-x", thinking: "high", providers: ["prov-b"] });
    },
  });
  assert.deepEqual([...oracleModelIds(duplicated)], ["model-x"]);
});

test("selected routes never carry whitespace-only provider or model ids", () => {
  const config = loadRoutingConfig();
  for (const role of DELEGATE_ROLES) {
    for (const route of selectRoutes(config, role, undefined, { random: () => 0 })) {
      assert.ok(route.provider.trim().length > 0, `${role} must not select a whitespace-only provider id`);
      assert.ok(route.model.trim().length > 0, `${role} must not select a whitespace-only model id`);
    }
  }
  // Defense in depth: even an in-memory config mutation that smuggles a
  // whitespace-only provider capability past validation cannot produce a
  // blank route; the selector invariant rejects it.
  const base = syntheticConfig({});
  const smuggled: RoutingConfig = {
    ...base,
    models: {
      ...base.models,
      "model-x": {
        providers: {
          ...base.models["model-x"]!.providers,
          " ": { thinking: ["high"], default: "high" },
        },
      },
    },
    roles: { ...base.roles, "solution-a": { profile: "all" } },
  };
  assert.throws(
    () => selectRoutes(smuggled, "solution-a", undefined, { random: () => 0 }),
    /routing produced a route with a whitespace-only provider or model id/,
  );
});

test("the parent provider is preferred inside a multi-provider tier", () => {
  const config = loadRoutingConfig();
  // Gate D still groups one model across several providers: an eligible
  // parent provider becomes that tier's primary without touching the stable
  // order of the remaining providers.
  const canonicalD = CODEX_PROVIDERS.map((provider) => `${provider}/gpt-5.5:high`);
  assert.deepEqual(
    selectRoutes(config, "solution-d", undefined, { parentProvider: "openai-codex-cgpt1" }).map(routeKey),
    ["openai-codex-cgpt1/gpt-5.5:high", ...canonicalD.filter((key) => key !== "openai-codex-cgpt1/gpt-5.5:high")],
  );
  // Gate B's deepseek-v4-flash pool lost seekai and is single-provider now:
  // even a seekai parent cannot promote the removed provider back into a
  // route, and the chain stays deterministic without a draw.
  assert.deepEqual(
    selectRoutes(config, "solution-b", undefined, { parentProvider: "seekai", random: () => 0.99 }).map(routeKey),
    [
      "opencode-go/deepseek-v4-flash:max",
      "agentrouter/claude-opus-5:high",
      "tabitoken/claude-opus-5-thinking:high",
      "gorouter/claude-opus-5-thinking:high",
    ],
  );
  // An unrelated parent provider does not disturb the stable order.
  assert.deepEqual(
    selectRoutes(config, "review-d", undefined, { parentProvider: "zai", random: () => 0 }).map(routeKey).slice(0, 2),
    ["openai-codex/gpt-5.5:high", "openai-codex-zahlo/gpt-5.5:high"],
  );
});

test("tiers concatenate in configured order with per-tier primaries", () => {
  const config = syntheticConfig({});
  // First tier prefers the parent provider; the second single-provider tier
  // stays deterministic, and the concatenation keeps tier order.
  assert.deepEqual(
    selectRoutes(config, "solution-a", undefined, { parentProvider: "prov-a" }).map(routeKey),
    ["prov-a/model-x:max", "prov-a/model-y:low"],
  );
  // Without parent preference the pinned profile's two-provider tier draws
  // exactly once, then keeps the remaining provider in stable config order.
  let draws = 0;
  const routes = selectRoutes(config, "oracle", undefined, {
    random: () => {
      draws += 1;
      return 0.9;
    },
  });
  assert.equal(draws, 1);
  assert.deepEqual(routes.map(routeKey), ["prov-b/model-x:high", "prov-a/model-x:high"]);
});

test("disabled providers drop out of multi-provider tiers", () => {
  const config = syntheticConfig({
    mutate: (document) => {
      // The "all" profile uses model-x at high on both providers, so
      // disabling prov-b leaves prov-a eligible.
      document.disabledProviders = ["prov-b"];
      const roles = document.roles as Record<string, unknown>;
      roles["solution-a"] = { profile: "all" };
    },
  });
  assert.deepEqual(selectRoutes(config, "solution-a").map(routeKey), ["prov-a/model-x:high"]);
});

test("model-only overrides treat every capable provider as one pool at its default thinking", () => {
  const config = loadRoutingConfig();
  // glm-5.3 has exactly the zai capability: the pool is deterministic.
  assert.deepEqual(
    selectRoutes(config, "review-a", { model: "glm-5.3", reason: "user requested Z.AI for this review" }).map(routeKey),
    ["zai/glm-5.3:max"],
  );

  const synthetic = syntheticConfig({});
  const override = { model: "model-x", reason: "user requested model-x" } as const;
  // An eligible parent provider becomes the pool primary without a draw.
  let parentDraws = 0;
  assert.deepEqual(
    selectRoutes(synthetic, "solution-a", override, {
      parentProvider: "prov-b",
      random: () => {
        parentDraws += 1;
        return 0;
      },
    }).map(routeKey),
    ["prov-b/model-x:high", "prov-a/model-x:max"],
  );
  assert.equal(parentDraws, 0);

  // An ineligible parent leaves exactly one random draw; the primary rotates
  // while the remainder keeps stable config order and each provider keeps
  // its own configured default thinking level.
  let draws = 0;
  assert.deepEqual(
    selectRoutes(synthetic, "solution-a", override, {
      parentProvider: "cursor",
      random: () => {
        draws += 1;
        return 0.9; // floor(0.9 * 2) = 1 -> prov-b primary
      },
    }).map(routeKey),
    ["prov-b/model-x:high", "prov-a/model-x:max"],
  );
  assert.equal(draws, 1);

  // A third capable provider keeps the stable remainder order visible.
  const threeProviders = syntheticConfig({
    mutate: (document) => {
      const models = document.models as Record<string, Record<string, unknown>>;
      models["model-x"] = {
        providers: {
          "prov-a": { thinking: ["low", "high", "max"], default: "max" },
          "prov-b": { thinking: ["high"], default: "high" },
          "prov-c": { thinking: ["high", "max"], default: "high" },
        },
      };
    },
  });
  let orderDraws = 0;
  assert.deepEqual(
    selectRoutes(threeProviders, "solution-a", override, {
      parentProvider: "cursor",
      random: () => {
        orderDraws += 1;
        return 0.5; // floor(0.5 * 3) = 1 -> prov-b primary
      },
    }).map(routeKey),
    ["prov-b/model-x:high", "prov-a/model-x:max", "prov-c/model-x:high"],
  );
  assert.equal(orderDraws, 1);

  // Exclusions filter the pool before selection; an excluded eligible parent
  // never becomes the primary.
  assert.deepEqual(
    selectRoutes(synthetic, "solution-a", { model: "model-x", excludeProviders: ["prov-a"], reason: "avoid prov-a" }, { parentProvider: "prov-a" }).map(routeKey),
    ["prov-b/model-x:high"],
  );
});

test("provider-only overrides pin and filter the configured tiers", () => {
  const config = loadRoutingConfig();
  // Pinning opencode-go keeps only the tiers opencode-go can serve.
  assert.deepEqual(
    selectRoutes(config, "solution-b", { provider: "opencode-go", reason: "user requested opencode-go" }).map(routeKey),
    ["opencode-go/deepseek-v4-flash:max"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-d", { provider: "openai-codex-cgpt4", reason: "user requested cgpt4" }).map(routeKey),
    ["openai-codex-cgpt4/gpt-5.5:high"],
  );
  // A provider that cannot serve any configured tier is a bounded error.
  assert.throws(
    () => selectRoutes(config, "verification", { provider: "zai", reason: "user requested zai" }),
    /routing produced no eligible route/,
  );
});

test("provider plus model overrides are exact after capability validation", () => {
  const config = loadRoutingConfig();
  assert.deepEqual(
    selectRoutes(config, "verification", {
      provider: "openai-codex-cgpt5",
      model: "gpt-5.6-sol",
      thinking: "high",
      reason: "user requested an exact route",
    }).map(routeKey),
    ["openai-codex-cgpt5/gpt-5.6-sol:high"],
  );
  // Without an explicit thinking level the provider's configured default applies.
  assert.deepEqual(
    selectRoutes(config, "implementation", { provider: "agentrouter", model: "gpt-5.6-sol", reason: "user requested sol on agentrouter" }).map(routeKey),
    ["agentrouter/gpt-5.6-sol:high"],
  );
  // Capability violations fail closed.
  assert.throws(
    () => selectRoutes(config, "implementation", { provider: "seekai", model: "glm-5.3", reason: "invalid" }),
    /provider "seekai" has no capability record for model "glm-5\.3"/,
  );
  assert.throws(
    () => selectRoutes(config, "implementation", { provider: "gorouter", model: "claude-opus-5-thinking", thinking: "max", reason: "invalid" }),
    /does not support model "claude-opus-5-thinking" at thinking "max"/,
  );
  assert.throws(
    () => selectRoutes(config, "implementation", { model: "unknown-model", reason: "invalid" }),
    /"unknown-model" has no capability record/,
  );
});

test("exclusion overrides filter providers inside every tier", () => {
  const config = loadRoutingConfig();
  assert.deepEqual(
    selectRoutes(config, "solution-b", { excludeProviders: ["opencode-go"], reason: "opencode-go is down" }).map(routeKey),
    [
      "agentrouter/claude-opus-5:high",
      "tabitoken/claude-opus-5-thinking:high",
      "gorouter/claude-opus-5-thinking:high",
    ],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-d", { excludeProviders: ["openai-codex", "openai-codex-zahlo", "openai-codex-cgpt1", "openai-codex-cgpt2", "openai-codex-cgpt3", "openai-codex-cgpt4", "openai-codex-cgpt6", "openai-codex-cgpt7"], reason: "only cgpt5" }).map(routeKey),
    ["openai-codex-cgpt5/gpt-5.5:high"],
  );
  // Excluding every eligible provider is a bounded error, not an empty run.
  assert.throws(
    () => selectRoutes(config, "implementation", { excludeProviders: ["tokenreply", "zai"], reason: "invalid" }),
    /routing produced no eligible route/,
  );
});

test("invalid or no-op overrides are rejected", () => {
  const config = loadRoutingConfig();
  const reason = "user requested an exceptional change";
  assert.throws(
    () => selectRoutes(config, "solution-a", { reason } as never),
    /routingOverride is a no-op/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-a", { provider: "zai", reason: "   " }),
    /requires a non-empty reason/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-a", { thinking: "high", reason } as never),
    /routingOverride.thinking requires routingOverride.model/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-a", { model: "glm-5.3", thinking: "", reason } as never),
    /routingOverride.thinking must be a non-empty string/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-a", { model: "glm-5.3", excludeProviders: [], reason } as never),
    /excludeProviders must be a non-empty array/,
  );
});

test("the oracle role rejects every override even when the profile policy is mutated", () => {
  const config = loadRoutingConfig();
  assert.throws(
    () => selectRoutes(config, "oracle", { model: "glm-5.3", reason: "attempted override" }),
    /routingOverride is not allowed for the oracle role/,
  );
  assert.throws(
    () => selectRoutes(config, "oracle", { excludeProviders: ["openai-codex"], reason: "attempted exclusion" }),
    /routingOverride is not allowed for the oracle role/,
  );
  // Defense in depth: simulate an in-memory mutation that flips the oracle
  // profile policy to "allowed". Validation would reject this config, but
  // the selector still rejects the override by role alone.
  const base = syntheticConfig({});
  const mutated: RoutingConfig = {
    ...base,
    profiles: {
      ...base.profiles,
      pinned: { ...base.profiles.pinned!, overridePolicy: "allowed" },
    },
  };
  assert.throws(
    () => selectRoutes(mutated, "oracle", { model: "model-y", reason: "attempted override" }),
    /routingOverride is not allowed for the oracle role/,
  );
  // Non-oracle roles keep override support through the same mutated config,
  // and overrides never change role classification: permissions and
  // concurrency stay a function of the role.
  assert.ok(selectRoutes(mutated, "implementation", { model: "model-x", reason: "explicit request" }, { random: () => 0 }).length > 0);
  assert.equal(roleIsReadOnly("implementation"), false);
  assert.equal(roleIsExclusive("implementation"), true);
  assert.equal(roleIsReadOnly("verification"), true);
  assert.equal(roleIsExclusive("oracle"), true);
});
