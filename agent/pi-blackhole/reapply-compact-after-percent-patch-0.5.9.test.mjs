import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import { gunzipSync } from "node:zlib";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.9.mjs";

// Acquire separately with npm pack pi-blackhole@0.5.9 --ignore-scripts in an empty
// directory, with empty user/global npm configs and isolated HOME/cache/environment.
// No acquisition, dependency install, subprocess, or Pi session runs in this suite.
// PI_BLACKHOLE_0_5_9_TARBALL=/tmp/.../pi-blackhole-0.5.9.tgz \
//   node --experimental-vm-modules --test --test-isolation=none <this-file>
const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../..");
const installed = join(repository, "agent/npm/node_modules/pi-blackhole");
const affected = [
  "package.json",
  "src/commands/memory.ts",
  "src/core/unified-config.ts",
  "src/om/model-budget.ts",
];
const invariant = ["index.ts", "src/om/compaction-trigger.ts"];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function snapshot(root) {
  const files = {};
  function visit(path, rel) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      files[rel] = `link:${readlinkSync(path)}`;
    } else if (stat.isDirectory()) {
      files[rel] = "directory";
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${rel}/${name}`);
    } else {
      files[rel] = digest(readFileSync(path));
    }
  }
  visit(root, "");
  return files;
}

function protectedSnapshot() {
  const paths = [
    installed,
    join(repository, "agent/settings.json"),
    join(here, "pi-blackhole-config.json"),
    ...readdirSync(here)
      .filter((name) => /\.(mjs|md)$/.test(name) && !name.includes("0.5.9"))
      .sort().map((name) => join(here, name)),
  ];
  return Object.fromEntries(paths.map((path) => [path, snapshot(path)]));
}

function stockArchive(tarball) {
  assert.equal(`sha512-${createHash("sha512").update(tarball).digest("base64")}`, registryIntegrity,
    "tarball must match the pinned npm registry SRI before extraction");
  // This pinned npm archive contains only ordinary files. Do not accept links or extensions.
  const tar = gunzipSync(tarball);
  const files = new Map();
  for (let offset = 0; tar[offset];) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0");
    assert.equal(header[345], 0, "no tar prefix in this pinned archive");
    assert.ok(name.startsWith("package/"));
    const rel = name.slice("package/".length);
    assert.ok(rel && !rel.split("/").some((part) => part === ".." || part === ""));
    assert.ok(!files.has(rel), `duplicate archive file: ${rel}`);
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    files.set(rel, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(files.size, 132);
  return files;
}

// Execute only the config, budget, and memory command modules. All external effects
// are denied or in memory; the extension entrypoint and provider code never load.
async function loadPolicy(root) {
  const virtualFiles = new Map();
  const context = createContext({ process: { env: {} }, console });
  const denied = () => assert.fail("unexpected runtime side effect");
  const modules = new Map();
  function mock(id, values) {
    modules.set(id, new SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context, identifier: id }));
  }
  mock("node:fs", {
    existsSync: (path) => virtualFiles.has(path),
    readFileSync: (path) => {
      assert.ok(virtualFiles.has(path), "read must use virtual config");
      return virtualFiles.get(path);
    },
    mkdirSync: denied,
    writeFileSync: denied,
  });
  mock("node:path", { dirname, join });
  mock("@earendil-works/pi-coding-agent", { getAgentDir: () => "/virtual-agent" });
  mock("src/pi-base/config.ts", {
    readBooleanEnv: (_name, fallback) => fallback,
    readPositiveIntEnv: (_name, fallback) => fallback,
  });
  mock("src/om/clipboard.ts", { copyTextToClipboard: denied });
  mock("src/om/pending.ts", { readPendingState: denied });
  const emptyProjection = () => ({ observations: [], reflections: [] });
  mock("src/om/ledger/index.ts", {
    diffProjection: () => ({ observationsOnlyInFull: [], droppedOnlyInFull: [], reflectionsOnlyInFull: [] }),
    entryIndexForId: denied,
    foldLedger: () => ({ ...emptyProjection(), droppedObservationIds: new Set() }),
    fullProjection: emptyProjection,
    observationPoolTokens: () => ({ tokens: 0 }),
    observationToSummaryLine: denied,
    rawTokensAfterIndex: denied,
    rawTokensSinceDropCoverage: () => 0,
    rawTokensSinceLastCompaction: () => 0,
    rawTokensSinceObservationCoverage: () => 0,
    rawTokensSinceReflectionCoverage: () => 0,
    reflectionToSummaryLine: denied,
    visibleProjection: emptyProjection,
  });
  const sourceFiles = [
    "src/core/config-env.ts", "src/core/unified-config.ts",
    "src/om/model-budget.ts", "src/commands/memory.ts",
  ];
  for (const rel of sourceFiles) {
    modules.set(rel, new SourceTextModule(
      stripTypeScriptTypes(readFileSync(join(root, rel), "utf8")),
      { context, identifier: rel },
    ));
  }
  for (const rel of sourceFiles) {
    const module = modules.get(rel);
    if (module.status === "unlinked") {
      await module.link((specifier, parent) => {
        let id = specifier;
        if (specifier.startsWith(".")) {
          id = posix.join(posix.dirname(parent.identifier), specifier).replace(/\.js$/, ".ts");
        }
        assert.ok(modules.has(id), `unexpected runtime import: ${id}`);
        return modules.get(id);
      });
    }
    await module.evaluate();
  }
  const config = modules.get("src/core/unified-config.ts").namespace;
  const budget = modules.get("src/om/model-budget.ts").namespace;
  const memory = modules.get("src/commands/memory.ts").namespace;
  const loadConfig = (input) => {
    virtualFiles.set("/virtual-agent/pi-blackhole/pi-blackhole-config.json", JSON.stringify(input));
    return config.loadUnifiedConfig("/virtual-project");
  };
  return {
    config, budget, loadConfig,
    async status(input, model) {
      let command;
      memory.registerMemoryCommand({
        registerCommand(name, spec) {
          assert.equal(name, "blackhole-memory");
          command = spec;
        },
      }, { config: { ...config.DEFAULTS, ...input }, ensureConfig() {} });
      let output;
      await command.handler("status", {
        cwd: "/virtual-project", model,
        sessionManager: { getBranch: () => [], getSessionId: () => "fixture" },
        ui: { notify: (text) => { output = text; } },
      });
      assert.equal(typeof output, "string");
      return output.split("\n").find((line) => line.startsWith("Compaction:"));
    },
  };
}

test("isolated pi-blackhole@0.5.9 percentage candidate", async (t) => {
  const protectedBefore = protectedSnapshot();
  assert.equal(JSON.parse(readFileSync(join(installed, "package.json"))).version, "0.5.8");
  const root = mkdtempSync(join(realpathSync(tmpdir()), "pi-blackhole-0.5.9-test-"));
  t.after(() => {
    try {
      assert.deepEqual(protectedSnapshot(), protectedBefore,
        "installed 0.5.8 package, settings, config, and existing helpers/tests/docs must be byte-identical");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const tarballPath = process.env.PI_BLACKHOLE_0_5_9_TARBALL;
  assert.ok(tarballPath, "supply PI_BLACKHOLE_0_5_9_TARBALL from separate isolated npm acquisition");
  const tarball = readFileSync(tarballPath);
  const files = stockArchive(tarball);
  const stockRoot = join(root, "stock");
  for (const [rel, bytes] of files) {
    mkdirSync(dirname(join(stockRoot, rel)), { recursive: true });
    writeFileSync(join(stockRoot, rel), bytes);
  }
  const stockBefore = snapshot(stockRoot);
  const stockPackage = JSON.parse(files.get("package.json"));
  assert.equal(stockPackage.name, "pi-blackhole");
  assert.equal(stockPackage.version, "0.5.9");
  assert.deepEqual(stockPackage.pi.extensions, ["./dist/index.js"]);

  function candidate(from = stockRoot) {
    const target = join(mkdtempSync(join(root, "case-")), "package");
    cpSync(from, target, { recursive: true });
    return target;
  }
  const patchedRoot = candidate();
  await t.test("changes only the percentage sources and pi.extensions; second pass writes nothing", () => {
    const before = snapshot(patchedRoot);
    assert.match(reapplyCompactAfterPercentPatch(patchedRoot), /^patched:/);
    const after = snapshot(patchedRoot);
    assert.deepEqual(Object.keys(after).filter((key) => after[key] !== before[key]).sort(),
      affected.map((rel) => `/${rel}`));
    const patchedPackage = JSON.parse(readFileSync(join(patchedRoot, "package.json")));
    assert.deepEqual(patchedPackage, { ...stockPackage, pi: { ...stockPackage.pi, extensions: ["./index.ts"] } });
    assert.equal(patchedPackage.main, "./dist/index.js");
    const mtimes = affected.map((rel) => statSync(join(patchedRoot, rel), { bigint: true }).mtimeNs);
    assert.match(reapplyCompactAfterPercentPatch(patchedRoot), /^already patched:/);
    assert.deepEqual(snapshot(patchedRoot), after);
    assert.deepEqual(affected.map((rel) => statSync(join(patchedRoot, rel), { bigint: true }).mtimeNs), mtimes);
    const trigger = readFileSync(join(patchedRoot, "src/om/compaction-trigger.ts"), "utf8");
    assert.equal(trigger.split("autoCompactThreshold(runtime.config, ctx.model)").length - 1, 2);
  });

  const stock = await loadPolicy(stockRoot);
  const patched = await loadPolicy(patchedRoot);
  const policy = { compactAfterPercent: 0.65, compactAfterTokens: 180_000 };
  await t.test("declared active window wins over fixed/native/config overrides and follows model switches", async () => {
    const cfg = {
      ...policy, compactAfterRatio: 0.2, compactReserveTokens: 10_000,
      model: { provider: "test", id: "active", contextWindow: 42_000 },
      observerModel: { provider: "test", id: "active", contextWindow: 32_000 },
    };
    for (const window of [272_000, 1_000_000, 200_000, 128_000, 101, 1]) {
      const model = { provider: "test", id: "active", contextWindow: window };
      const expected = Math.max(1, Math.floor(window * 0.65));
      assert.equal(patched.budget.autoCompactThreshold(cfg, model), expected);
      assert.equal(await patched.status(cfg, model),
        `Compaction:     ~0 tokens (triggers at ${expected.toLocaleString()} · 65% of ${window.toLocaleString()}-token window)`);
    }
    const fractionalModel = { provider: "test", id: "active", contextWindow: 100_001.9 };
    assert.equal(patched.budget.directSessionContextWindow(fractionalModel), 100_001);
    assert.equal(patched.budget.autoCompactThreshold(cfg, fractionalModel), 65_000);
    assert.equal(await patched.status(cfg, fractionalModel),
      "Compaction:     ~0 tokens (triggers at 65,000 · 65% of 100,001-token window)");
    assert.equal(patched.budget.autoCompactThreshold({ ...policy, compactAfterPercent: 1 }, { contextWindow: 272_000 }), 272_000);
  });

  await t.test("missing/invalid declarations use the valid fixed fallback, including in memory status", async () => {
    const cfg = { ...policy, model: { provider: "test", id: "active", contextWindow: 1_000_000 } };
    const models = [undefined, null, {}, ...[undefined, null, 0, -1, NaN, Infinity, -Infinity, "1000000"]
      .map((contextWindow) => ({ provider: "test", id: "active", contextWindow }))];
    for (const model of models) {
      assert.equal(patched.budget.autoCompactThreshold(cfg, model), 180_000);
      assert.equal(await patched.status(cfg, model), "Compaction:     ~0 tokens (triggers at 180,000)");
    }
    for (const fixed of [0, -1, NaN, Infinity, "180000", 1.5, undefined]) {
      const cfg = { compactAfterPercent: 0.65, compactAfterTokens: fixed, compactAfterRatio: 0.5 };
      assert.equal(patched.budget.autoCompactThreshold(cfg, {}), stock.budget.autoCompactThreshold(cfg, {}));
      assert.equal(await patched.status(cfg, {}), await stock.status(cfg, {}));
    }
  });

  await t.test("absent/invalid percent preserves native fixed, ratio, reserve, and preset behavior", async () => {
    const nativeConfigs = [
      { compactAfterTokens: 180_000 }, { compactAfterRatio: 0.5 },
      { compactReserveTokens: 16_384 }, {},
      { compactAfterPreset: "custom", compactAfterPresets: { custom: [{ window: 32_000, ratio: 0.3 }] } },
    ];
    for (const percent of [undefined, null, 0, -0.1, NaN, Infinity, 1.01, "0.65"]) {
      for (const cfg of nativeConfigs) {
        for (const model of [{ contextWindow: 272_000 }, {}]) {
          const input = { ...cfg, compactAfterPercent: percent };
          assert.equal(patched.budget.autoCompactThreshold(input, model), stock.budget.autoCompactThreshold(cfg, model));
          assert.equal(await patched.status(input, model), await stock.status(cfg, model));
        }
      }
    }
  });

  await t.test("config parsing preserves valid percent and worker budgets; normalization rejects invalid percent", () => {
    const workers = {
      observeAfterTokens: 30_000, reflectAfterTokens: 40_000, observerChunkMaxTokens: 50_000,
      reflectorInputMaxTokens: 60_000, dropperInputMaxTokens: 70_000, agentMaxTurns: 7,
    };
    const loaded = patched.loadConfig({ ...policy, ...workers });
    const { compactAfterPercent, ...withoutPercent } = loaded;
    assert.equal(compactAfterPercent, 0.65);
    assert.deepEqual(JSON.parse(JSON.stringify(withoutPercent)), JSON.parse(JSON.stringify(stock.loadConfig({ ...policy, ...workers }))));
    for (const [key, value] of Object.entries(workers)) assert.equal(loaded[key], value);
    for (const percent of [undefined, null, 0, -1, NaN, Infinity, 1.1, "0.65"]) {
      const record = { ...policy, compactAfterPercent: percent };
      patched.config.normalizeThresholdKnobs(record);
      assert.ok(!Object.hasOwn(record, "compactAfterPercent"));
      assert.equal(patched.loadConfig({ ...policy, compactAfterPercent: percent }).compactAfterPercent, undefined);
    }
    const cfg = { ...policy, model: { provider: "test", id: "worker", contextWindow: 32_000 } };
    const model = { provider: "test", id: "worker", contextWindow: 200_000, maxTokens: 8_192 };
    assert.equal(patched.budget.compactThresholdTokens(cfg, 1_000_000), 180_000);
    assert.equal(patched.budget.sessionContextWindow(model, cfg), stock.budget.sessionContextWindow(model, cfg));
    assert.equal(patched.budget.effectiveContextWindow(model, cfg.model), stock.budget.effectiveContextWindow(model, cfg.model));
    assert.equal(patched.budget.boundedMaxTokens(model), stock.budget.boundedMaxTokens(model));
    const workerSource = (dir) => readFileSync(join(dir, "src/om/model-budget.ts"), "utf8")
      .split("export function boundedMaxTokens(")[1];
    assert.equal(workerSource(patchedRoot), workerSource(stockRoot));
  });

  function rejectsWithoutWrites(target, expected = /Mixed|Drifted|Expected|ENOENT|non-isolated/) {
    const before = snapshot(root);
    assert.throws(() => reapplyCompactAfterPercentPatch(target), expected);
    assert.deepEqual(snapshot(root), before, "rejection must change zero fixture bytes");
  }
  await t.test("requires an explicit isolated target and refuses the live installation", () => {
    for (const target of [undefined, "", " "]) rejectsWithoutWrites(target, /explicit isolated/);
    for (const target of [installed, repository]) rejectsWithoutWrites(target, /non-isolated/);
    rejectsWithoutWrites(join(root, "missing"), /ENOENT/);
    const alias = join(root, "alias");
    symlinkSync(patchedRoot, alias, "dir");
    rejectsWithoutWrites(alias, /non-isolated/);
    const moduleRoot = join(root, "node_modules/pi-blackhole");
    cpSync(stockRoot, moduleRoot, { recursive: true });
    rejectsWithoutWrites(moduleRoot, /non-isolated/);
  });

  await t.test("rejects wrong names and versions before any write", () => {
    for (const change of [
      { name: "other" }, { version: "0.5.8" }, { version: "0.5.10" }, { version: "0.5.9-beta" },
    ]) {
      const target = candidate();
      writeFileSync(join(target, "package.json"), JSON.stringify({ ...stockPackage, ...change }));
      rejectsWithoutWrites(target, /Expected exactly pi-blackhole@0\.5\.9/);
    }
  });

  await t.test("preflights every affected/invariant file for missing files and drift in either state", () => {
    for (const rel of [...affected, ...invariant]) {
      const missing = candidate();
      unlinkSync(join(missing, rel));
      rejectsWithoutWrites(missing, /ENOENT/);
      for (const sourceRoot of [stockRoot, patchedRoot]) {
        const target = candidate(sourceRoot);
        writeFileSync(join(target, rel), `${readFileSync(join(target, rel), "utf8")}\n`);
        rejectsWithoutWrites(target);
      }
    }
  });

  await t.test("rejects mixed files in either direction and a partially patched file", () => {
    for (const rel of affected) {
      for (const [from, other] of [[stockRoot, patchedRoot], [patchedRoot, stockRoot]]) {
        const target = candidate(from);
        writeFileSync(join(target, rel), readFileSync(join(other, rel)));
        rejectsWithoutWrites(target, /Mixed/);
      }
    }
    const target = candidate();
    const rel = "src/core/unified-config.ts";
    const partial = readFileSync(join(target, rel), "utf8")
      .replace("    \"compactAfterTokens\",", "    \"compactAfterTokens\",\n    \"compactAfterPercent\",");
    writeFileSync(join(target, rel), partial);
    rejectsWithoutWrites(target, /Mixed/);
  });

  await t.test("rejects duplicate stock and patched anchors before any write", () => {
    for (const sourceRoot of [stockRoot, patchedRoot]) {
      const entry = sourceRoot === stockRoot ? "./dist/index.js" : "./index.ts";
      for (const [rel, anchor, duplicate] of [
        ["src/core/unified-config.ts", "    \"compactAfterTokens\",\n"],
        ["src/om/model-budget.ts", "export function autoCompactThreshold(\n"],
        ["src/commands/memory.ts", "  autoCompactThreshold,\n"],
        ["package.json", `      "${entry}"`, `      "${entry}",\n      "${entry}"`],
      ]) {
        const target = candidate(sourceRoot);
        const source = readFileSync(join(target, rel), "utf8");
        assert.equal(source.split(anchor).length, 2);
        writeFileSync(join(target, rel), source.replace(anchor, duplicate ?? anchor + anchor));
        rejectsWithoutWrites(target);
      }
    }
  });

  await t.test("refuses linked files/directories rather than changing shared bytes", () => {
    for (const kind of ["symlink", "hardlink", "directory"]) {
      const target = candidate();
      const rel = kind === "directory" ? "src/commands" : "src/commands/memory.ts";
      const shared = join(root, `shared-${kind}`);
      cpSync(join(target, rel), shared, { recursive: true });
      rmSync(join(target, rel), { recursive: true });
      if (kind === "hardlink") linkSync(shared, join(target, rel));
      else symlinkSync(shared, join(target, rel), kind === "directory" ? "dir" : "file");
      rejectsWithoutWrites(target, /unlinked regular file/);
    }
  });

  await t.test("rejects a corrupt tarball before extraction and leaves the stock fixture unchanged", () => {
    const corrupt = Buffer.from(tarball);
    corrupt[0] ^= 1;
    assert.throws(() => stockArchive(corrupt), /pinned npm registry SRI/);
    assert.deepEqual(snapshot(stockRoot), stockBefore);
    assert.deepEqual(protectedSnapshot(), protectedBefore);
  });
});
