import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
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

  // Every multi-provider tier consumes exactly one random draw: no eligible
  // provider can suppress it, so the primary always follows the draw.
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

test("no provider preference exists: the random primary keeps the stable fallback order", () => {
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
