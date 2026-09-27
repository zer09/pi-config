import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import { gunzipSync } from "node:zlib";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.9.mjs";
import { reapplyNullableProviderHeadersPatch } from "./reapply-nullable-provider-headers-patch-0.5.9.mjs";

// Uses a separately acquired registry-SRI-verified archive. No install or acquisition.
// Run: node --experimental-vm-modules --test --test-isolation=none <this-file>
// Override PI_BLACKHOLE_0_5_9_TARBALL only with an identical verified archive.
const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const tarballPath = process.env.PI_BLACKHOLE_0_5_9_TARBALL ??
  "/tmp/pi-blackhole-0.5.9-increment1-aqrwBx/pi-blackhole-0.5.9.tgz";
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../..");
const installed = join(repository, "agent/npm/node_modules/pi-blackhole");
const globalModules = "/home/gc/.bun/install/global/node_modules";
const ts = createRequire(import.meta.url)(join(globalModules, "typescript/lib/typescript.js"));
const stages = ["observer", "reflector", "dropper"];
const workerFiles = stages.map((stage) => `src/om/agents/${stage}/agent.ts`);
const affected = ["src/om/runtime.ts", "src/om/provider-stream.ts", ...workerFiles];
const percentageFiles = ["package.json", "src/core/unified-config.ts", "src/om/model-budget.ts", "src/commands/memory.ts"];
const prerequisites = [...percentageFiles, "index.ts", "src/om/compaction-trigger.ts"];
const read = (root, rel) => readFileSync(join(root, rel), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const denied = () => assert.fail("isolated runtime side effect denied");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function snapshot(root, includeWriteTimes = false) {
  const files = {};
  function visit(path, rel) {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) {
      files[rel] = `link:${readlinkSync(path)}`;
    } else if (stat.isDirectory()) {
      files[rel] = "directory";
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${rel}/${name}`);
    } else {
      files[rel] = digest(readFileSync(path));
      if (includeWriteTimes) files[rel] += `:${stat.mtimeNs}:${stat.ctimeNs}`;
    }
  }
  visit(root, "");
  return files;
}

function protectedSnapshot() {
  const paths = [
    installed,
    join(repository, "agent/settings.json"),
    join(here, "pi-blackhole-config.json"),
    ...readdirSync(here).filter((name) => /\.(mjs|md)$/.test(name) &&
      !name.startsWith("reapply-nullable-provider-headers-patch-0.5.9."))
      .sort().map((name) => join(here, name)),
  ];
  return Object.fromEntries(paths.map((path) => [path, snapshot(path)]));
}

function stockArchive(tarball) {
  assert.equal(`sha512-${createHash("sha512").update(tarball).digest("base64")}`, registryIntegrity,
    "tarball must match the pinned npm registry SRI before extraction");
  // This exact archive has only ordinary files, with no links or tar extensions.
  const tar = gunzipSync(tarball);
  const files = new Map();
  for (let offset = 0; tar[offset];) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0");
    assert.equal(header[345], 0);
    assert.ok(name.startsWith("package/"));
    const rel = name.slice("package/".length);
    assert.ok(rel && !rel.split("/").some((part) => part === ".." || part === ""));
    assert.ok(!files.has(rel));
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    files.set(rel, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(files.size, 132);
  return files;
}

// Execute the five actual patched source modules, but never Pi, a provider SDK,
// a session, or credential storage. Unknown imports (including subprocess/network
// builtins) and dynamic imports are denied. The VM receives an empty environment.
async function loadRuntime(root) {
  const requests = [];
  const loops = [];
  const context = createContext({
    process: Object.freeze({ env: Object.freeze({}) }),
    URL, AbortController,
    fetch: denied, WebSocket: denied, setTimeout: denied, clearTimeout: denied,
  }, { codeGeneration: { strings: false, wasm: false } });
  const modules = new Map();
  function mock(id, values) {
    modules.set(id, new SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context, identifier: id }));
  }
  const fakeRequest = (model, ctx, options) => {
    requests.push({ model, ctx, options });
    return "fake-request";
  };
  const fakeLoop = (_prompts, ctx, config, signal, streamFn) => {
    loops.push({ config, signal });
    assert.equal(streamFn(config.model, ctx, config), "fake-request");
    return { async *[Symbol.asyncIterator]() {}, async result() {} };
  };
  mock("src/om/config.ts", { DEFAULTS: { sessionFallback: true }, loadConfig: denied });
  mock("src/om/cooldown.ts", {
    isCooldownActive: () => false, recordCooldown: denied, expireCooldowns: denied,
    modelKey: (model) => `${model.provider}/${model.id}`,
    sanitizeCooldownReason: denied, getCooldownEntry: denied,
  });
  mock("src/om/retryable-error.ts", { isDeterministicError: denied });
  mock("src/om/pending.ts", { readPendingCursors: denied, writePendingCursors: denied });
  mock("src/om/debug-log.ts", { debugLog() {} });
  mock("@earendil-works/pi-agent-core", { agentLoop: fakeLoop });
  mock("@earendil-works/pi-ai/compat", { streamSimple: fakeRequest });
  mock("typebox", { Type: Object.fromEntries(
    ["Union", "Literal", "Object", "Array", "Optional", "Boolean", "String"].map((name) => [name, () => ({})]),
  ) });
  mock("src/om/agents/agent-context.ts", { buildAgentContext: (system, tools) => ({ system, tools }) });
  mock("src/om/agents/turn-cap.ts", { createTurnCap: denied });
  mock("src/om/ids.ts", { hashId: denied });
  mock("src/om/model-budget.ts", { AGENT_LOOP_MAX_TOKENS: 1024, boundedMaxTokens: () => 1024 });
  mock("src/om/serialize.ts", { nowTimestamp: denied, truncateRecordContent: denied });
  mock("src/om/tokens.ts", { estimateStringTokens: denied });
  for (const stage of stages) {
    mock(`src/om/agents/${stage}/prompts.ts`, { [`${stage.toUpperCase()}_SYSTEM`]: stage });
  }
  mock("src/om/ledger/index.ts", {
    observationToSummaryLine: () => "fixture observation", reflectionToSummaryLine: () => "fixture reflection",
  });
  mock("src/om/agents/dropper/coverage.ts", {
    REFLECTION_COVERAGE_DROP_RANK: { none: 0 }, coverageTierForObservation: () => "none",
    observationToDropperLine: () => "fixture observation", reflectionCoverageMap: () => new Map(),
    summarizeCoverageByRelevance: () => ({}), summarizeCoverageByRelevanceForIds: () => ({}),
  });
  for (const rel of affected) {
    modules.set(rel, new SourceTextModule(ts.transpileModule(read(root, rel), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText, { context, identifier: rel, importModuleDynamically: denied }));
  }
  const linker = (specifier, parent) => {
    let id = specifier;
    if (specifier.startsWith(".")) {
      id = posix.join(posix.dirname(parent.identifier), specifier).replace(/\.js$/, ".ts");
    }
    assert.ok(modules.has(id), `unexpected isolated import: ${id}`);
    return modules.get(id);
  };
  for (const rel of affected) {
    const module = modules.get(rel);
    if (module.status === "unlinked") await module.link(linker);
    await module.evaluate();
  }
  // Prove the denial hooks, not just the absence of real inference in the fixtures.
  assert.throws(() => context.fetch("https://fixture.invalid"), /side effect denied/);
  assert.deepEqual(Object.keys(context.process.env), []);
  for (const id of ["node:child_process", "node:http", "node:fs"]) {
    assert.throws(() => linker(id, { identifier: "probe" }), /unexpected isolated import/);
  }
  return {
    Runtime: modules.get(affected[0]).namespace.Runtime,
    provider: modules.get(affected[1]).namespace,
    workers: workerFiles.map((rel, index) => modules.get(rel).namespace[
      `run${stages[index][0].toUpperCase()}${stages[index].slice(1)}`
    ]),
    requests, loops,
  };
}

function typeDiagnostics(root) {
  // Compile the actual header/env/cache field declarations, not handwritten copies.
  // Compile all of provider-stream.ts too, including its nullable post-auth seam.
  const virtual = new Map();
  const declarations = [];
  for (const [rel, name, fields] of [
    [affected[0], "ResolvedModelBase", ["headers", "env"]],
    ...stages.map((stage, index) => [workerFiles[index],
      `Run${stage[0].toUpperCase()}${stage.slice(1)}Args`, ["headers", "env", "cacheRetention"]]),
  ]) {
    const parsed = ts.createSourceFile(rel, read(root, rel), ts.ScriptTarget.Latest, true);
    const node = parsed.statements.find((item) => ts.isInterfaceDeclaration(item) && item.name.text === name);
    assert.ok(node, name);
    const members = node.members.filter((item) => fields.includes(item.name?.getText(parsed)));
    assert.equal(members.length, fields.length);
    declarations.push(`interface ${name} { ${members.map((item) => item.getText(parsed)).join("\n")} }`);
  }
  const fixture = join(root, "header-contract.ts");
  const providerFile = join(root, "provider-contract.ts");
  virtual.set(providerFile, read(root, affected[1]));
  virtual.set(fixture, `
import type { ProviderHeaders, CacheRetention } from "@earendil-works/pi-ai";
import { withProviderAttributionHeaders, createAttributionTransform, type AttributionTransform } from "./provider-contract.js";
${declarations.join("\n")}
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Check<T extends true> = T;
type RuntimeHeaders = Check<Equal<ResolvedModelBase["headers"], ProviderHeaders | undefined>>;
type ObserverHeaders = Check<Equal<RunObserverArgs["headers"], ProviderHeaders | undefined>>;
type ReflectorHeaders = Check<Equal<RunReflectorArgs["headers"], ProviderHeaders | undefined>>;
type DropperHeaders = Check<Equal<RunDropperArgs["headers"], ProviderHeaders | undefined>>;
type MergeHeaders = Check<Equal<ReturnType<typeof withProviderAttributionHeaders>, ProviderHeaders | undefined>>;
type PostAuthInput = Check<Equal<Parameters<AttributionTransform>[0], ProviderHeaders>>;
type PostAuthOutput = Check<Equal<Awaited<ReturnType<AttributionTransform>>, ProviderHeaders>>;
const resolved: ResolvedModelBase = { headers: { remove: null, keep: "value" }, env: { REGION: "fixture" } };
const observer: RunObserverArgs = { ...resolved, cacheRetention: "long" };
const reflector: RunReflectorArgs = { ...resolved, cacheRetention: "short" };
const dropper: RunDropperArgs = { ...resolved, cacheRetention: "none" };
withProviderAttributionHeaders({ provider: "opencode" }, resolved.headers, "fixture");
createAttributionTransform({}, "fixture", (headers: ProviderHeaders) => ({ ...headers, remove: null }));
const transform = createAttributionTransform({}, "fixture", async (headers: ProviderHeaders) => ({ ...headers, remove: null }));
transform({ keep: "string", remove: null });
// @ts-expect-error ProviderHeaders values must remain strings or null
transform({ bad: 123 });
// @ts-expect-error callback results must also contain only strings or null
createAttributionTransform({}, "fixture", () => ({ bad: true }));
// @ts-expect-error a string-only callback cannot accept null deletion markers
createAttributionTransform({}, "fixture", (headers: Record<string, string>) => headers);
// @ts-expect-error nullable does not mean arbitrary header values
const invalid: RunObserverArgs = { headers: { bad: 123 } };
// @ts-expect-error CacheRetention must not become any or a generic string
const invalidCache: RunDropperArgs = { cacheRetention: "invalid" };
void [observer, reflector, dropper, invalid, invalidCache];
`);
  const options = {
    noEmit: true, strict: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    paths: { "@earendil-works/pi-ai": [join(globalModules, "@earendil-works/pi-ai/dist/index.d.ts")] },
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  host.readFile = (path) => virtual.get(path) ?? originalRead(path);
  host.fileExists = (path) => virtual.has(path) || originalExists(path);
  const program = ts.createProgram([fixture, providerFile], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    file: diagnostic.file?.fileName, code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
}

test("isolated pi-blackhole@0.5.9 nullable ProviderHeaders candidate", async (t) => {
  const protectedBefore = protectedSnapshot();
  assert.equal(JSON.parse(read(installed, "package.json")).version, "0.5.8");
  const root = mkdtempSync(join(realpathSync(tmpdir()), "pi-blackhole-0.5.9-nullable-test-"));
  t.after(() => {
    try {
      assert.deepEqual(protectedSnapshot(), protectedBefore,
        "installed 0.5.8, settings, config, earlier helpers/tests/docs, and increment 1 must remain byte-identical");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const tarball = readFileSync(tarballPath);
  const files = stockArchive(tarball);
  const stockRoot = join(root, "stock");
  for (const [rel, bytes] of files) {
    mkdirSync(dirname(join(stockRoot, rel)), { recursive: true });
    writeFileSync(join(stockRoot, rel), bytes);
  }
  const stockBefore = snapshot(stockRoot);
  const stockPackage = JSON.parse(read(stockRoot, "package.json"));
  assert.equal(stockPackage.name, "pi-blackhole");
  assert.equal(stockPackage.version, "0.5.9");
  assert.deepEqual(stockPackage.pi.extensions, ["./dist/index.js"]);
  function candidate(from) {
    const target = join(mkdtempSync(join(root, "case-")), "package");
    cpSync(from, target, { recursive: true });
    return target;
  }
  function rejects(target, expected = /Mixed|Drifted|Expected|ENOENT|non-isolated/) {
    const before = snapshot(root, true);
    assert.throws(() => reapplyNullableProviderHeadersPatch(target), expected);
    assert.deepEqual(snapshot(root, true), before, "rejection must change zero bytes and zero file write times");
    // Only remove this test's disposable copies, never its reference fixtures.
    if (typeof target === "string" && target.startsWith(join(root, "case-")) &&
        ![percentRoot, patchedRoot].includes(target)) rmSync(dirname(target), { recursive: true, force: true });
  }
  const percentRoot = candidate(stockRoot);
  assert.match(reapplyCompactAfterPercentPatch(percentRoot), /^patched:/);
  const percentBefore = snapshot(percentRoot);
  assert.deepEqual(Object.keys(percentBefore).filter((key) => percentBefore[key] !== stockBefore[key]).sort(),
    percentageFiles.map((rel) => `/${rel}`).sort());
  const patchedRoot = candidate(percentRoot);

  await t.test("applies exactly five header files after increment 1; second pass performs no writes", () => {
    assert.deepEqual(JSON.parse(read(percentRoot, "package.json")).pi.extensions, ["./index.ts"]);
    assert.match(reapplyNullableProviderHeadersPatch(patchedRoot), /^patched:/);
    const patched = snapshot(patchedRoot);
    assert.deepEqual(Object.keys(patched).filter((key) => patched[key] !== percentBefore[key]).sort(),
      affected.map((rel) => `/${rel}`).sort());
    const before = snapshot(patchedRoot, true);
    assert.match(reapplyNullableProviderHeadersPatch(patchedRoot), /^already patched:/);
    assert.deepEqual(snapshot(patchedRoot, true), before);
  });

  await t.test("actual nullable declarations compile; stock fails; post-auth transform accepts nullable headers", () => {
    assert.deepEqual(typeDiagnostics(patchedRoot), []);
    const stockErrors = typeDiagnostics(percentRoot);
    assert.ok(stockErrors.some((error) => error.code === 2344), "stock header contracts must fail exact type compatibility");
    assert.ok(stockErrors.some((error) => error.message.includes("null")), "stock must reject null deletion markers");
    const runtime = read(patchedRoot, affected[0]);
    assert.equal(runtime.split("headers: auth.headers,").length - 1, 2);
    assert.doesNotMatch(runtime, /headers: auth\.headers as (?:any|Record<string, string>)/);
    const providerStream = read(patchedRoot, affected[1]);
    assert.match(providerStream, /export type AttributionTransform = \(\s+headers: ProviderHeaders,\s+\) => ProviderHeaders \| Promise<ProviderHeaders>;/);
    assert.match(providerStream, /return async \(headers: ProviderHeaders\) =>/);
    assert.match(providerStream, /const attributed = withProviderAttributionHeaders\(model, headers, sessionId\) \?\? \{\};\s+if \(typeof next === "function"\) return \(await next\(attributed\)\) \?\? attributed;/);
    assert.doesNotMatch(providerStream, /post-auth string headers|withProviderAttributionHeaders\(model, headers, sessionId\) as/);
    for (const rel of workerFiles) {
      const worker = read(patchedRoot, rel);
      assert.match(worker, /import type \{\s+CacheRetention,\s+Message,\s+Model,\s+ModelThinkingLevel,\s+ProviderHeaders,/);
      assert.match(worker, /headers\?: ProviderHeaders;/);
      assert.match(worker, /env\?: Record<string, string>;/);
    }
  });

  await t.test("attribution preserves null overrides without mutating input; nullable transform chains", async () => {
    const { provider } = await loadRuntime(patchedRoot);
    const headers = Object.freeze({ remove: null, keep: "value", "x-opencode-client": null, "x-opencode-session": "caller" });
    assert.deepEqual(plain(provider.withProviderAttributionHeaders({ provider: "opencode" }, headers, "fixture")), headers);
    assert.equal(provider.withProviderAttributionHeaders({ provider: "unrelated" }, headers, "fixture"), headers);
    assert.equal(provider.withProviderAttributionHeaders({ provider: "opencode" }, headers, undefined), headers);
    assert.equal(provider.withProviderAttributionHeaders({}, undefined, "fixture"), undefined);
    assert.deepEqual(plain(provider.withProviderAttributionHeaders({ baseUrl: "https://opencode.ai/v1" }, undefined, "fixture")),
      { "x-opencode-session": "fixture", "x-opencode-client": "pi" });
    assert.equal(provider.withProviderAttributionHeaders({ baseUrl: "https://opencode.ai.evil.invalid" }, headers, "fixture"), headers);
    const postAuth = Object.freeze({ remove: null, keep: "post-auth", "x-opencode-client": null });
    let seen;
    const transform = provider.createAttributionTransform({ provider: "opencode" }, "fixture", async (value) => {
      seen = value;
      return { ...value, "x-opencode-session": null, chained: "yes" };
    });
    assert.deepEqual(plain(await transform(postAuth)), {
      "x-opencode-session": null, "x-opencode-client": null, remove: null, keep: "post-auth", chained: "yes",
    });
    assert.deepEqual(plain(seen), {
      "x-opencode-session": "fixture", "x-opencode-client": null, remove: null, keep: "post-auth",
    });
    for (const next of [undefined, null, () => undefined, async () => null]) {
      const fallback = provider.createAttributionTransform({ provider: "opencode" }, "fixture", next);
      assert.deepEqual(plain(await fallback(postAuth)), {
        "x-opencode-session": "fixture", "x-opencode-client": null, remove: null, keep: "post-auth",
      });
    }
    assert.equal(await provider.createAttributionTransform({}, "fixture", () => undefined)(postAuth), postAuth);
  });

  await t.test("both auth branches carry null headers, endpoint, env, and cache into every fake worker request", async () => {
    const { Runtime, workers, requests, loops } = await loadRuntime(patchedRoot);
    for (const branch of ["candidate", "session"]) {
      const runtime = new Runtime();
      runtime.config = { sessionFallback: true };
      runtime.consolidationPhase = "observer";
      const model = { provider: "fixture", id: branch, api: "fixture-api", baseUrl: "https://unresolved.invalid", reasoning: true };
      const headers = Object.freeze({ remove: null, keep: branch });
      const env = Object.freeze({ REGION: branch });
      const endpoint = `https://opencode.ai/${branch}`;
      const authCalls = [];
      let providerAuthCalls = 0;
      const registry = {
        find: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
        getApiKeyAndHeaders: async (selected) => {
          authCalls.push(selected);
          const auth = { ok: true, apiKey: "fixture-key", headers, env };
          // Exercise the direct endpoint and provider-auth endpoint paths too.
          if (branch === "session") auth.baseUrl = endpoint;
          return auth;
        },
        hasConfiguredAuth: () => true, isUsingOAuth: () => false,
        getProviderAuth: async (provider) => {
          assert.equal(provider, "fixture");
          providerAuthCalls++;
          return { auth: { baseUrl: endpoint } };
        },
      };
      const resolved = await runtime.resolveModel({
        model, modelRegistry: registry, hasUI: false,
        stageModel: branch === "candidate" ? { provider: model.provider, id: model.id } : undefined,
      });
      assert.equal(resolved.ok, true);
      assert.equal(resolved.source, branch);
      assert.equal(resolved.headers, headers);
      assert.equal(resolved.env, env);
      assert.equal(resolved.apiKey, "fixture-key");
      assert.equal(resolved.model.baseUrl, endpoint);
      assert.equal(model.baseUrl, "https://unresolved.invalid");
      assert.deepEqual(authCalls, [model]);
      assert.equal(providerAuthCalls, branch === "candidate" ? 1 : 0);
      for (const [index, run] of workers.entries()) {
        const signal = new AbortController().signal;
        const cacheRetention = ["long", "short", "none"][index];
        await run({
          ...resolved, sessionId: "fixture-session", cacheRetention, thinkingLevel: "low", signal,
          priorReflections: [], priorObservations: [], chunk: "fixture chunk", allowedSourceEntryIds: ["fixture-entry"],
          reflections: [], observations: [{ id: "fixture-observation", content: "fixture", timestamp: "2026-09-27 00:00", relevance: "low", tokenCount: 1000 }],
          budgetTokens: 100,
        });
        const { options, model: requestModel, ctx } = requests.at(-1);
        assert.equal(ctx.system, stages[index]);
        assert.equal(requestModel, resolved.model);
        assert.equal(loops.at(-1).config.headers, headers);
        assert.equal(loops.at(-1).signal, signal);
        assert.deepEqual(plain(options.headers), {
          "x-opencode-session": "fixture-session", "x-opencode-client": "pi", ...headers,
        });
        assert.equal(options.apiKey, "fixture-key");
        assert.equal(options.env, env);
        assert.equal(options.cacheRetention, cacheRetention);
        assert.equal(options.reasoning, "low");
        assert.equal(options.sessionId, "fixture-session");
        assert.equal(options.fetch, undefined);
        assert.deepEqual(plain(await options.transformHeaders(Object.freeze({
          "x-opencode-client": null, postAuth: "string", remove: null,
        }))), {
          "x-opencode-session": "fixture-session", "x-opencode-client": null, postAuth: "string", remove: null,
        });
      }
    }
    assert.equal(requests.length, 6, "both auth branches must reach all three worker boundaries");
  });

  await t.test("configured auth failures keep stage, fallback, base, session order and the session opt-out", async () => {
    const { Runtime } = await loadRuntime(patchedRoot);
    const chain = ["stage", "fallback", "base", "session"].map((id) => ({ provider: "fixture", id }));
    for (const sessionFallback of [true, false]) {
      const runtime = new Runtime();
      runtime.config = { model: chain[2], sessionFallback };
      const attempted = [];
      const result = await runtime.resolveModel({
        stageModel: chain[0], stageFallbacks: [chain[1]], model: chain[3], hasUI: false,
        modelRegistry: {
          find: (_provider, id) => chain.find((model) => model.id === id),
          getApiKeyAndHeaders: async (model) => {
            attempted.push(model.id);
            return { ok: model.id === "session", apiKey: "fixture-key", headers: { remove: null } };
          },
        },
      });
      assert.deepEqual(attempted, sessionFallback ? ["stage", "fallback", "base", "session"] : ["stage", "fallback", "base"]);
      assert.equal(result.ok, sessionFallback);
      if (sessionFallback) assert.equal(result.headers.remove, null);
    }
  });

  await t.test("requires explicit isolated targets, exact version, and the complete accepted percentage prerequisite", () => {
    for (const target of [undefined, "", " "]) rejects(target, /explicit isolated/);
    for (const target of [installed, repository]) rejects(target, /non-isolated/);
    rejects(join(root, "missing"), /ENOENT/);
    const alias = join(root, "alias");
    symlinkSync(patchedRoot, alias, "dir");
    rejects(alias, /non-isolated/);
    const moduleRoot = join(root, "node_modules/pi-blackhole");
    cpSync(stockRoot, moduleRoot, { recursive: true });
    rejects(moduleRoot, /non-isolated/);
    for (const change of [{ name: "other" }, { version: "0.5.8" }, { version: "0.5.10" }, { version: "0.5.9-beta" }]) {
      const target = candidate(percentRoot);
      writeFileSync(join(target, "package.json"), JSON.stringify({ ...stockPackage, ...change }));
      rejects(target, /Expected exactly pi-blackhole@0\.5\.9/);
    }
    rejects(candidate(stockRoot), /percentage candidate first/);
    const spoofed = candidate(stockRoot);
    writeFileSync(join(spoofed, "package.json"), read(percentRoot, "package.json"));
    rejects(spoofed, /Drifted percentage prerequisite/);
    for (const extensions of [undefined, [], ["./index.ts", "./dist/index.js"], "./index.ts"]) {
      const target = candidate(percentRoot);
      const pkg = JSON.parse(read(target, "package.json"));
      pkg.pi.extensions = extensions;
      writeFileSync(join(target, "package.json"), JSON.stringify(pkg));
      rejects(target, /percentage candidate first/);
    }
  });

  await t.test("missing and drifted files in either state reject with zero writes, including the last file", () => {
    for (const from of [percentRoot, patchedRoot]) {
      for (const rel of [...prerequisites, ...affected]) {
        const missing = candidate(from);
        unlinkSync(join(missing, rel));
        rejects(missing, /ENOENT/);
        const drifted = candidate(from);
        writeFileSync(join(drifted, rel), `${read(drifted, rel)}\n`);
        rejects(drifted);
      }
    }
  });

  await t.test("mixed files and partial or duplicate anchors reject without repairing either state", () => {
    for (const rel of affected) {
      for (const [from, other] of [[percentRoot, patchedRoot], [patchedRoot, percentRoot]]) {
        const target = candidate(from);
        writeFileSync(join(target, rel), read(other, rel));
        rejects(target, /Mixed/);
      }
    }
    // Every changed anchor, including the two separate auth return sites.
    const anchors = [
      [affected[0], 'import type { AuthResult }', 'import type { AuthResult, ProviderHeaders }'],
      [affected[0], '  headers?: Record<string, string>;', '  headers?: ProviderHeaders;'],
      [affected[0], 'headers: auth.headers as Record<string, string> | undefined,', 'headers: auth.headers,'],
      [affected[1], 'interface RegisteredProviderConfig {', 'import type { ProviderHeaders } from "@earendil-works/pi-ai";\n\ninterface RegisteredProviderConfig {'],
      [affected[1], '  headers: Record<string, string> | undefined,\n  sessionId: string | undefined,\n): Record<string, string> | undefined {',
        '  headers: ProviderHeaders | undefined,\n  sessionId: string | undefined,\n): ProviderHeaders | undefined {'],
      [affected[1], 'export type AttributionTransform = (\n  headers: Record<string, string>,\n) => Record<string, string> | Promise<Record<string, string>>;',
        'export type AttributionTransform = (\n  headers: ProviderHeaders,\n) => ProviderHeaders | Promise<ProviderHeaders>;'],
      [affected[1], '  return async (headers: Record<string, string>) => {', '  return async (headers: ProviderHeaders) => {'],
      ...workerFiles.flatMap((rel) => [
        [rel, 'import type { CacheRetention, Message, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";',
          'import type {\n  CacheRetention,\n  Message,\n  Model,\n  ModelThinkingLevel,\n  ProviderHeaders,\n} from "@earendil-works/pi-ai";'],
        [rel, '  headers?: Record<string, string>;', '  headers?: ProviderHeaders;'],
      ]),
    ];
    for (const [rel, stockAnchor, patchedAnchor] of anchors) {
      for (const [from, anchor, other] of [[percentRoot, stockAnchor, patchedAnchor], [patchedRoot, patchedAnchor, stockAnchor]]) {
        assert.ok(read(from, rel).includes(anchor), `${rel}: anchor must exist`);
        for (const replacement of [anchor + anchor, other]) {
          const target = candidate(from);
          writeFileSync(join(target, rel), read(target, rel).replace(anchor, replacement));
          rejects(target);
        }
      }
    }
  });

  await t.test("linked prerequisites, affected files, and parent directories cannot write through to shared data", () => {
    for (const rel of [...prerequisites, ...affected]) {
      for (const kind of ["symlink", "hardlink"]) {
        const target = candidate(percentRoot);
        const shared = join(mkdtempSync(join(root, "shared-")), "file");
        cpSync(join(target, rel), shared);
        unlinkSync(join(target, rel));
        if (kind === "hardlink") linkSync(shared, join(target, rel));
        else symlinkSync(shared, join(target, rel), "file");
        rejects(target, /unlinked regular file/);
        rmSync(dirname(shared), { recursive: true, force: true });
      }
    }
    const target = candidate(percentRoot);
    const shared = join(root, "shared-om");
    cpSync(join(target, "src/om"), shared, { recursive: true });
    rmSync(join(target, "src/om"), { recursive: true });
    symlinkSync(shared, join(target, "src/om"), "dir");
    rejects(target, /unlinked regular file/);
  });

  await t.test("corrupt tarball rejects before extraction; stock, percentage, and all protected files stay identical", () => {
    const corrupt = Buffer.from(tarball);
    corrupt[0] ^= 1;
    assert.throws(() => stockArchive(corrupt), /pinned npm registry SRI/);
    assert.deepEqual(snapshot(stockRoot), stockBefore);
    assert.deepEqual(snapshot(percentRoot), percentBefore);
    assert.deepEqual(protectedSnapshot(), protectedBefore);
  });
});
