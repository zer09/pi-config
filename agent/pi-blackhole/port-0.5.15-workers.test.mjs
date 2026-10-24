import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// Run in a network-denied sandbox with explicit isolated package/runtime roots.
// This uses the real target agent loop, auth facade, attribution and HTTP adapter.
const runtime = process.env.PI_BLACKHOLE_TEST_RUNTIME;
const root = process.env.PI_BLACKHOLE_PACKAGE_ROOT;
assert.ok(runtime && root && isAbsolute(runtime) && isAbsolute(root));
assert.equal(realpathSync(runtime), runtime);
assert.equal(realpathSync(root), root);
assert.equal(process.env.PI_OFFLINE, "1");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(json(join(root, "package.json")).version, "0.5.15");
assert.deepEqual(json(join(root, "package.json")).pi.extensions, ["./index.ts"]);
assert.equal(hash(join(root, "src/om/runtime.ts")), "cc069e93cc31c3ecdbcf41b4a937fc785ff91cc035463533edcb598273f1f3ab");
assert.equal(hash(join(root, "src/om/provider-stream.ts")), "a8ac21e75f7ab08d77acbde8ed431bed0ad2a7dad3deee90119709f9fc6ed0c3");
const deps = join(runtime, "node_modules");
const alias = {};
for (const name of ["pi-ai", "pi-agent-core", "pi-coding-agent", "pi-tui"]) {
  const pkg = join(deps, "@earendil-works", name);
  const manifest = json(join(pkg, "package.json"));
  assert.equal(manifest.version, "1.4.0");
  alias[`@earendil-works/${name}`] = join(pkg, manifest.exports?.["."]?.import ?? manifest.main);
}
alias["@earendil-works/pi-ai/compat"] = join(deps, "@earendil-works/pi-ai/dist/compat.js");
alias.typebox = join(deps, "typebox/build/index.mjs");
const ai = await import(pathToFileURL(alias["@earendil-works/pi-ai"]));
const pi = await import(pathToFileURL(alias["@earendil-works/pi-coding-agent"]));
assert.equal(pi.VERSION, "1.4.0");
const { stream, streamSimple } = await import(pathToFileURL(join(deps, "@earendil-works/pi-ai/dist/api/openai-completions.js")));
const { createJiti } = await import(pathToFileURL(join(deps, "jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { alias, fsCache: false, moduleCache: true });
const { Runtime } = await jiti.import(join(root, "src/om/runtime.ts"));
const { loadUnifiedConfig } = await jiti.import(join(root, "src/core/unified-config.ts"));
const { autoCompactThreshold } = await jiti.import(join(root, "src/om/model-budget.ts"));
const workers = {};
for (const stage of ["observer", "reflector", "dropper"]) {
  const module = await jiti.import(join(root, `src/om/agents/${stage}/agent.ts`));
  workers[stage] = module[`run${stage[0].toUpperCase()}${stage.slice(1)}`];
}
const sourceConfigPath = new URL("./pi-blackhole-config.json", import.meta.url);
assert.equal(hash(sourceConfigPath), "a9c533b6f757a2a26575f18f31191c3f9c3122d478390009dd531852f6613713");
const sourceConfig = json(sourceConfigPath);
const configDir = join(process.env.PI_CODING_AGENT_DIR, "pi-blackhole");
assert.ok(!existsSync(join(configDir, "pi-blackhole-config.json")), "use a fresh disposable agent directory");
mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, "pi-blackhole-config.json"), readFileSync(sourceConfigPath));
const config = loadUnifiedConfig(process.cwd());
const protectedConfig = readFileSync(join(process.env.PI_CODING_AGENT_DIR, "pi-blackhole/pi-blackhole-config.json"));
const unhandled = [];
const onUnhandled = (error) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
test.after(() => {
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);
  assert.deepEqual(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "pi-blackhole/pi-blackhole-config.json")), protectedConfig);
  assert.ok(!existsSync(join(process.env.PI_CODING_AGENT_DIR, "auth.json")));
});

// A private fetch replaces the transport. All other fetches remain forbidden.
globalThis.fetch = () => { throw new Error("Unexpected network request in worker fixture"); };

