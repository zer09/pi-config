import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const modules = process.env.PI_TEST_NODE_MODULES;
const compiler = process.env.PI_TEST_COMPILER_NODE_MODULES;
const out = process.env.PI_TEST_OUTPUT_DIR;
for (const root of [modules, compiler, out]) {
  assert.ok(root && isAbsolute(root), "Explicit isolated SDK/compiler/output roots required");
  assert.equal(fs.realpathSync(root), root);
}
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
assert.equal(process.env.CLAUDE_CONFIG_DIR, join(out, "claude"));
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pi = join(modules, "@earendil-works/pi-coding-agent");
const bridgeRoot = join(modules, "pi-claude-bridge");
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
for (const name of ["pi-ai", "pi-coding-agent", "pi-agent-core", "pi-tui"]) {
  assert.equal(json(join(modules, "@earendil-works", name, "package.json")).version, "1.5.2");
}
assert.equal(json(join(bridgeRoot, "package.json")).version, "0.9.3");
assert.equal(json(join(compiler, "typescript/package.json")).version, "6.0.3");
const require = createRequire(import.meta.url);
const ai = await import(pathToFileURL(join(modules, "@earendil-works/pi-ai/dist/index.js")));
const sdk = await import(pathToFileURL(join(pi, "dist/index.js")));
const loader = await import(pathToFileURL(join(pi, "dist/core/extensions/loader.js")));
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
const aliases = {
  "@earendil-works/pi-coding-agent": join(pi, "dist/index.js"),
  "@earendil-works/pi-ai": join(pi, "dist/core/extensions/pi-ai-extension-view.js"),
  "@earendil-works/pi-ai/compat": join(pi, "dist/core/extensions/pi-ai-extension-view.js"),
  "@earendil-works/pi-tui": join(modules, "@earendil-works/pi-tui/dist/index.js"),
};
const activeKey = Symbol.for("claude-bridge:activeStreamSimple");
const rebuildKey = Symbol.for("claude-bridge:markRebuildHooks");
const originalCwd = process.cwd();
const layouts = [];
const queryContracts = [];
const digest = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function layout() {
  const root = fs.mkdtempSync(join(out, "layout-"));
  const npm = join(root, "agent/npm/node_modules");
  const entry = join(root, "agent/extensions/claude-bridge-provider/delegate-entry.ts");
  fs.mkdirSync(dirname(entry), { recursive: true });
  fs.copyFileSync(join(repository, "agent/extensions/claude-bridge-provider/delegate-entry.ts"), entry);
  const stock = join(npm, "pi-claude-bridge");
  fs.mkdirSync(stock, { recursive: true });
  const copies = [];
  function copy(from, to) {
    const stat = fs.lstatSync(from);
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) copy(join(from, name), join(to, name));
    } else {
      assert.ok(stat.isFile());
      fs.copyFileSync(from, to);
      assert.equal(digest(to), digest(from));
      const published = from.replace(bridgeRoot, join(dirname(repository), "sources/npm/pi-claude-bridge-0.9.3"));
      assert.equal(digest(from), digest(published), "The loaded stock package must match the verified published extraction");
      copies.push({ from, to, sha256: digest(to) });
    }
  }
  for (const name of ["src", "package.json", "LICENSE"]) copy(join(bridgeRoot, name), join(stock, name));
  for (const name of ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/sdk", "@modelcontextprotocol/sdk", "cc-session-io", "change-case", "typebox"]) {
    const to = join(npm, name);
    fs.mkdirSync(dirname(to), { recursive: true });
    fs.symlinkSync(join(modules, name), to);
    assert.equal(fs.realpathSync(to), join(modules, name));
  }
  const value = { root, entry, stock, copies, wrapperSha256: digest(entry) };
  assert.equal(value.wrapperSha256, digest(join(repository, "agent/extensions/claude-bridge-provider/delegate-entry.ts")));
  layouts.push(value);
  return value;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function fire(extension, type, event, context) {
  for (const handler of extension.handlers.get(type) ?? []) await handler({ type, ...event }, context);
}
function context(id, runtime, cwd = process.cwd()) {
  return { cwd, mode: "rpc", hasUI: false, ui: { notify() {} }, sessionManager: { getSessionId: () => id }, modelRegistry: runtime, getSystemPrompt: () => "Synthetic portable instructions" };
}
const credentials = { async list() { return []; }, async read() { return undefined; }, async modify() { throw Error("Credential write forbidden"); }, async delete() { throw Error("Credential deletion forbidden"); } };
async function registry() {
  return sdk.ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
}
function bind(loaded, runtime) {
  const registrations = [];
  const register = (name, config) => { registrations.push({ name, config }); runtime.registerProvider(name, config); };
  for (const pending of loaded.runtime.pendingProviderRegistrations) register(pending.name, pending.config);
  loaded.runtime.pendingProviderRegistrations = [];
  assert.deepEqual(loaded.runtime.pendingNativeProviderRegistrations, []);
  loaded.runtime.registerProvider = register;
  loaded.runtime.unregisterProvider = name => runtime.unregisterProvider(name);
  return registrations;
}
function assertProviderOnly(loaded) {
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  for (const name of ["tools", "commands", "flags", "shortcuts", "messageRenderers", "entryRenderers"]) assert.equal(extension[name].size, 0, name);
  assert.equal(loaded.runtime.mcpServers.list().length, 0);
  assert.ok(extension.handlers.has("session_start"));
  assert.ok(extension.handlers.has("session_compact"));
  assert.ok(extension.handlers.has("session_tree"));
  return extension;
}
async function fixture() {
  const files = layout();
  process.chdir(files.root);
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: true, alias: aliases });
  const stock = await jiti.import(join(files.stock, "src/index.ts"));
  const wrapper = await jiti.import(files.entry);
  const requests = [];
  let script;
  const fakeQuery = args => {
    assert.ok(script, "A finite fake query must be armed before every stream");
    const run = script;
    script = undefined;
    const request = { ...args, interrupted: 0, closed: 0, prompts: [], finish: Promise.withResolvers() };
    requests.push(request);
    const contract = {};
    for (const key of ["cwd", "tools", "permissionMode", "includePartialMessages", "settings", "systemPrompt", "extraArgs", "effort", "resume", "model", "skills", "persistSession", "settingSources", "maxTurns", "strictMcpConfig"]) {
      if (args.options[key] !== undefined) contract[key] = args.options[key];
    }
    queryContracts.push(contract);
    const generator = (async function* () {
      if (typeof args.prompt !== "string") {
        const input = args.prompt[Symbol.asyncIterator]();
        request.prompts.push((await input.next()).value);
        // Resuming the input generator acknowledges the first synthetic stdin write.
        request.input = input;
        request.ack = input.next().catch(() => ({ done: true }));
      }
      yield* run(request);
    })();
    return Object.assign(generator, {
      async interrupt() { request.interrupted++; return undefined; },
      close() { request.closed++; request.finish.resolve(); },
    });
  };
  stock.__test.setQuery(fakeQuery);
  stock.__test.resetSharedSession();
  // First establish the stream's identity from the seam-owning stock module.
  assert.equal(globalThis[activeKey], undefined, "A fixture cannot displace an existing stream owner");
  const stockLoaded = await loader.loadExtensionFromFactory(stock.default, files.root, sdk.createEventBus(), loader.createExtensionRuntime());
  const stockStream = globalThis[activeKey];
  assert.equal(stockLoaded.tools.has("AskClaude"), true, "The enabled AskClaude control must actually register");
  await fire(stockLoaded, "session_shutdown", {}, context("stock-control", null));
  const rt = loader.createExtensionRuntime();
  const extension = await loader.loadExtensionFromFactory(wrapper.default, files.root, sdk.createEventBus(), rt, files.entry);
  assert.equal(globalThis[activeKey], stockStream, "The actual child fixed import must use the module whose fake query is installed");
  const loaded = { extensions: [extension], errors: [], runtime: rt };
  assertProviderOnly(loaded);
  const runtime = await registry();
  const registrations = bind(loaded, runtime);
  const model = runtime.getModels("claude-bridge").find(m => m.id === "claude-sonnet-4-6");
  assert.ok(model);
  const ctx = id => context(id, runtime, files.root);
  async function start(id) { await fire(extension, "session_start", { reason: "startup" }, ctx(id)); }
  async function call(id, messages, run, options = {}, selectedModel = model) {
    assert.equal(script, undefined);
    script = run;
    await fire(extension, "before_agent_start", { systemPrompt: ai.getCurrentSystemPrompt(messages), systemPromptOptions: { customPrompt: ai.getCurrentSystemPrompt(messages), contextFiles: [], skills: [] } }, ctx(id));
    const stream = runtime.getProvider("claude-bridge").streamSimple(selectedModel, ai.normalizeContext({ messages }), { sessionId: id, ...options });
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();
    assert.equal(script, undefined, `The armed query must run: ${result.errorMessage ?? result.stopReason}`);
    assert.equal(events.filter(e => ["done", "error"].includes(e.type)).length, 1);
    assert.equal(result, events.at(-1).message ?? events.at(-1).error);
    await settle();
    return { result, events };
  }
  return { ...files, stock, wrapper, requests, runtime, registrations, model, extension, ctx, start, call,
    async close() {
      assert.equal(stock.__test.activeQueryContexts.size, 0);
      await Promise.all(requests.map(request => request.ack));
      assert.ok(requests.every(request => request.closed >= 1), "Every synthetic SDK handle must close");
      await fire(extension, "session_shutdown", {}, ctx("fixture-shutdown"));
      stock.__test.setQuery(() => { throw Error("Unarmed SDK query forbidden"); });
      process.chdir(originalCwd);
    },
  };
}
const user = content => ({ role: "user", content, timestamp: 1 });
const system = (content = "Synthetic portable instructions", toolsAdded = []) => ({ role: "system", content, toolsAdded, timestamp: 0 });
const usage = { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 5, cache_creation_input_tokens: 3,
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 3 }, service_tier: "standard", inference_geo: "not_available", iterations: [],
  server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 }, fallback_credit: null, output_tokens_details: { thinking_tokens: 0 }, speed: "standard" };
