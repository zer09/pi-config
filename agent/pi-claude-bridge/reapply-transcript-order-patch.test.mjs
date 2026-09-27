// Run: node --test agent/pi-claude-bridge/reapply-transcript-order-patch.test.mjs
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import dns from "node:dns";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { stripTypeScriptTypes, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import tls from "node:tls";
import { gunzipSync } from "node:zlib";
import { PATCHED_SHA256, STOCK_SHA256, reapplyTranscriptOrderPatch } from "./reapply-transcript-order-patch.mjs";

const archiveIntegrity = "CaSXdCdMWLGcvvG4IZuKeyUIyLio2m8nEO7cUFZdxKPdkwWuf8Eq46Ys2z3VlSjCidlIpasLwiCdJStXSt6EZQ==";
const archiveHex = Buffer.from(archiveIntegrity, "base64").toString("hex");
// Read only this public package blob from the original cache, never its config or credentials.
const archivePath = process.env.PI_CLAUDE_BRIDGE_TEST_TARBALL ?? join(homedir(), ".npm", "_cacache", "content-v2", "sha512",
  archiveHex.slice(0, 2), archiveHex.slice(2, 4), archiveHex.slice(4));
const sha256 = (source) => createHash("sha256").update(source).digest("hex");

function isolate(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-bridge-reapply-"));
  const env = { ...process.env };
  const cwd = process.cwd();
  for (const name of Object.keys(process.env)) delete process.env[name];
  for (const name of ["home", "agent", "cache", "config", "claude", "tmp", "workspace", "bin"]) mkdirSync(join(root, name));
  Object.assign(process.env, {
    HOME: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "agent"),
    XDG_CACHE_HOME: join(root, "cache"), XDG_CONFIG_HOME: join(root, "config"),
    CLAUDE_CONFIG_DIR: join(root, "claude"), TMPDIR: join(root, "tmp"), PATH: join(root, "bin"),
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  });
  process.chdir(join(root, "workspace"));
  writeFileSync(join(root, "agent", "settings.json"), JSON.stringify({ cacheWarming: "off" }));
  const attempts = [];
  const block = (label) => () => { attempts.push(label); throw new Error(`Offline fixture blocked ${label}`); };
  for (const [target, names] of [
    [childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
    [http, ["request", "get"]], [https, ["request", "get"]], [http2, ["connect"]],
    [net, ["connect", "createConnection"]], [net.Socket.prototype, ["connect"]],
    [tls, ["connect"]], [dgram.Socket.prototype, ["connect", "send"]],
    [dns, ["lookup", "resolve"]], [dns.promises, ["lookup", "resolve"]],
    [globalThis, ["fetch", "WebSocket"]],
  ]) {
    for (const name of names) t.mock.method(target, name, block(name));
  }
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    process.chdir(cwd);
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, env);
    rmSync(root, { recursive: true, force: true });
    assert.deepEqual(attempts, [], "no network, browser, or subprocess attempts");
  });
  return root;
}

function publishedFiles(root) {
  const cached = join(root, "cache", "pi-claude-bridge-0.8.0.tgz");
  copyFileSync(archivePath, cached);
  const archive = readFileSync(cached);
  assert.equal(createHash("sha512").update(archive).digest("base64"), archiveIntegrity, "exact offline published tarball");
  const tar = gunzipSync(archive);
  const files = new Map();
  // This hash-pinned npm tarball has only regular files. No npm, tar process, or install scripts run.
  for (let offset = 0; offset < tar.length && tar[offset];) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, "");
    const size = Number.parseInt(header.subarray(124, 136).toString(), 8);
    assert.equal(header[156], 48, "regular tar entry");
    assert.ok(name.startsWith("package/") && !name.split("/").includes(".."));
    files.set(name.slice("package/".length), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(JSON.parse(files.get("package.json")).version, "0.8.0");
  assert.equal(sha256(files.get("src/transcript.ts")), STOCK_SHA256);
  return files;
}

