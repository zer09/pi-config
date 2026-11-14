import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run with Node's test runner inside an OS-network-denied sandbox. All bindings
// are explicit; this test never discovers Pi through PATH or a global install.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modules = process.env.PI_TEST_NODE_MODULES;
const compiler = process.env.PI_TEST_COMPILER_NODE_MODULES;
for (const root of [modules, compiler]) {
  assert.ok(root && isAbsolute(root), "Explicit isolated module/compiler roots required");
  assert.equal(fs.realpathSync(root), root);
  assert.ok(!root.startsWith("/home/gc/.bun/") && !root.startsWith("/home/gc/.pi/"));
}
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
assert.equal(process.env.PI_TEST_CHILD_NODE, process.execPath);
assert.equal(process.env.PI_DELEGATED_CHILD, undefined, "Test the parent registration, never a delegated child");
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const piRoot = join(modules, "@earendil-works/pi-coding-agent");
assert.equal(process.env.PI_TEST_CHILD_PI, join(piRoot, "dist/cli.js"));
for (const scope of ["@earendil-works", "@mariozechner"]) {
  for (const name of ["pi-ai", "pi-coding-agent", "pi-agent-core", "pi-tui"]) {
    assert.equal(json(join(modules, scope, name, "package.json")).version, "1.5.2", `${scope}/${name}`);
  }
}
assert.equal(json(join(modules, "typebox/package.json")).version, "1.3.27");
assert.equal(json(join(compiler, "typescript/package.json")).version, "6.0.3");
assert.equal(json(join(compiler, "@types/node/package.json")).version, "24.13.2");
for (const [name, version] of [["pi-blackhole", "0.5.15"], ["pi-btw", "0.8.0"], ["pi-browser-harness", "0.13.0"], ["pi-claude-bridge", "0.9.3"]]) {
  assert.equal(json(join(modules, name, "package.json")).version, version);
}

const forbidden = [];
const deny = name => () => {
  forbidden.push(name);
  throw new Error(`C2 transport forbidden: ${name}`);
};
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = deny(name);
childProcess.ChildProcess.prototype.spawn = deny("ChildProcess.spawn");
net.Socket.prototype.connect = deny("socket.connect");
net.Server.prototype.listen = deny("server.listen");
globalThis.fetch = deny("fetch");
globalThis.WebSocket = deny("WebSocket");
syncBuiltinESMExports();
after(() => assert.deepEqual(forbidden, [], "Even a swallowed transport attempt fails this suite"));

