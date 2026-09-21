import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createRouteScheduler,
  loadRoutingConfig as loadLiveRoutingConfig,
  loadRoutingSnapshot,
  oracleModelIds,
  readRoutingConfigFile,
  requireRole,
  roleIds,
  roleIdsInFamily,
  selectRoutes,
  validateRoutingConfig,
  type ResolvedRole,
  type RouteSelectionOptions,
  type RoutingConfig,
} from "./routing.ts";
import { roleIsExclusive, roleIsReadOnly, routeKey } from "./routes.ts";
import { loadRoutingFixture } from "./routing.test-fixture.ts";
import type { DelegateRole } from "./types.ts";

const POOL_PROVIDERS = [
  "provider-a",
  "provider-b",
  "provider-c",
  "provider-d",
  "provider-e",
  "provider-f",
  "provider-g",
  "provider-h",
] as const;

// Concrete selection tests use a stable fixture. Only acceptance checks read
// the operator-owned routing.json, so valid policy edits do not rewrite tests.
const loadRoutingConfig = loadRoutingFixture;

function syntheticConfig(overrides: {
  mutate?: (document: Record<string, unknown>) => void;
}): RoutingConfig {
  const document: Record<string, unknown> = {
    version: 2,
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
    assignments: {
      solution: ["two-tier", "two-tier", "two-tier", "two-tier", "two-tier", "two-tier"],
      review: ["two-tier", "two-tier", "two-tier", "two-tier", "two-tier"],
      implementation: "two-tier",
      remediation: "two-tier",
      verification: "two-tier",
      oracle: "pinned",
    },
  };
  overrides.mutate?.(document);
  return validateRoutingConfig(document);
}

const CODEX_PROVIDERS = ["openai-codex", "openai-codex-a", "openai-codex-b", "openai-codex-c"] as const;

function providerPoolConfig(providers: readonly string[] = CODEX_PROVIDERS): RoutingConfig {
  return validateRoutingConfig({
    version: 2,
    thinkingLevels: ["low", "high"],
    disabledProviders: [],
    models: {
      "model-x": {
        providers: Object.fromEntries(providers.map((provider) => [provider, { thinking: ["high"], default: "high" }])),
      },
    },
    profiles: {
      pool: { tiers: [{ model: "model-x", thinking: "high" }] },
      oracle: { overridePolicy: "rejected", tiers: [{ model: "model-x", thinking: "high" }] },
    },
    assignments: {
      solution: ["pool"], review: ["pool"], implementation: "pool",
      remediation: "pool", verification: "pool", oracle: "oracle",
    },
  });
}

function usageSnapshot(records: Readonly<Record<string, {
  readonly planType?: string;
  readonly allowed?: boolean;
  readonly primary?: number;
  readonly secondary?: number;
  readonly secondaryResetAt?: number;
}>>): NonNullable<RouteSelectionOptions["codexUsageSnapshot"]> {
  return Object.freeze(Object.fromEntries(Object.entries(records).map(([providerId, usage]) => [
    providerId,
    Object.freeze({
      providerId,
      planType: usage.planType ?? "plus",
      fetchedAt: 0,
      allowed: usage.allowed ?? true,
      ...(usage.primary === undefined ? {} : { primary: Object.freeze({ remainingPercent: usage.primary, resetAt: 1 }) }),
      ...(usage.secondary === undefined ? {} : { secondary: Object.freeze({
        remainingPercent: usage.secondary,
        ...(usage.secondaryResetAt === undefined ? {} : { resetAt: usage.secondaryResetAt }),
      }) }),
    }),
  ])));
}

