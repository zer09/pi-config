import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, linkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.10.mjs";
import { reapplyNullableProviderHeadersPatch } from "./reapply-nullable-provider-headers-patch-0.5.10.mjs";
import { reapplyContextEditCompactionPatch } from "./reapply-context-edit-compaction-patch-0.5.10.mjs";

// Supply an explicit disposable TMPDIR and separately acquired, SRI-pinned archive.
// No installation, provider, or live package access occurs in this focused gate.
const integrity = "sha512-bglpA0hzumUXmfMWydF67bT3unCWTrTMMlUt9/rxpRqcLfxbNhaPtqlsnBnGCpInYtISVHZq/9qanLP597h0lQ==";
const here = dirname(fileURLToPath(import.meta.url));
const helpers = [reapplyCompactAfterPercentPatch, reapplyNullableProviderHeadersPatch, reapplyContextEditCompactionPatch];
const names = ["compact-after-percent", "nullable-provider-headers", "context-edit-compaction"];
const affected = [
  ["src/core/unified-config.ts", "src/om/model-budget.ts", "src/commands/memory.ts", "package.json"],
  ["src/om/runtime.ts", "src/om/provider-stream.ts", ...["observer", "reflector", "dropper"].map((stage) => `src/om/agents/${stage}/agent.ts`)],
  ["src/hooks/before-compact.ts"],
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function snapshot(root) {
  const result = {};
  function visit(path, rel = "") {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) result[rel] = `link:${readlinkSync(path)}:${stat.mtimeNs}`;
    else if (stat.isDirectory()) {
      result[rel] = `directory:${stat.mtimeNs}`;
      for (const name of readdirSync(path).sort()) visit(join(path, name), rel ? `${rel}/${name}` : name);
    } else result[rel] = `${hash(readFileSync(path))}:${stat.mtimeNs}`;
  }
  visit(root);
  return result;
}
function extract(bytes, target) {
  assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, integrity);
  const tar = gunzipSync(bytes);
  const seen = new Set();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0");
    assert.equal(header[345], 0);
    assert.ok(name.startsWith("package/"));
    const rel = name.slice(8);
    assert.ok(rel && !rel.split("/").some((part) => ["", ".."].includes(part)));
    assert.ok(!seen.has(rel));
    seen.add(rel);
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(seen.size, 132);
}
function edits(version, name) {
  const source = readFileSync(join(here, `reapply-${name}-patch-${version}.mjs`), "utf8");
  const start = source.indexOf(name === "context-edit-compaction" ? "const rel =" : "const patches =");
  return JSON.parse(JSON.stringify(vm.runInNewContext(source.slice(start, source.indexOf("function sha256")) + "\npatches")));
}