function installFixture(files, packageRoot) {
  for (const [name, bytes] of files) {
    const path = join(packageRoot, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}

function snapshot(packageRoot) {
  return Object.fromEntries(readdirSync(packageRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [path.slice(packageRoot.length + 1), sha256(readFileSync(path))];
    }).sort(([a], [b]) => a.localeCompare(b)));
}

test("guarded 0.8.0 patch from the clean offline published package", async (t) => {
  const root = isolate(t);
  const files = publishedFiles(root);
  const packageRoot = join(root, "agent", "npm", "node_modules", "pi-claude-bridge");
  installFixture(files, packageRoot);
  const target = join(packageRoot, "src", "transcript.ts");
  const manifestPath = join(packageRoot, "package.json");
  const stock = readFileSync(target, "utf8");
  const before = snapshot(packageRoot);
  let patched;

  await t.test("changes only transcript.ts and compiles the focused source", async () => {
    assert.equal(reapplyTranscriptOrderPatch(packageRoot), "patched");
    patched = readFileSync(target, "utf8");
    assert.equal(sha256(patched), PATCHED_SHA256);
    assert.deepEqual(snapshot(packageRoot), { ...before, "src/transcript.ts": PATCHED_SHA256 });
    const compile = async (source) => import("data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source, { mode: "transform" })));
    const original = await compile(stock);
    const fixed = await compile(patched);
    const messages = [{ role: "system", content: "", sections: { preamble: "P", addendum: "A", cwd: "C" } },
      { role: "system", content: "", sections: { addendum: null } },
      { role: "system", content: "", sections: { addendum: "A2", vendor_one: "X", vendor_two: "Y" } }];
    assert.equal(original.toBridgeContext({ messages }).systemPrompt, "P\n\nA2\n\nX\n\nY\n\nC");
    assert.equal(fixed.toBridgeContext({ messages }).systemPrompt, "P\n\nA2\n\nC\n\nX\n\nY");
  });

  await t.test("reapplication is byte-idempotent and does not rewrite the file", () => {
    utimesSync(target, 1, 1);
    const beforeStat = statSync(target, { bigint: true });
    assert.equal(reapplyTranscriptOrderPatch(packageRoot), "already patched");
    assert.equal(readFileSync(target, "utf8"), patched);
    const afterStat = statSync(target, { bigint: true });
    assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs);
    assert.equal(afterStat.ctimeNs, beforeStat.ctimeNs);
    assert.deepEqual(snapshot(packageRoot), { ...before, "src/transcript.ts": PATCHED_SHA256 });
  });

  await t.test("offline reinstall restores stock, then reapplies identical bytes", () => {
    rmSync(packageRoot, { recursive: true });
    installFixture(files, packageRoot);
    assert.deepEqual(snapshot(packageRoot), before);
    assert.equal(reapplyTranscriptOrderPatch(packageRoot), "patched");
    assert.equal(readFileSync(target, "utf8"), patched);
    assert.deepEqual(snapshot(packageRoot), { ...before, "src/transcript.ts": PATCHED_SHA256 });
  });

  await t.test("stock drift, patched drift, and a partial patch fail without writes", () => {
    for (const drift of [stock + "\n", patched + "\n", stock.replace("?? predecessorRank", "?? Number.MAX_SAFE_INTEGER")]) {
      writeFileSync(target, drift);
      const drifted = snapshot(packageRoot);
      assert.throws(() => reapplyTranscriptOrderPatch(packageRoot), /source drift/);
      assert.deepEqual(snapshot(packageRoot), drifted);
    }
  });

  await t.test("package name and version guards run even on already-patched bytes", () => {
    const manifest = JSON.parse(files.get("package.json"));
    for (const source of [stock, patched]) {
      writeFileSync(target, source);
      for (const change of [{ version: "0.8.1" }, { version: "0.7.0" }, { name: "other-package" }]) {
        writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...change }));
        const incompatible = snapshot(packageRoot);
        assert.throws(() => reapplyTranscriptOrderPatch(packageRoot), /Expected pi-claude-bridge 0\.8\.0/);
        assert.deepEqual(snapshot(packageRoot), incompatible);
      }
    }
  });
});