const entry = name => {
  const parts = name.split("/");
  const packageParts = name.startsWith("@") ? 2 : 1;
  const root = join(modules, ...parts.slice(0, packageParts));
  const subpath = parts.slice(packageParts).join("/");
  const manifest = json(join(root, "package.json"));
  const exported = manifest.exports?.[subpath ? `./${subpath}` : "."] ?? manifest.main;
  const file = fs.realpathSync(join(root, typeof exported === "string" ? exported : exported.import));
  assert.ok(!relative(modules, file).startsWith(".."), `Not an isolated host module: ${name}`);
  return pathToFileURL(file).href;
};
const ai = await import(entry("@earendil-works/pi-ai"));
const { Type } = await import(entry("typebox"));
const Value = await import(entry("typebox/value"));
const Format = await import(entry("typebox/format"));
const { loadExtensions } = await import(pathToFileURL(join(piRoot, "dist/core/extensions/loader.js")));
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
const alias = {};
for (const scope of ["@earendil-works", "@mariozechner"]) {
  for (const name of ["pi-coding-agent", "pi-agent-core", "pi-tui"]) alias[`${scope}/${name}`] = fileURLToPath(entry(`@earendil-works/${name}`));
  alias[`${scope}/pi-ai`] = join(piRoot, "dist/core/extensions/pi-ai-extension-view.js");
}
for (const subpath of ["compile", "value", "format"]) alias[`typebox/${subpath}`] = fileURLToPath(entry(`typebox/${subpath}`));
alias.typebox = fileURLToPath(entry("typebox"));
alias["@sinclair/typebox"] = alias.typebox;
const jiti = createJiti(import.meta.url, { alias, fsCache: false, moduleCache: false });
const local = (name, file) => jiti.import(join(repository, "agent/extensions", name, file));
const packageSource = (name, file) => jiti.import(join(modules, name, file));
const loaded = await loadExtensions([
  ...["delegated-pi-loop", "web-search", "github-ci"].map(name => join(repository, "agent/extensions", name, "index.ts")),
  // The target's checked example imports Type from pi-ai, exercising the real loader alias.
  join(piRoot, "examples/extensions/hello.ts"),
], process.cwd());
assert.deepEqual(loaded.errors, []);
const tools = new Map(loaded.extensions.flatMap(extension => [...extension.tools].map(([name, tool]) => [name, tool.definition])));
const sink = { registerTool(tool) { assert.ok(!tools.has(tool.name)); tools.set(tool.name, tool); } };
const { registerRecallTool } = await packageSource("pi-blackhole", "src/tools/recall.ts");
registerRecallTool(sink);
const { createToolRegistry } = await packageSource("pi-browser-harness", "src/registry.ts");
const fakeClient = new Proxy({}, { get: (_target, name) => deny(`browser client.${String(name)}`) });
createToolRegistry().register(sink, fakeClient);
const routing = await local("delegated-pi-loop", "routing.ts");
const resources = await local("delegated-pi-loop", "resources.ts");
const snapshot = routing.loadRoutingSnapshot();
const policy = resources.loadDelegateResources();
const contents = await local("web-search", "src/contents.ts");
const web = await local("web-search", "src/tools.ts");
const { setHeadersTool } = await packageSource("pi-browser-harness", "src/domains/headers.ts");
const tool = name => { assert.ok(tools.has(name), name); return tools.get(name); };
const call = (name, args, extra = {}) => ({ type: "toolCall", id: "c2", name, arguments: args, ...extra });
const validate = (name, args) => ai.validateToolArguments(tool(name), call(name, args));
const synthetic = (parameters, args) => ai.validateToolArguments({ name: "synthetic", parameters }, call("synthetic", args));
const decoded = (t, name, input, expected) => {
  const before = structuredClone(input);
  const actual = validate(name, input);
  assert.deepEqual(actual, expected);
  assert.deepEqual(input, before, "Validation must not rewrite transcript arguments");
  t.diagnostic(`decoded ${name}: ${JSON.stringify(actual)}`);
  return actual;
};

test("exact host: ordinary SDK exports differ from real loader aliases; direct TypeBox remains supported", async t => {
  assert.equal(ai.Type, undefined);
  assert.equal(typeof ai.validateToolArguments, "function");
  assert.deepEqual(synthetic(Type.Object({ count: Type.Integer() }), { count: "3" }), { count: 3 });
  const hello = tool("hello");
  const args = decoded(t, "hello", { name: 42 }, { name: "42" });
  assert.deepEqual((await hello.execute("c2", args)).details, { greeted: "42" });
  assert.deepEqual(ai.validateToolCall([hello], call("hello", { name: "reader" })), { name: "reader" });
  assert.throws(() => ai.validateToolCall([hello], call("missing", {})));
  assert.throws(() => ai.validateToolArguments(hello, call("hello", { name: "ok" }, { argumentsError: "malformed JSON" })));
});

test("direct SDK declarations reject removed Type re-export but accept direct TypeBox tools", async () => {
  const require = createRequire(import.meta.url);
  const ts = require(join(compiler, "typescript"));
  const filename = join(process.env.TMPDIR, "c2-direct-sdk.ts");
  const options = { noEmit: true, strict: true, skipLibCheck: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], paths: {
    "@earendil-works/pi-ai": [join(modules, "@earendil-works/pi-ai/dist/index.d.ts")],
    typebox: [join(modules, "typebox/build/index.d.mts")],
  } };
  const diagnostics = source => {
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (file, language, ...rest) => file === filename ? ts.createSourceFile(file, source, language) : original(file, language, ...rest);
    return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
  };
  const removed = diagnostics('import { Type } from "@earendil-works/pi-ai"; void Type;');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].code, 2305);
  assert.match(removed[0].message, /Type/);
  assert.deepEqual(diagnostics('import { Type, type Static } from "typebox"; import type { Tool } from "@earendil-works/pi-ai"; const schema = Type.Object({ count: Type.Integer() }); const input: Static<typeof schema> = { count: 3 }; const tool: Tool<typeof schema> = { name: "count", description: "count", parameters: schema }; void input; void tool;'), []);
});