test("focused isolated pi-blackhole@0.5.10 three-patch gate", async (t) => {
  assert.ok(process.env.TMPDIR && isAbsolute(process.env.TMPDIR), "set an explicit disposable TMPDIR");
  assert.equal(realpathSync(tmpdir()), realpathSync(process.env.TMPDIR));
  const tarball = process.env.PI_BLACKHOLE_0_5_10_TARBALL;
  assert.ok(tarball && isAbsolute(tarball), "set PI_BLACKHOLE_0_5_10_TARBALL");
  const root = mkdtempSync(join(realpathSync(tmpdir()), "blackhole-0.5.10-port-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stock = join(root, "stock");
  extract(readFileSync(tarball), stock);
  const manifest = JSON.parse(readFileSync(join(stock, "package.json")));
  assert.equal(manifest.version, "0.5.10");
  assert.deepEqual(manifest.pi.extensions, ["./dist/index.js"]);
  const clone = (from) => {
    const target = join(mkdtempSync(join(root, "case-")), "package");
    cpSync(from, target, { recursive: true });
    return target;
  };
  const states = [stock];
  for (let i = 0; i < helpers.length; i++) {
    await t.test(`${names[i]}: exact old transformations, intended writes, idempotence`, () => {
      const oldEdits = edits("0.5.9", names[i]);
      const newEdits = edits("0.5.10", names[i]);
      const transformations = (specs) => i === 2 ? specs : specs.map(({ rel, edits }) => ({ rel, edits }));
      assert.deepEqual(transformations(newEdits), transformations(oldEdits));
      const target = clone(states[i]);
      const before = snapshot(target);
      assert.match(helpers[i](target), /^patched:/);
      const after = snapshot(target);
      assert.deepEqual(Object.keys(after).filter((rel) => before[rel] !== after[rel]).sort(), [...affected[i]].sort());
      assert.match(helpers[i](target), /^already patched:/);
      assert.deepEqual(snapshot(target), after, "second pass must preserve all bytes and mtimes");
      states.push(target);
    });
  }
  await t.test("combined second pass and manifest preserve stock dependencies and bundle", () => {
    const target = states[3], before = snapshot(target);
    for (const apply of helpers) assert.match(apply(target), /^already patched:/);
    assert.deepEqual(snapshot(target), before);
    assert.deepEqual(JSON.parse(readFileSync(join(target, "package.json"))), { ...manifest, pi: { ...manifest.pi, extensions: ["./index.ts"] } });
    assert.deepEqual(readFileSync(join(target, "dist/index.js")), readFileSync(join(stock, "dist/index.js")));
  });
  for (let i = 0; i < helpers.length; i++) {
    await t.test(`${names[i]}: version, drift, partial state and links reject before writes`, () => {
      const reject = (prepare, pattern = /Drifted|drifted|Mixed|partial|unlinked|exactly/) => {
        const target = clone(states[i]);
        prepare(target);
        const before = snapshot(target);
        assert.throws(() => helpers[i](target), pattern);
        assert.deepEqual(snapshot(target), before);
      };
      reject((target) => {
        const path = join(target, "package.json");
        writeFileSync(path, readFileSync(path, "utf8").replace('"version": "0.5.10"', '"version": "0.5.9"'));
      });
      reject((target) => {
        const path = join(target, affected[i].filter((rel) => rel.endsWith(".ts")).at(-1));
        writeFileSync(path, readFileSync(path, "utf8") + "\n// drift\n");
      });
      reject((target) => {
        const rel = affected[i][0];
        let source = readFileSync(join(target, rel), "utf8");
        const spec = edits("0.5.10", names[i]);
        const [oldText, newText] = i === 2 ? spec[0] : spec[0].edits[0];
        source = source.replace(oldText, newText);
        writeFileSync(join(target, rel), source);
      });
      for (const kind of ["symlink", "hardlink", "parent"]) reject((target) => {
        const rel = affected[i][0], path = join(target, rel), saved = join(target, "saved");
        if (kind === "parent") {
          cpSync(join(target, "src"), saved, { recursive: true });
          rmSync(join(target, "src"), { recursive: true });
          symlinkSync(saved, join(target, "src"));
        } else {
          cpSync(path, saved);
          rmSync(path);
          if (kind === "symlink") symlinkSync(saved, path);
          else linkSync(saved, path);
        }
      });
      const linked = join(root, `linked-${i}`);
      symlinkSync(states[i], linked);
      assert.throws(() => helpers[i](linked), /non-isolated/);
      assert.throws(() => helpers[i](), /explicit isolated/);
      const dependencyTarget = join(root, `deps-${i}`, "node_modules", "pi-blackhole");
      mkdirSync(dirname(dependencyTarget), { recursive: true });
      cpSync(states[i], dependencyTarget, { recursive: true });
      const before = snapshot(dependencyTarget);
      assert.throws(() => helpers[i](dependencyTarget), /non-isolated/);
      assert.deepEqual(snapshot(dependencyTarget), before);
      if (i > 0) assert.throws(() => helpers[i](stock), /percentage candidate first/);
    });
  }
});