test("the operator routing config loads and fails closed on invalid files", async () => {
  const config = loadLiveRoutingConfig();
  assert.equal(config.version, 2);
  // The cached loader returns the same validated instance.
  assert.equal(loadLiveRoutingConfig(), config);

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

test("the runtime loaders read the complete operator routing.json policy", () => {
  const expected = readRoutingConfigFile(fileURLToPath(new URL("./routing.json", import.meta.url)));
  const cached = loadLiveRoutingConfig();
  const snapshot = loadRoutingSnapshot();
  // A fresh read, not the process cache: registration reload picks up edits.
  assert.notEqual(snapshot, cached);
  assert.deepEqual(cached, expected);
  assert.deepEqual(snapshot, expected);
});

test("config validation rejects structural violations", () => {
  const cases: Array<{ name: string; mutate: (document: Record<string, unknown>) => void; pattern: RegExp }> = [
    {
      name: "wrong version",
      mutate: (document) => {
        document.version = 3;
      },
      pattern: /version must be exactly 2/,
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
      name: "assignments not an object",
      mutate: (document) => {
        document.assignments = [];
      },
      pattern: /assignments must be an object/,
    },
    {
      name: "assignments missing a family key",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        delete assignments.oracle;
      },
      pattern: /assignments\.oracle is required/,
    },
    {
      name: "assignments extra family key",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.extra = "two-tier";
      },
      pattern: /assignments has unknown key "extra"/,
    },
    {
      name: "solution assignment not an array",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.solution = "two-tier";
      },
      pattern: /assignments\.solution must be a non-empty ordered array of profile names/,
    },
    {
      name: "empty solution assignment",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.solution = [];
      },
      pattern: /assignments\.solution must be a non-empty ordered array of profile names/,
    },
    {
      name: "oversized indexed family",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.solution = Array.from({ length: 27 }, () => "two-tier");
      },
      pattern: /assignments\.solution lists 27 profiles, but indexed families support at most 26 roles \(solution-a\.\.solution-z\)/,
    },
    {
      name: "blank indexed profile entry",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.solution = ["two-tier", "  "];
      },
      pattern: /assignments\.solution\[1\] must be a non-empty, non-whitespace-only profile name/,
    },
    {
      name: "non-string indexed profile entry",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.review = ["two-tier", 7];
      },
      pattern: /assignments\.review\[1\] must be a non-empty, non-whitespace-only profile name/,
    },
    {
      name: "indexed entry referencing unknown profile",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.solution = ["two-tier", "ghost"];
      },
      pattern: /assignments\.solution\[1\] references unknown profile "ghost"/,
    },
    {
      name: "singleton assignment as an array",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.implementation = ["two-tier"];
      },
      pattern: /assignments\.implementation must be exactly one non-empty, non-whitespace-only profile name string/,
    },
    {
      name: "singleton assignment as an object",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.remediation = { profile: "two-tier" };
      },
      pattern: /assignments\.remediation must be exactly one non-empty, non-whitespace-only profile name string/,
    },
    {
      name: "whitespace-only singleton assignment",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.verification = " ";
      },
      pattern: /assignments\.verification must be exactly one non-empty, non-whitespace-only profile name string/,
    },
    {
      name: "singleton referencing unknown profile",
      mutate: (document) => {
        const assignments = document.assignments as Record<string, unknown>;
        assignments.oracle = "ghost";
      },
      pattern: /assignments\.oracle references unknown profile "ghost"/,
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

test("a version-1 document is rejected with one clear migration error, not dual-schema support", () => {
  const v1Document = {
    version: 1,
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    disabledProviders: [],
    models: { "model-x": { providers: { "prov-a": { thinking: ["high"], default: "high" } } } },
    profiles: { solo: { overridePolicy: "rejected", tiers: [{ model: "model-x", thinking: "high" }] } },
    roles: { "solution-a": { profile: "solo" }, oracle: { profile: "solo" } },
    oracleSafety: { selfReviewModelIds: ["model-x"] },
  };
  assert.throws(
    () => validateRoutingConfig(v1Document),
    /version 1 was removed: migrate the concrete v1 roles mapping and oracleSafety\.selfReviewModelIds into the version 2 assignments object/,
  );
  // The version gate fires before the key check, so the error names the
  // migration rather than complaining about unknown v1 keys.
  try {
    validateRoutingConfig(v1Document);
    assert.fail("must throw");
  } catch (error) {
    assert.equal((error as Error).message.includes("unknown key"), false);
  }
});

test("assignments derive ordered zero-based slots and canonical role ids", () => {
  const config = syntheticConfig({
    mutate: (document) => {
      const assignments = document.assignments as Record<string, unknown>;
      assignments.solution = ["two-tier", "all", "pinned", "all"];
      assignments.review = ["all", "pinned"];
    },
  });
  const solution = roleIdsInFamily(config, "solution");
  const review = roleIdsInFamily(config, "review");
  assert.deepEqual(solution, ["solution-a", "solution-b", "solution-c", "solution-d"]);
  assert.deepEqual(review, ["review-a", "review-b"]);
  assert.deepEqual(
    config.roles.get("solution-a"),
    { id: "solution-a", family: "solution", profile: "two-tier", slot: 0 },
  );
  assert.deepEqual(
    config.roles.get("solution-d"),
    { id: "solution-d", family: "solution", profile: "all", slot: 3 },
  );
  assert.deepEqual(
    config.roles.get("review-b"),
    { id: "review-b", family: "review", profile: "pinned", slot: 1 },
  );
  // Singleton families keep their fixed ids, no slot.
  assert.deepEqual(config.roles.get("oracle"), { id: "oracle", family: "oracle", profile: "pinned" });
  assert.deepEqual(config.roles.get("implementation"), { id: "implementation", family: "implementation", profile: "two-tier" });
  // Canonical registry order: solution slots, review slots, then singletons.
  assert.deepEqual(roleIds(config), [
    ...solution,
    ...review,
    "implementation",
    "remediation",
    "verification",
    "oracle",
  ]);
});

test("an indexed family of exactly 26 profiles derives through the z slot", () => {
  const config = syntheticConfig({
    mutate: (document) => {
      const assignments = document.assignments as Record<string, unknown>;
      assignments.solution = Array.from({ length: 26 }, () => "two-tier");
    },
  });
  const solution = roleIdsInFamily(config, "solution");
  assert.equal(solution.length, 26);
  assert.equal(solution[0], "solution-a");
  assert.equal(solution[25], "solution-z");
  assert.equal(config.roles.get("solution-z")!.slot, 25);
});

test("a profile may repeat inside and across indexed assignment arrays", () => {
  const config = syntheticConfig({
    mutate: (document) => {
      const assignments = document.assignments as Record<string, unknown>;
      assignments.solution = ["two-tier", "two-tier"];
      assignments.review = ["two-tier", "two-tier"];
    },
  });
  // Duplicate profiles are intentional: distinct role ids share one profile.
  assert.equal(config.roles.get("solution-a")!.profile, "two-tier");
  assert.equal(config.roles.get("solution-b")!.profile, "two-tier");
  assert.equal(config.roles.get("review-a")!.profile, "two-tier");
  // Reused profiles produce identical chains.
  assert.deepEqual(
    selectRoutes(config, "solution-a").map(routeKey),
    selectRoutes(config, "solution-b").map(routeKey),
  );
  assert.deepEqual(
    selectRoutes(config, "review-b").map(routeKey),
    selectRoutes(config, "solution-a").map(routeKey),
  );
});

test("unknown roles fail closed at the registry boundary", () => {
  const config = loadRoutingConfig();
  assert.throws(() => requireRole(config, "solution-z"), /unknown delegate role "solution-z"/);
  // The stable fixture's review family ends at review-c.
  assert.throws(() => requireRole(config, "review-d"), /unknown delegate role "review-d"/);
  assert.throws(() => requireRole(config, "ghost"), /unknown delegate role "ghost"/);
  // Route selection performs the same registry validation.
  assert.throws(
    () => selectRoutes(config, "solution-impl" as DelegateRole),
    /unknown delegate role "solution-impl"/,
  );
  // A lookalike id never resolves: registry lookup is exact.
  assert.equal(config.roles.has("solution-a "), false);
  assert.equal(config.roles.has("Solution-A"), false);
});

test("selectRoutes preserves the ordered tier chains for the stable routing fixture", () => {
  const config = loadRoutingConfig();
  const keys = (role: DelegateRole) => selectRoutes(config, role).map(routeKey);
  const expectedC = ["provider-i/model-c:max"];
  const expectedD = ["provider-i/model-d:high"];
  const expectedE = ["provider-j/model-e:xhigh"];
  const expectedF = ["provider-j/model-f:high"];
  const expectedG = ["provider-k/model-g:high"];
  const expectedH = ["provider-k/model-h:high"];
  const expectedI = [
    "provider-l/model-i:max",
    "provider-k/model-j:high",
  ];
  // Solution and review pairs share one profile and produce identical
  // chains. Every tier of these gates allowlists exactly one provider, so
  // the chains are deterministic without a random draw.
  assert.deepEqual(keys("solution-c"), expectedC);
  assert.deepEqual(keys("review-c"), expectedC);
  assert.deepEqual(keys("solution-d"), expectedD);
  assert.deepEqual(keys("solution-e"), expectedE);
  assert.deepEqual(keys("solution-f"), expectedF);
  assert.deepEqual(keys("solution-g"), expectedG);
  assert.deepEqual(keys("solution-h"), expectedH);
  assert.deepEqual(keys("solution-i"), expectedI);
  // Single-provider tiers stay deterministic and consume no random draw,
  // even when one is injected.
  let draws = 0;
  const counting = () => {
    draws += 1;
    return 0.99;
  };
  assert.deepEqual(selectRoutes(config, "solution-c", undefined, { random: counting }).map(routeKey), expectedC);
  assert.deepEqual(selectRoutes(config, "solution-i", undefined, { random: counting }).map(routeKey), expectedI);
  assert.equal(draws, 0);
});

test("gate A, gate B, and the oracle select their configured provider pools", () => {
  const config = loadRoutingConfig();
  const canonicalA = POOL_PROVIDERS.map((provider) => `${provider}/model-a:high`);
  const canonicalB = POOL_PROVIDERS.map((provider) => `${provider}/model-b:high`);

  // Without a usage snapshot, every multi-provider tier consumes exactly
  // one random draw and the primary follows it.
  let draws = 0;
  const aRoutes = selectRoutes(config, "solution-a", undefined, {
    random: () => {
      draws += 1;
      return 0.4; // floor(0.4 * 8) = 3 -> provider-d
    },
  });
  assert.equal(draws, 1);
  assert.equal(routeKey(aRoutes[0]!), "provider-d/model-a:high");
  assert.deepEqual(
    aRoutes.slice(1).map(routeKey),
    canonicalA.filter((key) => key !== "provider-d/model-a:high"),
  );

  let bDraws = 0;
  assert.deepEqual(
    selectRoutes(config, "review-b", undefined, {
      random: () => {
        bDraws += 1;
        return 0;
      },
    }).map(routeKey),
    canonicalB,
  );
  assert.equal(bDraws, 1);

  let oracleDraws = 0;
  const oracleRoutes = selectRoutes(config, "oracle", undefined, {
    random: () => {
      oracleDraws += 1;
      return 0.99; // clamps to the last provider
    },
  });
  assert.equal(oracleDraws, 1);
  assert.equal(routeKey(oracleRoutes[0]!), "provider-h/model-a:high");
  assert.deepEqual(
    oracleRoutes.slice(1).map(routeKey),
    canonicalA.filter((key) => key !== "provider-h/model-a:high"),
  );

  for (const routes of [
    selectRoutes(config, "solution-a", undefined, { random: () => 0 }),
    selectRoutes(config, "solution-b", undefined, { random: () => 0 }),
    oracleRoutes,
  ]) {
    assert.equal(routes.length, POOL_PROVIDERS.length);
    for (const route of routes) {
      assert.ok((POOL_PROVIDERS as readonly string[]).includes(route.provider));
    }
  }
});

test("singleton role assignments select their configured fixture routes", () => {
  const config = loadRoutingConfig();
  const implementationRoutes = ["provider-i/model-c:max"];
  assert.deepEqual(selectRoutes(config, "implementation").map(routeKey), implementationRoutes);
  assert.deepEqual(selectRoutes(config, "remediation").map(routeKey), implementationRoutes);
  assert.deepEqual(selectRoutes(config, "verification").map(routeKey), ["provider-a/model-a:high"]);
  assert.deepEqual([...oracleModelIds(config)], ["model-a"]);
});

test("the stable fixture assignments map gate-a through gate-i to the derived role ids", () => {
  const config = loadRoutingConfig();
  const solutions = roleIdsInFamily(config, "solution");
  const reviews = roleIdsInFamily(config, "review");
  assert.deepEqual(solutions, [
    "solution-a", "solution-b", "solution-c", "solution-d", "solution-e",
    "solution-f", "solution-g", "solution-h", "solution-i",
  ]);
  assert.deepEqual(reviews, ["review-a", "review-b", "review-c"]);
  for (const [index, id] of solutions.entries()) {
    assert.equal(config.roles.get(id)!.profile, `gate-${String.fromCharCode(97 + index)}`);
  }
  for (const [index, id] of reviews.entries()) {
    assert.equal(config.roles.get(id)!.profile, `gate-${String.fromCharCode(97 + index)}`);
  }
  for (const gate of ["gate-a", "gate-b", "gate-c", "gate-d", "gate-e", "gate-f", "gate-g", "gate-h", "gate-i"]) {
    assert.equal(gate in config.profiles, true, gate);
  }
  // Every fixture role id resolves through the registry.
  for (const id of roleIds(config)) {
    const resolved: ResolvedRole = requireRole(config, id);
    assert.equal(resolved.id, id);
    assert.ok(config.profiles[resolved.profile] !== undefined);
  }
});

test("a temporary extra reviewer pins one exact route through a reason-required one-run override", () => {
  const config = loadRoutingConfig();
  // A temporary extra reviewer reuses an existing non-exclusive review role;
  // when it must run a distinct route for that one run, the exceptional
  // routingOverride pins it exactly after capability validation.
  assert.deepEqual(
    selectRoutes(config, "review-a", {
      provider: "provider-f",
      model: "model-a",
      thinking: "high",
      reason: "temporary extra reviewer on a distinct route",
    }).map(routeKey),
    ["provider-f/model-a:high"],
  );
  // The one-run override stays exceptional: the reason is mandatory and the
  // override never changes role classification.
  assert.throws(
    () => selectRoutes(config, "review-a", {
      provider: "provider-f",
      model: "model-a",
      thinking: "high",
      reason: "   ",
    }),
    /requires a non-empty reason/,
  );
  const reviewA = requireRole(config, "review-a");
  assert.equal(roleIsReadOnly(reviewA), true);
  assert.equal(roleIsExclusive(reviewA), false);
  const canonicalA = POOL_PROVIDERS.map((provider) => `${provider}/model-a:high`);
  assert.deepEqual(
    selectRoutes(config, "review-a", undefined, { random: () => 0 }).map(routeKey),
    canonicalA,
  );
});

test("every operator-configured role selects a non-empty chain of Pi routes", () => {
  const config = loadLiveRoutingConfig();
  for (const id of roleIds(config)) {
    const routes = selectRoutes(config, id);
    assert.ok(routes.length > 0, `${id} must select at least one route`);
    for (const route of routes) {
      assert.equal(route.kind, "pi");
      assert.ok(route.provider.length > 0);
      assert.ok(route.model.length > 0);
      assert.ok(route.thinking.length > 0);
    }
  }
});

test("the oracle self-review set derives from every tier of the assigned oracle profile", () => {
  const twoTier = syntheticConfig({
    mutate: (document) => {
      const profiles = document.profiles as Record<string, Record<string, unknown>>;
      (profiles.pinned!.tiers as Array<Record<string, unknown>>).push({ model: "model-y", thinking: "low", providers: ["prov-a"] });
    },
  });
  // Both tier models are guarded members; there is no separate declared set
  // that could drift from the assigned profile.
  assert.deepEqual([...oracleModelIds(twoTier)].sort(), ["model-x", "model-y"]);
  assert.equal(oracleModelIds(twoTier).has("model-y"), true);
  assert.equal(oracleModelIds(twoTier).has("model-x"), true);
  // A duplicate tier model still yields the unique model set.
  const duplicated = syntheticConfig({
    mutate: (document) => {
      const profiles = document.profiles as Record<string, Record<string, unknown>>;
      (profiles.pinned!.tiers as Array<Record<string, unknown>>).push({ model: "model-x", thinking: "high", providers: ["prov-b"] });
    },
  });
  assert.deepEqual([...oracleModelIds(duplicated)], ["model-x"]);
  // Reassigning the oracle family to a different profile changes the derived
  // set with it; the new profile must keep the rejected override policy.
  const reassigned = syntheticConfig({
    mutate: (document) => {
      const profiles = document.profiles as Record<string, Record<string, unknown>>;
      profiles["two-tier"]!.overridePolicy = "rejected";
      const assignments = document.assignments as Record<string, unknown>;
      assignments.oracle = "two-tier";
    },
  });
  assert.deepEqual([...oracleModelIds(reassigned)].sort(), ["model-x", "model-y"]);
});

test("selected routes never carry whitespace-only provider or model ids", () => {
  const config = loadLiveRoutingConfig();
  for (const id of roleIds(config)) {
    for (const route of selectRoutes(config, id, undefined, { random: () => 0 })) {
      assert.ok(route.provider.trim().length > 0, `${id} must not select a whitespace-only provider id`);
      assert.ok(route.model.trim().length > 0, `${id} must not select a whitespace-only model id`);
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
    roles: new Map(base.roles).set("solution-a", { id: "solution-a", family: "solution", profile: "all", slot: 0 }),
  };
  assert.throws(
    () => selectRoutes(smuggled, "solution-a", undefined, { random: () => 0 }),
    /routing produced a route with a whitespace-only provider or model id/,
  );
});

test("without a usage snapshot, the random primary keeps the stable fallback order", () => {
  const config = loadRoutingConfig();
  const canonicalB = POOL_PROVIDERS.map((provider) => `${provider}/model-b:high`);
  let draws = 0;
  const routes = selectRoutes(config, "solution-b", undefined, {
    random: () => {
      draws += 1;
      return 0;
    },
  });
  assert.equal(draws, 1);
  assert.deepEqual(routes.map(routeKey), canonicalB);

  // Regression: the removed former parent-provider option can no longer
  // suppress the draw.
  const formerParentKey = ["parent", "Provider"].join("");
  let smuggledDraws = 0;
  const formerParentOptions = {
    [formerParentKey]: "provider-e",
    random: () => {
      smuggledDraws += 1;
      return 0;
    },
  } as never;
  assert.deepEqual(
    selectRoutes(config, "solution-b", undefined, formerParentOptions).map(routeKey),
    canonicalB,
  );
  assert.equal(smuggledDraws, 1);

  let tierDraws = 0;
  assert.deepEqual(
    selectRoutes(config, "solution-i", undefined, {
      random: () => {
        tierDraws += 1;
        return 0.99;
      },
    }).map(routeKey),
    ["provider-l/model-i:max", "provider-k/model-j:high"],
  );
  assert.equal(tierDraws, 0);
});

test("Codex usage ranks the primary and fallback tail by 5-hour remaining", () => {
  const config = providerPoolConfig();
  const before = structuredClone(config);
  const snapshot = usageSnapshot({
    "openai-codex": { primary: 20 },
    "openai-codex-a": { primary: 20 },
    "openai-codex-b": { primary: 90 },
    "openai-codex-c": { primary: 80 },
  });
  // Old timestamps deliberately prove routing trusts the snapshot boundary.
  const routes = selectRoutes(config, "solution-a", undefined, {
    codexUsageSnapshot: snapshot,
    random: () => assert.fail("a unique highest score must not draw"),
  });
  assert.deepEqual(routes.map((route) => route.provider), [
    "openai-codex-b", "openai-codex-c", "openai-codex", "openai-codex-a",
  ]);
  assert.deepEqual(config, before);
  assert.equal(snapshot["openai-codex-b"]!.primary!.remainingPercent, 90);
});

test("standard weights pace weekly quota and reset time with protective multiplicative 5-hour headroom", () => {
  const now = 1_800_000_000_000;
  for (const [primary, secondary, secondsLeft, expected] of [
    [80, 25, 604800, 40],
    [80, 25, 151200, 80],
    [80, 100, 151200, 120],
    [20, 100, 151200, 30],
    [80, 1, 604800, 40],
    [80, 1, 60, 80],
    [80, 25, 1209600, 40],
  ]) {
    let selections = 0;
    selectRoutes(providerPoolConfig(), "solution-a", undefined, {
      now: () => now,
      codexUsageSnapshot: usageSnapshot({
        "openai-codex": { primary, secondary, secondaryResetAt: now / 1000 + secondsLeft },
      }),
      scheduler: {
        release: () => false,
        select: (_pool, providers) => {
          selections += 1;
          assert.deepEqual(providers, [{ provider: "openai-codex", weight: expected }]);
          return providers[0]!.provider;
        },
      },
    });
    assert.equal(selections, 1);
  }
});

test("missing weekly/reset data gives a neutral factor and credits cannot change weights", () => {
  for (const weekly of [{}, { secondary: 1 }, { secondary: 100 }]) {
    const snapshot = usageSnapshot({ "openai-codex": { primary: 60, ...weekly } });
    selectRoutes(providerPoolConfig(), "solution-a", undefined, {
      now: () => 1_800_000_000_000,
      codexUsageSnapshot: { "openai-codex": { ...snapshot["openai-codex"]!, ...{ credits: 9999 } } },
      scheduler: {
        release: () => false,
        select: (_pool, providers) => {
          assert.deepEqual(providers, [{ provider: "openai-codex", weight: 60 }]);
          return providers[0]!.provider;
        },
      },
    });
  }
});

test("paced weights also rank the fallback tail without comparing standards to weekly-only reserves", () => {
  const now = 1_800_000_000_000;
  const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
    now: () => now,
    codexUsageSnapshot: usageSnapshot({
      "openai-codex": { primary: 80, secondary: 25, secondaryResetAt: now / 1000 + 604800 },
      "openai-codex-a": { primary: 40, secondary: 100, secondaryResetAt: now / 1000 + 151200 },
      "openai-codex-b": { primary: 5, secondary: 100, secondaryResetAt: now / 1000 + 60 },
      "openai-codex-c": { planType: "prolite", secondary: 100 },
    }),
    random: () => assert.fail("the highest paced weight is unique"),
  });
  assert.deepEqual(routes.map((route) => route.provider), [
    "openai-codex-a", "openai-codex", "openai-codex-b", "openai-codex-c",
  ]);
});

