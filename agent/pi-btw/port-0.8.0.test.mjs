import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { reapplyModelRuntimePatch } from "./reapply-model-runtime-patch-0.8.0.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const integrity = "sha512-vOelcQM1l2CjBPVfa6oBs4vgd11t4sZ+VqE5KCVjEPkKWbW3Qn7iS5bHWFFrf53r7nsC5WRvqlWWx7ZR6MdSKA==";
const archive = process.env.PI_BTW_0_8_0_TARBALL;
assert.ok(archive && isAbsolute(archive), "Supply the separately acquired, SRI-pinned pi-btw@0.8.0 archive");
assert.ok(process.env.TMPDIR && isAbsolute(process.env.TMPDIR), "Supply a disposable OS TMPDIR");
const hostRoot = process.env.PI_BTW_HOST_ROOT;
assert.ok(hostRoot && isAbsolute(hostRoot), "Bind explicitly to the isolated target host");
const require = createRequire(join(hostRoot, "package.json"));
const ts = require("typescript");
assert.equal(ts.version, "6.0.3");
const manifest = JSON.parse(readFileSync(join(hostRoot, "package.json")));
assert.equal(manifest.name, "@earendil-works/pi-coding-agent");
assert.equal(manifest.version, "1.4.0");
const pi = await import(join(hostRoot, "dist/index.js"));
const ai = await import(join(hostRoot, "../../@earendil-works/pi-ai/dist/index.js"));
const stockCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey);";
const patchedCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey, { signal: ctx.signal });";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function snapshot(root) {
  const result = {};
  function visit(path, rel = "") {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) result[rel] = { link: readlinkSync(path), mtime: stat.mtimeNs };
    else if (stat.isDirectory()) {
      result[rel] = { directory: true, mtime: stat.mtimeNs };
      for (const name of readdirSync(path).sort()) visit(join(path, name), rel ? `${rel}/${name}` : name);
    } else result[rel] = { bytes: readFileSync(path), mtime: stat.mtimeNs };
  }
  visit(root);
  return result;
}

function extract(bytes, target) {
  // Verify BEFORE decompressing or writing anything. No download or installer runs here.
  assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, integrity);
  const tar = gunzipSync(bytes);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0");
    assert.equal(header[345], 0);
    assert.ok(name.startsWith("package/"));
    const rel = name.slice(8);
    assert.ok(rel && !rel.split("/").some((part) => ["", ".", ".."].includes(part)));
    assert.equal(files.has(rel), false);
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    files.set(rel, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(files.size, 8);
  for (const [rel, content] of files) {
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), content);
  }
}

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), "pi-btw-0.8.0-port-"));
  assert.equal(statSync(root).mode & 0o777, 0o700);
  const packageRoot = join(root, "package");
  extract(readFileSync(archive), packageRoot);
  try { return check(packageRoot, root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function failWithoutWrites(root, pattern) {
  const before = snapshot(root);
  assert.throws(() => reapplyModelRuntimePatch(root), pattern);
  assert.deepEqual(snapshot(root), before, "refusal preserves every byte and mtime");
}

function compile(source, startText, endText, expression, bindings) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(code + `\n${expression}`, bindings);
}

function runtimeOptions(source, ModelRuntime) {
  return compile(source, "async function createBtwModelRuntimeOptions(", "\nfunction hasResolvedAuthValues", "createBtwModelRuntimeOptions", { ModelRuntime });
}

test("SRI refusal precedes all extraction writes", () => {
  fixture((_package, root) => {
    const before = snapshot(root);
    const bytes = Buffer.from(readFileSync(archive));
    bytes[0] ^= 1;
    assert.throws(() => extract(bytes, join(root, "bad-sri")));
    assert.deepEqual(snapshot(root), before);
  });
});

test("clean application, reinstall, full fingerprints and byte/mtime idempotence", () => {
  fixture((root) => {
    const before = snapshot(root);
    const source = before["extensions/btw.ts"].bytes.toString();
    assert.equal(source.split(stockCall).length - 1, 1, "stock 0.8.0 still omits the signal");
    assert.equal(source.includes(patchedCall), false);
    assert.match(reapplyModelRuntimePatch(root), /^patched:/);
    const after = snapshot(root);
    assert.equal(after["extensions/btw.ts"].bytes.toString(), source.replace(stockCall, patchedCall));
    assert.equal(hash(after["extensions/btw.ts"].bytes), "5a499821b7893bc866db88d056062746e7e6fc05c89e86b1456af897909b4d2e");
    for (const rel of Object.keys(before)) if (rel !== "extensions/btw.ts") assert.deepEqual(after[rel], before[rel]);
    assert.match(reapplyModelRuntimePatch(root), /^already patched:/);
    assert.deepEqual(snapshot(root), after);
    extract(readFileSync(archive), root);
    assert.equal(readFileSync(join(root, "extensions/btw.ts"), "utf8"), source);
    assert.match(reapplyModelRuntimePatch(root), /^patched:/);
    const reinstalled = snapshot(root);
    for (const rel of Object.keys(after)) assert.deepEqual(reinstalled[rel].bytes, after[rel].bytes);
    assert.match(reapplyModelRuntimePatch(root), /^already patched:/);
    assert.deepEqual(snapshot(root), reinstalled);
  });
});

test("wrong identity/version, all-file drift, missing/extra files and partial anchors refuse before writing", () => {
  for (const [field, value] of [["name", "other"], ["version", "0.7.1"], ["version", "0.8.1"]]) {
    fixture((root) => {
      const path = join(root, "package.json");
      const pkg = JSON.parse(readFileSync(path));
      pkg[field] = value;
      writeFileSync(path, JSON.stringify(pkg));
      failWithoutWrites(root, /Expected exactly/);
    });
  }
  fixture((root) => {
    writeFileSync(join(root, "package.json"), "{malformed");
    failWithoutWrites(root, /JSON|property/);
  });
  for (const patched of [false, true]) {
    fixture((stock, parent) => {
      const files = Object.entries(snapshot(stock)).filter(([, value]) => value.bytes).map(([rel]) => rel);
      for (const rel of files) {
        const root = join(parent, "drift-" + files.indexOf(rel));
        cpSync(stock, root, { recursive: true });
        if (patched) reapplyModelRuntimePatch(root);
        const path = join(root, rel);
        writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("\n")]));
        failWithoutWrites(root, /Drifted file/);
      }
    });
    for (const extra of [false, true]) fixture((root) => {
      if (patched) reapplyModelRuntimePatch(root);
      if (extra) writeFileSync(join(root, "unexpected.ts"), "unexpected");
      else rmSync(join(root, "extensions/btw-ssh-workspace.ts"));
      failWithoutWrites(root, /whole-package inventory/);
    });
  }
  for (const replacement of ["", stockCall + "\n" + stockCall, stockCall + "\n" + patchedCall, patchedCall + "\n" + patchedCall, patchedCall.replace("ctx.signal", "undefined")]) {
    fixture((root) => {
      const path = join(root, "extensions/btw.ts");
      writeFileSync(path, readFileSync(path, "utf8").replace(stockCall, replacement));
      failWithoutWrites(root, /patch anchor|Drifted file/);
    });
  }
});

