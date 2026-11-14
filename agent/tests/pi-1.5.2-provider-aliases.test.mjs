import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Require explicit target roots. Never discover a global SDK or account file.
const modules = process.env.PI_TEST_NODE_MODULES;
const compiler = process.env.PI_TEST_COMPILER_NODE_MODULES;
for (const root of [modules, compiler]) {
  assert.ok(root && isAbsolute(root), "Explicit isolated SDK/compiler roots required");
  assert.equal(fs.realpathSync(root), root);
}
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const extension = join(repository, "agent/extensions/openai-codex-aliases");
const pi = join(modules, "@earendil-works/pi-coding-agent");
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const require = createRequire(import.meta.url);
const entries = new Map();
function entry(name) {
  const parts = name.split("/");
  const count = name.startsWith("@") ? 2 : 1;
  const root = join(modules, ...parts.slice(0, count));
  const manifest = json(join(root, "package.json"));
  const subpath = parts.slice(count).join("/");
  let exported = manifest.exports?.[subpath ? `./${subpath}` : "."];
  if (!exported && subpath.startsWith("providers/")) {
    const wildcard = manifest.exports["./providers/*"];
    exported = wildcard.import.replace("*", subpath.slice("providers/".length));
  }
  if (!subpath) exported ??= manifest.main;
  assert.ok(exported, `Missing target export: ${name}`);
  const file = fs.realpathSync(join(root, typeof exported === "string" ? exported : exported.import));
  assert.ok(file.startsWith(modules + "/"));
  entries.set(name, file);
  return pathToFileURL(file).href;
}
for (const name of ["pi-ai", "pi-coding-agent", "pi-agent-core", "pi-tui"]) {
  assert.equal(json(join(modules, "@earendil-works", name, "package.json")).version, "1.5.2");
}
assert.equal(json(join(compiler, "typescript/package.json")).version, "6.0.3");