test("Codex usage accepts primary alone but missing primary cannot outrank usable standard capacity", () => {
  const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
    codexUsageSnapshot: usageSnapshot({
      "openai-codex": { primary: 30, secondary: 100 },
      "openai-codex-a": { primary: 80 },
      "openai-codex-b": { secondary: 100 },
    }),
    random: () => assert.fail("primary alone establishes a unique highest score"),
  });
  assert.deepEqual(routes.map((route) => route.provider), [
    "openai-codex-a", "openai-codex", "openai-codex-b", "openai-codex-c",
  ]);
});

test("Codex usage breaks exact highest-score ties with one draw over only tied standard providers", () => {
  const snapshot = usageSnapshot({
    "openai-codex": { primary: 90, secondary: 100 },
    "openai-codex-a": { primary: 20 },
    "openai-codex-b": { primary: 90, secondary: 100 },
    "openai-codex-c": { planType: "prolite", secondary: 100 },
  });
  for (const [value, primary] of [[0.49, "openai-codex"], [0.99, "openai-codex-b"]] as const) {
    let draws = 0;
    const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
      codexUsageSnapshot: snapshot,
      random: () => { draws += 1; return value; },
    });
    assert.equal(draws, 1);
    const tiedFallback = primary === "openai-codex" ? "openai-codex-b" : "openai-codex";
    assert.deepEqual(routes.map((route) => route.provider), [
      primary, tiedFallback, "openai-codex-a", "openai-codex-c",
    ]);
  }
});