const observations = Array.from({ length: 10 }, (_, i) => ({
  id: `obs-${i}`, content: `Fixture observation ${i}`, relevance: "low",
  timestamp: "2026-01-01 00:00", sourceEntryIds: ["source-1"], tokenCount: 4_000,
}));
const payloads = {
  observer: { name: "record_observations", args: { complete: true, observations: [{ content: "Keep the requested goal", relevance: "high", sourceEntryIds: ["source-1"] }] } },
  reflector: { name: "record_reflections", args: { complete: true, reflections: [{ content: "Keep the durable goal", supportingObservationIds: ["obs-0"] }] } },
  dropper: { name: "drop_observations", args: { ids: ["obs-0"], reason: "Duplicated synthetic detail" } },
};
function response(stage, turn) {
  let delta, finish;
  if (turn === 1) {
    const payload = payloads[stage];
    delta = { role: "assistant", tool_calls: [{ index: 0, id: `call-${stage}`, type: "function", function: { name: payload.name, arguments: JSON.stringify(payload.args) } }] };
    finish = "tool_calls";
  } else {
    delta = { role: "assistant", content: "Synthetic review complete." };
    finish = "stop";
  }
  const chunk = { id: `fixture-${stage}-${turn}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: null }] };
  const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

test("configured selection, fixed budgets, quiet settings and percentage precedence remain unchanged", () => {
  for (const key of ["observerModel", "observerFallbackModels", "reflectorModel", "reflectorFallbackModels", "dropperModel", "dropperFallbackModels"]) {
    const withoutComments = (value) => Array.isArray(value) ? value.map(withoutComments) : Object.fromEntries(Object.entries(value).filter(([key]) => key !== "_comment"));
    assert.deepEqual(config[key], withoutComments(sourceConfig[key]), key);
  }
  for (const key of ["sessionFallback", "observeAfterTokens", "reflectAfterTokens", "compactAfterTokens", "compactAfterPercent", "observerChunkMaxTokens", "observerPreambleMaxTokens", "observationsPoolMaxTokens", "observationsPoolTargetTokens", "reflectorInputMaxTokens", "dropperInputMaxTokens", "agentMaxTurns", "midRunCompaction", "dropperPressureThreshold", "retainedToolOutputMaxTokens", "recallResponseMaxChars", "reflectionsPoolMaxTokens", "statusBar", "showWorkerNotifications", "debug", "debugLog"]) {
    assert.equal(config[key], sourceConfig[key], key);
  }
  assert.deepEqual(JSON.parse(protectedConfig), sourceConfig);
  // Stock 0.5.15 still ignores this file option. Keep the inherited loader
  // limitation visible instead of adding an unassigned repair.
  assert.equal(sourceConfig.showPreCompactionMessage, false);
  assert.equal(config.showPreCompactionMessage, true);
  assert.equal(config.tailBehavior, "pi-default");
  assert.equal(config.contextPressureFallback, "off");
  assert.equal(config.observeOnShutdown, false);
  assert.equal(config.reflectionSupersedes, false);
  assert.equal(config.reflectionTimestamps, true);
  assert.equal(autoCompactThreshold(config, { contextWindow: 272_000 }), 176_800);
  assert.equal(autoCompactThreshold({ ...config, sessionContextWindow: 1_000_000 }, undefined), 180_000);
  for (const contextWindow of [0, -1, NaN, Infinity, "272000"]) assert.equal(autoCompactThreshold(config, { contextWindow }), 180_000);
});

for (const stage of ["observer", "reflector", "dropper"]) {
  for (const [source, outcome] of ["candidate", "session"].flatMap(source => ["success", "cancel", "refusal", "stream-refusal"].map(outcome => [source, outcome]))) {
    test(`${stage}: ${source} auth survives attribution and final dispatch (${outcome})`, { timeout: 10_000 }, async () => {
      const controller = new AbortController();
      const wire = [], dispatch = [], authCalls = [];
      const primary = config[`${stage}Model`];
      const headers = { "User-Agent": null, "x-opencode-client": null, "x-keep": "fixture-value" };
      const fakeFetch = async (input, init) => {
        const request = new Request(input, init);
        assert.equal(new URL(request.url).hostname, "opencode.ai");
        assert.equal(request.headers.has("user-agent"), false, "null removes SDK defaults on the wire");
        assert.equal(request.headers.has("x-opencode-client"), false, "null removes attribution on the wire");
        assert.equal(request.headers.get("x-opencode-session"), "fixture-session");
        assert.equal(request.headers.get("x-keep"), "fixture-value");
        wire.push(JSON.parse(await request.text()));
        if (outcome === "cancel") {
          controller.abort();
          throw new DOMException("Fixture cancelled", "AbortError");
        }
        if (outcome === "refusal") return new Response(JSON.stringify({ error: { message: "fixture refusal", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } });
        return response(stage, wire.length);
      };
      const faux = ai.fauxProvider({ provider: primary.provider, models: [{ id: primary.id, reasoning: true, contextWindow: primary.contextWindow, maxTokens: 16_384 }] });
      // Explicit model headers outrank auth in Pi 1.4.0. Leave that layer unset
      // so this checks auth deletion markers, not a model-level override.
      const model = { ...faux.getModel(), api: "openai-completions", baseUrl: "https://opencode.ai/api" };
      const provider = ai.createProvider({
        id: primary.provider, models: [model],
        auth: { apiKey: { name: "Offline fixture", resolve: async () => { authCalls.push(1); return { auth: { apiKey: "fixture-not-a-credential", headers }, env: { FIXTURE_ENV: "present" } }; } } },
        api: {
          stream: (model, context, options) => stream(model, context, { ...options, fetch: fakeFetch }),
          streamSimple: (model, context, options) => {
            assert.equal(options.headers["User-Agent"], null);
            assert.equal(options.headers["x-opencode-client"], null);
            assert.equal(options.headers["x-opencode-session"], "fixture-session");
            assert.equal(options.env.FIXTURE_ENV, "present");
            assert.equal(options.reasoning, primary.thinking);
            dispatch.push({ model: `${model.provider}/${model.id}`, maxTokens: options.maxTokens });
            return streamSimple(model, context, { ...options, fetch: fakeFetch });
          },
        },
      });
      const modelRuntime = await pi.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
      modelRuntime.registerNativeProvider(provider);
      await modelRuntime.setRuntimeApiKey(primary.provider, "fixture-not-a-credential");
      // Registration refreshes availability in the background. Await the local snapshot.
      await modelRuntime.refresh({ allowNetwork: false });
      const registry = new pi.ModelRegistry(modelRuntime);
      const blackhole = new Runtime();
      blackhole.config = { ...structuredClone(config), model: undefined };
      const resolveCtx = { model, modelRegistry: registry, hasUI: false };
      if (source === "candidate") {
        resolveCtx.stageModel = primary;
        resolveCtx.stageFallbacks = config[`${stage}FallbackModels`];
      }
      const resolved = await blackhole.resolveModel(resolveCtx, controller.signal);
      assert.equal(resolved.ok, true, resolved.reason);
      assert.equal(resolved.source, source);
      if (source === "candidate") assert.deepEqual(resolved.candidateConfig, primary);
      assert.deepEqual(resolved.headers, headers);
      assert.equal(resolved.model.provider, primary.provider);
      assert.equal(resolved.model.id, primary.id);
      let dispatchRegistry = registry;
      if (outcome === "stream-refusal") {
        dispatchRegistry = { streamSimple(model, _context, options) {
          assert.equal(options.headers["User-Agent"], null);
          assert.equal(options.headers["x-opencode-client"], null);
          assert.equal(options.headers["x-opencode-session"], "fixture-session");
          assert.equal(typeof options.transformHeaders, "function");
          dispatch.push({ model: `${model.provider}/${model.id}`, maxTokens: options.maxTokens });
          throw new Error("fixture refusal before transport");
        } };
      }
      const common = { ...resolved, signal: controller.signal, modelRegistry: dispatchRegistry, sessionId: "fixture-session", maxTurns: config.agentMaxTurns, thinkingLevel: primary.thinking };
      const args = stage === "observer"
        ? { ...common, priorReflections: [], priorObservations: [], chunk: "[Source entry id: source-1] Keep the requested goal.", allowedSourceEntryIds: ["source-1"] }
        : { ...common, reflections: [], observations, budgetTokens: config.observationsPoolMaxTokens };
      if (outcome === "success") {
        const result = await workers[stage](args);
        if (stage === "observer") assert.equal(result.observations.length, 1);
        else if (stage === "reflector") assert.equal(result.reflections.length, 1);
        else assert.deepEqual(result, ["obs-0"]);
      } else {
        await assert.rejects(workers[stage](args), (error) => {
          assert.equal(error.name, "WorkerStreamError");
          assert.match(error.message, outcome === "cancel" ? /abort/i : /fixture refusal/);
          assert.equal(error.discardedCount, 0);
          return true;
        });
      }
      const expectedRequests = stage === "dropper" && outcome === "success" ? 2 : 1;
      assert.equal(wire.length, outcome === "stream-refusal" ? 0 : expectedRequests);
      assert.equal(dispatch.length, expectedRequests);
      for (const request of dispatch) {
        assert.equal(request.model, `${primary.provider}/${primary.id}`);
        assert.equal(request.maxTokens, 16_384, "worker output cap stays fixed, not compactAfterPercent-scaled");
      }
      assert.ok(authCalls.length >= expectedRequests + 1, "both resolution and dispatch use target request auth");
      assert.equal(controller.signal.aborted, outcome === "cancel");
    });
  }
}
