import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

test("ports the Pi 0.84.1 local patch set to pi-blackhole 0.4.5", async () => {
  const installedPackage =
    process.env.PI_BLACKHOLE_PACKAGE_ROOT ??
    join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-blackhole");
  assert.ok(existsSync(installedPackage), `pi-blackhole package missing at ${installedPackage}`);
  const packageJson = JSON.parse(source(installedPackage, "package.json"));
  assert.equal(packageJson.version, "0.4.5");

  const root = mkdtempSync(join(tmpdir(), "pi-blackhole-local-patches-"));
  const packageRoot = join(root, "pi-blackhole");
  try {
    cpSync(installedPackage, packageRoot, { recursive: true });
    run(compactHelper, packageRoot);
    run(headersHelper, packageRoot);
    assert.match(run(bridgeHelper, packageRoot), /upstream support present/);
    assert.match(run(compactHelper, packageRoot), /already patched/);
    assert.match(run(headersHelper, packageRoot), /already patched/);

    const patchedPackageJson = JSON.parse(source(packageRoot, "package.json"));
    assert.deepEqual(patchedPackageJson.pi.extensions, ["./index.ts"]);

    const trigger = source(packageRoot, "src/om/compaction-trigger.ts");
    assert.match(trigger, /effectiveCompactAfterTokens/);
    assert.equal((trigger.match(/tokens < compactThreshold\.tokens/g) ?? []).length, 2);
    assert.match(trigger, /currentTokens < compactThreshold\.tokens/);

    const runtime = source(packageRoot, "src/om/runtime.ts");
    assert.match(runtime, /headers\?: ProviderHeaders/);
    assert.equal((runtime.match(/headers: auth\.headers,/g) ?? []).length, 2);
    assert.doesNotMatch(runtime, /auth\.headers as Record<string, string>/);

    for (const stage of ["observer", "reflector", "dropper"]) {
      assert.match(source(packageRoot, `src/om/agents/${stage}/agent.ts`), /headers\?: ProviderHeaders/);
    }

    const budget = await import(
      `${pathToFileURL(join(packageRoot, "src/om/compaction-budget.ts")).href}?test=${Date.now()}`
    );
    assert.deepEqual(
      budget.effectiveCompactAfterTokens(
        { compactAfterTokens: 180_000, compactAfterPercent: 0.65 },
        { contextWindow: 272_000 },
      ),
      { tokens: 176_800, source: "percent", percent: 0.65, contextWindow: 272_000 },
    );
    assert.equal(
      budget.effectiveCompactAfterTokens(
        { compactAfterTokens: 180_000, compactAfterPercent: 0.65 },
        {},
      ).tokens,
      180_000,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