test("healthy Codex usage beats unknown, exhausted, and disallowed candidates", () => {
  const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
    codexUsageSnapshot: usageSnapshot({
      "openai-codex": { allowed: false, primary: 100 },
      "openai-codex-b": { primary: 0 },
      "openai-codex-c": { primary: 0.1 },
    }),
    random: () => assert.fail("the sole healthy provider must win"),
  });
  assert.deepEqual(routes.map((route) => route.provider), [
    "openai-codex-c", "openai-codex", "openai-codex-a", "openai-codex-b",
  ]);
});

test("without healthy Codex usage, one draw selects only unknown candidates", () => {
  const snapshot = usageSnapshot({
    "openai-codex": { allowed: false, primary: 100 },
    "openai-codex-b": { primary: 0 },
  });
  for (const [value, primary] of [[0, "openai-codex-a"], [0.99, "openai-codex-c"]] as const) {
    let draws = 0;
    const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
      codexUsageSnapshot: snapshot,
      random: () => { draws += 1; return value; },
    });
    assert.equal(draws, 1);
    assert.deepEqual(routes.map((route) => route.provider), [
      primary, ...CODEX_PROVIDERS.filter((provider) => provider !== primary),
    ]);
  }
});

test("only exact prolite planType is reserved, independently of provider IDs", () => {
  const providers = ["openai-codex", "openai-codex-pro", "openai-codex-prolite", "openai-codex-z"];
  for (const planType of ["plus", "pro", "team", "enterprise", "pro-lite", "pro_lite", "future-plan_2"]) {
    const routes = selectRoutes(providerPoolConfig(providers), "solution-a", undefined, {
      codexUsageSnapshot: usageSnapshot({
        "openai-codex": { planType: "prolite", secondary: 100 },
        "openai-codex-pro": { planType, primary: 20 },
        "openai-codex-prolite": { planType, primary: 50 },
        "openai-codex-z": { planType: "prolite", secondary: 80 },
      }),
      random: () => assert.fail("the highest standard 5-hour score is unique"),
    });
    assert.deepEqual(routes.map((route) => route.provider), [
      "openai-codex-prolite", "openai-codex-pro", "openai-codex", "openai-codex-z",
    ], planType);
  }
});

test("usable standard routes rank by capacity before unknown fallbacks and Pro Lite reserves", () => {
  const providers = [...CODEX_PROVIDERS, "openai-codex-d", "openai-codex-e", "openai-codex-f"];
  const config = providerPoolConfig(providers);
  const before = structuredClone(config);
  const snapshot = usageSnapshot({
    "openai-codex": { planType: "prolite", secondary: 100 },
    "openai-codex-a": { allowed: false, primary: 100 },
    "openai-codex-c": { planType: "prolite", allowed: false, secondary: 100 },
    "openai-codex-d": { primary: 20 },
    "openai-codex-e": { primary: 50, secondary: 0 },
    "openai-codex-f": { primary: 40 },
  });
  for (const role of roleIds(config)) {
    const routes = selectRoutes(config, role, undefined, {
      codexUsageSnapshot: snapshot,
      random: () => assert.fail("the highest usable standard must win without a draw"),
    });
    assert.deepEqual(routes.map((route) => route.provider), [
      "openai-codex-f", "openai-codex-d", "openai-codex-a", "openai-codex-b", "openai-codex-e",
      "openai-codex", "openai-codex-c",
    ]);
  }
  assert.deepEqual(config, before);
  assert.equal(snapshot["openai-codex"]!.planType, "prolite");
});

test("missing snapshots and missing primary windows compete as unknown before a known Pro Lite reserve", () => {
  const snapshot = usageSnapshot({
    "openai-codex": { planType: "prolite", secondary: 100 },
    "openai-codex-a": { secondary: 100 },
    "openai-codex-b": { planType: "future-plan", secondary: 50 },
  });
  for (const [value, primary] of [[0, "openai-codex-a"], [0.5, "openai-codex-b"], [0.99, "openai-codex-c"]] as const) {
    let draws = 0;
    const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
      codexUsageSnapshot: snapshot,
      random: () => { draws += 1; return value; },
    });
    assert.equal(draws, 1);
    assert.deepEqual(routes.map((route) => route.provider), [
      primary, ...CODEX_PROVIDERS.slice(1).filter((provider) => provider !== primary), "openai-codex",
    ]);
  }
});

test("a disallowed standard with missing primary is blocked, not unknown, when a Pro Lite reserve is usable", () => {
  const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
    codexUsageSnapshot: usageSnapshot({
      "openai-codex": { allowed: false, secondary: 100 },
      "openai-codex-a": { primary: 0 },
      "openai-codex-b": { planType: "prolite", secondary: 0.1 },
      "openai-codex-c": { planType: "prolite", allowed: false, secondary: 100 },
    }),
    random: () => assert.fail("the only usable reserve must win without a draw"),
  });
  assert.deepEqual(routes.map((route) => route.provider), [
    "openai-codex-b", "openai-codex", "openai-codex-a", "openai-codex-c",
  ]);
});