test("active registrations and unsupported-feature audit stay bounded to active source", t => {
  assert.equal(tools.size, 50, "6 local tools, target hello, recall, and 42 browser tools");
  for (const name of ["delegate_run", "delegate_model_catalog", "web_search", "web_code_search", "fetch_contents", "github_ci_wait", "recall", "browser_set_headers"]) assert.ok(tools.has(name));
  assert.ok([...tools.keys()].every(name => !/^(?:codegraph_|ctx_)/.test(name)));
  assert.equal(json(join(repository, "agent/claude-bridge.json")).askClaude.enabled, false, "AskClaude is not an active package tool");
  assert.deepEqual(policy.runtimeExtensions.map(file => relative(join(repository, "agent/extensions"), file)), [
    "delegated-pi-loop/index.ts", "openai-codex-aliases/index.ts", "web-search/index.ts", "fastlane/index.ts", "claude-bridge-provider/delegate-entry.ts",
  ]);
  assert.equal(policy.catalogExtensions.length, 2);
  const schemas = [];
  function auditSchema(value) {
    if (!value || typeof value !== "object") return;
    assert.equal(Type.IsRefine(value), false);
    assert.equal(Type.IsCodec(value), false);
    if (value.type) assert.ok(!["bigint", "undefined", "void", "function", "symbol"].includes(value.type), "Synthetic-only non-JSON input type");
    if (typeof value.format === "string") schemas.push(value.format);
    for (const child of Object.values(value)) auditSchema(child);
  }
  for (const definition of tools.values()) auditSchema(definition.parameters);
  assert.deepEqual(schemas, [], "Active parameter schemas use no custom or standard format assertions");
  const paths = [];
  const roots = [
    ...["delegated-pi-loop", "claude-bridge-provider", "web-search", "github-ci", "fastlane", "footer", "theme-overrides", "openai-codex-aliases"].map(name => join(repository, "agent/extensions", name)),
    ...["pi-blackhole", "pi-btw", "pi-browser-harness", "pi-claude-bridge"].map(name => join(modules, name)),
  ];
  function visit(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ["node_modules", "dist", "tests", "test", "examples", ".git"].includes(entry.name)) continue;
      const file = join(root, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:ts|js|mjs|cjs)$/.test(file) && !/\.(?:test|fixture)\./.test(file)) paths.push(file);
    }
  }
  roots.forEach(visit);
  for (const file of paths) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\b(?:Refine|Codec)\s*\(|\bFormat\s*\.\s*Set\s*\(/, file);
    // No active consumer parses host validation wording. Provider-specific
    // error classification (for example Exa's empty-query error) is separate.
    assert.doesNotMatch(source, /Validation failed for tool|must have required properties|must be number|validateToolArguments|validateToolCall/, file);
  }
  assert.ok(paths.length > 150);
  t.diagnostic(`audit: ${paths.length} source files; 50 captured schemas; no refinements, codecs, custom formats or host-error consumers; btw has no tool, AskClaude disabled`);
});