// ModelRuntime otherwise builds every ambient provider. Replace only its catalog
// input, not the SDK root or runtime implementation, so only fixture auth can run.
let catalogBindings = 0;
const catalogHook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-ai/providers/all" && context.parentURL === pathToFileURL(join(pi, "dist/core/model-runtime.js")).href) {
    catalogBindings++;
    return { url: "data:text/javascript," + encodeURIComponent("export const builtinProviders = () => []; export const getBuiltinModelDataGeneratedAt = () => undefined;"), shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const ai = await import(entry("@earendil-works/pi-ai"));
const sdk = await import(entry("@earendil-works/pi-coding-agent"));
catalogHook.deregister();
const loader = await import(pathToFileURL(join(pi, "dist/core/extensions/loader.js")));
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, alias: {
  "@earendil-works/pi-ai": fileURLToPath(entry("@earendil-works/pi-ai")),
  "@earendil-works/pi-ai/providers/all": fileURLToPath(entry("@earendil-works/pi-ai/providers/all")),
  "@earendil-works/pi-tui": fileURLToPath(entry("@earendil-works/pi-tui")),
} });
const { createOpenAICodexAliasProvider } = await jiti.import(join(extension, "provider-adapter.ts"));
const { registerOpenAICodexAliases } = await jiti.import(join(extension, "index.ts"));
const aliases = ["fixture-a", "fixture-b"].map(slug => ({ slug, id: `openai-codex-${slug}`, name: `Synthetic ${slug}` }));
const forbidden = [];
const deny = name => () => { forbidden.push(name); throw Error(`Forbidden fixture operation: ${name}`); };
const usage = {
  input: 11, output: 7, cacheRead: 5, cacheWrite: 3, cacheWrite1h: 2, reasoning: 4, totalTokens: 26,
  cost: { input: 0.11, output: 0.07, cacheRead: 0.05, cacheWrite: 0.03, total: 9.87, totalFromProvider: true },
};
function assistant(provider = "openai-codex", overrides = {}) {
  return {
    role: "assistant", api: "openai-codex-responses", provider, model: "fixture-model",
    responseModel: "fixture-backend-revision", responseId: "fixture-response",
    content: [{ type: "text", text: "hello", textSignature: "fixture-signature", opaqueBlock: { provider: "do-not-rewrite" } }],
    usage, stopReason: "stop", timestamp: 123, durationMs: 42,
    providerThinkingLevel: "max", rawStopReason: "completed", endTurn: true,
    opaqueProvider: { provider: "openai-codex", nested: [1, null, { future: true }] }, ...overrides,
  };
}
function fixture() {
  const calls = [];
  const model = Object.freeze({
    id: "fixture-model", name: "Synthetic Codex", api: "openai-codex-responses", provider: "openai-codex",
    baseUrl: "https://fixture.invalid/backend-api", reasoning: true, thinkingLevelMap: { max: "max" },
    input: ["text", "image"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 272000, maxTokens: 128000, headers: { "x-model": "fixture", "x-remove": null },
  });
  const authConversions = [];
  const source = {
    id: "openai-codex", name: "Synthetic canonical", baseUrl: model.baseUrl,
    headers: Object.freeze({ "x-provider": "fixture", "x-null": null }),
    auth: Object.freeze({
      apiKey: Object.freeze({ name: "Unused fixture API key", resolve: deny("api key resolver"), login: deny("key login") }),
      oauth: Object.freeze({ name: "Synthetic OAuth", isSubscription: true, login: deny("OAuth login"), refresh: deny("OAuth refresh"),
        async toAuth(credential) {
          assert.ok(credential.access.startsWith("synthetic-only:"));
          authConversions.push(credential.access);
          return { apiKey: credential.access, headers: { "x-fixture-account": credential.access, "x-auth-null": null } };
        },
      }),
    }),
    getModels: () => Object.freeze([model]),
    stream(model, context, options) { return dispatch("stream", model, context, options); },
    streamSimple(model, context, options) { return dispatch("streamSimple", model, context, options); },
  };
  const state = { produce: () => ({ async *[Symbol.asyncIterator]() { yield { type: "done", reason: "stop", message: assistant() }; } }) };
  function dispatch(method, model, context, options) {
    calls.push({ method, model, context, options });
    return state.produce(model, context, options);
  }
  return { source, model, calls, state, authConversions };
}
async function collect(stream) {
  const events = [];
  const result = stream.result();
  for await (const event of stream) events.push(event);
  assert.equal(events.filter(e => ["done", "error"].includes(e.type)).length, 1);
  const terminal = events.at(-1);
  assert.ok(["done", "error"].includes(terminal.type));
  assert.equal(await result, terminal.message ?? terminal.error);
  assert.equal(await stream.result(), await result);
  return events;
}
function mapped(message, provider) {
  return { ...message, provider };
}
function requestContext() {
  const tool = { name: "read", description: "Synthetic tool", parameters: { type: "object", properties: { path: { type: "string" } } } };
  return {
    messages: [
      { role: "system", content: "Initial fixture instructions", sections: { fixture: "read only" }, toolsAdded: [tool], timestamp: 0 },
      { role: "user", content: "Synthetic request", timestamp: 1 },
      assistant(aliases[0].id), assistant(), assistant(aliases[1].id),
      { role: "toolResult", toolCallId: "fixture-call", toolName: "read", content: [{ type: "text", text: "fixture result" }], isError: false, timestamp: 2 },
      { role: "system", content: "Updated instructions", toolsRemoved: [{ name: "read", namespace: "fixture" }], toolsAdded: [tool], timestamp: 3 },
    ],
    opaqueContext: { reference: "keep this object" },
  };
}
function options(signal) {
  return { signal, reasoning: "max", transport: "websocket-cached", cacheRetention: "long", sessionId: "synthetic-session",
    headers: { "x-request": "fixture", "x-request-null": null }, env: { FIXTURE_ONLY: "synthetic" },
    onPayload: deny("payload hook execution"), onResponse: deny("response hook execution"), onProviderStreamEvent: deny("provider hook execution"),
  };
}

test("native SDK identity, extension view separation and strict exact-target declarations", async t => {
  assert.equal(catalogBindings, 1);
  const catalog = await import(entry("@earendil-works/pi-ai/providers/all"));
  assert.equal(entries.get("@earendil-works/pi-ai/providers/all"), join(modules, "@earendil-works/pi-ai/dist/providers/all.js"));
  assert.equal(typeof catalog.builtinProviders, "function");
  const nativeEnum = await import(pathToFileURL(join(modules, "@earendil-works/pi-ai/dist/utils/string-enum.js")));
  assert.equal(ai.StringEnum, nativeEnum.StringEnum);
  assert.equal(ai.Type, undefined);
  assert.equal(ai.createAssistantMessageEventStream, require(fileURLToPath(entry("@earendil-works/pi-ai"))).createAssistantMessageEventStream);
  const nativeRuntime = await import(pathToFileURL(join(pi, "dist/core/model-runtime.js")));
  assert.equal(sdk.ModelRuntime, nativeRuntime.ModelRuntime);
  const view = await import(pathToFileURL(join(pi, "dist/core/extensions/pi-ai-extension-view.js")));
  assert.equal(typeof view.StringEnum, "function");
  assert.notEqual(view.StringEnum, ai.StringEnum, "The filesystem-loader helper must not replace the native SDK helper");
  assert.equal(view.createAssistantMessageEventStream, ai.createAssistantMessageEventStream);
  const ts = require(join(compiler, "typescript"));
  const filename = join(process.env.TMPDIR, "c6a-provider-contract.ts");
  const paths = {};
  for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) paths[name] = [join(modules, name, "dist/index.d.ts")];
  paths["@earendil-works/pi-ai/providers/all"] = [join(modules, "@earendil-works/pi-ai/dist/providers/all.d.ts")];
  const compilerOptions = { noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ["node"], typeRoots: [join(compiler, "@types")], paths };
  const files = ["index.ts", "provider-adapter.ts", "provider-id.ts", "config.ts", "usage-command.ts"].map(f => join(extension, f));
  function diagnostics(text, roots) {
    const host = ts.createCompilerHost(compilerOptions);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (file, language, ...rest) => file === filename ? ts.createSourceFile(file, text, language) : original(file, language, ...rest);
    const program = ts.createProgram(roots, compilerOptions, host);
    const result = ts.getPreEmitDiagnostics(program).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
    const resolved = program.getSourceFiles().map(f => f.fileName);
    for (const name of ["pi-ai", "pi-coding-agent"]) assert.ok(resolved.includes(join(modules, "@earendil-works", name, "dist/index.d.ts")));
    assert.ok(resolved.includes(join(compiler, "@types/node/index.d.ts")));
    return result;
  }
  const text = `import type { AssistantMessage, Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
export function check(pi: ExtensionAPI, runtime: ModelRuntime, provider: Provider<"openai-codex-responses">, message: AssistantMessage) {
  pi.registerProvider(provider); runtime.registerNativeProvider(provider);
  const responseModel: string | undefined = message.responseModel;
  const billed: boolean | undefined = message.usage.cost.totalFromProvider;
  return { responseModel, billed };
}`;
  assert.deepEqual(diagnostics(text, [...files, filename]), []);
  const invalid = diagnostics(text + '\nconst bad: Pick<AssistantMessage, "responseModel"> = { responseModel: 42 }; export { bad };', [filename]);
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].code, 2322);
  const invalidCost = diagnostics(text + '\nexport const bad: AssistantMessage["usage"]["cost"] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, totalFromProvider: "yes" };', [filename]);
  assert.equal(invalidCost.length, 1);
  assert.equal(invalidCost[0].code, 2322);
  t.diagnostic(`TypeScript ${ts.version}: five unchanged production files plus native contract; zero diagnostics; invalid responseModel and totalFromProvider refused`);
  t.diagnostic(JSON.stringify({ runtimeEntries: Object.fromEntries(entries), declarationEntries: paths, nodeTypes: join(compiler, "@types/node/index.d.ts") }));
});