test("exhausted standards promote the highest usable weekly-only Pro Lite reserve and retain every fallback", () => {
  const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
    codexUsageSnapshot: usageSnapshot({
      "openai-codex": { primary: 0, secondary: 100 },
      "openai-codex-a": { planType: "prolite", secondary: 30 },
      "openai-codex-b": { planType: "prolite", secondary: 70 },
      "openai-codex-c": { planType: "prolite", allowed: false, secondary: 100 },
    }),
    random: () => assert.fail("the highest usable reserve is unique"),
  });
  assert.deepEqual(routes.map((route) => route.provider), [
    "openai-codex-b", "openai-codex", "openai-codex-a", "openai-codex-c",
  ]);
});

test("Pro Lite promotion randomizes only highest weekly ties, including all-Pro-Lite pools", () => {
  for (const planType of ["plus", "prolite"]) {
    const snapshot = usageSnapshot({
      "openai-codex": { planType, secondary: 0 },
      "openai-codex-a": { planType: "prolite", secondary: 80 },
      "openai-codex-b": { planType: "prolite", secondary: 80 },
      "openai-codex-c": { planType: "prolite", secondary: 20 },
    });
    for (const [value, primary] of [[0.49, "openai-codex-a"], [0.99, "openai-codex-b"]] as const) {
      let draws = 0;
      const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
        codexUsageSnapshot: snapshot,
        random: () => { draws += 1; return value; },
      });
      assert.equal(draws, 1);
      const tiedFallback = primary === "openai-codex-a" ? "openai-codex-b" : "openai-codex-a";
      const expected = planType === "plus"
        ? [primary, "openai-codex", tiedFallback, "openai-codex-c"]
        : [primary, tiedFallback, "openai-codex-c", "openai-codex"];
      assert.deepEqual(routes.map((route) => route.provider), expected);
    }
  }
});

test("without usable or unknown candidates, Codex pools retain the entire legacy random chain", () => {
  const config = providerPoolConfig();
  for (const snapshot of [
    usageSnapshot({
      "openai-codex": { primary: 0 },
      "openai-codex-a": { allowed: false, primary: 90 },
      "openai-codex-b": { primary: 0, secondary: 100 },
      "openai-codex-c": { allowed: false, secondary: 100 },
    }),
    usageSnapshot({
      "openai-codex": { planType: "prolite", secondary: 0 },
      "openai-codex-a": { allowed: false, primary: 90 },
      "openai-codex-b": { planType: "prolite" },
      "openai-codex-c": { primary: 0 },
    }),
  ]) {
    for (const value of [0, 0.3, 0.6, 0.99]) {
      let draws = 0;
      const routes = selectRoutes(config, "solution-a", undefined, {
        codexUsageSnapshot: snapshot,
        random: () => { draws += 1; return value; },
      });
      assert.equal(draws, 1);
      assert.deepEqual(routes, selectRoutes(config, "solution-a", undefined, { random: () => value }));
    }
  }
});

test("absent, empty, and unmatched Codex snapshots preserve legacy random selection exactly", () => {
  const config = providerPoolConfig();
  for (const snapshot of [undefined, usageSnapshot({}), usageSnapshot({ "openai-codex-other": { planType: "prolite", secondary: 100 } })]) {
    for (const value of [-1, 0, 0.26, 0.5, 0.99, 1, 2]) {
      let draws = 0;
      const routes = selectRoutes(config, "solution-a", undefined, {
        codexUsageSnapshot: snapshot,
        scheduler: {
          select: () => assert.fail("unscored pools must not enter weighted scheduling"),
          release: () => false,
        },
        random: () => { draws += 1; return value; },
      });
      const primary = CODEX_PROVIDERS[Math.max(0, Math.min(3, Math.floor(value * 4)))]!;
      const expected = [primary, ...CODEX_PROVIDERS.filter((provider) => provider !== primary)]
        .map((provider) => ({ kind: "pi", provider, model: "model-x", thinking: "high" }));
      assert.equal(JSON.stringify(routes), JSON.stringify(expected));
      assert.equal(draws, 1);
    }
  }
});

test("mixed, non-Codex, and invalid Codex alias pools ignore usage snapshots", () => {
  for (const providers of [
    ["openai-codex", "openai-codex-a", "other"],
    ["prov-a", "prov-b"],
    ["openai-codex", "openai-codex-"],
    ["openai-codex", "openai-codex-UPPER"],
  ]) {
    const config = providerPoolConfig(providers);
    const snapshot = usageSnapshot(Object.fromEntries(providers.map((provider, index) => [
      provider, index === 0 ? { planType: "prolite", secondary: 100 } : { primary: 0 },
    ])));
    let draws = 0;
    const routes = selectRoutes(config, "solution-a", undefined, {
      codexUsageSnapshot: snapshot,
      scheduler: {
        select: () => assert.fail("legacy pools must not schedule"),
        release: () => assert.fail("legacy pools must not release reserves"),
      },
      random: () => { draws += 1; return 0.99; },
    });
    assert.equal(draws, 1);
    assert.deepEqual(routes, selectRoutes(config, "solution-a", undefined, { random: () => 0.99 }));
    assert.equal(routes[0]!.provider, providers.at(-1));
  }
});

test("single-provider Codex pools and explicit Pro Lite pins remain deterministic even when disallowed", () => {
  const options = {
    codexUsageSnapshot: usageSnapshot({
      "openai-codex": { planType: "prolite", allowed: false, secondary: 0 },
      "openai-codex-a": { primary: 100 },
    }),
    random: () => assert.fail("single-provider pools must not draw"),
    scheduler: {
      select: () => assert.fail("single-provider pools and pins must not schedule"),
      release: () => assert.fail("single-provider pools and pins must not release reserves"),
    },
  };
  assert.deepEqual(
    selectRoutes(providerPoolConfig(["openai-codex"]), "solution-a", undefined, options).map(routeKey),
    ["openai-codex/model-x:high"],
  );
  for (const override of [
    { provider: "openai-codex", reason: "explicit pin" },
    { provider: "openai-codex", model: "model-x", reason: "explicit exact route" },
  ]) {
    assert.deepEqual(selectRoutes(providerPoolConfig(), "solution-a", override, options).map(routeKey), [
      "openai-codex/model-x:high",
    ]);
    assert.throws(() => selectRoutes(providerPoolConfig(), "solution-a", {
      ...override, excludeProviders: ["openai-codex"],
    }, options), /routing produced no eligible route/);
  }
  assert.throws(() => selectRoutes(providerPoolConfig(), "oracle", {
    provider: "openai-codex", reason: "rejected pin",
  }, options), /routingOverride is not allowed for the oracle role/);
});

test("exclusions, disabled providers, tier allowlists, and capabilities apply before Codex reserve ordering", () => {
  const config = providerPoolConfig();
  const disabled = { ...config, disabledProviders: ["openai-codex-b"] };
  const allowlisted: RoutingConfig = {
    ...config,
    profiles: { ...config.profiles, pool: { ...config.profiles.pool!, tiers: [{
      model: "model-x", thinking: "high", providers: ["openai-codex-c", "openai-codex-a", "openai-codex"],
    }] } },
  };
  const incapable: RoutingConfig = {
    ...config,
    models: { "model-x": { providers: {
      ...config.models["model-x"]!.providers,
      "openai-codex-b": { thinking: ["low"], default: "low" },
    } } },
  };
  for (const standardUsable of [true, false]) {
    const options = {
      codexUsageSnapshot: usageSnapshot({
        "openai-codex": { planType: "prolite", secondary: 20 },
        "openai-codex-a": { primary: standardUsable ? 60 : 0 },
        "openai-codex-b": { primary: 100 },
        "openai-codex-c": { allowed: standardUsable, primary: 80 },
      }),
      random: () => assert.fail("the eligible highest score is unique"),
    };
    const withoutBest = standardUsable
      ? ["openai-codex-c", "openai-codex-a", "openai-codex"]
      : ["openai-codex", "openai-codex-a", "openai-codex-c"];
    assert.deepEqual(selectRoutes(config, "solution-a", {
      excludeProviders: ["openai-codex-b"], reason: "explicit exclusion",
    }, options).map((route) => route.provider), withoutBest);
    for (const filtered of [disabled, allowlisted, incapable]) {
      assert.deepEqual(selectRoutes(filtered, "solution-a", undefined, options).map((route) => route.provider), withoutBest);
    }
    assert.throws(() => selectRoutes(config, "solution-a", {
      excludeProviders: CODEX_PROVIDERS, reason: "exclude every provider",
    }, options), /routing produced no eligible route/);
    // Pool classification uses eligible providers, not excluded mixed members.
    const mixed = providerPoolConfig([...CODEX_PROVIDERS, "other"]);
    assert.equal(selectRoutes(mixed, "solution-a", {
      excludeProviders: ["other"], reason: "Codex-only run",
    }, options)[0]!.provider, "openai-codex-b");
  }
});