test("delegated tools: coercion does not replace roles, skill allowlists or routing policy", async t => {
  const skill = resources.allowedDelegateSkillNames(policy)[0];
  const input = decoded(t, "delegate_run", { role: "implementation", prompt: "test only", fastlane: "true", availableSkills: skill, cwd: null }, { role: "implementation", prompt: "test only", fastlane: true, availableSkills: [skill] });
  assert.equal(routing.requireRole(snapshot, input.role).id, "implementation");
  assert.deepEqual(resources.resolveDelegateSkills(policy, input.availableSkills).map(item => item.name), [skill]);
  assert.throws(() => validate("delegate_run", { prompt: "missing role" }));
  assert.throws(() => validate("delegate_run", { role: "unknown", prompt: "x" }));
  assert.throws(() => validate("delegate_run", { role: "implementation", prompt: "x", availableSkills: ["../not-approved"] }));
  assert.throws(() => routing.requireRole(snapshot, "unknown"));
  assert.throws(() => resources.resolveDelegateSkills(policy, ["../not-approved"]));
  assert.throws(() => resources.resolveDelegateSkills(policy, "gh-cli"));
  assert.throws(() => resources.resolveDelegateSkills(policy, [" "]));
  const override = decoded(t, "delegate_run", { role: "implementation", prompt: "x", routingOverride: { reason: "test", excludeProviders: "not-configured" } }, { role: "implementation", prompt: "x", routingOverride: { reason: "test", excludeProviders: ["not-configured"] } });
  assert.throws(() => routing.selectRoutes(snapshot, input.role, { ...override.routingOverride, reason: " " }));
  assert.throws(() => routing.selectRoutes(snapshot, input.role, { reason: "test" }));
  assert.throws(() => routing.selectRoutes(snapshot, input.role, { reason: "test", thinking: "high" }));
  assert.throws(() => routing.selectRoutes(snapshot, input.role, { reason: "test", model: "not-configured" }));
  assert.throws(() => routing.selectRoutes(snapshot, input.role, { reason: "test", excludeProviders: "not-an-array" }));
  const params = decoded(t, "delegate_model_catalog", { query: "gpt", limit: "2.9", provider: null, thinking: null }, { query: "gpt", limit: 2 });
  const result = await tool("delegate_model_catalog").execute("c2", params);
  assert.ok(result.details.returned <= 2);
  await assert.rejects(() => tool("delegate_model_catalog").execute("c2", validate("delegate_model_catalog", { query: " ", limit: "2" })));
  await assert.rejects(() => tool("delegate_model_catalog").execute("c2", { query: "gpt", limit: 2.5 }));
  assert.throws(() => validate("delegate_model_catalog", { query: "gpt", limit: "no" }));
  assert.throws(() => validate("delegate_model_catalog", { query: "gpt", thinking: "not-configured" }));
  assert.throws(() => validate("delegate_model_catalog", { query: "gpt", limit: 21 }));
});

test("delegated Bridge refuses repository config before the fake package loader runs", async () => {
  const { activateBridge } = await local("claude-bridge-provider", "delegate-entry.ts");
  const cwd = fs.mkdtempSync(join(process.env.TMPDIR, "c2-repository-"));
  fs.mkdirSync(join(cwd, ".pi"));
  fs.writeFileSync(join(cwd, ".pi/claude-bridge.json"), "{}\n");
  let loads = 0;
  await activateBridge(new Proxy({}, { get: (_target, name) => deny(`bridge API.${String(name)}`) }), async () => {
    loads++;
    throw new Error("Fake package loader must not run");
  }, cwd);
  assert.equal(loads, 0, "Repository config must prevent package activation");
});

test("GitHub CI: real raw prepare hook remains stricter than host coercion", t => {
  const ci = tool("github_ci_wait");
  const raw = { repo: "owner/repo", runs: [{ id: 42 }] };
  const prepared = ci.prepareArguments(raw);
  decoded(t, "github_ci_wait", prepared, { ...raw, intervalSeconds: 15, timeoutSeconds: 1800, failFast: true });
  decoded(t, "github_ci_wait", { repo: "owner/repo", runs: { id: "42.9" }, intervalSeconds: "5", failFast: "false", timeoutSeconds: null }, { repo: "owner/repo", runs: [{ id: 42 }], intervalSeconds: 5, failFast: false });
  for (const args of [
    { ...raw, runs: { id: 42 } }, { ...raw, runs: [{ id: "42" }] }, { ...raw, runs: [{ id: 42.9 }] },
    { ...raw, runs: [{ id: 42 }, { id: 42, label: "different" }] }, { ...raw, failFast: "false" },
    { ...raw, timeoutSeconds: null }, { ...raw, intervalSeconds: "5" }, { ...raw, extra: true },
    { ...raw, repo: "owner/repo\n--help" }, { ...raw, runs: [{ id: 42, label: "\u202eforge" }] },
    { ...raw, runs: [{ id: 42, label: " " }] }, { ...raw, runs: [{ id: Number.MAX_SAFE_INTEGER + 1 }] },
    null, {},
  ]) assert.throws(() => ci.prepareArguments(args));
  for (const args of [{ ...raw, extra: true }, { ...raw, runs: [{ id: 42, extra: true }] }, { ...raw, repo: "https://github.com/owner/repo" }, { ...raw, runs: [] }]) assert.throws(() => validate("github_ci_wait", args));
});

