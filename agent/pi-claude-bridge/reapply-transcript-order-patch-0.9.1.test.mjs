// Run with explicit offline archive and PI_BRIDGE_TEST_NODE_MODULES under isolated TMPDIR.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import dns from "node:dns";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { stripTypeScriptTypes, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { PATCHED_SHA256, STOCK_SHA256, reapplyTranscriptOrderPatch } from "./reapply-transcript-order-patch-0.9.1.mjs";

const archiveIntegrity = "ysKygf8sZOae+mhkKsFd567F7iZUB+1pDCYlQ2WK8h2z+7wJI//LJYofDdhZ8rv7M+k1H/BeFJ/d9w2EuN1j5A==";
const archivePath = process.env.PI_CLAUDE_BRIDGE_0_9_1_TARBALL;
const modules = process.env.PI_BRIDGE_TEST_NODE_MODULES;
assert.ok(archivePath && modules, "supply explicit disposable archive and node_modules; no live defaults");
const piAi = pathToFileURL(join(modules, "@earendil-works/pi-ai/dist/index.js")).href;
assert.equal(JSON.parse(readFileSync(join(modules, "@earendil-works/pi-ai/package.json"))).version, "0.99.2");
const sha256 = (source) => createHash("sha256").update(source).digest("hex");

function isolate(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-bridge-0.9.1-reapply-"));
  const env = { ...process.env }, cwd = process.cwd();
  for (const name of Object.keys(process.env)) delete process.env[name];
  for (const name of ["home", "agent", "cache", "config", "claude", "tmp", "workspace", "bin"]) mkdirSync(join(root, name));
  Object.assign(process.env, {
    HOME: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "agent"),
    XDG_CACHE_HOME: join(root, "cache"), XDG_CONFIG_HOME: join(root, "config"),
    CLAUDE_CONFIG_DIR: join(root, "claude"), TMPDIR: join(root, "tmp"), PATH: join(root, "bin"),
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  });
  process.chdir(join(root, "workspace"));
  const attempts = [];
  const block = (label) => () => { attempts.push(label); throw new Error(`Offline fixture blocked ${label}`); };
  for (const [target, names] of [
    [childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
    [http, ["request", "get"]], [https, ["request", "get"]], [http2, ["connect"]],
    [net, ["connect", "createConnection"]], [net.Socket.prototype, ["connect"]],
    [tls, ["connect"]], [dgram.Socket.prototype, ["connect", "send"]],
    [dns, ["lookup", "resolve"]], [dns.promises, ["lookup", "resolve"]],
    [globalThis, ["fetch", "WebSocket"]],
  ]) for (const name of names) t.mock.method(target, name, block(name));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports(); process.chdir(cwd);
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, env); rmSync(root, { recursive: true, force: true });
    assert.deepEqual(attempts, [], "no network, browser, or subprocess attempts");
  });
  return root;
}