test("aliases independently wrap model arrays, model objects, auth methods and provider headers", () => {
  const { source, model } = fixture();
  const [a, b] = aliases.map(alias => createOpenAICodexAliasProvider(alias, source));
  for (const provider of [a, b]) {
    assert.notEqual(provider.getModels(), source.getModels());
    assert.notEqual(provider.getModels()[0], model);
    assert.deepEqual(provider.getModels()[0], { ...model, provider: provider.id });
    assert.notEqual(provider.auth, source.auth);
    for (const method of ["apiKey", "oauth"]) assert.notEqual(provider.auth[method], source.auth[method]);
    assert.notEqual(provider.headers, source.headers);
    assert.equal(provider.auth.oauth.toAuth, source.auth.oauth.toAuth);
    assert.equal(provider.auth.apiKey.resolve, source.auth.apiKey.resolve);
  }
  assert.notEqual(a.getModels(), b.getModels());
  assert.notEqual(a.getModels()[0], b.getModels()[0]);
  assert.notEqual(a.auth, b.auth);
  assert.notEqual(a.auth.apiKey, b.auth.apiKey);
  assert.notEqual(a.auth.oauth, b.auth.oauth);
  assert.notEqual(a.headers, b.headers);
  a.headers["x-provider"] = "changed fixture";
  a.auth.oauth.name = "changed fixture";
  a.auth.apiKey.name = "changed fixture";
  a.getModels()[0].name = "changed fixture";
  assert.equal(source.headers["x-provider"], "fixture");
  assert.equal(b.headers["x-provider"], "fixture");
  assert.equal(source.auth.oauth.name, "Synthetic OAuth");
  assert.equal(b.auth.oauth.name, `${aliases[1].name} (ChatGPT Plus/Pro)`);
  assert.equal(source.auth.apiKey.name, "Unused fixture API key");
  assert.equal(b.auth.apiKey.name, "Unused fixture API key");
  assert.equal(model.name, "Synthetic Codex");
  assert.equal(b.getModels()[0].name, "Synthetic Codex");
});