test("three web tools: raw JSON coercion and input/URL guards run before any transport", async t => {
  decoded(t, "web_search", { query: "How does Pi validate?", depth: null }, { query: "How does Pi validate?" });
  decoded(t, "web_search", { query: null }, { query: "null" });
  decoded(t, "web_code_search", { query: "Find the documented Pi API.", focus: "developer_sources" }, { query: "Find the documented Pi API.", focus: "developer_sources" });
  for (const [name, args] of [
    ["web_search", {}], ["web_search", { query: "x", depth: "invalid" }], ["web_search", { query: "x", extra: true }],
    ["web_code_search", { query: "x" }], ["web_code_search", { query: "x", focus: null }], ["web_code_search", { query: "x", focus: "invalid" }],
    ["fetch_contents", { uris: [] }], ["fetch_contents", { uris: [""] }], ["fetch_contents", { uris: ["https://example.com"], maxCharacters: "no" }],
  ]) assert.throws(() => validate(name, args));
  const args = decoded(t, "fetch_contents", { uris: "HTTPS://EXAMPLE.COM:443/a#fragment", maxCharacters: "12.9", maxAgeHours: null }, { uris: ["HTTPS://EXAMPLE.COM:443/a#fragment"], maxCharacters: 12 });
  const guarded = contents.validateFetchContentsInput({ rawUris: args.uris, rawMaxCharacters: args.maxCharacters, rawMaxAgeHours: args.maxAgeHours });
  assert.deepEqual(guarded, { uris: args.uris, normalizedUrls: ["https://example.com/a"], maxCharacters: 12, maxAgeHours: undefined });
  assert.equal(contents.resolveFetchContentsInput(guarded, 24).maxAgeHours, 24);
  for (const uri of ["file:///etc/passwd", "javascript:alert(1)", "data:text/plain,test", "not-a-url", " "]) {
    const accepted = validate("fetch_contents", { uris: [uri] });
    assert.throws(() => contents.validateFetchContentsInput({ rawUris: accepted.uris }));
  }
  assert.throws(() => contents.validateFetchContentsInput({ rawUris: ["https://example.com"], rawMaxCharacters: 1.5 }));
  // Invalid-query guards are private to the real execute functions. Fake
  // provider settings trap dispatch; diagnostics use only synthetic paths.
  const noTransportConfig = { cacheDir: process.env.TMPDIR, webSearch: { defaultDepth: "standard" } };
  Object.defineProperty(noTransportConfig.webSearch, "parallel", { get: deny("web dispatch") });
  Object.defineProperty(noTransportConfig, "codeSearch", { get: deny("code dispatch") });
  await assert.rejects(() => web.executeWebSearch(validate("web_search", { query: " " }), undefined, { config: noTransportConfig }), /query/);
  await assert.rejects(() => web.executeWebCodeSearch(validate("web_code_search", { query: " ", focus: "developer_sources" }), undefined, { config: noTransportConfig }), /query/);
});