const init = (id, cwd) => ({ type: "system", subtype: "init", session_id: id, uuid: "00000000-0000-4000-8000-000000000001",
  apiKeySource: "none", claude_code_version: "synthetic", cwd, tools: [], mcp_servers: [], model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", slash_commands: [], output_style: "default", skills: [], plugins: [] });
const result = (id, text = "Synthetic answer", is_error = false) => ({ type: "result", subtype: "success", session_id: id, uuid: "00000000-0000-4000-8000-000000000002",
  duration_ms: 1, duration_api_ms: 1, num_turns: 1, is_error, result: text, stop_reason: "end_turn", total_cost_usd: 0, usage, modelUsage: {}, permission_denials: [] });
function success(request) {
  return (async function* () {
    const id = request.options.resume ?? "00000000-0000-4000-8000-000000000003";
    yield init(id, request.options.cwd);
    yield result(id);
  })();
}
const readTool = { name: "read", description: "Synthetic read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } };
const toolResult = id => ({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: "Synthetic result" }], isError: false, timestamp: 3 });
function assistantTool(id) {
  return { type: "assistant", session_id: "00000000-0000-4000-8000-000000000003", uuid: "00000000-0000-4000-8000-000000000004", parent_tool_use_id: null,
    message: { id: "msg_fixture", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "tool_use", id, name: "mcp__custom-tools__read", input: { file_path: "synthetic.txt" }, caller: { type: "direct" } }],
      stop_reason: "tool_use", stop_sequence: null, usage, container: null, context_management: null, diagnostics: null, stop_details: null } };
}
// Call the actual in-process MCP handler, without connecting a socket or running a tool.
function mcpCall(request, id) {
  const protocol = request.options.mcpServers["custom-tools"].instance.server;
  return protocol._requestHandlers.get("tools/call")({ method: "tools/call", params: { name: "read", arguments: {}, _meta: { "claudecode/toolUseId": id } } }, {});
}
function parked(id, gate) {
  return async function* (request) {
    yield init(request.options.resume, request.options.cwd);
    request.toolReply = mcpCall(request, id);
    yield assistantTool(id);
    gate.resolve(request);
    await request.toolReply;
    await request.finish.promise;
    yield result(request.options.resume, "Continued answer");
  };
}
function mirrorFiles() {
  const files = [];
  function visit(dir) {
    for (const name of fs.readdirSync(dir)) {
      const file = join(dir, name);
      if (fs.statSync(file).isDirectory()) visit(file);
      else if (file.endsWith(".jsonl")) files.push({ file, sha256: digest(file) });
    }
  }
  visit(process.env.CLAUDE_CONFIG_DIR);
  return files;
}