for (const method of ["stream", "streamSimple"]) {
  test(`${method}: exact context/model/options references and new usage metadata survive mapping and continuation`, { timeout: 5000 }, async () => {
    const { source, model, calls, state } = fixture();
    const provider = createOpenAICodexAliasProvider(aliases[0], source);
    const context = requestContext();
    const before = structuredClone(context);
    const opts = options(new AbortController().signal);
    for (const totalFromProvider of [true, false, undefined]) {
      const message = assistant("openai-codex", { usage: { ...usage, cost: { ...usage.cost } } });
      if (totalFromProvider === undefined) delete message.usage.cost.totalFromProvider;
      else message.usage.cost.totalFromProvider = totalFromProvider;
      const partial = { ...message, stopReason: "pending" };
      const events = [{ type: "start", partial }, { type: "text_delta", delta: "hello", contentIndex: 0, partial, opaqueEvent: { future: true } }, { type: "done", reason: "stop", message, opaqueEvent: { terminal: true } }];
      const eventBefore = structuredClone(events);
      state.produce = () => ({ async *[Symbol.asyncIterator]() { yield* events; } });
      const outward = await collect(provider[method](provider.getModels()[0], context, opts));
      assert.deepEqual(outward, events.map(event => event.type === "done" ? { ...event, message: mapped(event.message, provider.id) } : { ...event, partial: mapped(event.partial, provider.id) }));
      assert.deepEqual(events, eventBefore);
      for (const event of outward) {
        const response = event.message ?? event.partial;
        assert.equal(response.usage, message.usage);
        assert.equal(response.opaqueProvider, message.opaqueProvider);
        assert.equal(response.responseModel, "fixture-backend-revision");
        assert.equal(response.model, model.id);
      }
      const call = calls.at(-1);
      assert.equal(call.method, method);
      assert.deepEqual(call.model, model);
      assert.notEqual(call.model, provider.getModels()[0]);
      assert.equal(call.options, opts);
      assert.notEqual(call.context, context);
      assert.notEqual(call.context.messages, context.messages);
      assert.equal(call.context.opaqueContext, context.opaqueContext);
      for (const [i, original] of context.messages.entries()) {
        let expected = original;
        if (i === 2) expected = mapped(original, "openai-codex");
        else if (i === 3) expected = mapped(original, "openai-codex-foreign");
        assert.deepEqual(call.context.messages[i], expected);
        if (i === 2 || i === 3) assert.equal(call.context.messages[i].content, original.content);
        else assert.equal(call.context.messages[i], original);
      }
      const result = outward.at(-1).message;
      const continuation = { ...context, messages: [...context.messages, result] };
      await collect(provider[method](provider.getModels()[0], continuation, opts));
      const continued = calls.at(-1).context.messages.at(-1);
      assert.deepEqual(continued, mapped(result, "openai-codex"));
      assert.equal(continued.usage, result.usage);
      assert.equal(continued.opaqueProvider, result.opaqueProvider);
      assert.equal(result.provider, provider.id);
    }
    assert.deepEqual(context, before);
    assert.equal(calls.length, 6);
  });

  for (const scenario of ["done", "error", "aborted", "source-throw", "iterator-throw", "missing-terminal", "empty", "cancel", "pre-aborted"]) {
    test(`${method}: ${scenario} terminates exactly once`, { timeout: 5000 }, async () => {
      const { source, state, calls } = fixture();
      const provider = createOpenAICodexAliasProvider(aliases[0], source);
      const controller = new AbortController();
      if (scenario === "pre-aborted") controller.abort();
      let closed = 0, trailing = false;
      const partial = assistant("openai-codex", { stopReason: "pending" });
      const reason = scenario === "aborted" ? "aborted" : "error";
      const terminal = assistant("openai-codex", { stopReason: reason, errorMessage: "synthetic provider error" });
      state.produce = () => {
        if (scenario === "source-throw" || scenario === "pre-aborted") throw Error("private fixture failure");
        return { async *[Symbol.asyncIterator]() {
          try {
            if (scenario === "empty") return;
            yield { type: "start", partial };
            if (scenario === "done") yield { type: "done", reason: "stop", message: assistant() };
            else if (scenario === "error" || scenario === "aborted") yield { type: "error", reason, error: terminal };
            else {
              if (scenario === "cancel") controller.abort();
              if (scenario === "iterator-throw" || scenario === "cancel") throw Error("private fixture failure");
              return;
            }
            trailing = true;
            yield { type: "done", reason: "stop", message: assistant() };
          } finally { closed++; }
        } };
      };
      const events = await collect(provider[method](provider.getModels()[0], { messages: [] }, { signal: controller.signal }));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].options.signal, controller.signal);
      assert.equal(trailing, false, "The adapter must stop consuming after the first terminal event");
      assert.equal(closed, ["source-throw", "pre-aborted"].includes(scenario) ? 0 : 1);
      const result = events.at(-1).message ?? events.at(-1).error;
      assert.equal(result.provider, provider.id);
      assert.equal(result.model, "fixture-model");
      if (["done", "error", "aborted"].includes(scenario)) {
        const expected = scenario === "done" ? assistant() : terminal;
        assert.deepEqual(result, mapped(expected, provider.id));
        assert.equal(result.usage.cost.totalFromProvider, true);
      } else {
        assert.equal(result.stopReason, ["cancel", "pre-aborted"].includes(scenario) ? "aborted" : "error");
        assert.doesNotMatch(result.errorMessage, /private fixture failure/);
        assert.deepEqual(result.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
      }
    });
  }
}