test("Codex reserve ordering preserves tier concatenation even when a later standard has more quota", () => {
  const base = providerPoolConfig();
  const config: RoutingConfig = {
    ...base,
    models: { ...base.models, "model-y": base.models["model-x"]! },
    profiles: { ...base.profiles, pool: { ...base.profiles.pool!, tiers: [
      { model: "model-x", thinking: "high", providers: ["openai-codex-a", "openai-codex-b"] },
      { model: "model-y", thinking: "high", providers: ["openai-codex", "openai-codex-c"] },
    ] } },
  };
  for (const primary of [0, 20]) {
    const routes = selectRoutes(config, "solution-a", undefined, {
      codexUsageSnapshot: usageSnapshot({
        "openai-codex": { primary: 100 }, "openai-codex-a": { planType: "prolite", secondary: 50 },
        "openai-codex-b": { primary }, "openai-codex-c": { planType: "prolite", secondary: 90 },
      }),
      random: () => assert.fail("each tier has a unique highest score"),
    });
    const firstTier = primary > 0
      ? ["openai-codex-b/model-x:high", "openai-codex-a/model-x:high"]
      : ["openai-codex-a/model-x:high", "openai-codex-b/model-x:high"];
    assert.deepEqual(routes.map(routeKey), [
      ...firstTier, "openai-codex/model-y:high", "openai-codex-c/model-y:high",
    ]);
  }
});

test("model overrides reserve Pro Lite without changing provider thinking defaults or explicit thinking", () => {
  const base = providerPoolConfig();
  const config: RoutingConfig = {
    ...base,
    models: { "model-x": { providers: {
      ...base.models["model-x"]!.providers,
      "openai-codex-a": { thinking: ["low", "high"], default: "low" },
    } } },
  };
  const options = {
    codexUsageSnapshot: usageSnapshot({
      "openai-codex": { planType: "prolite", secondary: 100 },
      "openai-codex-a": { primary: 50 },
      "openai-codex-b": { secondary: 100 },
      "openai-codex-c": { planType: "prolite", secondary: 80 },
    }),
    random: () => assert.fail("the model pool has a unique highest standard score"),
  };
  assert.deepEqual(selectRoutes(config, "solution-a", {
    model: "model-x", reason: "explicit model",
  }, options).map(routeKey), [
    "openai-codex-a/model-x:low", "openai-codex-b/model-x:high",
    "openai-codex/model-x:high", "openai-codex-c/model-x:high",
  ]);
  assert.deepEqual(selectRoutes(config, "solution-a", {
    model: "model-x", thinking: "high", reason: "explicit thinking",
  }, options).map(routeKey), [
    "openai-codex-a/model-x:high", "openai-codex-b/model-x:high",
    "openai-codex/model-x:high", "openai-codex-c/model-x:high",
  ]);
});

test("weekly exhaustion blocks standards, and known usable reserves beat unknown or unusable Pro Lite data", () => {
  for (const standard of [
    { primary: 90, secondary: 0 },
    { secondary: 0 },
    { allowed: false, primary: 100, secondary: 100 },
    { primary: 0, secondary: 100 },
  ]) {
    for (const reserve of [{ secondary: 0 }, { allowed: false, secondary: 100 }]) {
      const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
        now: () => 1_800_000_000_000,
        codexUsageSnapshot: usageSnapshot({
          "openai-codex": standard,
          "openai-codex-a": { planType: "prolite" },
          "openai-codex-b": { planType: "prolite", secondary: 50 },
          "openai-codex-c": { planType: "prolite", ...reserve },
        }),
        random: () => assert.fail("only the known usable reserve can serve"),
      });
      assert.deepEqual(routes.map((route) => route.provider), [
        "openai-codex-b", "openai-codex", "openai-codex-a", "openai-codex-c",
      ]);
    }
  }
});

test("one scheduler distributes repeated standard primaries by weight instead of a permanent winner", () => {
  const config = providerPoolConfig();
  const scheduler = createRouteScheduler();
  const snapshot = usageSnapshot({ "openai-codex": { primary: 75 }, "openai-codex-a": { primary: 25 } });
  const primaries = Array.from({ length: 100 }, () => selectRoutes(config, "solution-a", undefined, {
    scheduler,
    now: () => 1_800_000_000_000,
    codexUsageSnapshot: structuredClone(snapshot),
    random: () => assert.fail("weighted scheduling must not draw"),
  })[0]!.provider);
  assert.equal(primaries.filter((provider) => provider === "openai-codex").length, 75);
  assert.equal(primaries.filter((provider) => provider === "openai-codex-a").length, 25);
  assert.equal(new Set(primaries.slice(0, 4)).size, 2);
});

test("repeated provider pools in later tiers consume only one scheduler turn per invocation", () => {
  const now = 1_800_000_000_000;
  const base = providerPoolConfig(CODEX_PROVIDERS.slice(0, 3));
  const config: RoutingConfig = {
    ...base,
    models: { ...base.models, "model-y": base.models["model-x"]! },
    profiles: { ...base.profiles, pool: { ...base.profiles.pool!, tiers: [
      { model: "model-x", thinking: "high" }, { model: "model-y", thinking: "high" },
    ] } },
  };
  const scheduler = createRouteScheduler();
  const primaries: string[] = [];
  for (let index = 0; index < 100; index += 1) {
    const routes = selectRoutes(config, "solution-a", undefined, {
      scheduler,
      now: () => now,
      codexUsageSnapshot: usageSnapshot({
        "openai-codex": { primary: 50 }, "openai-codex-a": { primary: 50 },
        "openai-codex-b": { planType: "prolite", secondary: 100, secondaryResetAt: now / 1000 + 86400 },
      }),
    });
    primaries.push(routes[0]!.provider);
    assert.equal(routes[0]!.provider, routes[3]!.provider);
    assert.deepEqual(routes.map((route) => route.model), ["model-x", "model-x", "model-x", "model-y", "model-y", "model-y"]);
  }
  assert.deepEqual(CODEX_PROVIDERS.slice(0, 3).map((provider) => primaries.filter((primary) => primary === provider).length), [45, 45, 10]);
});

test("scheduler instances isolate rotations and release credit; stateless callers share neither", () => {
  const config = providerPoolConfig();
  const first = createRouteScheduler();
  const second = createRouteScheduler();
  const options = {
    now: () => 1_800_000_000_000,
    codexUsageSnapshot: usageSnapshot({ "openai-codex": { primary: 50 }, "openai-codex-a": { primary: 50 } }),
    random: () => 0,
  };
  assert.equal(selectRoutes(config, "solution-a", undefined, { ...options, scheduler: first })[0]!.provider, "openai-codex");
  assert.equal(selectRoutes(config, "solution-a", undefined, { ...options, scheduler: second })[0]!.provider, "openai-codex");
  assert.equal(selectRoutes(config, "solution-a", undefined, { ...options, scheduler: first })[0]!.provider, "openai-codex-a");
  for (let index = 0; index < 5; index += 1) {
    assert.equal(selectRoutes(config, "solution-a", undefined, options)[0]!.provider, "openai-codex");
    assert.equal(first.release("pool", 0.2), index === 4);
  }
  assert.equal(second.release("pool", 0.2), false);
  assert.equal(selectRoutes(config, "solution-a", undefined, { ...options, scheduler: second })[0]!.provider, "openai-codex-a");
});

