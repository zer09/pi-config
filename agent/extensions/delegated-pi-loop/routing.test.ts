import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadRoutingConfig,
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
] as const;

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

test("the shipped routing config loads and fails closed on invalid files", async () => {
  const config = loadRoutingConfig();
  assert.equal(config.version, 2);
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

test("the registration snapshot re-reads routing.json and derives the same roles", () => {
  const snapshot = loadRoutingSnapshot();
  assert.equal(snapshot.version, 2);
  // A fresh read, not the process cache: registration reload picks up edits.
  assert.notEqual(snapshot, loadRoutingConfig());
  assert.deepEqual(roleIds(snapshot), roleIds(loadRoutingConfig()));
  assert.deepEqual([...snapshot.roles.keys()], [...loadRoutingConfig().roles.keys()]);
});

test("the shipped routing config contains no retired provider occurrence", async () => {
  // Regression: retired providers disappear from the routing policy entirely,
  // rather than remaining as disabled capability or profile entries.
  const text = await readFile(new URL("./routing.json", import.meta.url), "utf8");
  for (const provider of ["seekai", "tabitoken", "gorouter", "tokenreply"]) {
    assert.equal(text.includes(provider), false, provider);
  }
  // The retired AgentRouter Opus 4.8 model record remains absent.
  assert.equal(text.includes("claude-opus-4-8"), false);
  // The obsolete Ox Alpha alias ids stay out of delegated routing: Ox Alpha
  // now runs under its official GLM-5.3-Flash model id, not an alias.
  assert.equal(text.includes("ox-alpha"), false);
});

test("the shipped config pins delegate model thinking capabilities", () => {
  const config = loadRoutingConfig();
  // The obsolete Ox Alpha alias ids are gone from delegated routing; the
  // official GLM-5.3-Flash capability carries the restored Ox Alpha role.
  assert.equal(config.models["stealth/ox-alpha"], undefined);
  assert.equal(config.models["ox-alpha"], undefined);
  assert.equal(config.models["claude-fable-5"], undefined);
  assert.deepEqual(config.models["glm-5.3-flash"]?.providers.zai, {
    thinking: ["low", "high", "max"],
    default: "high",
  });
  // The retired AgentRouter Opus routes remain absent. AgentRouter now serves
  // DeepSeek V4 Flash, as declared by routing.json.
  assert.equal(config.models["claude-opus-4-8"], undefined);
  assert.equal(config.models["gpt-5.6-sol"]?.providers.agentrouter, undefined);
  assert.equal(config.models["claude-opus-5"], undefined);
  assert.deepEqual(config.models["deepseek-v4-flash"]?.providers.agentrouter, {
    thinking: ["low", "high", "max"],
    default: "max",
  });
  // Gate B runs gpt-5.5 at high across its full provider set; every
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
  // The review family ends at review-c in the shipped snapshot.
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

test("selectRoutes preserves the ordered tier chains for the shipped gate profiles", () => {
  const config = loadRoutingConfig();
  const keys = (role: DelegateRole) => selectRoutes(config, role).map(routeKey);
  const expectedC = ["zai/glm-5.3:max"];
  const expectedD = ["zai/glm-5.3-flash:high"];
  const expectedE = ["opencode-go/muse-spark-1.2-contributor:xhigh"];
  const expectedF = ["opencode-go/hy3:high"];
  const expectedG = ["xkiro/minimax/minimax-m3:free:high"];
  const expectedH = ["xkiro/qwen/qwen3.8-max:free:high"];
  // Gate I keeps DeepSeek on two ordered tiers because the provider model
  // ids differ: AgentRouter serves deepseek-v4-flash first, then xKiro
  // serves deepseek/deepseek-v4-flash as the fallback tier.
  const expectedI = [
    "agentrouter/deepseek-v4-flash:max",
    "xkiro/deepseek/deepseek-v4-flash:high",
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

test("gate A, gate B, and the oracle select their configured Codex pools", () => {
  const config = loadRoutingConfig();
  const canonicalA = CODEX_PROVIDERS.map((provider) => `${provider}/gpt-5.6-sol:high`);
  const canonicalB = CODEX_PROVIDERS.map((provider) => `${provider}/gpt-5.5:high`);

  // Every multi-provider tier consumes exactly one random draw: no eligible
  // provider can suppress it, so the primary always follows the draw.
  let draws = 0;
  const aRoutes = selectRoutes(config, "solution-a", undefined, {
    random: () => {
      draws += 1;
      return 0.4; // floor(0.4 * 8) = 3 -> openai-codex-cgpt2
    },
  });
  assert.equal(draws, 1);
  assert.equal(routeKey(aRoutes[0]!), "openai-codex-cgpt2/gpt-5.6-sol:high");
  assert.deepEqual(
    aRoutes.slice(1).map(routeKey),
    canonicalA.filter((key) => key !== "openai-codex-cgpt2/gpt-5.6-sol:high"),
  );

  // Review B pins its primary with the same single draw on the gpt-5.5 pool.
  let bDraws = 0;
  assert.deepEqual(
    selectRoutes(config, "review-b", undefined, {
      random: () => {
        bDraws += 1;
        return 0; // floor(0 * 8) = 0 -> openai-codex primary
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
  assert.equal(routeKey(oracleRoutes[0]!), "openai-codex-cgpt6/gpt-5.6-sol:high");
  assert.deepEqual(
    oracleRoutes.slice(1).map(routeKey),
    canonicalA.filter((key) => key !== "openai-codex-cgpt6/gpt-5.6-sol:high"),
  );

  // Cursor and every non-Codex provider stay excluded from the Gate A,
  // Gate B, and Oracle Codex chains.
  for (const routes of [
    selectRoutes(config, "solution-a", undefined, { random: () => 0 }),
    selectRoutes(config, "solution-b", undefined, { random: () => 0 }),
    oracleRoutes,
  ]) {
    assert.equal(routes.length, CODEX_PROVIDERS.length);
    for (const route of routes) {
      assert.ok((CODEX_PROVIDERS as readonly string[]).includes(route.provider));
    }
  }
});

test("implementation and remediation use only GLM while verification stays pinned", () => {
  const config = loadRoutingConfig();
  const implementationRoutes = ["zai/glm-5.3:max"];
  assert.deepEqual(selectRoutes(config, "implementation").map(routeKey), implementationRoutes);
  assert.deepEqual(selectRoutes(config, "remediation").map(routeKey), implementationRoutes);
  assert.deepEqual(selectRoutes(config, "verification").map(routeKey), ["openai-codex/gpt-5.6-sol:high"]);
  assert.deepEqual([...oracleModelIds(config)], ["gpt-5.6-sol"]);
});

test("the shipped assignments map gate-a through gate-i to the derived role ids", () => {
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
  // Every shipped role id resolves through the registry.
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
  const reviewA = requireRole(config, "review-a");
  assert.equal(roleIsReadOnly(reviewA), true);
  assert.equal(roleIsExclusive(reviewA), false);
  // Without the override the reused role keeps its normal Gate A Codex
  // pool chain.
  const canonicalA = CODEX_PROVIDERS.map((provider) => `${provider}/gpt-5.6-sol:high`);
  assert.deepEqual(
    selectRoutes(config, "review-a", undefined, { random: () => 0 }).map(routeKey),
    canonicalA,
  );
});

test("every configured role selects a non-empty chain of Pi routes", () => {
  const config = loadRoutingConfig();
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
  const config = loadRoutingConfig();
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
  // Gate B still groups one model across several providers. Nothing can
  // promote a specific provider to primary: the draw alone picks it, and the
  // remaining providers keep their stable config order as the fallback.
  const canonicalB = CODEX_PROVIDERS.map((provider) => `${provider}/gpt-5.5:high`);
  let draws = 0;
  const routes = selectRoutes(config, "solution-b", undefined, {
    random: () => {
      draws += 1;
      return 0; // floor(0 * 8) = 0 -> openai-codex primary
    },
  });
  assert.equal(draws, 1);
  assert.deepEqual(routes.map(routeKey), canonicalB);

  // Regression: the removed former parent-provider option can no longer
  // suppress the draw. The key is built dynamically so this regression file
  // carries no literal occurrence of the removed identifier.
  const formerParentKey = ["parent", "Provider"].join("");
  let smuggledDraws = 0;
  const formerParentOptions = {
    [formerParentKey]: "openai-codex-cgpt4",
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

  // Gate I pins DeepSeek to one provider per tier. The single-provider
  // tiers stay deterministic without a draw and keep AgentRouter first.
  let iDraws = 0;
  assert.deepEqual(
    selectRoutes(config, "solution-i", undefined, {
      random: () => {
        iDraws += 1;
        return 0.99;
      },
    }).map(routeKey),
    ["agentrouter/deepseek-v4-flash:max", "xkiro/deepseek/deepseek-v4-flash:high"],
  );
  assert.equal(iDraws, 0);
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
  // glm-5.3 has exactly the zai capability: the pool is deterministic.
  assert.deepEqual(
    selectRoutes(config, "review-a", { model: "glm-5.3", reason: "user requested Z.AI for this review" }).map(routeKey),
    ["zai/glm-5.3:max"],
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
  // Pinning AgentRouter keeps the Gate I tier it serves; pinning xKiro
  // keeps Gate I's DeepSeek fallback tier.
  assert.deepEqual(
    selectRoutes(config, "solution-i", { provider: "agentrouter", reason: "user requested agentrouter" }).map(routeKey),
    ["agentrouter/deepseek-v4-flash:max"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-i", { provider: "xkiro", reason: "user requested xkiro" }).map(routeKey),
    ["xkiro/deepseek/deepseek-v4-flash:high"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-b", { provider: "openai-codex-cgpt4", reason: "user requested cgpt4" }).map(routeKey),
    ["openai-codex-cgpt4/gpt-5.5:high"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-a", { provider: "openai-codex-cgpt6", reason: "user requested cgpt6" }).map(routeKey),
    ["openai-codex-cgpt6/gpt-5.6-sol:high"],
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
    selectRoutes(config, "implementation", { provider: "zai", model: "glm-5.3-flash", reason: "user requested glm-5.3 flash on zai" }).map(routeKey),
    ["zai/glm-5.3-flash:high"],
  );
  // Capability violations fail closed.
  assert.throws(
    () => selectRoutes(config, "implementation", { provider: "seekai", model: "glm-5.3", reason: "invalid" }),
    /provider "seekai" has no capability record for model "glm-5\.3"/,
  );
  assert.throws(
    () => selectRoutes(config, "implementation", { provider: "gorouter", model: "glm-5.3-flash", thinking: "high", reason: "invalid" }),
    /provider "gorouter" has no capability record for model "glm-5\.3-flash"/,
  );
  assert.throws(
    () => selectRoutes(config, "implementation", { model: "unknown-model", reason: "invalid" }),
    /"unknown-model" has no capability record/,
  );
});

test("exclusion overrides filter providers inside every tier", () => {
  const config = loadRoutingConfig();
  // Excluding AgentRouter from Gate I leaves the xKiro DeepSeek fallback
  // tier, not an empty run.
  assert.deepEqual(
    selectRoutes(config, "solution-i", { excludeProviders: ["agentrouter"], reason: "agentrouter is down" }).map(routeKey),
    ["xkiro/deepseek/deepseek-v4-flash:high"],
  );
  assert.deepEqual(
    selectRoutes(config, "solution-b", { excludeProviders: ["openai-codex", "openai-codex-zahlo", "openai-codex-cgpt1", "openai-codex-cgpt2", "openai-codex-cgpt3", "openai-codex-cgpt4", "openai-codex-cgpt6"], reason: "only cgpt5" }).map(routeKey),
    ["openai-codex-cgpt5/gpt-5.5:high"],
  );
  // Excluding every eligible provider is a bounded error, not an empty run.
  assert.throws(
    () => selectRoutes(config, "implementation", { excludeProviders: ["zai"], reason: "invalid" }),
    /routing produced no eligible route/,
  );
  assert.throws(
    () => selectRoutes(config, "solution-i", { excludeProviders: ["agentrouter", "xkiro"], reason: "both deepseek providers down" }),
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

test("malformed runtime overrides fail validation before any field read", () => {
  const config = loadRoutingConfig();
  // Pi tool_call handlers can mutate validated input and direct callers can
  // bypass the schema, so the selector revalidates the override as unknown.
  // Every case must fail with a bounded routingOverride error, never with a
  // raw TypeError and never by returning routes.
  const cases: Array<{ name: string; override: unknown }> = [
    { name: "null override", override: null },
    { name: "missing reason", override: { provider: "zai" } },
    { name: "numeric reason", override: { provider: "zai", reason: 7 } },
    { name: "numeric provider", override: { provider: 7, reason: "x" } },
    { name: "numeric model", override: { model: 7, reason: "x" } },
    { name: "numeric thinking", override: { model: "glm-5.3", thinking: 7, reason: "x" } },
    { name: "excludeProviders as a string", override: { excludeProviders: "zai", reason: "x" } },
    { name: "excludeProviders containing a non-string", override: { excludeProviders: ["zai", 7], reason: "x" } },
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
    () => selectRoutes(config, "implementation", { excludeProviders: "zai", reason: "x" } as never),
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
    () => selectRoutes(config, "oracle", { excludeProviders: "openai-codex" } as never),
    /routingOverride is not allowed for the oracle role/,
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