after(() => {
  process.chdir(originalCwd);
  for (const value of layouts) {
    for (const copy of value.copies) assert.equal(digest(copy.to), copy.sha256);
    assert.equal(digest(value.entry), value.wrapperSha256);
  }
  console.log(JSON.stringify({ layouts: layouts.map(({ root, copies, wrapperSha256 }) => ({ root, copiedFiles: copies.length, wrapperSha256 })), syntheticMirrors: mirrorFiles().length }));
});

test("real filesystem loader activates stock child provider before catalog and suppresses enabled AskClaude", async () => {
  globalThis[activeKey] = undefined;
  const files = layout();
  process.chdir(files.root);
  const loaded = await loader.loadExtensions([files.entry], files.root);
  const extension = assertProviderOnly(loaded);
  assert.equal(loaded.runtime.pendingProviderRegistrations.length, 1);
  const runtime = await registry();
  const registrations = bind(loaded, runtime);
  assert.equal(registrations[0].name, "claude-bridge");
  assert.ok(runtime.getProvider("claude-bridge"));
  assert.ok(runtime.getModels("claude-bridge").length > 0, "Catalog must not need session_start");
  const stream = globalThis[activeKey];
  await fire(extension, "session_start", { reason: "startup" }, context("catalog", runtime, files.root));
  assert.equal(globalThis[activeKey], stream);
  await fire(extension, "session_shutdown", {}, context("catalog", runtime, files.root));
  assert.equal(globalThis[activeKey], undefined);
  process.chdir(originalCwd);
});

