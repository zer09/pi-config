import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// Only the redacted compatibility groups are represented, not private model identities or prices.
const modules = process.env.PI_TEST_NODE_MODULES;
const compiler = process.env.PI_TEST_COMPILER_NODE_MODULES;
for (const root of [modules, compiler]) {
  assert.ok(root && isAbsolute(root), "Explicit isolated SDK/compiler roots required");
  assert.equal(fs.realpathSync(root), root);
}
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
const require = createRequire(join(modules, "fixture.cjs"));
const manifest = name => JSON.parse(fs.readFileSync(join(modules, name, "package.json"), "utf8"));
assert.equal(manifest("@earendil-works/pi-ai").version, "1.5.2");
assert.equal(JSON.parse(fs.readFileSync(join(compiler, "typescript/package.json"), "utf8")).version, "6.0.3");
const paths = {};
async function native(subpath) {
  const name = `@earendil-works/pi-ai${subpath ? `/${subpath}` : ""}`;
  const exports = manifest("@earendil-works/pi-ai").exports;
  const exported = subpath ? exports["./api/*"].import.replace("*", subpath.slice("api/".length)) : exports["."].import;
  const file = fs.realpathSync(join(modules, "@earendil-works/pi-ai", exported));
  const expected = join(modules, "@earendil-works/pi-ai/dist", subpath ? `${subpath}.js` : "index.js");
  assert.equal(file, expected, "Use the published native API export, not a provider facade or loader view");
  paths[name] = file;
  return import(pathToFileURL(file).href);
}
const ai = await native("");
const openai = await native("api/openai-completions");
const anthropic = await native("api/anthropic-messages");
const groups = [
  { name: "a-default", count: 10, provider: "fixture-a", compat: {} },
  { name: "a-reasoning-history", count: 2, provider: "fixture-a", compat: { requiresReasoningContentOnAssistantMessages: true } },
  { name: "a-deepseek-history", count: 3, provider: "fixture-a", compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" } },
  { name: "b-deepseek-no-effort", count: 1, provider: "fixture-b", compat: { supportsReasoningEffort: false, thinkingFormat: "deepseek" } },
  { name: "b-default", count: 1, provider: "fixture-b", compat: {} },
];
function model(group = groups[0]) {
  return {
    id: `synthetic-${group.name}`, name: `Synthetic ${group.name}`, api: "openai-completions", provider: group.provider,
    baseUrl: `https://${group.provider}.invalid/v1`, reasoning: true, input: ["text"],
    contextWindow: 128000, maxTokens: 4096,
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
    compat: { supportsStore: false, supportsReasoningEffort: true, maxTokensField: "max_tokens",
      ...(group.provider === "fixture-a" ? { supportsDeveloperRole: false } : {}), ...group.compat },
  };
}
const anthropicModel = {
  ...model(), id: "synthetic-anthropic-override", name: "Synthetic Anthropic override", api: "anthropic-messages",
  baseUrl: "https://fixture-anthropic.invalid/proxy", compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsStrictTools: true },
};
const rawTool = {
  name: "fixture_read", description: "Read a synthetic path only",
  parameters: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer", minimum: 1 } }, required: ["path"], additionalProperties: false },
};
// Anthropic strict tools support integers, but not numeric range keywords.
const strictTool = { ...rawTool, parameters: { ...rawTool.parameters, properties: { path: { type: "string" }, limit: { type: "integer" } } },
  constrainedSampling: { type: "json_schema", strict: "require" } };
