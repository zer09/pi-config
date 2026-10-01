import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { reapplyModelRuntimePatch } from "./reapply-model-runtime-patch-0.7.0.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const stock = process.env.PI_BTW_0_7_0_STOCK;
assert.ok(stock, "Supply an isolated SRI-verified pi-btw@0.7.0 stock fixture");
const stockCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey);";
const patchedCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey, { signal: ctx.signal });";

function snapshot(root) {
  const result = {};
  function visit(dir, prefix = "") {
    for (const name of readdirSync(dir)) {
      const rel = prefix + name;
      const path = join(dir, name);
      const stat = statSync(path, { bigint: true });
      if (stat.isDirectory()) visit(path, rel + "/");
      else result[rel] = { bytes: readFileSync(path), mtime: stat.mtimeNs };
    }
  }
  visit(root);
  return result;
}

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), "pi-btw-0.7.0-port-"));
  const packageRoot = join(root, "package");
  cpSync(stock, packageRoot, { recursive: true });
  try { return check(packageRoot, root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function failWithoutWrites(root, pattern) {
  const before = snapshot(root);
  assert.throws(() => reapplyModelRuntimePatch(root), pattern);
  assert.deepEqual(snapshot(root), before, "failure must preserve all bytes and mtimes");
}

test("changes only the runtime credential call and performs no writes on the second pass", () => {
  fixture((root) => {
    const before = snapshot(root);
    assert.match(reapplyModelRuntimePatch(root), /^patched:/);
    const after = snapshot(root);
    assert.equal(after["extensions/btw.ts"].bytes.toString(), before["extensions/btw.ts"].bytes.toString().replace(stockCall, patchedCall));
    for (const rel of Object.keys(before)) {
      if (rel !== "extensions/btw.ts") assert.deepEqual(after[rel], before[rel]);
    }
    assert.match(reapplyModelRuntimePatch(root), /^already patched:/);
    assert.deepEqual(snapshot(root), after, "idempotence includes mtimes");
  });
});

test("fails closed on wrong name/version and stock or patched source drift", () => {
  for (const [field, value] of [["name", "other"], ["version", "0.6.1"], ["version", "0.7.1"]]) {
    fixture((root) => {
      const path = join(root, "package.json");
      const pkg = JSON.parse(readFileSync(path));
      pkg[field] = value;
      writeFileSync(path, JSON.stringify(pkg));
      failWithoutWrites(root, /Expected exactly/);
    });
  }
  for (const patched of [false, true]) {
    for (const rel of ["package.json", "extensions/btw.ts", "extensions/btw-extension-tools.ts"]) {
      fixture((root) => {
        if (patched) reapplyModelRuntimePatch(root);
        const path = join(root, rel);
        writeFileSync(path, readFileSync(path, "utf8") + "\n");
        failWithoutWrites(root, /Drifted file/);
      });
    }
  }
  for (const replacement of ["", stockCall + "\n" + stockCall, stockCall + "\n" + patchedCall]) {
    fixture((root) => {
      const path = join(root, "extensions/btw.ts");
      writeFileSync(path, readFileSync(path, "utf8").replace(stockCall, replacement));
      failWithoutWrites(root, /patch anchor/);
    });
  }
});

test("rejects implicit, linked, shared and node_modules targets", () => {
  assert.throws(() => reapplyModelRuntimePatch(), /explicit isolated/);
  assert.throws(() => execFileSync(process.execPath, [join(here, "reapply-model-runtime-patch-0.7.0.mjs")], { stdio: "pipe" }));
  fixture((root, parent) => {
    const link = join(parent, "linked");
    symlinkSync(root, link);
    assert.throws(() => reapplyModelRuntimePatch(link), /non-isolated/);
    linkSync(join(root, "extensions/btw.ts"), join(parent, "shared.ts"));
    failWithoutWrites(root, /unlinked regular file/);
  });
  fixture((root, parent) => {
    const target = join(parent, "node_modules", "pi-btw");
    cpSync(root, target, { recursive: true });
    failWithoutWrites(target, /non-isolated/);
  });
});

test("the patched runtime credential sync receives and obeys the command cancellation signal", async () => {
  const require = createRequire(join(process.env.PI_BTW_PACKAGE_ROOT, "package.json"));
  const ts = require("typescript");
  const source = readFileSync(join(stock, "extensions/btw.ts"), "utf8").replace(stockCall, patchedCall);
  const start = source.indexOf("async function createBtwModelRuntimeOptions(");
  const end = source.indexOf("\nfunction hasResolvedAuthValues", start);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const controller = new AbortController();
  const events = [];
  const nativeProvider = { id: "offline-native" };
  const runtime = {
    registerNativeProvider(provider) { assert.equal(provider, nativeProvider); events.push("register"); },
    async refresh(options) { assert.equal(options.allowNetwork, false); events.push("refresh"); },
    async setRuntimeApiKey(provider, key, options) {
      assert.equal(provider, "offline-native");
      assert.equal(key, "synthetic-key");
      assert.equal(options.signal, controller.signal);
      events.push("credentials");
      await new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        controller.abort(new Error("synthetic credential cancellation"));
      });
    },
  };
  const createOptions = runInNewContext(compiled + "\ncreateBtwModelRuntimeOptions", {
    ModelRuntime: { async create(options) { assert.equal(options.allowModelNetwork, false); events.push("create"); return runtime; } },
  });
  const ctx = {
    signal: controller.signal,
    modelRegistry: {
      getRegisteredNativeProvider: () => nativeProvider,
      getRegisteredProviderConfig: () => undefined,
      getProviderAuthStatus: () => ({ source: "runtime" }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic-key" }),
    },
  };
  await assert.rejects(createOptions(ctx, { provider: "offline-native" }), /synthetic credential cancellation/);
  assert.deepEqual(events, ["create", "register", "refresh", "credentials"]);
  assert.equal(controller.signal.aborted, true);
});

test("real Pi 0.99.2 credential synchronization cancels an offline native provider refresh", { timeout: 10_000 }, async () => {
  const require = createRequire(join(process.env.PI_BTW_PACKAGE_ROOT, "package.json"));
  const ts = require("typescript");
  const hostRoot = join(dirname(process.env.PI_BTW_PACKAGE_ROOT), "@earendil-works", "pi-coding-agent");
  assert.equal(JSON.parse(readFileSync(join(hostRoot, "package.json"))).version, "0.99.2");
  const { ModelRuntime } = await import(join(hostRoot, "dist", "index.js"));
  const root = mkdtempSync(join(tmpdir(), "pi-btw-credential-cancel-"));
  try {
    const packageRoot = join(root, "package");
    cpSync(stock, packageRoot, { recursive: true });
    reapplyModelRuntimePatch(packageRoot);
    const source = readFileSync(join(packageRoot, "extensions/btw.ts"), "utf8");
    const start = source.indexOf("async function createBtwModelRuntimeOptions(");
    const end = source.indexOf("\nfunction hasResolvedAuthValues", start);
    assert.ok(start >= 0 && end > start);
    const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const controller = new AbortController();
    const reason = new Error("synthetic native refresh cancellation");
    let refreshStarted = 0;
    let refreshAborted = 0;
    const nativeProvider = {
      id: "offline-credential-cancel",
      name: "Offline credential cancellation",
      auth: { apiKey: { name: "Synthetic key", async resolve({ credential }) {
        return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
      } } },
      getModels: () => [],
      async refreshModels({ credential, signal, allowNetwork }) {
        assert.equal(allowNetwork, false);
        if (credential?.key !== "synthetic-key") return;
        refreshStarted++;
        assert.equal(signal.aborted, false);
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => { refreshAborted++; reject(signal.reason); }, { once: true });
          controller.abort(reason);
        });
      },
      stream() { throw new Error("No inference permitted"); },
      streamSimple() { throw new Error("No inference permitted"); },
    };
    const createOptions = runInNewContext(compiled + "\ncreateBtwModelRuntimeOptions", {
      ModelRuntime: { async create(options) {
        assert.equal(options.allowModelNetwork, false);
        return ModelRuntime.create({ ...options, authPath: join(root, "auth.json"), modelsPath: null, modelsStorePath: join(root, "models-cache.json") });
      } },
    });
    const ctx = {
      signal: controller.signal,
      modelRegistry: {
        getRegisteredNativeProvider: () => nativeProvider,
        getRegisteredProviderConfig: () => undefined,
        getProviderAuthStatus: () => ({ source: "runtime" }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic-key" }),
      },
    };
    await assert.rejects(createOptions(ctx, { provider: nativeProvider.id }), (error) =>
      error.name === "CredentialSynchronizationError" && error.operation === "setRuntimeApiKey" && error.cause === reason,
      "credential cancellation must propagate through the real runtime");
    assert.equal(refreshStarted, 1);
    assert.equal(refreshAborted, 1);
    assert.equal(controller.signal.aborted, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