test("project guard prevents real package activation and emits one bounded line without registrations", async t => {
  const files = layout();
  fs.mkdirSync(join(files.root, ".pi"));
  fs.writeFileSync(join(files.root, ".pi/claude-bridge.json"), '{"provider":{"strictMcpConfig":false}}\n');
  process.chdir(files.root);
  const stream = globalThis[activeKey], hooks = globalThis[rebuildKey].size;
  const error = t.mock.method(console, "error", () => {});
  const loaded = await loader.loadExtensions([files.entry], files.root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.equal(loaded.extensions[0].handlers.size, 0);
  assert.equal(loaded.extensions[0].tools.size, 0);
  assert.equal(loaded.extensions[0].commands.size, 0);
  assert.deepEqual(loaded.runtime.pendingProviderRegistrations, []);
  assert.equal(loaded.runtime.mcpServers.list().length, 0);
  assert.equal(globalThis[activeKey], stream);
  assert.equal(globalThis[rebuildKey].size, hooks, "Package import must not enlist a rebuild hook");
  assert.equal(error.mock.callCount(), 1);
  const line = error.mock.calls[0].arguments[0];
  assert.ok(line.length <= 300);
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  assert.match(line, /project \.pi\/claude-bridge\.json found/);
  process.chdir(originalCwd);
});

test("later stock module instances preserve the owner's shared registry and register into separate registries", async () => {
  globalThis[activeKey] = undefined;
  const a = layout(), b = layout(), c = layout();
  process.chdir(a.root);
  const first = await loader.loadExtensions([a.entry], a.root);
  const firstExtension = assertProviderOnly(first);
  const ownerStream = globalThis[activeKey];
  const shared = await registry();
  bind(first, shared);
  const owned = shared.getRegisteredProviderConfig("claude-bridge").streamSimple;
  process.chdir(b.root);
  const later = await loader.loadExtensions([b.entry], b.root);
  const laterExtension = assertProviderOnly(later);
  assert.equal(later.runtime.pendingProviderRegistrations.length, 0);
  const skipped = bind(later, shared);
  await fire(laterExtension, "session_start", { reason: "startup" }, context("shared-child", shared));
  assert.equal(skipped.length, 0);
  assert.equal(shared.getRegisteredProviderConfig("claude-bridge").streamSimple, owned);
  await fire(laterExtension, "session_shutdown", {}, context("shared-child", shared));
  assert.equal(globalThis[activeKey], ownerStream, "Non-owner shutdown cannot clear the owner's key");
  process.chdir(c.root);
  const separate = await loader.loadExtensions([c.entry], c.root);
  const separateExtension = assertProviderOnly(separate);
  const own = await registry();
  const installed = bind(separate, own);
  await fire(separateExtension, "session_start", { reason: "startup" }, context("separate-child", own));
  assert.equal(installed.length, 1);
  assert.ok(own.getProvider("claude-bridge"));
  assert.notEqual(own.getRegisteredProviderConfig("claude-bridge").streamSimple, owned);
  await fire(separateExtension, "session_shutdown", {}, context("separate-child", own));
  assert.equal(globalThis[activeKey], ownerStream);
  await fire(firstExtension, "session_shutdown", {}, context("owner", shared));
  assert.equal(globalThis[activeKey], undefined);
  process.chdir(a.root);
  const reloaded = await loader.loadExtensions([a.entry], a.root);
  assertProviderOnly(reloaded);
  const reloadRegistrations = bind(reloaded, shared);
  assert.equal(reloadRegistrations.length, 1);
  const replacement = globalThis[activeKey];
  assert.equal(typeof replacement, "function");
  assert.notEqual(replacement, ownerStream);
  assert.equal(shared.getRegisteredProviderConfig("claude-bridge").streamSimple, replacement);
  await fire(laterExtension, "session_shutdown", {}, context("late-old-child", shared));
  assert.equal(globalThis[activeKey], replacement);
  assert.equal(shared.getRegisteredProviderConfig("claude-bridge").streamSimple, replacement);
  await fire(reloaded.extensions[0], "session_shutdown", {}, context("reload", shared));
  assert.equal(globalThis[activeKey], undefined);
  process.chdir(originalCwd);
});

test("real stock replay failure rolls back hooks and keeps its diagnostic bounded", async t => {
  const f = await fixture();
  try {
    await fire(f.extension, "session_shutdown", {}, f.ctx("pre-replay"));
    const active = new Set(), observed = [];
    const error = t.mock.method(console, "error", () => {});
    const api = {
      on(type, handler) { const item = { type, handler }; active.add(item); observed.push(item); return () => active.delete(item); },
      registerProvider() { throw Error("Synthetic replay failure\n" + "x".repeat(1000)); },
      unregisterProvider() { assert.fail("No provider succeeded, so none can be removed"); },
    };
    await f.wrapper.activateBridge(api, async () => f.stock.default, f.root);
    assert.equal(active.size, 0);
    assert.equal(error.mock.callCount(), 1);
    const line = error.mock.calls[0].arguments[0];
    assert.equal(line.length, 300);
    assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    assert.match(line, /claude-bridge registration failed/);
    // The wrapper promises registration rollback, not rollback of package globals.
    assert.ok(globalThis[activeKey]);
    await observed.find(item => item.type === "session_shutdown").handler({ type: "session_shutdown" }, f.ctx("replay-cleanup"));
    assert.equal(globalThis[activeKey], undefined);
  } finally { await f.close(); }
});

test("provider success, error and cancel own only their synthetic session mirrors", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    for (const id of ["a", "b"]) await f.start(id);
    const seed = await f.call("seed", [system(), user("Seed")], success);
    const history = [system(), user("Earlier question"), seed.result, user("Current question")];
    const a = await f.call("a", history, success);
    assert.equal(a.result.stopReason, "stop");
    assert.equal(a.result.content[0].text, "Synthetic answer");
    const normal = f.requests.at(-1);
    assert.equal(normal.options.settingSources, undefined);
    assert.equal(normal.options.persistSession, undefined);
    assert.deepEqual(normal.options.tools, []);
    assert.equal(normal.options.extraArgs["strict-mcp-config"], null);
    assert.equal(normal.options.env.DISABLE_AUTO_COMPACT, "1");
    assert.equal(normal.options.env.ENABLE_CLAUDEAI_MCP_SERVERS, "0");
    assert.equal(normal.options.env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_CONFIG_DIR);
    assert.equal(normal.prompts[0].message.content[0].text, "Current question");
    const stateA = structuredClone(f.stock.__test.getSharedSession("a"));
    await f.call("b", history, success);
    const stateB = structuredClone(f.stock.__test.getSharedSession("b"));
    assert.notEqual(stateA.sessionId, stateB.sessionId);
    const before = mirrorFiles();
    const failure = await f.call("a", history, async function* () { throw Error("Synthetic SDK failure"); });
    assert.equal(failure.result.stopReason, "error");
    assert.match(failure.result.errorMessage, /Synthetic SDK failure/);
    assert.equal(f.stock.__test.getSharedSession("a"), null);
    assert.deepEqual(f.stock.__test.getSharedSession("b"), stateB);
    assert.deepEqual(mirrorFiles(), before, "An SDK failure must not delete another session's mirror");
    const terminal = await f.call("a", history, async function* (request) { yield init(request.options.resume, request.options.cwd); yield result(request.options.resume, "Synthetic terminal error", true); });
    assert.equal(terminal.result.stopReason, "error");
    assert.equal(terminal.result.errorMessage, "Synthetic terminal error");
    const controller = new AbortController(), entered = Promise.withResolvers();
    const cancelled = f.call("a", history, async function* (request) { yield init(request.options.resume, request.options.cwd); entered.resolve(request); await request.finish.promise; }, { signal: controller.signal });
    const pending = await entered.promise;
    controller.abort();
    assert.equal((await cancelled).result.stopReason, "aborted");
    assert.ok(pending.interrupted >= 1 && pending.closed >= 1);
    const abortedState = f.stock.__test.getSharedSession("a");
    assert.equal(abortedState.needsRebuild, true);
    assert.equal(abortedState.forceRotate, true);
    const callsBeforeOrphan = f.requests.length;
    const orphan = await f.call("a", [...history, toolResult("aborted-call")], undefined, { signal: controller.signal });
    assert.equal(orphan.result.stopReason, "stop");
    assert.equal(f.requests.length, callsBeforeOrphan);
    assert.deepEqual(f.stock.__test.getSharedSession("b"), stateB);
    const oldFile = mirrorFiles().find(e => e.file.endsWith(`${abortedState.sessionId}.jsonl`));
    assert.ok(oldFile);
    await f.call("a", history, success);
    assert.notEqual(f.stock.__test.getSharedSession("a").sessionId, abortedState.sessionId);
    assert.equal(digest(oldFile.file), oldFile.sha256, "Rotation leaves the possible orphan writer's file alone");
    assert.deepEqual(f.stock.__test.getSharedSession("b"), stateB);
    assert.equal(f.stock.__test.activeQueryContexts.size, 0);
  } finally { await f.close(); }
});