const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
function history(target, tools = [rawTool]) {
  const old = { ...rawTool, name: "fixture_retired" };
  return ai.normalizeContext({ systemPrompt: "Initial synthetic instructions", tools: [old], messages: [
    { role: "user", content: "Read the fixture", timestamp: 1 },
    { role: "assistant", api: target.api, provider: target.provider, model: target.id, timestamp: 2, stopReason: "toolUse", usage: zeroUsage(),
      content: [{ type: "text", text: "Checking" }, { type: "toolCall", id: "history_call", name: old.name, arguments: { path: "safe" } }] },
    { role: "toolResult", toolCallId: "history_call", toolName: old.name, content: [{ type: "text", text: "synthetic result" }], isError: false, timestamp: 3 },
    { role: "system", content: "Updated synthetic instructions", sections: { policy: "Keep the safety boundary" }, toolsRemoved: [{ name: old.name }], toolsAdded: tools, timestamp: 4 },
    { role: "user", content: "Continue", timestamp: 5 },
  ] });
}
const frame = data => `data: ${JSON.stringify(data)}\n\n`;
const anthropicFrame = data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
function openaiSse(target, mode = "success", args = '{"path":"safe"}') {
  const chunk = (delta, finish_reason = null) => ({ id: "synthetic-response", object: "chat.completion.chunk", created: 1,
    model: `${target.id}-backend`, choices: [{ index: 0, delta, finish_reason }] });
  const prefix = frame(chunk({ role: "assistant", reasoning_content: "Synthetic reasoning", content: "héllo" }));
  if (mode === "abort" || mode === "unfinished") return prefix;
  if (mode === "error") return prefix + frame({ error: { type: "invalid_request_error", message: "synthetic stream failure", code: "fixture_error" } });
  return prefix + frame(chunk({ tool_calls: [{ index: 0, id: "stream_call", type: "function", function: { name: rawTool.name, arguments: args.slice(0, 9) } }] })) +
    frame(chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(9) } }] }, "tool_calls")) +
    frame({ id: "synthetic-response", object: "chat.completion.chunk", created: 1, model: `${target.id}-backend`, choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 7 } } }) + "data: [DONE]\n\n";
}
function anthropicSse(target, mode = "success", args = '{"path":"safe"}') {
  const prefix = [
    { type: "message_start", message: { id: "synthetic-response", type: "message", role: "assistant", model: `${target.id}-backend`, content: [], stop_reason: null, stop_sequence: null,
      container: null, diagnostics: null, stop_details: null,
      usage: { input_tokens: 60, output_tokens: 0, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 6, ephemeral_1h_input_tokens: 4 },
        inference_geo: null, output_tokens_details: null, server_tool_use: null, service_tier: null } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "héllo" } },
  ].map(anthropicFrame).join("");
  if (mode === "abort" || mode === "unfinished") return prefix;
  if (mode === "error") return prefix + anthropicFrame({ type: "error", error: { type: "overloaded_error", message: "synthetic stream failure" } });
  return prefix + [
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "stream_call", name: rawTool.name, input: {}, caller: { type: "direct" } } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: args.slice(0, 9) } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: args.slice(9) } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null, container: null, stop_details: null },
      usage: { output_tokens: 20, input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null, output_tokens_details: { thinking_tokens: 7 }, server_tool_use: null } },
    { type: "message_stop" },
  ].map(anthropicFrame).join("");
}
let fetchCalls = 0;
function transport(target, mode = "success", args) {
  const calls = [], state = { closed: false, cancelled: 0, aborted: 0, listeners: 0 };
  let response;
  const fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.equal(url, target.baseUrl + (target.api === "openai-completions" ? "/chat/completions" : "/v1/messages?beta=true"));
    assert.equal(init.method, "POST");
    assert.ok(init.signal instanceof AbortSignal);
    fetchCalls++;
    calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const text = target.api === "openai-completions" ? openaiSse(target, mode, args) : anthropicSse(target, mode, args);
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream({
      start(controller) {
        // Split inside a multi-byte character so the real SSE decoder must retain UTF-8 state.
        const split = bytes.indexOf(0xc3) + 1;
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        if (mode !== "abort") { controller.close(); state.closed = true; return; }
        state.listeners++;
        const abort = () => {
          state.aborted++;
          state.listeners--;
          init.signal.removeEventListener("abort", abort);
          controller.error(new DOMException("Synthetic transport aborted", "AbortError"));
        };
        init.signal.addEventListener("abort", abort, { once: true });
      },
      cancel() { state.cancelled++; },
    });
    response = new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-fixture-response": "synthetic" } });
    return response;
  };
  return { fetch, calls, state, get response() { return response; } };
}
async function request(target, context = history(target), options = {}, mode = "success", args) {
  const wire = transport(target, mode, args);
  const controller = new AbortController();
  const api = target.api === "openai-completions" ? openai : anthropic;
  const observed = { payload: 0, response: 0, events: 0 };
  const stream = api.streamSimple(target, context, {
    apiKey: "synthetic-not-a-credential", fetch: wire.fetch, maxRetries: 0, reasoning: "high", maxTokens: 2048, temperature: 0.4,
    signal: controller.signal, sessionId: "synthetic-session", env: {},
    onPayload(_payload, selected) { assert.equal(selected, target); observed.payload++; },
    onResponse(info, selected) { assert.equal(selected, target); assert.equal(info.status, 200); assert.equal(info.headers["x-fixture-response"], "synthetic"); observed.response++; },
    onProviderStreamEvent() { observed.events++; if (mode === "abort") controller.abort(); },
    ...options,
  });
  const result = stream.result(), events = [];
  for await (const event of stream) events.push(event);
  assert.equal(events.filter(e => ["done", "error"].includes(e.type)).length, 1);
  const terminal = events.at(-1);
  assert.equal(await result, terminal.message ?? terminal.error);
  assert.equal(await stream.result(), await result);
  if (wire.response) assert.equal(wire.response.body.locked, false, "The native parser releases its response reader");
  assert.equal(wire.state.listeners, 0);
  return { wire, events, message: await result, observed };
}
function costEstimate(message, target) {
  const u = message.usage, longWrite = u.cacheWrite1h ?? 0;
  assert.equal(u.cost.input, (target.cost.input / 1e6) * u.input);
  assert.equal(u.cost.output, (target.cost.output / 1e6) * u.output);
  assert.equal(u.cost.cacheRead, (target.cost.cacheRead / 1e6) * u.cacheRead);
  assert.equal(u.cost.cacheWrite, ((u.cacheWrite - longWrite) * target.cost.cacheWrite + longWrite * target.cost.input * 2) / 1e6);
  assert.equal(u.cost.total, u.cost.input + u.cost.output + u.cost.cacheRead + u.cost.cacheWrite);
  assert.equal(u.cost.totalFromProvider, false, "Generic proxies report token-based catalog estimates, not billed totals");
}
function success(result, target) {
  const { message, events, wire, observed } = result;
  assert.equal(events[0].type, "start");
  assert.equal(events.at(-1).type, "done");
  assert.equal(message.stopReason, "toolUse");
  assert.equal(message.api, target.api);
  assert.equal(message.provider, target.provider);
  assert.equal(message.model, target.id);
  assert.equal(message.responseModel, `${target.id}-backend`);
  assert.equal(message.responseId, "synthetic-response");
  assert.equal(message.content.find(b => b.type === "text").text, "héllo");
  const call = message.content.find(b => b.type === "toolCall");
  assert.deepEqual(call.arguments, { path: "safe" });
  assert.deepEqual(ai.validateToolCall([rawTool], call), { path: "safe" });
  assert.equal(wire.calls.length, 1);
  assert.equal(observed.payload, 1);
  assert.equal(observed.response, 1);
  assert.ok(observed.events > 2);
  assert.equal(wire.state.closed, true);
  assert.equal(message.usage.totalTokens, 120);
  costEstimate(message, target);
}