test("Pro Lite release is zero outside 48 hours and follows the bounded pressure-times-weekly share inside", () => {
  const now = 1_800_000_000_000;
  const config = providerPoolConfig(["openai-codex", "openai-codex-a"]);
  for (const [secondsLeft, weekly] of [[172801, 100], [172800, 100], [86400, 100], [86400, 50], [60, 100]]) {
    const share = 0.20 * Math.max(0, 1 - secondsLeft / 172800) * weekly / 100;
    const sequences: string[][] = [];
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const scheduler = createRouteScheduler();
      let released = 0;
      const sequence: string[] = [];
      for (let count = 1; count <= 1000; count += 1) {
        const routes = selectRoutes(config, "solution-a", undefined, {
          now: () => now,
          scheduler,
          codexUsageSnapshot: usageSnapshot({
            "openai-codex": { primary: 0.1 },
            "openai-codex-a": { planType: "prolite", secondary: weekly, secondaryResetAt: now / 1000 + secondsLeft },
          }),
          random: () => assert.fail("known weights must not draw"),
        });
        sequence.push(routes[0]!.provider);
        if (routes[0]!.provider === "openai-codex-a") released += 1;
        assert.ok(released <= count * share + 1e-9, `release cap at selection ${count}`);
        assert.equal(routes[1]!.provider, routes[0]!.provider === "openai-codex" ? "openai-codex-a" : "openai-codex");
      }
      assert.equal(released, Math.floor(1000 * share + 1e-9));
      sequences.push(sequence);
    }
    assert.deepEqual(sequences[0], sequences[1]);
  }
});

test("multiple Pro Lite records average release pressure, count unknowns as zero, and preserve fallback class order", () => {
  const now = 1_800_000_000_000;
  const scheduler = createRouteScheduler();
  const config = providerPoolConfig();
  const counts = new Map<string, number>();
  for (let count = 1; count <= 600; count += 1) {
    const routes = selectRoutes(config, "solution-a", undefined, {
      now: () => now,
      scheduler,
      codexUsageSnapshot: usageSnapshot({
        "openai-codex": { primary: 1 },
        "openai-codex-a": { planType: "prolite", secondary: 100, secondaryResetAt: now / 1000 + 86400 },
        "openai-codex-b": { planType: "prolite", secondary: 40, secondaryResetAt: now / 1000 + 43200 },
        "openai-codex-c": { planType: "prolite" },
      }),
      random: () => assert.fail("release selection must not draw"),
    });
    const primary = routes[0]!.provider;
    counts.set(primary, (counts.get(primary) ?? 0) + 1);
    // (0.5 * 1 + 0.75 * 0.4 + 0) / 3 gives a total share of 0.16 / 3.
    const released = (counts.get("openai-codex-a") ?? 0) + (counts.get("openai-codex-b") ?? 0);
    assert.ok(released <= count * 0.16 / 3 + 1e-9);
    assert.deepEqual(routes.map((route) => route.provider), [primary, ...CODEX_PROVIDERS.filter((provider) => provider !== primary)]);
  }
  assert.deepEqual(Object.fromEntries(counts), { "openai-codex": 568, "openai-codex-a": 20, "openai-codex-b": 12 });
});

test("adding full Pro Lite reserves never multiplies the 20 percent pool cap", () => {
  const now = 1_800_000_000_000;
  const config = providerPoolConfig();
  const scheduler = createRouteScheduler();
  let released = 0;
  for (let count = 1; count <= 1000; count += 1) {
    const routes = selectRoutes(config, "solution-a", undefined, {
      now: () => now,
      scheduler,
      codexUsageSnapshot: usageSnapshot(Object.fromEntries(CODEX_PROVIDERS.map((provider, index) => [
        provider, index === 0 ? { primary: 10 } : { planType: "prolite", secondary: 100, secondaryResetAt: now / 1000 + 1 },
      ]))),
    });
    if (routes[0]!.provider !== "openai-codex") released += 1;
    assert.ok(released <= count * 0.20);
  }
  assert.equal(released, 199);
});

test("no scheduler or missing reserve reset keeps standards first even at the end of the week", () => {
  const now = 1_800_000_000_000;
  for (const options of [{}, { scheduler: createRouteScheduler() }]) {
    for (let index = 0; index < 20; index += 1) {
      const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
        ...options,
        now: () => now,
        codexUsageSnapshot: usageSnapshot({
          "openai-codex": { primary: 0.1 },
          "openai-codex-a": { planType: "prolite", secondary: 100, ...(!options.scheduler ? { secondaryResetAt: now / 1000 + 1 } : {}) },
          "openai-codex-b": { planType: "prolite", secondary: 0, secondaryResetAt: now / 1000 + 1 },
          "openai-codex-c": { planType: "prolite", allowed: false, secondary: 100, secondaryResetAt: now / 1000 + 1 },
        }),
      });
      assert.deepEqual(routes.map((route) => route.provider), CODEX_PROVIDERS);
    }
  }
});

test("unknown standards do not release reserves, but unavailable standards allow 100 percent weekly-only reserve traffic", () => {
  const now = 1_800_000_000_000;
  for (const standard of [{}, { primary: 0 }]) {
    const scheduler = createRouteScheduler();
    const counts = new Map<string, number>();
    for (let index = 0; index < 100; index += 1) {
      const routes = selectRoutes(providerPoolConfig(), "solution-a", undefined, {
        now: () => now,
        scheduler,
        codexUsageSnapshot: usageSnapshot({
          "openai-codex": standard,
          "openai-codex-a": { planType: "prolite", secondary: 80, secondaryResetAt: now / 1000 + 1 },
          "openai-codex-b": { planType: "prolite", secondary: 20, secondaryResetAt: now / 1000 + 604800 },
          "openai-codex-c": { planType: "prolite" },
        }),
        random: () => 0,
      });
      counts.set(routes[0]!.provider, (counts.get(routes[0]!.provider) ?? 0) + 1);
    }
    assert.deepEqual(Object.fromEntries(counts), standard.primary === 0
      ? { "openai-codex-a": 80, "openai-codex-b": 20 }
      : { "openai-codex": 100 });
  }
});

test("tiers concatenate in configured order with per-tier primaries", () => {
  const config = syntheticConfig({});
  // Both tiers of the two-tier profile are single-provider: the chain stays
  // deterministic without a draw and keeps the configured tier order.
  let tierDraws = 0;
  assert.deepEqual(
    selectRoutes(config, "solution-a", undefined, {
      random: () => {
        tierDraws += 1;
        return 0.9;
      },
    }).map(routeKey),
    ["prov-a/model-x:max", "prov-a/model-y:low"],
  );
  assert.equal(tierDraws, 0);
  // The pinned profile's two-provider tier draws exactly once, then keeps
  // the remaining provider in stable config order.
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
      const assignments = document.assignments as Record<string, unknown>;
      assignments.solution = ["all"];
    },
  });
  assert.deepEqual(selectRoutes(config, "solution-a").map(routeKey), ["prov-a/model-x:high"]);
});