test("implicit, linked/shared, repository, temp-root, outside-temp and node_modules targets refuse", () => {
  assert.throws(() => reapplyModelRuntimePatch(), /explicit isolated/);
  assert.throws(() => execFileSync(process.execPath, [join(here, "reapply-model-runtime-patch-0.8.0.mjs")], { stdio: "pipe" }));
  for (const path of [join(here, "../.."), tmpdir(), "/usr"]) assert.throws(() => reapplyModelRuntimePatch(path), /non-isolated/);
  fixture((root, parent) => {
    const link = join(parent, "linked");
    symlinkSync(root, link);
    assert.throws(() => reapplyModelRuntimePatch(link), /non-isolated/);
    const target = join(parent, "node_modules", "pi-btw");
    cpSync(root, target, { recursive: true });
    failWithoutWrites(target, /non-isolated/);
  });
  for (const patched of [false, true]) for (const rel of ["extensions/btw.ts", "README.md"]) {
    for (const kind of ["symlink", "hardlink", "parent"]) fixture((root, parent) => {
      if (patched) reapplyModelRuntimePatch(root);
      const path = join(root, rel);
      const moved = join(parent, "moved");
      if (kind === "parent") {
        renameSync(join(root, "extensions"), moved);
        symlinkSync(moved, join(root, "extensions"));
      } else {
        renameSync(path, moved);
        if (kind === "symlink") symlinkSync(moved, path);
        else linkSync(moved, path);
      }
      failWithoutWrites(root, /unlinked regular file/);
    });
  }
});