test.after(() => {
  assert.equal(fetchCalls, 28);
  console.log(JSON.stringify({ injectedFetchCalls: fetchCalls, configuredOpenAIModelsRepresented: 17, anthropicOverrides: 1 }));
});

test("native export and compiler bindings reject incompatible declarations", () => {
  assert.equal(ai.PI_AI_VERSION, "1.5.2");
  assert.equal(ai.Type, undefined);
  assert.equal(groups.reduce((n, group) => n + group.count, 0), 17);
  assert.ok(groups.every(group => model(group).compat.requiresToolsWithToolHistory === undefined));
  const ts = require(join(compiler, "typescript"));
  const filename = join(process.env.TMPDIR, "c6b-native-contract.ts");
  const sseData = text => text.split("\n\n").map(frame => frame.split("\n").find(line => line.startsWith("data: "))?.slice(6)).filter(data => data && data !== "[DONE]").map(data => JSON.parse(data));
  const source = `import { normalizeContext, type Model, type Tool, type AssistantMessage, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages/messages";
type ProxyChunk = Omit<ChatCompletionChunk, "choices"> & { choices: Array<Omit<ChatCompletionChunk.Choice, "delta"> & { delta: ChatCompletionChunk.Choice.Delta & { reasoning_content?: string } }> };
export const completionEvents: ProxyChunk[] = ${JSON.stringify(sseData(openaiSse(model())))};
export const messageEvents: RawMessageStreamEvent[] = ${JSON.stringify(sseData(anthropicSse(anthropicModel)))};
import { streamSimple as completions, stream, type OpenAICompletionsOptions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as messages, type AnthropicOptions } from "@earendil-works/pi-ai/api/anthropic-messages";
export const a: Model<"openai-completions"> = ${JSON.stringify(model())};
export const categories: Model<"openai-completions">[] = ${JSON.stringify(groups.map(model))};
export const b: Model<"anthropic-messages"> = ${JSON.stringify(anthropicModel)};
export const tool: Tool = ${JSON.stringify(strictTool)};
export const context = normalizeContext({ messages: ${JSON.stringify(history(model()).messages)} });
export const options: SimpleStreamOptions = { apiKey: "synthetic", fetch: async () => new Response(""), headers: { "x-null": null }, reasoning: "high" };
export const detailed: OpenAICompletionsOptions = { ...options, reasoningEffort: "high" };
export const adaptive: AnthropicOptions = { ...options, thinkingEnabled: true, effort: "high" };
export const aStream = completions(a, context, options);
export const bStream = messages(b, context, options);
export const directStream = stream(a, context, detailed);
export const result: Promise<AssistantMessage> = bStream.result();
export const responseModel: AssistantMessage["responseModel"] = "synthetic-backend";
`;
  const declarations = { ...Object.fromEntries(Object.entries(paths).map(([name, file]) => [name, file.replace(/\.js$/, ".d.ts")])),
    "openai/resources/chat/completions": join(modules, "openai/resources/chat/completions/completions.d.ts"),
    "@anthropic-ai/sdk/resources/messages/messages": join(modules, "@anthropic-ai/sdk/resources/messages/messages.d.ts") };
  const options = { strict: true, noUnusedLocals: true, noUnusedParameters: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ["node"], typeRoots: [join(compiler, "@types")], paths: Object.fromEntries(Object.entries(declarations).map(([name, file]) => [name, [file]])) };
  function diagnostics(text) {
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (file, language, ...rest) => file === filename ? ts.createSourceFile(file, text, language) : original(file, language, ...rest);
    const program = ts.createProgram([filename], options, host);
    for (const file of Object.values(declarations)) assert.ok(program.getSourceFile(file), `Missing native declaration: ${file}`);
    return ts.getPreEmitDiagnostics(program);
  }
  assert.deepEqual(diagnostics(source).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  for (const extra of ['export const wrong: AssistantMessage["responseModel"] = 1;', 'export const wrong: OpenAICompletionsOptions = { reasoningEffort: "off" };', 'export const wrong: AnthropicOptions = { headers: { "x-invalid": 1 } };']) {
    assert.deepEqual(diagnostics(source + extra).map(d => d.code), [2322]);
  }
  console.log(JSON.stringify({ nativeBindings: paths, compiler: join(compiler, "typescript"), declarations, fixtureGroups: groups.map(({ name, count }) => ({ name, count })) }));
});

for (const group of groups) {
  test(`OpenAI category ${group.name} (${group.count} configured models): request, history and streamed provenance`, async () => {
    const target = model(group), context = history(target), before = structuredClone(context);
    const result = await request(target, context);
    success(result, target);
    const body = result.wire.calls[0].body;
    assert.equal(body.model, target.id);
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 2048);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.store, undefined);
    assert.equal(body.temperature, 0.4);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal(body.messages[0].role, group.provider === "fixture-a" ? "system" : "developer");
    assert.match(body.messages[0].content, /Initial synthetic instructions[\s\S]*Updated synthetic instructions[\s\S]*Keep the safety boundary/);
    assert.equal(body.messages.filter(m => ["system", "developer"].includes(m.role)).length, 1);
    const replay = body.messages.find(m => m.role === "assistant");
    assert.equal(replay.tool_calls[0].function.name, "fixture_retired");
    assert.deepEqual(JSON.parse(replay.tool_calls[0].function.arguments), { path: "safe" });
    assert.equal(replay.reasoning_content, group.compat.requiresReasoningContentOnAssistantMessages ? "" : undefined);
    assert.equal(body.messages.find(m => m.role === "tool").tool_call_id, "history_call");
    assert.equal(body.messages.find(m => m.role === "tool").content, "synthetic result");
    assert.deepEqual(body.tools, [{ type: "function", function: { name: rawTool.name, description: rawTool.description, parameters: rawTool.parameters } }]);
    assert.equal(body.reasoning_effort, group.compat.supportsReasoningEffort === false ? undefined : "high");
    assert.deepEqual(body.thinking, group.compat.thinkingFormat === "deepseek" ? { type: "enabled" } : undefined);
    assert.equal(result.message.usage.input, 60);
    assert.equal(result.message.usage.reasoning, 7);
    assert.equal(result.message.usage.cacheRead, 30);
    assert.equal(result.message.usage.cacheWrite, 10);
    assert.deepEqual(context, before, "Request conversion must not rewrite the stored transcript or raw schema");
    const empty = await request(target, history(target, []), { reasoning: undefined, maxTokens: undefined, temperature: undefined });
    assert.equal(empty.wire.calls[0].body.max_tokens, target.maxTokens);
    assert.equal(empty.wire.calls[0].body.temperature, undefined);
    assert.equal(Object.hasOwn(empty.wire.calls[0].body, "tools"), false);
    assert.equal(empty.wire.calls[0].body.reasoning_effort, undefined);
    if (group.compat.thinkingFormat === "deepseek") assert.deepEqual(empty.wire.calls[0].body.thinking, { type: "disabled" });
  });
}