test("actual extension Provider registration and ModelRuntime keep synthetic alias credentials separate", { timeout: 15000 }, async t => {
  const f = fixture();
  const records = new Map([f.source.id, ...aliases.map(a => a.id)].map(id => [id, Object.freeze({
    type: "oauth", access: `synthetic-only:${id}`, refresh: "synthetic-never-refresh", expires: Date.now() + 86400000,
  })]));
  const reads = [];
  const credentials = {
    async read(id) { assert.ok(records.has(id)); reads.push(id); return records.get(id); },
    async list() { return [...records].map(([providerId, value]) => ({ providerId, type: value.type })); },
    modify: deny("credential write/refresh"), delete: deny("credential delete"),
  };
  const runtime = await sdk.ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  assert.deepEqual(runtime.getProviders(), [], "The fixture catalog must exclude ambient provider auth");
  const registration = loader.createExtensionRuntime();
  await loader.loadExtensionFromFactory(pi => { registerOpenAICodexAliases(pi, aliases, f.source); }, repository, sdk.createEventBus(), registration, "c6a-inline-fixture");
  const pending = registration.pendingNativeProviderRegistrations;
  assert.deepEqual(pending.map(p => p.provider.id), aliases.map(a => a.id));
  assert.deepEqual(registration.pendingProviderRegistrations, []);
  runtime.registerNativeProvider(f.source);
  for (const { provider } of pending) runtime.registerNativeProvider(provider);
  const refreshed = await runtime.refresh({ allowNetwork: false });
  assert.equal(refreshed.errors.size, 0);
  assert.deepEqual(runtime.getRegisteredProviderIds().sort(), [...records.keys()].sort());
  for (const { provider } of pending) assert.equal(runtime.getRegisteredNativeProvider(provider.id), provider);
  const context = requestContext();
  const before = structuredClone(context);
  for (const method of ["stream", "streamSimple"]) {
    const results = await Promise.all([...records.keys()].map(async id => {
      const model = runtime.getModel(id, "fixture-model");
      assert.equal(model.provider, id);
      const signal = new AbortController().signal;
      const opts = options(signal);
      const events = await collect(runtime[method](model, context, opts));
      const call = f.calls.findLast(c => c.method === method && c.options.apiKey === `synthetic-only:${id}`);
      assert.ok(call);
      assert.equal(call.options.signal, signal);
      for (const name of ["transport", "reasoning", "cacheRetention", "sessionId", "onPayload", "onResponse", "onProviderStreamEvent"]) assert.equal(call.options[name], opts[name]);
      assert.deepEqual(call.options.env, opts.env);
      assert.equal(call.options.headers["x-fixture-account"], `synthetic-only:${id}`);
      assert.equal(call.options.headers["x-request"], "fixture");
      assert.equal(call.options.headers["x-model"], "fixture");
      assert.equal(call.options.headers["x-auth-null"], null);
      assert.equal(call.context.messages[0], context.messages[0]);
      assert.equal(call.context.messages.at(-1), context.messages.at(-1));
      assert.equal(call.model.provider, "openai-codex");
      assert.equal(call.model.id, model.id);
      for (const [i, original] of context.messages.entries()) {
        let expected = original;
        if (id !== f.source.id && original.role === "assistant") {
          if (original.provider === id) expected = mapped(original, "openai-codex");
          else if (original.provider === "openai-codex") expected = mapped(original, "openai-codex-foreign");
        }
        assert.deepEqual(call.context.messages[i], expected);
      }
      const result = events.at(-1).message;
      assert.deepEqual(result, mapped(assistant(), id));
      const followUp = { messages: [...context.messages, result] };
      await collect(runtime[method](model, followUp, opts));
      const continued = f.calls.findLast(c => c.method === method && c.options.apiKey === `synthetic-only:${id}`);
      assert.deepEqual(continued.context.messages.at(-1), mapped(result, "openai-codex"));
      assert.equal(result.provider, id);
      return result;
    }));
    assert.deepEqual(results.map(m => m.provider), [...records.keys()]);
  }
  assert.deepEqual(context, before);
  assert.equal(records.size, 3);
  assert.ok(reads.length >= 3);
  assert.equal(f.calls.length, 12);
  assert.equal(f.authConversions.length, 12);
  for (const method of ["stream", "streamSimple"]) assert.equal(f.calls.filter(c => c.method === method).length, 6);
  assert.deepEqual(forbidden, []);
  await runtime.settleCredentialWrites();
  t.diagnostic(JSON.stringify({ fixtureProviders: records.size, sourceCalls: f.calls.length, authConversions: f.authConversions.length, credentialReads: reads.length, forbiddenOperations: forbidden.length }));
});
