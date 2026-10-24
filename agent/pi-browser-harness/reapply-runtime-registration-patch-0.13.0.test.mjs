import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import vm from "node:vm";
import { reapplyRuntimeRegistrationPatch as apply } from "./reapply-runtime-registration-patch-0.13.0.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const integrity = "sha512-RP0AK9RZJkkse4fQ4TQ1Tip5mAZVYAE2fmstowiGz4oT4mLlnbY8ecvXhEybiAgkTiIhHMLXSKE9T6imWi3cng==";
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
  visit(root);
  return result;
}
function extract(bytes, target) {
  assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, integrity);
  const tar = gunzipSync(bytes), seen = new Set();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0");
    assert.equal(header[345], 0);
    assert.ok(name.startsWith("package/"));
    const rel = name.slice(8);
    assert.ok(rel && !rel.split("/").some(part => ["", ".", ".."].includes(part)) && !isAbsolute(rel));
    assert.ok(!seen.has(rel)); seen.add(rel);
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(seen.size, 99);
}

test("guarded isolated Harness 0.13.0 artifact repair", async t => {
  assert.ok(process.env.TMPDIR && isAbsolute(process.env.TMPDIR));
  assert.equal(realpathSync(tmpdir()), process.env.TMPDIR);
  const archive = process.env.PI_TEST_HARNESS_TARBALL;
  assert.ok(archive && isAbsolute(archive));
  const root = mkdtempSync(join(tmpdir(), "harness-registration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stock = join(root, "stock");
  extract(readFileSync(archive), stock);
  const clone = (from = stock) => {
    const target = join(mkdtempSync(join(root, "case-")), "package");
    cpSync(from, target, { recursive: true }); return target;
  };
  const source = readFileSync(join(here, "reapply-runtime-registration-patch-0.13.0.mjs"), "utf8");
  const edits = vm.runInNewContext(source.slice(source.indexOf("const edits ="), source.indexOf("const sha256")) + "\nedits");
  let repaired;
  await t.test("SRI, 99-file first application, sole registry delta and byte/mtime idempotence", () => {
    repaired = clone();
    const before = snapshot(repaired);
    assert.match(apply(repaired), /^patched:/);
    const after = snapshot(repaired);
    assert.deepEqual(Object.keys(after).filter(rel => before[rel] !== after[rel]), ["src/registry.ts"]);
    assert.match(apply(repaired), /^already patched:/);
    assert.deepEqual(snapshot(repaired), after);
    const fresh = clone(); apply(fresh);
    assert.deepEqual(readFileSync(join(fresh, "src/registry.ts")), readFileSync(join(repaired, "src/registry.ts")));
    assert.deepEqual(JSON.parse(readFileSync(join(repaired, "package.json"))).pi.extensions, ["./src/index.ts"]);
  });
  const reject = (prepare, from = stock, pattern = /Drifted|drifted|partial|Mixed|unlinked|exactly|ENOENT|JSON|property|EACCES|empty directory/) => {
    const target = clone(from); prepare(target);
    const before = snapshot(target);
    assert.throws(() => apply(target), pattern);
    assert.deepEqual(snapshot(target), before, "refusal must preserve all bytes and mtimes");
  };
  await t.test("bad archive SRI refuses before extraction", () => {
    const bytes = Buffer.from(readFileSync(archive)); bytes[0] ^= 1;
    const target = join(root, "bad-sri"); mkdirSync(target);
    const before = snapshot(target);
    assert.throws(() => extract(bytes, target)); assert.deepEqual(snapshot(target), before);
  });
  await t.test("exact name/version and complete identity: every file drift and omission refuses", () => {
    for (const [before, after] of [['"0.13.0"', '"0.11.0"'], ['"pi-browser-harness"', '"other-package"']]) {
      reject(target => { const path = join(target, "package.json"); writeFileSync(path, readFileSync(path, "utf8").replace(before, after)); });
    }
    reject(target => writeFileSync(join(target, "package.json"), "{malformed"));
    const files = Object.keys(snapshot(stock)).filter(rel => !snapshot(stock)[rel].startsWith("directory:"));
    assert.equal(files.length, 99);
    for (const rel of files) {
      reject(target => { const path = join(target, rel); writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("\n")])); });
      reject(target => rmSync(join(target, rel)));
    }
    reject(target => writeFileSync(join(target, "extra.ts"), "unexpected"));
    reject(target => mkdirSync(join(target, "empty")), stock, /empty directory/);
    reject(target => writeFileSync(join(target, "README.md"), "drift"), repaired);
  });
  await t.test("partial anchors and patched drift refuse without finishing a partial repair", () => {
    for (const [before, after] of edits) {
      reject(target => { const path = join(target, "src/registry.ts"); writeFileSync(path, readFileSync(path, "utf8").replace(before, after)); });
      reject(target => { const path = join(target, "src/registry.ts"); writeFileSync(path, readFileSync(path, "utf8").replace(after, before)); }, repaired);
    }
    reject(target => { const path = join(target, "src/registry.ts"); writeFileSync(path, readFileSync(path, "utf8") + "\n"); }, repaired);
  });
  await t.test("all-write preflight: last identity file, unreadable destination and all linked files refuse", () => {
    reject(target => writeFileSync(join(target, "tsconfig.json"), "late drift"));
    reject(target => chmodSync(join(target, "src/registry.ts"), 0o444));
    const files = Object.keys(snapshot(stock)).filter(rel => !snapshot(stock)[rel].startsWith("directory:"));
    for (const rel of files) for (const kind of ["symlink", "hardlink"]) {
      reject(target => {
        const path = join(target, rel), saved = join(root, `saved-${Math.random()}`);
        cpSync(path, saved); rmSync(path);
        if (kind === "symlink") symlinkSync(saved, path); else linkSync(saved, path);
      });
    }
    reject(target => { const saved = join(root, "saved-src"); cpSync(join(target, "src"), saved, { recursive: true }); rmSync(join(target, "src"), { recursive: true }); symlinkSync(saved, join(target, "src")); });
    reject(target => { rmSync(join(target, "README.md")); mkdirSync(join(target, "README.md")); }, stock, /empty directory/);
  });
  await t.test("explicit canonical TMPDIR, repository, node_modules, root links and outside targets refuse", () => {
    const before = snapshot(stock);
    for (const value of [undefined, "", stock + "/../stock", "relative", root + "/", tmpdir(), join(here, "../.."), here]) assert.throws(() => apply(value));
    const linked = join(root, "linked"); symlinkSync(stock, linked); assert.throws(() => apply(linked), /non-isolated/);
    const deps = join(root, "node_modules", "pi-browser-harness"); cpSync(stock, deps, { recursive: true });
    const depsBefore = snapshot(deps); assert.throws(() => apply(deps), /non-isolated/); assert.deepEqual(snapshot(deps), depsBefore);
    const old = process.env.TMPDIR;
    delete process.env.TMPDIR; assert.throws(() => apply(stock), /non-isolated/);
    process.env.TMPDIR = join(root, "restricted"); mkdirSync(process.env.TMPDIR); assert.throws(() => apply(stock), /non-isolated/);
    process.env.TMPDIR = linked; assert.throws(() => apply(stock), /non-isolated/);
    // Even a broad TMPDIR must not make a repository target acceptable.
    process.env.TMPDIR = realpathSync(join(here, "../../.."));
    const repositoryBefore = snapshot(here);
    assert.throws(() => apply(here), /non-isolated/);
    assert.deepEqual(snapshot(here), repositoryBefore);
    process.env.TMPDIR = old;
    assert.deepEqual(snapshot(stock), before);
  });
});
