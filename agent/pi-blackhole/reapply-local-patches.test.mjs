import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const compactHelper = join(here, "reapply-compact-after-percent-patch.mjs");
const headersHelper = join(here, "reapply-nullable-provider-headers-patch.mjs");
const bridgeHelper = join(here, "reapply-provider-stream-bridge-patch.mjs");

function run(helper, packageRoot) {
  return execFileSync(process.execPath, [helper, packageRoot], { encoding: "utf8" });
}

function source(packageRoot, rel) {
  return readFileSync(join(packageRoot, rel), "utf8");
}

test("ports the local patch set to pi-blackhole 0.5.8 and is byte-idempotent", async () => {
  const installedPackage =
    process.env.PI_BLACKHOLE_PACKAGE_ROOT ??
    join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-blackhole");
  assert.ok(existsSync(installedPackage), `pi-blackhole package missing at ${installedPackage}`);
  const packageJson = JSON.parse(source(installedPackage, "package.json"));
  assert.equal(packageJson.version, "0.5.8");

  const root = mkdtempSync(join(tmpdir(), "pi-blackhole-local-patches-"));
  const packageRoot = join(root, "pi-blackhole");
  try {
    cpSync(installedPackage, packageRoot, { recursive: true });
    symlinkSync(dirname(installedPackage), join(root, "node_modules"), "dir");
    run(compactHelper, packageRoot);
    run(headersHelper, packageRoot);
    assert.match(run(bridgeHelper, packageRoot), /upstream support present/);
    const patchedFiles = [
      "package.json",
      "src/core/unified-config.ts",
      "src/om/model-budget.ts",
      "src/commands/memory.ts",
      "src/om/runtime.ts",
      "src/om/provider-stream.ts",
      "src/om/agents/observer/agent.ts",
      "src/om/agents/reflector/agent.ts",
      "src/om/agents/dropper/agent.ts",
    ];
    const hashPatchedFiles = () => {
      const hash = createHash("sha256");
      for (const rel of patchedFiles) hash.update(rel).update("\0").update(source(packageRoot, rel)).update("\0");
      return hash.digest("hex");
    };
    const firstHash = hashPatchedFiles();
    assert.match(run(compactHelper, packageRoot), /already patched/);
    assert.match(run(headersHelper, packageRoot), /already patched/);
    assert.match(run(bridgeHelper, packageRoot), /upstream support present/);
    assert.equal(hashPatchedFiles(), firstHash, "a second helper pass must not change any patched byte");

    const patchedPackageJson = JSON.parse(source(packageRoot, "package.json"));
    assert.deepEqual(patchedPackageJson.pi.extensions, ["./index.ts"]);

    const configSource = source(packageRoot, "src/core/unified-config.ts");
    assert.match(configSource, /compactAfterPercent\?: number/);
    assert.match(configSource, /isWindowRatio\(rec\.compactAfterPercent\)/);

    const trigger = source(packageRoot, "src/om/compaction-trigger.ts");
    assert.equal((trigger.match(/autoCompactThreshold\(runtime\.config, ctx\.model\)/g) ?? []).length, 2);
    assert.match(source(packageRoot, "index.ts"), /registerCompactFailedHook/);
    assert.match(source(packageRoot, "src/hooks/compact-failed.ts"), /session_compact_failed/);

    const runtime = source(packageRoot, "src/om/runtime.ts");
    assert.match(runtime, /headers\?: ProviderHeaders/);
    assert.equal((runtime.match(/headers: auth\.headers,/g) ?? []).length, 2);
    assert.doesNotMatch(runtime, /auth\.headers as Record<string, string>/);

    const providerStream = source(packageRoot, "src/om/provider-stream.ts");
    assert.match(providerStream, /headers: ProviderHeaders \| undefined/);
    assert.match(providerStream, /\): ProviderHeaders \| undefined/);

    for (const stage of ["observer", "reflector", "dropper"]) {
      assert.match(source(packageRoot, `src/om/agents/${stage}/agent.ts`), /headers\?: ProviderHeaders/);
    }

    const budgetUrl = `${pathToFileURL(join(packageRoot, "src/om/model-budget.ts")).href}?test=${Date.now()}`;
    const budgetOutput = execFileSync(
      "bun",
      [
        "-e",
        `const budget = await import(${JSON.stringify(budgetUrl)}); const config = { compactAfterTokens: 180000, compactAfterPercent: 0.65 }; console.log(JSON.stringify([budget.autoCompactThreshold(config, { contextWindow: 272000 }), budget.autoCompactThreshold(config, { contextWindow: 1000000 }), budget.autoCompactThreshold(config, {})]));`,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(budgetOutput.trim()), [176_800, 650_000, 180_000]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