test("stock ignores cancellation; patched target credential synchronization receives the exact signal and cancels while pending", { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-btw-target-cancel-"));
  try {
    const packageRoot = join(root, "package");
    extract(readFileSync(archive), packageRoot);
    for (const patched of [false, true]) {
      if (patched) reapplyModelRuntimePatch(packageRoot);
      const source = readFileSync(join(packageRoot, "extensions/btw.ts"), "utf8");
      const controller = new AbortController();
      const reason = new Error("synthetic pending credential cancellation");
      let entered, release;
      const pending = new Promise((resolve) => { entered = resolve; });
      const released = new Promise((resolve) => { release = resolve; });
      let refreshStarted = 0, refreshAborted = 0, settled = false, callOptions;
      const provider = {
        id: "offline-credential-cancel", name: "Offline credential cancellation",
        auth: { apiKey: { name: "Synthetic key", async resolve({ credential }) {
          return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
        } } },
        getModels: () => [],
        async refreshModels({ credential, signal, allowNetwork }) {
          assert.equal(allowNetwork, false);
          if (credential?.key !== "synthetic-key") return;
          refreshStarted++;
          assert.equal(signal.aborted, false);
          entered();
          await new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => { refreshAborted++; reject(signal.reason); }, { once: true });
            released.then(resolve);
          });
        },
        stream() { throw new Error("No inference permitted"); },
        streamSimple() { throw new Error("No inference permitted"); },
      };
      const createOptions = runtimeOptions(source, { async create(options) {
        assert.equal(options.allowModelNetwork, false);
        const runtime = await pi.ModelRuntime.create({ ...options, credentials: new ai.InMemoryCredentialStore(), modelsPath: null, modelsStorePath: join(root, `models-${patched}.json`) });
        const setKey = runtime.setRuntimeApiKey.bind(runtime);
        runtime.setRuntimeApiKey = (id, key, options) => {
          callOptions = options;
          return setKey(id, key, options);
        };
        return runtime;
      } });
      const ctx = {
        signal: controller.signal,
        modelRegistry: {
          getRegisteredNativeProvider: () => provider, getRegisteredProviderConfig: () => undefined,
          getProviderAuthStatus: () => ({ source: "runtime" }),
          getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic-key" }),
        },
      };
      const operation = createOptions(ctx, { provider: provider.id });
      operation.then(() => { settled = true; }, () => { settled = true; });
      try {
        await pending;
        assert.equal(settled, false, "abort occurs during credential synchronization");
        if (patched) assert.equal(callOptions.signal, controller.signal);
        else assert.equal(callOptions, undefined, "stock passes no signal");
        controller.abort(reason);
        if (patched) {
          await assert.rejects(operation, (error) => error.name === "CredentialSynchronizationError" && error.operation === "setRuntimeApiKey" && error.cause === reason);
          assert.equal(refreshAborted, 1);
        } else {
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(settled, false, "stock remains pending after the command is cancelled");
          assert.equal(refreshAborted, 0);
          release();
          await operation;
        }
        assert.equal(refreshStarted, 1);
      } finally { release(); await operation.catch(() => {}); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inherited toolsAdded/toolsRemoved are stripped without changing canonical parent content; defaults remain empty/local", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-btw-defaults-"));
  try {
    extract(readFileSync(archive), root);
    const source = readFileSync(join(root, "extensions/btw.ts"), "utf8");
    const seed = compile(source, "const BTW_TOOLS_BY_MODE:", "\nfunction formatToolPreview", "buildBtwSeedState", {
      buildSessionContext: pi.buildSessionContext, isVisibleBtwMessage: () => false,
    });
    const manager = pi.SessionManager.inMemory();
    manager.appendMessage({ role: "system", content: "parent system", sections: { fixture: "retained" }, toolsAdded: [{ name: "delegate_to_pi", description: "parent only", parameters: {} }], timestamp: 1 });
    manager.appendMessage({ role: "user", content: "parent kept", timestamp: 2 });
    manager.appendMessage({ role: "system", content: "later system", toolsAdded: [{ name: "parent_extra", description: "parent only", parameters: {} }], toolsRemoved: [{ name: "read" }], timestamp: 3 });
    const before = structuredClone(manager.getEntries());
    const canonical = manager.buildSessionContext().messages;
    const expected = canonical.map(({ toolsAdded, toolsRemoved, ...message }) => message);
    for (const mode of ["contextual", "readonly"]) {
      const result = seed({ sessionManager: manager }, [], mode, null);
      assert.deepEqual(JSON.parse(JSON.stringify(result.messages)), expected);
      assert.equal(result.sideThreadStartIndex, canonical.length);
      assert.ok(result.messages.every((message) => !Object.hasOwn(message, "toolsAdded") && !Object.hasOwn(message, "toolsRemoved")));
    }
    assert.deepEqual(manager.getEntries(), before, "raw parent entries are unchanged");
    const exports = {};
    const config = ts.transpileModule(readFileSync(join(root, "extensions/btw-extension-tools.ts"), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    runInNewContext(config, { exports, require: (name) => name === "@earendil-works/pi-coding-agent" ? {} : require(name) });
    const agentDir = join(root, "agent"), cwd = join(root, "workspace");
    mkdirSync(agentDir); mkdirSync(cwd);
    for (const projectTrusted of [false, true]) {
      const options = { cwd, agentDir, projectTrusted };
      assert.equal(JSON.stringify(await exports.readBtwExtensionSources(options)), "[]");
      assert.equal(await exports.readBtwWorkspaceMode(options), "local");
    }
    assert.deepEqual(readdirSync(agentDir), [], "no BTW install or configuration was created");
    assert.deepEqual(readdirSync(cwd), [], "no project configuration was created");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
