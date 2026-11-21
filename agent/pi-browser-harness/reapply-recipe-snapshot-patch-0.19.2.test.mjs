import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import vm from "node:vm";
import { reapplyRecipeSnapshotPatch as apply } from "./reapply-recipe-snapshot-patch-0.19.2.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const integrity = "sha512-WKMR65ovAwT3d18tyHi0yLlB2jpQ5H542gNoLN02IXrvXhDBqqtXrAIFqoJJfoGp6QPql6FqsLK+itYgKl/l9A==";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
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
  visit(root); return result;
}
export function extract(bytes, target) {
  assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, integrity);
  const tar = gunzipSync(bytes), seen = new Set();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512), name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0"); assert.equal(header[345], 0); assert.ok(name.startsWith("package/"));
    const rel = name.slice(8);
    assert.ok(rel && !rel.split("/").some(part => ["", ".", ".."].includes(part)) && !isAbsolute(rel));
    assert.ok(!seen.has(rel)); seen.add(rel);
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(seen.size, 128);
}
test("guarded isolated Harness 0.19.2 recipe snapshot repair", async t => {
  assert.ok(process.env.TMPDIR && isAbsolute(process.env.TMPDIR)); assert.equal(realpathSync(tmpdir()), process.env.TMPDIR);
  const archive = process.env.PI_TEST_HARNESS_TARBALL; assert.ok(archive && isAbsolute(archive));
  const root = mkdtempSync(join(tmpdir(), "harness-snapshot-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stock = join(root, "stock"); extract(readFileSync(archive), stock);
  const files = Object.entries(snapshot(stock)).filter(([, value]) => !value.startsWith("directory:")).map(([rel]) => rel);
  assert.equal(files.length, 128);
  const clone = (from = stock) => { const target = join(mkdtempSync(join(root, "case-")), "package"); cpSync(from, target, { recursive: true }); return target; };
  const source = readFileSync(join(here, "reapply-recipe-snapshot-patch-0.19.2.mjs"), "utf8");
  const edits = vm.runInNewContext(source.slice(source.indexOf("const edits ="), source.indexOf("const sha256")) + "\nedits");
  let repaired;
  await t.test("SRI, all 128 files, exact four-source delta, reinstall and bytes/mtime idempotence", () => {
    repaired = clone(); const before = snapshot(repaired); assert.match(apply(repaired), /^patched:/);
    const after = snapshot(repaired);
    assert.deepEqual(Object.keys(after).filter(rel => before[rel] !== after[rel]).sort(), Object.keys(edits).sort());
    assert.match(apply(repaired), /^already patched:/); assert.deepEqual(snapshot(repaired), after);
    const fresh = clone(); apply(fresh);
    for (const rel of files) assert.deepEqual(readFileSync(join(fresh, rel)), readFileSync(join(repaired, rel)));
    assert.deepEqual(JSON.parse(readFileSync(join(repaired, "package.json"))).pi.extensions, ["./src/index.ts"]);
  });
  const reject = (prepare, from = stock, pattern = /Drifted|drifted|partial|Mixed|unlinked|exactly|ENOENT|JSON|property|EACCES|empty directory/) => {
    const target = clone(from); prepare(target); const before = snapshot(target);
    assert.throws(() => apply(target), pattern); assert.deepEqual(snapshot(target), before, "refusal preserves all bytes and mtimes");
  };
  await t.test("archive SRI corruption refuses before extraction", () => {
    const bytes = Buffer.from(readFileSync(archive)); bytes[0] ^= 1;
    const target = join(root, "bad-sri"); mkdirSync(target); const before = snapshot(target);
    assert.throws(() => extract(bytes, target)); assert.deepEqual(snapshot(target), before);
  });
  await t.test("name, version, full inventory and every source/file drift or omission refuse", () => {
    for (const [before, after] of [['"0.19.2"', '"0.13.0"'], ['"pi-browser-harness"', '"other-package"']]) reject(target => {
      const path = join(target, "package.json"); writeFileSync(path, readFileSync(path, "utf8").replace(before, after));
    });
    reject(target => writeFileSync(join(target, "package.json"), "{malformed"));
    for (const rel of files) {
      reject(target => { const path = join(target, rel); writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("\n")])); });
      reject(target => rmSync(join(target, rel)));
    }
    reject(target => writeFileSync(join(target, "extra.ts"), "unexpected"));
    reject(target => mkdirSync(join(target, "empty")), stock, /empty directory/);
    reject(target => writeFileSync(join(target, "README.md"), "drift"), repaired);
  });
  await t.test("every partial anchor and mixed file state refuses, including repaired drift", () => {
    for (const [rel, changes] of Object.entries(edits)) {
      for (const [before, after] of changes) {
        reject(target => { const path = join(target, rel); writeFileSync(path, readFileSync(path, "utf8").replace(before, after)); });
        reject(target => { const path = join(target, rel); writeFileSync(path, readFileSync(path, "utf8").replace(after, before)); }, repaired);
      }
      reject(target => cpSync(join(repaired, rel), join(target, rel)));
      reject(target => cpSync(join(stock, rel), join(target, rel)), repaired);
      reject(target => { const path = join(target, rel); writeFileSync(path, readFileSync(path, "utf8") + "\n"); }, repaired);
    }
  });
  await t.test("all-write preflight: every unwritable destination, late drift and every linked file refuse", () => {
    reject(target => writeFileSync(join(target, "tsconfig.json"), "late drift"));
    for (const rel of Object.keys(edits)) reject(target => chmodSync(join(target, rel), 0o444));
    for (const rel of files) for (const kind of ["symlink", "hardlink"]) reject(target => {
      const path = join(target, rel), saved = join(root, `saved-${Math.random()}`);
      cpSync(path, saved); rmSync(path); if (kind === "symlink") symlinkSync(saved, path); else linkSync(saved, path);
    });
    reject(target => { const saved = join(root, "saved-src"); cpSync(join(target, "src"), saved, { recursive: true }); rmSync(join(target, "src"), { recursive: true }); symlinkSync(saved, join(target, "src")); });
  });
  await t.test("explicit canonical TMPDIR, outside/repository/node_modules and root links are guarded", () => {
    const before = snapshot(stock);
    for (const value of [undefined, "", stock + "/../stock", "relative", root + "/", tmpdir(), join(here, "../.."), here]) assert.throws(() => apply(value));
    const linked = join(root, "linked"); symlinkSync(stock, linked); assert.throws(() => apply(linked), /non-isolated/);
    const deps = join(root, "node_modules", "pi-browser-harness"); cpSync(stock, deps, { recursive: true });
    const depsBefore = snapshot(deps); assert.throws(() => apply(deps), /non-isolated/); assert.deepEqual(snapshot(deps), depsBefore);
    const old = process.env.TMPDIR;
    try {
      delete process.env.TMPDIR; assert.throws(() => apply(stock), /non-isolated/);
      process.env.TMPDIR = join(root, "restricted"); mkdirSync(process.env.TMPDIR); assert.throws(() => apply(stock), /non-isolated/);
      process.env.TMPDIR = linked; assert.throws(() => apply(stock), /non-isolated/);
      process.env.TMPDIR = realpathSync(join(here, "../../..")); const repoBefore = snapshot(here);
      assert.throws(() => apply(here), /non-isolated/); assert.deepEqual(snapshot(here), repoBefore);
    } finally { process.env.TMPDIR = old; }
    assert.deepEqual(snapshot(stock), before);
  });
});