test("tools stay omitted without history; only an explicit synthetic opt-in emits an empty list with history", async () => {
  const target = model(), optedIn = { ...target, compat: { ...target.compat, requiresToolsWithToolHistory: true } };
  const noHistory = ai.normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] });
  for (const selected of [target, optedIn]) {
    const empty = await request(selected, noHistory);
    assert.equal(Object.hasOwn(empty.wire.calls[0].body, "tools"), false);
  }
  const withHistory = await request(optedIn, history(optedIn, []));
  assert.deepEqual(withHistory.wire.calls[0].body.tools, []);
  assert.equal(target.compat.requiresToolsWithToolHistory, undefined);
});

test("native model/request headers override and null suppresses defaults for both APIs", async () => {
  for (const base of [model(), anthropicModel]) {
    const target = { ...base, headers: { "x-model": "synthetic", "x-layer": "model", "x-remove": "model" } };
    const result = await request(target, history(target), { headers: { "x-layer": "request", "x-remove": null, "user-agent": null } });
    assert.equal(result.message.stopReason, "toolUse");
    if (base.api === "anthropic-messages") assert.equal(result.wire.calls[0].body.tools[0].strict, undefined);
    const headers = result.wire.calls[0].headers;
    assert.equal(headers.get("x-model"), "synthetic");
    assert.equal(headers.get("x-layer"), "request");
    assert.equal(headers.has("x-remove"), false);
    assert.equal(headers.has("user-agent"), false);
    assert.equal(headers.get(base.api === "openai-completions" ? "authorization" : "x-api-key"), base.api === "openai-completions" ? "Bearer synthetic-not-a-credential" : "synthetic-not-a-credential");
    const noKey = await request(base, history(base), { apiKey: undefined, headers: { authorization: "Bearer synthetic-header-only" } });
    assert.equal(noKey.message.stopReason, "toolUse");
    assert.equal(noKey.wire.calls[0].headers.get("authorization"), "Bearer synthetic-header-only");
  }
});