test("tool-result continuation and session-specific compact/tree rebuild never steal another parked query", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.start("parent");
    await f.start("child");
    const history = [system("Synthetic portable instructions", [readTool]), user("Earlier"), { role: "assistant", content: [{ type: "text", text: "Earlier answer" }], api: "claude-bridge", provider: "claude-bridge", model: f.model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 }, user("Use read")];
    const parentGate = Promise.withResolvers(), childGate = Promise.withResolvers();
    const parentTurn = await f.call("parent", history, parked("parent-call", parentGate));
    const parentRequest = await parentGate.promise;
    const parentState = structuredClone(f.stock.__test.getSharedSession("parent"));
    const parentFile = mirrorFiles().find(e => e.file.endsWith(`${parentState.sessionId}.jsonl`));
    const childTurn = await f.call("child", history, parked("child-call", childGate));
    const childRequest = await childGate.promise;
    assert.equal(parentTurn.result.stopReason, "toolUse");
    assert.deepEqual(parentTurn.result.content[0], { type: "toolCall", id: "parent-call", name: "read", arguments: { path: "synthetic.txt" } });
    assert.equal(f.stock.__test.activeQueryContexts.size, 2);
    const laterFiles = layout();
    const later = await loader.loadExtensions([laterFiles.entry], f.root);
    const laterExtension = assertProviderOnly(later);
    const skipped = bind(later, f.runtime);
    await fire(laterExtension, "session_start", { reason: "startup" }, f.ctx("child"));
    assert.equal(skipped.length, 0);
    const servingStream = globalThis[activeKey];
    await fire(laterExtension, "session_compact", { reason: "manual", willRetry: false }, f.ctx("child"));
    const parentCtx = [...f.stock.__test.activeQueryContexts].find(c => c.piSessionId === "parent");
    assert.equal(parentCtx.historyStale, false);
    assert.equal(parentRequest.closed, 0);
    const childOld = f.stock.__test.getSharedSession("child").sessionId;
    const discardedQuery = [...f.stock.__test.activeQueryContexts].find(c => c.piSessionId === "child").activeQuery;
    const compacted = [system("Synthetic portable instructions", [readTool]), user("Synthetic compact summary"), childTurn.result, toolResult("child-call")];
    const continued = await f.call("child", compacted, success);
    assert.equal(continued.result.stopReason, "stop");
    assert.ok(childRequest.interrupted >= 1 && childRequest.closed >= 1);
    assert.equal(f.stock.__test.isQueryAbandoned(discardedQuery), true);
    const childNew = f.stock.__test.getSharedSession("child").sessionId;
    assert.notEqual(childNew, childOld);
    const compactFile = mirrorFiles().find(e => e.file.endsWith(`${childNew}.jsonl`));
    const compactImport = fs.readFileSync(compactFile.file, "utf8");
    assert.match(compactImport, /Synthetic compact summary/);
    assert.doesNotMatch(compactImport, /Earlier answer/);
    assert.match(f.requests.at(-1).prompts[0].message.content[0].text, /context was compacted/);
    await fire(laterExtension, "session_shutdown", {}, f.ctx("child"));
    assert.equal(globalThis[activeKey], servingStream);
    assert.equal(digest(compactFile.file), compactFile.sha256);
    assert.deepEqual(f.stock.__test.getSharedSession("parent"), parentState);
    assert.equal(digest(parentFile.file), parentFile.sha256);
    assert.equal(parentRequest.closed, 0);
    const queries = f.requests.length;
    parentRequest.finish.resolve();
    // No fake is armed: delivering the result must reuse the original SDK query.
    const resumed = await f.call("parent", [...history, parentTurn.result, toolResult("parent-call")], undefined);
    assert.equal(resumed.result.content[0].text, "Continued answer");
    assert.equal(f.requests.length, queries);
    assert.deepEqual(await parentRequest.toolReply, { content: toolResult("parent-call").content, isError: false });
    assert.equal(f.stock.__test.activeQueryContexts.size, 0);
    const childState = structuredClone(f.stock.__test.getSharedSession("child"));
    await fire(f.extension, "session_tree", {}, f.ctx("parent"));
    assert.equal(f.stock.__test.getSharedSession("parent").needsRebuild, true);
    assert.deepEqual(f.stock.__test.getSharedSession("child"), childState);
    const id = f.stock.__test.getSharedSession("parent").sessionId;
    const changed = [system("Updated instructions", [{ ...readTool, name: "inspect" }]), ...history.slice(1), parentTurn.result, toolResult("parent-call"), user("New branch")];
    const model = f.runtime.getModels("claude-bridge").find(m => m.id !== f.model.id);
    await f.call("parent", changed, success, {}, model);
    assert.equal(f.requests.at(-1).options.systemPrompt?.append, "Updated instructions");
    assert.equal(f.stock.__test.getSharedSession("parent").sessionId, id, "No writer is parked, so tree rebuild keeps the UUID");
    assert.deepEqual(f.stock.__test.getSharedSession("child"), childState);
    assert.equal(f.requests.at(-1).options.extraArgs.model.includes(model.id), true);
    const protocol = f.requests.at(-1).options.mcpServers["custom-tools"].instance.server;
    const advertised = await protocol._requestHandlers.get("tools/list")({ method: "tools/list" }, {});
    assert.deepEqual(advertised.tools.map(t => t.name), ["inspect"]);
    const rewrittenFile = mirrorFiles().find(e => e.file.endsWith(`${id}.jsonl`));
    const imported = fs.readFileSync(rewrittenFile.file, "utf8");
    assert.match(imported, /Earlier answer/);
    assert.match(imported, /Synthetic result/);
    assert.doesNotMatch(imported, /Synthetic portable instructions|Updated instructions/);
    assert.equal(f.stock.__test.getHistoryRewritten(), false);
  } finally { await f.close(); }
});