test("package tools: decoded values retain browser ownership and header-name guards", async t => {
  decoded(t, "recall", { expand: "3", page: "2", scope: null }, { expand: [3], page: 2 });
  assert.throws(() => validate("recall", { scope: "invalid" }));
  decoded(t, "browser_set_headers", { headers: { "X-Test": 42 } }, { headers: { "X-Test": "42" } });
  assert.throws(() => validate("browser_set_headers", { headers: { "X-Test": "line\r\nInjected: yes" } }));
  const args = validate("browser_set_headers", { headers: { "not a header": "test" } });
  const owned = { current: () => ({ targetId: "fixture-tab" }), owns: () => true, cdp: deny("CDP") };
  const invalid = await setHeadersTool.handler(args, { client: owned });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.kind, "invalid_args");
  const unowned = await setHeadersTool.handler(validate("browser_set_headers", { headers: { "X-Test": "test" } }), { client: { ...owned, owns: () => false } });
  assert.equal(unowned.success, false);
  assert.equal(unowned.error.kind, "invalid_state");
});

test("synthetic-only schemas: nullable, local refs, relative root id, missing refs and literal property names", () => {
  const schema = { $id: "schemas/tool.json", type: "object", properties: {
    limit: { $ref: "#/$defs/limit" }, optional: { type: "integer", minimum: 1 }, optionalRef: { $ref: "#/$defs/limit" }, nullable: { anyOf: [{ type: "integer" }, { type: "null" }] },
    "a.b": { type: "string" }, broken: { $ref: "#/$defs/missing" },
  }, required: ["limit", "nullable", "a.b"], additionalProperties: false, $defs: { limit: { type: "integer", minimum: 1 } } };
  assert.deepEqual(synthetic(schema, { limit: "3", optional: null, nullable: null, "a.b": "literal" }), { limit: 3, nullable: null, "a.b": "literal" });
  // Final 1.5.2 deliberately skips optional-null dropping at a $ref. The
  // referenced integer converts null to 0, which fails its minimum of 1.
  assert.throws(() => synthetic(schema, { limit: 1, optionalRef: null, nullable: null, "a.b": "x" }));
  assert.throws(() => synthetic(schema, { limit: 0, nullable: null, "a.b": "x" }));
  assert.throws(() => synthetic(schema, { limit: 1, nullable: null, axb: "not a declared name" }));
  assert.throws(() => synthetic(schema, { limit: 1, nullable: null, "a.b": "x", broken: 1 }));
});

test("synthetic-only TypeBox features: refinements/formats/codecs are not host authorization", () => {
  let refined = 0, decodedCount = 0;
  const refine = Type.Refine(Type.Integer(), value => { refined++; return value > 10; });
  assert.equal(Value.Check(refine, 1), false);
  refined = 0;
  assert.deepEqual(synthetic(Type.Object({ value: refine }), { value: "1" }), { value: 1 });
  assert.equal(refined, 0);
  const formatsBefore = Format.Entries();
  Format.Set("c2-custom", value => value === "allowed");
  try {
    const format = Type.String({ format: "c2-custom" });
    assert.equal(Value.Check(format, "denied"), false);
    assert.deepEqual(synthetic(Type.Object({ value: format }), { value: "denied" }), { value: "denied" });
  } finally {
    Format.Clear();
    for (const [name, check] of formatsBefore) Format.Set(name, check);
  }
  assert.throws(() => synthetic(Type.Object({ value: Type.String({ format: "email" }) }), { value: "not an email" }));
  const codec = Type.Codec(Type.String()).Decode(value => { decodedCount++; return Number(value); }).Encode(value => String(value));
  assert.equal(Value.Decode(codec, "42"), 42);
  decodedCount = 0;
  assert.deepEqual(synthetic(Type.Object({ value: codec }), { value: "42" }), { value: "42" });
  assert.equal(decodedCount, 0, "The host hands execute the encoded JSON, not the TypeBox decoded value");
});

test("synthetic-only final 1.5.2 supports BigInt and Undefined conversion, not Void", () => {
  for (const raw of ["42", 42]) assert.deepEqual(synthetic(Type.Object({ value: Type.BigInt() }), { value: raw }), { value: 42n });
  const undefinedValue = synthetic(Type.Object({ value: Type.Undefined() }), { value: null });
  assert.equal(Object.hasOwn(undefinedValue, "value"), true);
  assert.equal(undefinedValue.value, undefined);
  for (const raw of [null, "", 0, false, {}, []]) assert.throws(() => synthetic(Type.Object({ value: Type.Void() }), { value: raw }));
});