test("Anthropic override uses normal messages, adaptive thinking, suppressed temperature and supported strict tools", async () => {
  const context = history(anthropicModel, [strictTool]), before = structuredClone(context);
  const result = await request(anthropicModel, context);
  success(result, anthropicModel);
  const { body, headers, url } = result.wire.calls[0];
  assert.ok(url.startsWith(anthropicModel.baseUrl));
  assert.ok(!url.startsWith(model().baseUrl));
  assert.equal(body.model, anthropicModel.id);
  assert.equal(body.max_tokens, 2048);
  assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(body.output_config, { effort: "high" });
  assert.equal(body.temperature, undefined);
  assert.equal(body.thread, undefined);
  assert.doesNotMatch(headers.get("anthropic-beta") ?? "", /message-threads/);
  assert.match(body.system[0].text, /Initial synthetic instructions[\s\S]*Updated synthetic instructions/);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].strict, true);
  assert.equal(body.tools[0].eager_input_streaming, true);
  assert.deepEqual(body.tools[0].input_schema, { ...strictTool.parameters, properties: { path: { type: "string" }, limit: { anyOf: [{ type: "integer" }, { type: "null" }] } }, required: ["path", "limit"] });
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(body.tools[0].cache_control, { type: "ephemeral" });
  assert.ok(body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === "tool_use" && b.name === "fixture_retired")));
  assert.ok(body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === "tool_result" && b.tool_use_id === "history_call")));
  assert.equal(result.message.usage.input, 60, "A delta with null input/cache counts preserves message_start usage");
  assert.equal(result.message.usage.reasoning, 7);
  assert.equal(result.message.usage.cacheRead, 30);
  assert.equal(result.message.usage.cacheWrite, 10);
  assert.equal(result.message.usage.cacheWrite1h, 4);
  assert.deepEqual(context, before);
  const unsupported = { ...rawTool, constrainedSampling: { type: "json_schema", strict: "require" } };
  const rejected = await request(anthropicModel, history(anthropicModel, [unsupported]));
  assert.equal(rejected.message.stopReason, "error");
  assert.match(rejected.message.errorMessage, /minimum.*unsupported/);
  assert.equal(rejected.wire.calls.length, 0);
  const preferred = { ...unsupported, constrainedSampling: { type: "json_schema", strict: "prefer" } };
  const fallback = await request(anthropicModel, history(anthropicModel, [preferred]));
  assert.equal(fallback.message.stopReason, "toolUse");
  assert.equal(fallback.wire.calls[0].body.tools[0].strict, undefined);
  assert.deepEqual(fallback.wire.calls[0].body.tools[0].input_schema.properties, rawTool.parameters.properties);
  const off = await request(anthropicModel, history(anthropicModel, []), { reasoning: undefined, maxTokens: undefined });
  assert.equal(off.wire.calls[0].body.max_tokens, anthropicModel.maxTokens);
  assert.equal(off.wire.calls[0].body.temperature, undefined, "The configured temperature flag applies even without thinking");
  assert.deepEqual(off.wire.calls[0].body.thinking, { type: "disabled" });
  assert.equal(Object.hasOwn(off.wire.calls[0].body, "tools"), false);
});

