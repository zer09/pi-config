import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const roots = {
  stock: process.env.PI_BLACKHOLE_STOCK_ROOT,
  patched: process.env.PI_BLACKHOLE_PACKAGE_ROOT,
};
const runtime = process.env.PI_BLACKHOLE_TEST_RUNTIME;
assert.equal(process.env.PI_OFFLINE, "1");
for (const root of [...Object.values(roots), runtime]) {
  assert.ok(root && isAbsolute(root));
  assert.equal(realpathSync(root), root);
}
const deps = join(runtime, "node_modules"), alias = {};
for (const name of ["pi-ai", "pi-coding-agent", "pi-agent-core", "pi-tui"]) {
  const dir = join(deps, "@earendil-works", name);
  assert.equal(JSON.parse(readFileSync(join(dir, "package.json"))).version, "1.4.0");
  alias[`@earendil-works/${name}`] = join(dir, "dist/index.js");
}
alias["@earendil-works/pi-ai/compat"] = join(deps, "@earendil-works/pi-ai/dist/compat.js");
alias.typebox = join(deps, "typebox/build/index.mjs");
const { createJiti } = await import(pathToFileURL(join(deps, "jiti/lib/jiti.mjs")));
const modules = {};
for (const [kind, root] of Object.entries(roots)) {
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, "0.5.15");
  const jiti = createJiti(import.meta.url, { alias, fsCache: false, moduleCache: true });
  modules[kind] = {
    budget: await jiti.import(join(root, "src/om/model-budget.ts")),
    config: await jiti.import(join(root, "src/core/unified-config.ts")),
    memory: await jiti.import(join(root, "src/commands/memory.ts")),
    headers: await jiti.import(join(root, "src/om/provider-stream.ts")),
  };
}
const { stock, patched } = modules;
globalThis.fetch = () => { throw new Error("Unexpected network request in behavior fixture"); };

function projectConfig(raw) {
  const cwd = mkdtempSync(join(tmpdir(), "config-case-"));
  mkdirSync(join(cwd, ".pi"));
  const path = join(cwd, ".pi/pi-blackhole-config.json");
  const bytes = JSON.stringify(raw);
  writeFileSync(path, bytes);
  const result = {};
  for (const kind of ["stock", "patched"]) result[kind] = modules[kind].config.loadUnifiedConfig(cwd);
  assert.equal(readFileSync(path, "utf8"), bytes, "loading must not write configuration");
  assert.equal(existsSync(join(process.env.PI_CODING_AGENT_DIR, "pi-blackhole/pi-blackhole-config.json")), false);
  return result;
}

test("percentage follows the active declaration, not configured worker/session overrides", () => {
  const cfg = {
    compactAfterPercent: 0.65, compactAfterTokens: 180_000,
    compactAfterRatio: 0.2, compactReserveTokens: 10,
    model: { provider: "fixture", id: "active", contextWindow: 2_000_000 },
    observerModel: { provider: "fixture", id: "active", contextWindow: 3_000_000 },
  };
  for (const window of [32_000, 200_000, 272_000, 1_000_000]) {
    const model = { provider: "fixture", id: "active", contextWindow: window };
    assert.equal(patched.budget.autoCompactThreshold(cfg, model), Math.floor(window * 0.65));
  }
  for (const model of [undefined, {}, ...[0, -1, NaN, Infinity, "272000", null].map(contextWindow => ({ contextWindow }))]) {
    assert.equal(patched.budget.autoCompactThreshold(cfg, model), 180_000);
  }
  assert.equal(patched.budget.autoCompactThreshold({ ...cfg, compactAfterPercent: 1 }, { contextWindow: 272_000 }), 272_000);
  assert.equal(patched.budget.autoCompactThreshold(cfg, { contextWindow: 1 }), 1);
});