test("model-only overrides treat every capable provider as one pool at its default thinking", () => {
  const config = loadRoutingConfig();
  assert.deepEqual(
    selectRoutes(config, "review-a", { model: "model-c", reason: "user requested model-c" }).map(routeKey),
    ["provider-i/model-c:max"],
  );

  const synthetic = syntheticConfig({});
  const override = { model: "model-x", reason: "user requested model-x" } as const;
  // The pool consumes exactly one draw; the primary follows it.
  let draws = 0;
  assert.deepEqual(
    selectRoutes(synthetic, "solution-a", override, {
      random: () => {
        draws += 1;
        return 0; // floor(0 * 2) = 0 -> prov-a primary
      },
    }).map(routeKey),
    ["prov-a/model-x:max", "prov-b/model-x:high"],
  );
  assert.equal(draws, 1);

  // The primary rotates with the draw while the remainder keeps stable config
  // order and each provider keeps its own configured default thinking level.
  let rotationDraws = 0;
  assert.deepEqual(
    selectRoutes(synthetic, "solution-a", override, {
      random: () => {
        rotationDraws += 1;
        return 0.9; // floor(0.9 * 2) = 1 -> prov-b primary
      },
    }).map(routeKey),
    ["prov-b/model-x:high", "prov-a/model-x:max"],
  );
  assert.equal(rotationDraws, 1);

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
      random: () => {
        orderDraws += 1;
        return 0.5; // floor(0.5 * 3) = 1 -> prov-b primary
      },
    }).map(routeKey),
    ["prov-b/model-x:high", "prov-a/model-x:max", "prov-c/model-x:high"],
  );
  assert.equal(orderDraws, 1);

  // Exclusions filter the pool before selection; a single remaining provider
  // consumes no draw.
  let exclusionDraws = 0;
  assert.deepEqual(
    selectRoutes(
      synthetic,
      "solution-a",
      { model: "model-x", excludeProviders: ["prov-a"], reason: "avoid prov-a" },
      {
        random: () => {
          exclusionDraws += 1;
          return 0.9;
        },
      },
    ).map(routeKey),
    ["prov-b/model-x:high"],
  );
  assert.equal(exclusionDraws, 0);
});

test("provider-only overrides pin and filter the configured tiers", () => {
  const config = loadRoutingConfig();
  assert.deepEqual(
    selectRoutes(config, "solution-i", { provider: "provider-l", reason: "user requested provider-l" }).map(routeKey),
    ["provider-l/model-i:max"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-i", { provider: "provider-k", reason: "user requested provider-k" }).map(routeKey),
    ["provider-k/model-j:high"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-b", { provider: "provider-e", reason: "user requested provider-e" }).map(routeKey),
    ["provider-e/model-b:high"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-a", { provider: "provider-h", reason: "user requested provider-h" }).map(routeKey),
    ["provider-h/model-a:high"],
  );
  // A provider that cannot serve any configured tier is a bounded error.
  assert.throws(
    () => selectRoutes(config, "verification", { provider: "provider-i", reason: "user requested provider-i" }),
    /routing produced no eligible route/,
  );
});

test("provider plus model overrides are exact after capability validation", () => {
  const config = loadRoutingConfig();
  assert.deepEqual(
    selectRoutes(config, "verification", {
      provider: "provider-f",
      model: "model-a",
      thinking: "high",
      reason: "user requested an exact route",
    }).map(routeKey),
    ["provider-f/model-a:high"],
  );
  // Without an explicit thinking level the provider's configured default applies.
  assert.deepEqual(
    selectRoutes(config, "implementation", { provider: "provider-i", model: "model-d", reason: "user requested model-d" }).map(routeKey),
    ["provider-i/model-d:high"],
  );
  // Capability violations fail closed.
  assert.throws(
    () => selectRoutes(config, "implementation", { provider: "provider-z", model: "model-c", reason: "invalid" }),
    /provider "provider-z" has no capability record for model "model-c"/,
  );
  assert.throws(
    () => selectRoutes(config, "implementation", { provider: "provider-z", model: "model-d", thinking: "high", reason: "invalid" }),
    /provider "provider-z" has no capability record for model "model-d"/,
  );
  assert.throws(
    () => selectRoutes(config, "implementation", { model: "unknown-model", reason: "invalid" }),
    /"unknown-model" has no capability record/,
  );
});

test("exclusion overrides filter providers inside every tier", () => {
  const config = loadRoutingConfig();
  assert.deepEqual(
    selectRoutes(config, "solution-i", { excludeProviders: ["provider-l"], reason: "provider-l is down" }).map(routeKey),
    ["provider-k/model-j:high"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-b", { excludeProviders: ["provider-a", "provider-b", "provider-c", "provider-d", "provider-e", "provider-g", "provider-h"], reason: "only provider-f" }).map(routeKey),
    ["provider-f/model-b:high"],
  );
  // Excluding every eligible provider is a bounded error, not an empty run.
  assert.throws(
    () => selectRoutes(config, "implementation", { excludeProviders: ["provider-i"], reason: "invalid" }),
    /routing produced no eligible route/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-i", { excludeProviders: ["provider-l", "provider-k"], reason: "both providers down" }),
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
    () => selectRoutes(config, "solution-a", { provider: "provider-i", reason: "   " }),
    /requires a non-empty reason/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-a", { thinking: "high", reason } as never),
    /routingOverride.thinking requires routingOverride.model/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-a", { model: "model-c", thinking: "", reason } as never),
    /routingOverride.thinking must be a non-empty string/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-a", { model: "model-c", excludeProviders: [], reason } as never),
    /excludeProviders must be a non-empty array/,
  );
});

test("malformed runtime overrides fail validation before any field read", () => {
  const config = loadRoutingConfig();
  // Pi tool_call handlers can mutate validated input and direct callers can
  // bypass the schema, so the selector revalidates the override as unknown.
  // Every case must fail with a bounded routingOverride error, never with a
  // raw TypeError and never by returning routes.
  const cases: Array<{ name: string; override: unknown }> = [
    { name: "null override", override: null },
    { name: "missing reason", override: { provider: "provider-i" } },
    { name: "numeric reason", override: { provider: "provider-i", reason: 7 } },
    { name: "numeric provider", override: { provider: 7, reason: "x" } },
    { name: "numeric model", override: { model: 7, reason: "x" } },
    { name: "numeric thinking", override: { model: "model-c", thinking: 7, reason: "x" } },
    { name: "excludeProviders as a string", override: { excludeProviders: "provider-i", reason: "x" } },
    { name: "excludeProviders containing a non-string", override: { excludeProviders: ["provider-i", 7], reason: "x" } },
  ];
  for (const item of cases) {
    let thrown: unknown;
    let returned = false;
    try {
      selectRoutes(config, "implementation", item.override as never);
      returned = true;
    } catch (error) {
      thrown = error;
    }
    assert.equal(returned, false, item.name);
    assert.ok(thrown instanceof Error, item.name);
    // A raw TypeError would mean an unvalidated field was read.
    assert.equal(thrown instanceof TypeError, false, item.name);
    assert.match(thrown.message, /^routingOverride/, item.name);
    // The malformed value never leaks into the bounded message.
    assert.equal(thrown.message.includes("7"), false, item.name);
  }
  // Regression: a string excludeProviders used to become a per-character
  // exclusion set and returned the provider it meant to exclude.
  assert.throws(
    () => selectRoutes(config, "implementation", { excludeProviders: "provider-i", reason: "x" } as never),
    /routingOverride.excludeProviders must be a non-empty array/,
  );
});

test("a malformed oracle override still receives the oracle-specific rejection first", () => {
  const config = loadRoutingConfig();
  // The family-based rejection fires before shape validation, so even
  // malformed oracle overrides never reach field reads or a shape error.
  assert.throws(
    () => selectRoutes(config, "oracle", null as never),
    /routingOverride is not allowed for the oracle role/,
  );
  assert.throws(
    () => selectRoutes(config, "oracle", { excludeProviders: "provider-a" } as never),
    /routingOverride is not allowed for the oracle role/,
  );
});

test("the oracle role rejects every override even when the profile policy is mutated", () => {
  const config = loadRoutingConfig();
  assert.throws(
    () => selectRoutes(config, "oracle", { model: "model-c", reason: "attempted override" }),
    /routingOverride is not allowed for the oracle role/,
  );
  assert.throws(
    () => selectRoutes(config, "oracle", { excludeProviders: ["provider-a"], reason: "attempted exclusion" }),
    /routingOverride is not allowed for the oracle role/,
  );
  // Defense in depth: simulate an in-memory mutation that flips the oracle
  // profile policy to "allowed". Validation would reject this config, but
  // the selector still rejects the override by family alone.
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
  // concurrency stay a function of the resolved role.
  assert.ok(selectRoutes(mutated, "implementation", { model: "model-x", reason: "explicit request" }, { random: () => 0 }).length > 0);
  assert.equal(roleIsReadOnly(requireRole(mutated, "implementation")), false);
  assert.equal(roleIsExclusive(requireRole(mutated, "implementation")), true);
  assert.equal(roleIsReadOnly(requireRole(mutated, "verification")), true);
  assert.equal(roleIsExclusive(requireRole(mutated, "oracle")), true);
});