for (const target of [model(), anthropicModel]) {
  test(`${target.api}: streamed error, incomplete response and abort release readers and finish once`, async () => {
    for (const mode of ["error", "unfinished", "abort"]) {
      const result = await request(target, history(target), {}, mode);
      assert.equal(result.events[0].type, "start");
      assert.equal(result.events.at(-1).type, "error");
      assert.equal(result.message.stopReason, mode === "abort" ? "aborted" : "error");
      assert.equal(result.message.responseModel, `${target.id}-backend`);
      assert.equal(result.wire.calls.length, 1);
      if (mode === "error") assert.match(result.message.errorMessage, /synthetic stream failure/);
      if (mode === "unfinished") assert.match(result.message.errorMessage, /without finish_reason|before message_stop/);
      if (mode === "abort") assert.equal(result.wire.state.aborted, 1);
      if (target.api === "anthropic-messages") {
        assert.equal(result.message.usage.input, 60);
        assert.equal(result.message.usage.cacheRead, 30);
        assert.equal(result.message.usage.cacheWrite1h, 4);
        costEstimate(result.message, target);
      } else assert.deepEqual(result.message.usage, zeroUsage());
      assert.notEqual(result.message.usage.cost.totalFromProvider, true);
    }
  });
  test(`${target.api}: missing auth, pre-abort and unsupported strict requests cannot reach fetch`, async () => {
    const api = target.api === "openai-completions" ? openai : anthropic;
    assert.throws(() => api.streamSimple(target, history(target), { env: {} }), /API key|authentication/i);
    const controller = new AbortController();
    controller.abort();
    const aborted = await request(target, history(target), { signal: controller.signal });
    assert.equal(aborted.message.stopReason, "aborted");
    assert.equal(aborted.wire.calls.length, 0);
    const badTool = { ...strictTool, parameters: { type: "object", properties: { value: { $ref: "#/$defs/value" } }, $defs: { value: { type: "string" } } } };
    const rejected = await request(target, history(target, [badTool]));
    assert.equal(rejected.message.stopReason, "error");
    assert.match(rejected.message.errorMessage, /requires JSON-schema constrained sampling/);
    assert.equal(rejected.wire.calls.length, 0);
  });
  test(`${target.api}: raw schemas and parsed unsafe keys do not bypass validation`, async () => {
    const result = await request(target, history(target), {}, "success", '{"path":"safe","__proto__":{"polluted":true}}');
    const call = result.message.content.find(b => b.type === "toolCall");
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.getPrototypeOf(call.arguments), Object.prototype);
    assert.ok(Object.hasOwn(call.arguments, "__proto__"));
    assert.throws(() => ai.validateToolCall([rawTool], call), /Validation failed|unsafe|forbidden/i);
    assert.equal(Object.prototype.polluted, undefined);
    assert.throws(() => ai.validateToolCall([], call), /not found/);
  });
}