test("isolated summary bypasses normal session sync and shutdown/reload clears only module-owned state", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.start("summary-owner");
    await f.call("summary-owner", [system(), user("Earlier"), { role: "user", content: "Prior", timestamp: 2 }, user("Current")], success);
    const state = structuredClone(f.stock.__test.getSharedSession("summary-owner"));
    const before = mirrorFiles();
    const signal = new AbortController().signal;
    await fire(f.extension, "session_before_compact", { signal }, f.ctx("summary-owner"));
    const summary = await f.call("summary-owner", [system("Summarize safely"), user("Synthetic summary input")], success, { cacheRetention: "none", signal });
    assert.equal(summary.result.stopReason, "stop");
    const query = f.requests.at(-1);
    assert.equal(query.prompt, "Synthetic summary input");
    assert.equal(query.options.cwd, f.root);
    assert.equal(query.options.persistSession, false);
    assert.deepEqual(query.options.settingSources, []);
    assert.equal(query.options.resume, undefined);
    assert.equal(query.options.maxTurns, 1);
    assert.equal(query.options.strictMcpConfig, true);
    assert.deepEqual(f.stock.__test.getSharedSession("summary-owner"), state);
    assert.deepEqual(mirrorFiles(), before);
    assert.equal(f.stock.__test.activeQueryContexts.size, 0);
    for (const reason of ["new", "resume", "fork"]) {
      f.stock.__test.setSharedSession("summary-owner", state);
      f.stock.__test.setSharedSession("sibling", { ...state, piSessionId: "sibling" });
      f.stock.__test.markRebuildForSession("summary-owner", "synthetic rewrite");
      await fire(f.extension, "session_start", { reason }, f.ctx("summary-owner"));
      assert.equal(f.stock.__test.getSharedSession("summary-owner"), null);
      assert.equal(f.stock.__test.getSharedSession("sibling"), null, "Stock transitions clear the module's whole mirror map");
      assert.equal(f.stock.__test.getHistoryRewritten(), false);
      assert.deepEqual(mirrorFiles(), before, "A session transition never deletes retained JSONL");
    }
    await fire(f.extension, "session_shutdown", {}, f.ctx("summary-owner"));
    assert.equal(f.stock.__test.getSharedSession("summary-owner"), null);
    assert.equal(globalThis[activeKey], undefined);
    assert.deepEqual(mirrorFiles(), before, "Stock retention keeps persisted copies after shutdown");
  } finally { await f.close(); }
});