function publishedFiles() {
  const archive = readFileSync(archivePath);
  assert.equal(createHash("sha512").update(archive).digest("base64"), archiveIntegrity, "exact offline published tarball");
  const tar = gunzipSync(archive), files = new Map();
  for (let offset = 0; offset < tar.length && tar[offset];) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, "");
    const size = Number.parseInt(header.subarray(124, 136).toString(), 8);
    assert.equal(header[156], 48, "regular tar entry");
    assert.ok(name.startsWith("package/") && !name.split("/").includes(".."));
    files.set(name.slice(8), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(JSON.parse(files.get("package.json")).version, "0.9.1");
  assert.equal(files.size, 23);
  assert.equal(sha256(files.get("src/transcript.ts")), STOCK_SHA256);
  return files;
}
function installFixture(files, root) {
  for (const [rel, bytes] of files) {
    const path = join(root, rel); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
  }
}
function snapshot(root) {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const path = join(e.parentPath, e.name);
    const stat = statSync(path, { bigint: true });
    return [path.slice(root.length + 1), { hash: sha256(readFileSync(path)), mtime: String(stat.mtimeNs) }];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

test("guarded 0.9.1 patch from the clean offline published package", async (t) => {
  const root = isolate(t), files = publishedFiles(), packageRoot = join(root, "tmp", "bridge");
  installFixture(files, packageRoot);
  const target = join(packageRoot, "src/transcript.ts"), manifestPath = join(packageRoot, "package.json");
  const stock = readFileSync(target, "utf8"), before = snapshot(packageRoot);
  let patched;
  await t.test("changes only transcript.ts and loads the focused source with public Pi utilities", async () => {
    assert.equal(reapplyTranscriptOrderPatch(packageRoot), "patched");
    patched = readFileSync(target, "utf8"); assert.equal(sha256(patched), PATCHED_SHA256);
    const after = snapshot(packageRoot);
    assert.deepEqual(after, { ...before, "src/transcript.ts": after["src/transcript.ts"] });
    const compile = async source => import("data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(
      source.replace('from "@earendil-works/pi-ai"', `from ${JSON.stringify(piAi)}`), { mode: "transform" },
    )));
    const original = await compile(stock), fixed = await compile(patched);
    const messages = [{ role: "system", content: "", timestamp: 1, sections: { preamble: "P", addendum: "A", cwd: "C" } },
      { role: "system", content: "", timestamp: 2, sections: { addendum: null } },
      { role: "system", content: "", timestamp: 3, sections: { addendum: "A2", vendor_one: "X", vendor_two: "Y" } }];
    assert.equal(original.toBridgeContext({ messages }).systemPrompt, "P\n\nA2\n\nX\n\nY\n\nC");
    assert.equal(fixed.toBridgeContext({ messages }).systemPrompt, "P\n\nA2\n\nC\n\nX\n\nY");
  });
  await t.test("repeat preserves bytes, mtime and ctime", () => {
    utimesSync(target, 1, 1); const beforeStat = statSync(target, { bigint: true }), beforeRepeat = snapshot(packageRoot);
    assert.equal(reapplyTranscriptOrderPatch(packageRoot), "already patched");
    assert.equal(readFileSync(target, "utf8"), patched);
    const afterStat = statSync(target, { bigint: true });
    assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs); assert.equal(afterStat.ctimeNs, beforeStat.ctimeNs);
    assert.deepEqual(snapshot(packageRoot), beforeRepeat);
  });
  await t.test("offline reinstall restores stock and reapplies identical bytes", () => {
    rmSync(packageRoot, { recursive: true }); installFixture(files, packageRoot);
    assert.equal(sha256(readFileSync(target)), STOCK_SHA256);
    assert.equal(reapplyTranscriptOrderPatch(packageRoot), "patched");
    assert.equal(readFileSync(target, "utf8"), patched);
  });
  await t.test("stock drift, patched drift and partial patch reject before writes", () => {
    for (const drift of [stock + "\n", patched + "\n", stock.replace("?? predecessorRank", "?? Number.MAX_SAFE_INTEGER")]) {
      writeFileSync(target, drift); const beforeDrift = snapshot(packageRoot);
      assert.throws(() => reapplyTranscriptOrderPatch(packageRoot), /source drift/);
      assert.deepEqual(snapshot(packageRoot), beforeDrift);
    }
  });
  await t.test("name and version guards run on stock and patched bytes", () => {
    const manifest = JSON.parse(files.get("package.json"));
    for (const source of [stock, patched]) {
      writeFileSync(target, source);
      for (const change of [{ version: "0.9.0" }, { version: "0.9.2" }, { name: "other-package" }]) {
        writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...change })); const incompatible = snapshot(packageRoot);
        assert.throws(() => reapplyTranscriptOrderPatch(packageRoot), /Expected pi-claude-bridge 0\.9\.1/);
        assert.deepEqual(snapshot(packageRoot), incompatible);
      }
    }
  });
  await t.test("no default, installed, linked or shared target is accepted", () => {
    writeFileSync(manifestPath, files.get("package.json")); writeFileSync(target, stock);
    assert.throws(() => reapplyTranscriptOrderPatch(), /explicit isolated/);
    assert.throws(() => reapplyTranscriptOrderPatch(modules), /non-isolated/);
    const alias = join(root, "tmp", "alias"); symlinkSync(packageRoot, alias);
    assert.throws(() => reapplyTranscriptOrderPatch(alias), /non-isolated/);
    const linked = join(root, "tmp", "shared.ts"); linkSync(target, linked);
    const beforeShared = snapshot(packageRoot);
    assert.throws(() => reapplyTranscriptOrderPatch(packageRoot), /unlinked regular file/);
    assert.deepEqual(snapshot(packageRoot), beforeShared);
    rmSync(linked); rmSync(target); symlinkSync(join(root, "tmp", "missing.ts"), target);
    assert.throws(() => reapplyTranscriptOrderPatch(packageRoot), /unlinked regular file/);
  });
});