test("absent or invalid percentage preserves stock ratio/reserve/preset/fixed behavior", () => {
  const configs = [
    {}, { compactAfterTokens: 180_000, compactAfterRatio: 0.4 },
    { compactAfterRatio: 0.65 }, { compactReserveTokens: 32_000 },
    { compactAfterTokens: 0, compactAfterRatio: 0.4, compactReserveTokens: 1_000 },
    { compactAfterPreset: "default" },
    { compactAfterPreset: "local", compactAfterPresets: { local: [{ window: 32_000, ratio: 0.8 }, { window: 1_000_000, ratio: 0.3 }] } },
    { compactAfterPreset: "missing-fixture-preset" },
  ];
  let comparisons = 0;
  for (const config of configs) {
    for (const model of [undefined, { contextWindow: 0 }, { contextWindow: 32_768 }, { contextWindow: 272_000 }, { provider: "fixture", id: "active", contextWindow: 1_000_000 }]) {
      for (const overrides of [{}, { model: { provider: "fixture", id: "active", contextWindow: 400_000 } }]) {
        const cfg = { ...config, ...overrides };
        const expected = stock.budget.autoCompactThreshold(cfg, model);
        for (const percent of [undefined, 0, -1, 1.1, NaN, Infinity, "0.65", null]) {
          assert.equal(patched.budget.autoCompactThreshold({ ...cfg, compactAfterPercent: percent }, model), expected);
          comparisons++;
        }
        assert.deepEqual(patched.budget.effectivePresets(cfg), stock.budget.effectivePresets(cfg));
        assert.equal(patched.budget.sessionContextWindow(model, cfg), stock.budget.sessionContextWindow(model, cfg));
      }
    }
  }
  assert.equal(comparisons, 640);
});

test("file loading validates percentage without changing stock defaults or no-setting configs", () => {
  assert.deepEqual(patched.config.DEFAULTS, stock.config.DEFAULTS);
  for (const raw of [{}, { compactAfterTokens: 180_000 }, { compactAfterRatio: 0.6 }, { compactReserveTokens: 32_000 }, { compactAfterTokens: 81_000, compactAfterPreset: "default" }]) {
    const configs = projectConfig(raw);
    assert.deepEqual(configs.patched, configs.stock);
  }
  for (const percent of [0.65, 1, 0, -1, 1.1, "0.65", null]) {
    const configs = projectConfig({ compactAfterPercent: percent, compactAfterTokens: 180_000 });
    const expected = { ...configs.stock };
    if (percent === 0.65 || percent === 1) expected.compactAfterPercent = percent;
    assert.deepEqual(configs.patched, expected);
  }
});

test("nullable attribution preserves caller deletions through chained transforms", async () => {
  const model = { provider: "fixture", baseUrl: "https://opencode.ai/api" };
  const headers = { "User-Agent": null, "x-opencode-client": null, "x-keep": "fixture-value" };
  const before = structuredClone(headers);
  const expected = { "x-opencode-session": "fixture-session", ...headers };
  assert.deepEqual(patched.headers.withProviderAttributionHeaders(model, headers, "fixture-session"), expected);
  const transform = patched.headers.createAttributionTransform(model, "fixture-session", async input => {
    assert.deepEqual(input, expected);
    return { ...input, "x-opencode-session": null };
  });
  assert.deepEqual(await transform(headers), { ...expected, "x-opencode-session": null });
  assert.deepEqual(headers, before);
  assert.equal(patched.headers.withProviderAttributionHeaders({ provider: "unrelated" }, headers, "fixture-session"), headers);
});

async function memoryStatus(kind, cfg, model) {
  let handler, result;
  modules[kind].memory.registerMemoryCommand({ registerCommand(name, command) {
    assert.equal(name, "blackhole-memory");
    handler = command.handler;
  } }, { config: { ...modules[kind].config.DEFAULTS, ...cfg }, ensureConfig() {} });
  await handler("status", { cwd: process.cwd(), model,
    sessionManager: { getBranch: () => [], getSessionId: () => "synthetic-status-session" },
    ui: { notify: text => { result = text; } },
  });
  return result;
}

test("memory status matches percentage precedence/fallback and keeps native display unchanged", async () => {
  const cfg = { compactAfterPercent: 0.65, compactAfterTokens: 180_000 };
  const known = await memoryStatus("patched", cfg, { contextWindow: 272_000 });
  assert.ok(known.includes(`triggers at ${(176_800).toLocaleString()} · 65% of ${(272_000).toLocaleString()}-token window`));
  const unknown = await memoryStatus("patched", cfg, undefined);
  assert.ok(unknown.includes(`triggers at ${(180_000).toLocaleString()})`));
  assert.ok(!unknown.includes("65%"));
  for (const native of [{}, { compactAfterRatio: 0.6 }, { compactReserveTokens: 16_000 }, { compactAfterTokens: 180_000 }]) {
    assert.equal(await memoryStatus("patched", native, { contextWindow: 272_000 }), await memoryStatus("stock", native, { contextWindow: 272_000 }));
  }
});