test("actual SDK messages, query controls and native transcript contracts typecheck with TypeScript 6.0.3", async t => {
  assert.ok(queryContracts.some(c => c.persistSession === false));
  assert.ok(queryContracts.some(c => c.resume && c.persistSession === undefined));
  const agentSdkRoot = join(modules, "@anthropic-ai/claude-agent-sdk");
  const agentSdk = await import(pathToFileURL(join(agentSdkRoot, "sdk.mjs")));
  assert.equal(typeof agentSdk.query, "function");
  assert.equal(ai.Type, undefined, "The direct native SDK must not resolve to the extension view");
  const ts = require(join(compiler, "typescript"));
  const filename = join(out, "native-sdk-contract.ts");
  const paths = {
    "@earendil-works/pi-ai": [join(modules, "@earendil-works/pi-ai/dist/index.d.ts")],
    "@earendil-works/pi-coding-agent": [join(pi, "dist/index.d.ts")],
    "@anthropic-ai/claude-agent-sdk": [join(agentSdkRoot, "sdk.d.ts")],
  };
  const options = { strict: true, noUnusedLocals: true, noUnusedParameters: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ["node"], typeRoots: [join(compiler, "@types")], paths };
  const code = `import type { SDKMessage, SDKUserMessage, Query, query } from "@anthropic-ai/claude-agent-sdk";
import { normalizeContext, type Provider, type TranscriptContext, type SimpleStreamOptions, type CredentialStore } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
export const messages: SDKMessage[] = ${JSON.stringify([init("00000000-0000-4000-8000-000000000003", out), result("00000000-0000-4000-8000-000000000003"), assistantTool("typed-call")])};
export const options: NonNullable<Parameters<typeof query>[0]["options"]>[] = ${JSON.stringify(queryContracts)};
export const transcript: TranscriptContext = normalizeContext(${JSON.stringify({ messages: [system("Synthetic", [readTool]), user("Typed"), toolResult("typed-call")] })});
export const credentials: CredentialStore = { async list() { return []; }, async read() { return undefined; }, async modify() { throw Error("forbidden"); }, async delete() { throw Error("forbidden"); } };
export async function* prompt(): AsyncGenerator<SDKUserMessage> { yield { type: "user", session_id: "", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: "Typed" }] } }; }
export const args: Parameters<typeof query>[0] = { prompt: prompt(), options: options[0] };
export type ConsumedQuery = Pick<Query, keyof AsyncGenerator<SDKMessage, void> | "interrupt" | "close">;
export function fake(): ConsumedQuery { return Object.assign((async function* (): AsyncGenerator<SDKMessage, void> { yield* messages; })(), { async interrupt() { return undefined; }, close() {} }); }
export function native(pi: ExtensionAPI, provider: Provider, ctx: ExtensionContext, options: SimpleStreamOptions) {
  pi.registerProvider(provider);
  return provider.streamSimple!(provider.getModels()[0], transcript, { ...options, sessionId: ctx.sessionManager.getSessionId() });
}
`;
  function diagnostics(text) {
    const host = ts.createCompilerHost(options), get = host.getSourceFile.bind(host);
    host.getSourceFile = (file, language, ...rest) => file === filename ? ts.createSourceFile(file, text, language) : get(file, language, ...rest);
    const program = ts.createProgram([filename], options, host);
    const resolved = program.getSourceFiles().map(file => file.fileName);
    for (const [name, [file]] of Object.entries(paths)) assert.ok(resolved.includes(file), name);
    assert.ok(resolved.includes(join(compiler, "@types/node/index.d.ts")));
    assert.ok(resolved.some(file => file.startsWith(join(modules, "@anthropic-ai/sdk/"))));
    return ts.getPreEmitDiagnostics(program).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
  }
  assert.deepEqual(diagnostics(code), []);
  for (const invalid of [
    'export const bad: NonNullable<Parameters<typeof query>[0]["options"]> = { persistSession: "false" };',
    'export const bad: Pick<SDKUserMessage, "session_id"> = { session_id: 42 };',
  ]) {
    const errors = diagnostics(code + invalid);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 2322);
  }
  const evidence = { compiler: join(compiler, "typescript"), compilerVersion: ts.version, declarations: paths,
    nativeAi: join(modules, "@earendil-works/pi-ai/dist/index.js"), agentSdk: join(agentSdkRoot, "sdk.mjs"),
    agentSdkVersion: json(join(agentSdkRoot, "package.json")).version, queryContracts: queryContracts.length, negativeTypeControls: 2 };
  t.diagnostic(JSON.stringify(evidence));
});
