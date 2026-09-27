import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { reapplyIsolatedPatches } from "./reapply-live-0.5.9-patches.mjs";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.9.mjs";
import { reapplyNullableProviderHeadersPatch } from "./reapply-nullable-provider-headers-patch-0.5.9.mjs";
import { reapplyContextEditCompactionPatch } from "./reapply-context-edit-compaction-patch-0.5.9.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, "../..");
const live = join(repository, "agent/npm/node_modules/pi-blackhole");
const helper = join(here, "reapply-live-0.5.9-patches.mjs");
const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const intended = [
  "package.json", "src/core/unified-config.ts", "src/om/model-budget.ts", "src/commands/memory.ts",
  "src/om/runtime.ts", "src/om/provider-stream.ts", "src/om/agents/observer/agent.ts",
  "src/om/agents/reflector/agent.ts", "src/om/agents/dropper/agent.ts", "src/hooks/before-compact.ts",
].sort();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function snapshot(root, metadata = false) {
  const entries = {};
  function visit(path, rel) {
    const stat = lstatSync(path, { bigint: true });
    let value;
    if (stat.isSymbolicLink()) value = `link:${readlinkSync(path)}`;
    else if (stat.isDirectory()) value = "directory";
    else value = hash(readFileSync(path));
    if (metadata) value += `:${stat.dev}:${stat.ino}:${stat.mode}:${stat.nlink}:${stat.mtimeNs}:${stat.ctimeNs}`;
    entries[rel] = value;
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name), join(rel, name));
    }
  }
  visit(root, ".");
  return entries;
}

function protectedSnapshot() {
  const paths = [
    live, join(repository, "agent/settings.json"), join(here, "pi-blackhole-config.json"),
    join(repository, "agent/npm/package.json"), join(repository, "agent/npm/package-lock.json"),
    join(repository, "agent/npm/node_modules/.package-lock.json"),
    ...readdirSync(here).filter((name) => name.endsWith(".mjs")).map((name) => join(here, name)),
  ];
  return Object.fromEntries(paths.map((path) => [path, existsSync(path) ? snapshot(path, true) : "absent"]));
}

function changed(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((rel) => before[rel] !== after[rel]).sort();
}

// Preparation-only proof: require live 0.5.8, but never install or load Blackhole.
// PI_BLACKHOLE_0_5_9_TARBALL=/tmp/.../pi-blackhole-0.5.9.tgz node --test <this-file>
test("guarded offline live-reapply preparation, with live 0.5.8 unchanged", async (t) => {
  const protectedBefore = protectedSnapshot();
  assert.equal(JSON.parse(readFileSync(join(live, "package.json"))).version, "0.5.8");
  const scratch = mkdtempSync(join(realpathSync(tmpdir()), "pi-blackhole-0.5.9-live-test-"));
  t.after(() => {
    try {
      assert.deepEqual(protectedSnapshot(), protectedBefore, "live package, settings, config, npm files and helpers changed");
      console.log("Protected before/after SHA-256:", hash(JSON.stringify(protectedBefore)));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
  const tarball = process.env.PI_BLACKHOLE_0_5_9_TARBALL;
  assert.ok(typeof tarball === "string" && isAbsolute(tarball), "set PI_BLACKHOLE_0_5_9_TARBALL to an explicit archive path");
  assert.equal(`sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`, registryIntegrity);
  const childEnv = { PATH: "/usr/bin:/bin", HOME: scratch, TMPDIR: scratch, PI_OFFLINE: "1", PI_CODING_AGENT_DIR: join(scratch, "agent") };
  const unpack = join(scratch, "stock");
  mkdirSync(unpack);
  execFileSync("tar", ["-xzf", tarball, "-C", unpack, "--no-same-owner"], { env: childEnv });
  const stock = join(unpack, "package");
  const expected = join(scratch, "expected/package");
  cpSync(stock, expected, { recursive: true });
  reapplyCompactAfterPercentPatch(expected);
  reapplyNullableProviderHeadersPatch(expected);
  reapplyContextEditCompactionPatch(expected);
  assert.deepEqual(changed(snapshot(stock), snapshot(expected)), intended);

  function fixture(from = stock) {
    const parent = mkdtempSync(join(scratch, "case-"));
    const target = join(parent, "package");
    cpSync(from, target, { recursive: true });
    return { parent, target };
  }

  async function rejectsWithoutWrites(name, mutate, pattern, from = stock) {
    await t.test(name, () => {
      const item = fixture(from);
      const target = mutate(item) ?? item.target;
      const before = snapshot(item.parent, true);
      assert.throws(() => reapplyIsolatedPatches(target, tarball), pattern);
      assert.deepEqual(snapshot(item.parent, true), before, "refusal must preserve bytes, paths, inode/link counts, modes and times");
    });
  }

  await t.test("exact ten-file output, second-pass byte/mtime idempotence and clean reinstall", () => {
    const { target } = fixture();
    const before = snapshot(target, true);
    assert.match(reapplyIsolatedPatches(target, tarball), /^patched:/);
    assert.deepEqual(changed(before, snapshot(target, true)), intended);
    assert.deepEqual(snapshot(target), snapshot(expected));
    const first = snapshot(target, true);
    assert.match(reapplyIsolatedPatches(target, tarball), /^already patched:/);
    assert.deepEqual(snapshot(target, true), first);
    const reinstall = fixture().target;
    assert.match(reapplyIsolatedPatches(reinstall, tarball), /^patched:/);
    assert.deepEqual(snapshot(reinstall), snapshot(expected));
    const originalManifest = JSON.parse(readFileSync(join(stock, "package.json")));
    const patchedManifest = JSON.parse(readFileSync(join(target, "package.json")));
    originalManifest.pi.extensions = ["./index.ts"];
    assert.deepEqual(patchedManifest, originalManifest, "main, dependencies and all other manifest fields stay unchanged");
  });

  await t.test("npm nested dependencies and internal .bin links remain byte/mtime unchanged", () => {
    const { parent, target } = fixture();
    const deps = join(target, "node_modules");
    mkdirSync(join(deps, "fixture"), { recursive: true });
    mkdirSync(join(deps, ".bin"));
    writeFileSync(join(deps, "fixture/cli.mjs"), "export const untouched = true;\n");
    symlinkSync("../fixture/cli.mjs", join(deps, ".bin/fixture"));
    writeFileSync(join(deps, ".package-lock.json"), '{"untouched":true}\n');
    writeFileSync(join(parent, "package.json"), '{"dependencies":{"pi-blackhole":"0.5.9"}}\n');
    writeFileSync(join(parent, "package-lock.json"), '{"lockfileVersion":3}\n');
    const before = snapshot(parent, true);
    const depBefore = snapshot(deps, true);
    assert.match(reapplyIsolatedPatches(target, tarball), /^patched:/);
    assert.deepEqual(changed(before, snapshot(parent, true)), intended.map((rel) => `package/${rel}`).sort());
    assert.deepEqual(snapshot(deps, true), depBefore);
    const first = snapshot(parent, true);
    assert.match(reapplyIsolatedPatches(target, tarball), /^already patched:/);
    assert.deepEqual(snapshot(parent, true), first);
  });

  for (const [label, key, value] of [
    ["0.5.8", "version", "0.5.8"], ["0.5.10", "version", "0.5.10"], ["wrong name", "name", "other-package"],
  ]) {
    await rejectsWithoutWrites(`reject ${label}`, ({ target }) => {
      const path = join(target, "package.json");
      const pkg = JSON.parse(readFileSync(path));
      pkg[key] = value;
      writeFileSync(path, JSON.stringify(pkg, null, 2));
    }, /Expected exactly pi-blackhole@0.5.9/);
  }
  for (const from of [stock, expected]) {
    for (const rel of ["src/hooks/before-compact.ts", "index.ts", "src/om/compaction-trigger.ts", "dist/index.js"]) {
      await rejectsWithoutWrites(`reject ${from === stock ? "stock" : "patched"} drift in ${rel}`, ({ target }) => {
        const path = join(target, rel);
        writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("\n// drift\n")]));
      }, /Mixed, partial, or drifted/, from);
    }
    await rejectsWithoutWrites(`reject ${from === stock ? "stock" : "patched"} manifest drift`, ({ target }) => {
      const path = join(target, "package.json");
      const pkg = JSON.parse(readFileSync(path));
      pkg.main = "./index.ts";
      pkg.dependencies = { ...pkg.dependencies, "unexpected-dependency": "1.0.0" };
      writeFileSync(path, JSON.stringify(pkg, null, 2));
    }, /Mixed, partial, or drifted/, from);
  }
  for (const rel of intended) {
    await rejectsWithoutWrites(`reject single patched file ${rel}`, ({ target }) => {
      writeFileSync(join(target, rel), readFileSync(join(expected, rel)));
    }, /Mixed, partial, or drifted/);
    await rejectsWithoutWrites(`reject single stock file ${rel}`, ({ target }) => {
      writeFileSync(join(target, rel), readFileSync(join(stock, rel)));
    }, /Mixed, partial, or drifted/, expected);
  }
  await rejectsWithoutWrites("reject percentage-only predecessor", ({ target }) => {
    reapplyCompactAfterPercentPatch(target);
  }, /Mixed, partial, or drifted/);
  await rejectsWithoutWrites("reject percentage-plus-nullable predecessor", ({ target }) => {
    reapplyCompactAfterPercentPatch(target);
    reapplyNullableProviderHeadersPatch(target);
  }, /Mixed, partial, or drifted/);
  await rejectsWithoutWrites("reject missing unpatched source", ({ target }) => {
    rmSync(join(target, "index.ts"));
  }, /Incomplete/);
  await rejectsWithoutWrites("reject extra source", ({ target }) => {
    writeFileSync(join(target, "src/unexpected.ts"), "export {};\n");
  }, /Unexpected/);
  await rejectsWithoutWrites("reject extra empty directory", ({ target }) => {
    mkdirSync(join(target, "src/unexpected"));
  }, /Unexpected/);

  for (const rel of ["package.json", "src/hooks/before-compact.ts", "index.ts"]) {
    for (const kind of ["symlink", "hardlink"]) {
      await rejectsWithoutWrites(`reject ${kind} ${rel}`, ({ parent, target }) => {
        const path = join(target, rel);
        const backing = join(parent, "backing");
        if (kind === "symlink") {
          renameSync(path, backing);
          symlinkSync(backing, path);
        } else linkSync(path, backing);
      }, /unlinked regular file/);
    }
  }
  await rejectsWithoutWrites("reject symlink package root", ({ parent, target }) => {
    const backing = join(parent, "backing");
    renameSync(target, backing);
    symlinkSync(backing, target);
  }, /canonical, non-symlink/);
  await rejectsWithoutWrites("reject symlink parent", ({ parent, target }) => {
    symlinkSync(parent, join(parent, "linked-parent"));
    return join(parent, "linked-parent/package");
  }, /canonical, non-symlink/);
  await rejectsWithoutWrites("reject symlink source directory", ({ parent, target }) => {
    renameSync(join(target, "src"), join(parent, "src"));
    symlinkSync(join(parent, "src"), join(target, "src"));
  }, /Unexpected package file/);
  await rejectsWithoutWrites("reject linked node_modules root", ({ parent, target }) => {
    mkdirSync(join(parent, "deps"));
    symlinkSync(join(parent, "deps"), join(target, "node_modules"));
  }, /Dependency|canonical/);
  await rejectsWithoutWrites("reject non-directory node_modules", ({ target }) => {
    writeFileSync(join(target, "node_modules"), "not npm dependencies");
  }, /node_modules/);
  await rejectsWithoutWrites("reject dependency link into package source", ({ target }) => {
    mkdirSync(join(target, "node_modules"));
    symlinkSync("../src/hooks/before-compact.ts", join(target, "node_modules/escape"));
  }, /Dependency link escapes/);
  await rejectsWithoutWrites("reject dependency hardlink into package source", ({ target }) => {
    mkdirSync(join(target, "node_modules"));
    linkSync(join(target, "src/hooks/before-compact.ts"), join(target, "node_modules/shared.ts"));
  }, /unlinked regular file/);

  await t.test("explicit archive required and bad SRI rejected without target writes", () => {
    const { parent, target } = fixture();
    const badArchive = join(parent, "bad.tgz");
    writeFileSync(badArchive, Buffer.concat([readFileSync(tarball), Buffer.from("drift")]));
    const before = snapshot(parent, true);
    for (const archive of [undefined, "relative.tgz", badArchive]) {
      assert.throws(() => reapplyIsolatedPatches(target, archive), /explicit absolute --tarball|registry SRI/);
      assert.deepEqual(snapshot(parent, true), before);
    }
  });
  await t.test("isolated API has no default and refuses live", () => {
    for (const target of [undefined, "", "relative", live]) {
      assert.throws(() => reapplyIsolatedPatches(target, tarball), /explicit absolute isolated|non-isolated/);
    }
  });
  await t.test("CLI requires --live and explicit archive, forbids target overrides", () => {
    const { parent, target } = fixture();
    const before = snapshot(parent, true);
    for (const args of [
      [], [tarball], ["--tarball", tarball], ["--live"], ["--live", "--tarball", "relative.tgz"],
      ["--live", "--tarball", tarball, target], ["--live", "--tarball", tarball, "--target", target],
    ]) {
      const result = spawnSync(process.execPath, [helper, ...args], { encoding: "utf8", env: childEnv });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Usage:/);
    }
    // This is a negative version check, not deployment. An environment override
    // must not redirect the CLI away from the canonical, still-0.5.8 installation.
    const result = spawnSync(process.execPath, [helper, "--live", "--tarball", tarball], {
      encoding: "utf8", env: { ...childEnv, PI_BLACKHOLE_PACKAGE_ROOT: target },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Expected exactly pi-blackhole@0.5.9/);
    assert.deepEqual(snapshot(parent, true), before);
    assert.deepEqual(protectedSnapshot(), protectedBefore);
  });
});
