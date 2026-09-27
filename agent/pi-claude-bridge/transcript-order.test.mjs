// Run: node --test agent/pi-claude-bridge/transcript-order.test.mjs
// Version-pinned regression, not a claim of full bridge compatibility.
// Real Pi lifecycle, bridge and SDK serialization; only the CLI transport/replies are fake.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { patchTranscriptSource } from "./reapply-transcript-order-patch.mjs";

// Preview the same guarded patch in memory before changing the installed source.
const previewPatch = process.env.PI_CLAUDE_BRIDGE_TEST_PATCH === "1";
const packages = new URL("../npm/node_modules/", import.meta.url);
const bridgeSource = new URL("pi-claude-bridge/src/", packages);
const piRoot = new URL("@earendil-works/pi-coding-agent/", packages);
const aiRoot = new URL("@earendil-works/pi-ai/", packages);
const sdkRoot = new URL("@anthropic-ai/claude-agent-sdk/", packages);

function pinVersion(root, version) {
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(manifest.version, version, `${manifest.name}: recheck expectations before changing this pin`);
}

function isolate(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-bridge-transcript-"));
  const env = { ...process.env };
  const cwd = process.cwd();
  for (const name of Object.keys(process.env)) delete process.env[name];
  for (const name of ["home", "agent", "cache", "config", "claude", "tmp", "workspace", "bin"]) {
    mkdirSync(join(root, name));
  }
  Object.assign(process.env, {
    HOME: join(root, "home"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_CONFIG_HOME: join(root, "config"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    TMPDIR: join(root, "tmp"),
    PATH: join(root, "bin"),
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  });
  process.chdir(join(root, "workspace"));
  writeFileSync(join(root, "agent", "claude-bridge.json"), JSON.stringify({
    startupNoticeShown: "offline-test",
    askClaude: { enabled: false },
    provider: { plan: "pro", longContextExtraUsage: false },
  }));
  const attempts = [];
  const block = (label) => () => {
    attempts.push(label);
    throw new Error(`Offline fixture blocked ${label}`);
  };
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
    // A dependency may catch an exception. Such an attempt still fails the test.
    assert.deepEqual(attempts, [], "no network, browser, or real subprocess attempts");
  });
  return root;
}

function loadBridgeTypescript(t) {
  // Node does not strip TypeScript in node_modules. Transform only this installed
  // bridge in memory, including its .js-to-.ts imports, without changing any source.
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.startsWith(bridgeSource.href) && specifier.startsWith("./") && specifier.endsWith(".js")) {
        return next(new URL(specifier.slice(0, -3) + ".ts", context.parentURL).href, context);
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith(bridgeSource.href) && url.endsWith(".ts")) {
        let source = readFileSync(new URL(url), "utf8");
        if (previewPatch && url === new URL("transcript.ts", bridgeSource).href) source = patchTranscriptSource(source);
        return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(
          source, { mode: "transform", sourceUrl: url },
        ) };
      }
      return next(url, context);
    },
  });
  t.after(() => hooks.deregister());
}

function fakeSdkTransport(t, root) {
  const requests = [];
  const key = Symbol.for("pi-bridge-transcript-test:spawn");
  assert.equal(globalThis[key], undefined);
  globalThis[key] = (options) => {
    assert.equal(options.command, join(root, "bin", "never-execute-claude"));
    assert.equal(options.cwd, join(root, "workspace"));
    assert.equal(options.env.HOME, join(root, "home"));
    assert.equal(options.env.CLAUDE_CONFIG_DIR, join(root, "claude"));
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.killed = false;
    child.exitCode = null;
    const request = { args: options.args, frames: [], child };
    requests.push(request);
    const send = (message) => child.stdout.write(JSON.stringify(message) + "\n");
    const finish = () => {
      if (child.exitCode !== null) return;
      child.exitCode = 0;
      child.stdout.end();
      child.emit("exit", 0, null);
    };
    child.kill = () => { child.killed = true; finish(); return true; };
    let pending = "";
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        try {
          pending += chunk.toString();
          let end;
          while ((end = pending.indexOf("\n")) !== -1) {
            const frame = JSON.parse(pending.slice(0, end));
            pending = pending.slice(end + 1);
            request.frames.push(frame);
            if (frame.type === "control_request") {
              assert.equal(frame.request.subtype, "initialize", "only the SDK handshake is expected");
              send({ type: "control_response", response: {
                subtype: "success", request_id: frame.request_id,
                response: { commands: [], agents: [], models: [] },
              } });
            } else {
              assert.equal(frame.type, "user");
              send({ type: "result", subtype: "success", is_error: false,
                result: "synthetic reply", session_id: "00000000-0000-4000-8000-000000000001",
                uuid: "00000000-0000-4000-8000-000000000002", duration_ms: 0, duration_api_ms: 0,
                num_turns: 1, total_cost_usd: 0, modelUsage: {}, permission_denials: [],
                usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              });
            }
          }
          callback();
        } catch (error) { callback(error); }
      },
      final(callback) { callback(); finish(); },
    });
    return child;
  };
  // Keep the installed query() and its wire encoder. Inject only its documented
  // transport seam, with a nonexistent path so no executable can be selected.
  const sdkUrl = new URL("sdk.mjs", sdkRoot).href;
  const facade = "data:text/javascript," + encodeURIComponent(`
    export * from ${JSON.stringify(sdkUrl)};
    import { query as realQuery } from ${JSON.stringify(sdkUrl)};
    export function query({ prompt, options }) {
      return realQuery({ prompt, options: { ...options,
        pathToClaudeCodeExecutable: ${JSON.stringify(join(root, "bin", "never-execute-claude"))},
        spawnClaudeCodeProcess: globalThis[Symbol.for("pi-bridge-transcript-test:spawn")],
      } });
    }
  `);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "@anthropic-ai/claude-agent-sdk" && context.parentURL?.startsWith(bridgeSource.href)) {
        return { url: facade, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  t.after(() => {
    for (const { child } of requests) child.stdin.end();
    hooks.deregister();
    delete globalThis[key];
  });
  return requests;
}

const tool = (name, description = name) => ({
  name, description, parameters: { type: "object", properties: {} },
});

test("bridge 0.8.0 / Pi 0.87.1 offline transcript ordering", { timeout: 30_000 }, async (t) => {
  const root = isolate(t);
  pinVersion(new URL("pi-claude-bridge/", packages), "0.8.0");
  pinVersion(piRoot, "0.87.1");
  pinVersion(aiRoot, "0.87.1");
  pinVersion(sdkRoot, "0.3.283");
  loadBridgeTypescript(t);
  const ai = await import(new URL("dist/index.js", aiRoot));
  const { toBridgeContext, nonSystemMessages } = await import(new URL("transcript.ts", bridgeSource));

  await t.test("literal replay oracle: base, updates, delete-readd, unknown sections, tool deltas", () => {
    const a = tool("alpha");
    const b = tool("beta");
    const a2 = tool("alpha", "updated alpha");
    const c = tool("gamma");
    const messages = [{
      role: "system", content: "base", timestamp: 1,
      sections: { preamble: "P", addendum: "A", cwd: "C", vendor_one: "X" },
      toolsAdded: [a, b],
    }, { role: "user", content: "synthetic user", timestamp: 2 }];
    const check = (piPrompt, bridgePrompt, tools) => {
      const normalized = toBridgeContext({ messages });
      assert.equal(ai.getCurrentSystemPrompt(messages), piPrompt);
      assert.equal(normalized.systemPrompt, bridgePrompt);
      assert.deepEqual(ai.getCurrentTools(messages), tools);
      assert.deepEqual(normalized.tools ?? [], tools);
      assert.deepEqual(normalized.messages, messages.filter((m) => m.role !== "system"));
    };
    check("base\n\nP\n\nA\n\nC\n\nX", "base\n\nP\n\nA\n\nC\n\nX", [a, b]);
    messages.push({ role: "system", timestamp: 3,
      content: [{ type: "text", text: "delta one" }, { type: "text", text: "delta two" }],
      sections: { addendum: "A2", vendor_one: "X2" }, toolsRemoved: [{ name: "beta" }], toolsAdded: [a2, c],
    });
    const prefix = "base\n\ndelta one\ndelta two\n\n";
    check(prefix + "P\n\nA2\n\nC\n\nX2", prefix + "P\n\nA2\n\nC\n\nX2", [a2, c]);
    messages.push({ role: "system", content: "", timestamp: 4,
      sections: { addendum: null }, toolsRemoved: [{ name: "alpha" }],
    });
    check(prefix + "P\n\nC\n\nX2", prefix + "P\n\nC\n\nX2", [c]);
    messages.push({ role: "system", content: "", timestamp: 5,
      sections: { addendum: "A3" }, toolsAdded: [a2],
    });
    check(prefix + "P\n\nC\n\nX2\n\nA3", prefix + "P\n\nA3\n\nC\n\nX2", [c, a2]);
    messages.push({ role: "system", content: "", timestamp: 6, sections: { vendor_two: "Y" } });
    // Pi's canonical builder puts unknown sections after built-ins, in replay order.
    check(prefix + "P\n\nC\n\nX2\n\nA3\n\nY", prefix + "P\n\nA3\n\nC\n\nX2\n\nY", [c, a2]);
    messages.push({ role: "system", content: "", timestamp: 7,
      toolsRemoved: [{ name: "alpha" }, { name: "gamma" }],
    });
    check(prefix + "P\n\nC\n\nX2\n\nA3\n\nY", prefix + "P\n\nA3\n\nC\n\nX2\n\nY", []);
  });

  await t.test("all known ranks precede stable unknowns; non-system history is unchanged", () => {
    const history = [
      { role: "user", content: "user", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "reply" }], timestamp: 2 },
      { role: "toolResult", toolCallId: "synthetic", toolName: "alpha", content: [], timestamp: 3 },
    ];
    const legacy = { messages: history, systemPrompt: "legacy", tools: [tool("alpha")] };
    assert.equal(toBridgeContext(legacy), legacy);
    const messages = [{ role: "system", content: "", sections: {
      vendor_z: "Z", cwd: "C", skills: "S", project_context: "PC", addendum: "A",
      vendor_a: "X", docs: "D", rules: "R", tools: "T", preamble: "P", vendor_m: "M",
    } }, ...history];
    assert.equal(toBridgeContext({ messages }).systemPrompt, "P\n\nT\n\nR\n\nD\n\nA\n\nPC\n\nS\n\nC\n\nZ\n\nX\n\nM");
    messages.push({ role: "system", content: "", sections: { vendor_z: null, vendor_a: "X2" } });
    messages.push({ role: "system", content: "", sections: { vendor_z: "Z2" } });
    const normalized = toBridgeContext({ messages });
    assert.equal(normalized.systemPrompt, "P\n\nT\n\nR\n\nD\n\nA\n\nPC\n\nS\n\nC\n\nX2\n\nM\n\nZ2");
    assert.deepEqual(normalized.messages, history);
    assert.deepEqual(nonSystemMessages(messages), history);
  });

  await t.test("real Pi capture lifecycle and SDK wire: addendum delete-readd, then unknown section", async (t) => {
    const requests = fakeSdkTransport(t, root);
    const bridge = await import(new URL("index.ts", bridgeSource));
    const piSdk = await import(new URL("dist/index.js", piRoot));
    const { loadExtensionFromFactory } = await import(new URL("dist/core/extensions/loader.js", piRoot));
    const cwd = process.cwd();
    const runtime = piSdk.createExtensionRuntime();
    const boundaries = [];
    let append = "portable addendum one";
    let vendorSection;
    const extension = await loadExtensionFromFactory((pi) => {
      pi.on("before_agent_start", (event) => {
        event.systemPromptOptions.appendSystemPrompt = append;
        if (vendorSection) event.systemPromptOptions.sections.vendor_one = vendorSection;
      });
      bridge.default(pi);
      for (const type of ["before_agent_start", "agent_start", "turn_start"]) {
        pi.on(type, (_event, ctx) => {
          const prompt = ctx.getSystemPrompt();
          boundaries.push({ type, prompt, source: bridge.__test.promptCaptures.resolve(prompt)?.source });
        });
      }
    }, cwd, piSdk.createEventBus(), runtime, fileURLToPath(new URL("index.ts", bridgeSource)));
    const provider = runtime.pendingProviderRegistrations.find(({ name }) => name === "claude-bridge").config;
    const model = { ...provider.models.find(({ id }) => id === "claude-sonnet-4-5"),
      provider: "claude-bridge", api: provider.api, baseUrl: provider.baseUrl };
    assert.equal(model.id, "claude-sonnet-4-5");
    const modelRuntime = await piSdk.ModelRuntime.create({
      authPath: join(root, "agent", "auth.json"), modelsPath: null,
      allowModelNetwork: false, refreshOnCreate: false,
    });
    const providerInputs = [];
    const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
    t.mock.method(modelRuntime, "streamSimple", (model, context, options) => {
      providerInputs.push(structuredClone(context));
      return streamSimple(model, context, options);
    });
    // No discovery: the session cannot load the user's extensions, prompts or history.
    const resourceLoader = {
      getExtensions: () => ({ extensions: [extension], errors: [], runtime }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => "portable custom",
      getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [],
      getAppendSystemPromptSources: () => [],
      extendResources: () => {}, reload: async () => {},
    };
    const settingsManager = piSdk.SettingsManager.inMemory({
      cacheWarming: "off", compaction: { enabled: false }, retry: { enabled: false },
    });
    const { session } = await piSdk.createAgentSession({
      cwd, agentDir: join(root, "agent"), model, modelRuntime, thinkingLevel: "off",
      resourceLoader, settingsManager, tools: [], sessionManager: piSdk.SessionManager.inMemory(cwd),
    });
    t.after(async () => {
      await session.abort();
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
      session.dispose();
    });
    const errors = [];
    await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
    assert.equal(settingsManager.getCacheWarmingMode(), "off");

    const cwdSection = `<cwd>\n${cwd}\n</cwd>`;
    for (const [index, value] of ["portable addendum one", "", "portable addendum two", "portable addendum two"].entries()) {
      append = value;
      if (index === 3) vendorSection = "synthetic extension section";
      const user = `synthetic turn ${index + 1}`;
      await session.prompt(user);
      assert.deepEqual(errors, []);
      assert.equal(session.getLastAssistantText(), "synthetic reply");
      assert.equal(session.messages.at(-1).stopReason, "stop");
      assert.equal(session.messages.at(-1).errorMessage, undefined);
      assert.equal(requests.length, index + 1);
      const expectedPrompt = ["portable custom", value && `<addendum>\n${value}\n</addendum>`, cwdSection,
        vendorSection && `<vendor_one>\n${vendorSection}\n</vendor_one>`].filter(Boolean).join("\n\n");
      assert.deepEqual(boundaries.slice(index * 3), ["before_agent_start", "agent_start", "turn_start"]
        .map((type) => ({ type, prompt: expectedPrompt, source: type })));
      const context = providerInputs[index];
      assert.equal(toBridgeContext(context).systemPrompt, expectedPrompt);
      const capture = bridge.__test.promptCaptures.resolve(expectedPrompt);
      assert.ok(capture, "the replayed prompt has an exact capture key");
      assert.equal(capture.assembledPrompt, expectedPrompt);
      assert.equal(capture.source, "turn_start");
      assert.equal(bridge.__test.promptCaptures.resolve(expectedPrompt + "\n"), undefined, "lookup stays exact");
      assert.equal(capture.append, value);
      assert.equal(capture.custom, "portable custom");
      const { frames, args, child } = requests[index];
      assert.deepEqual(frames.map((frame) => frame.type), ["control_request", "user"]);
      assert.equal(frames[0].request.subtype, "initialize");
      assert.equal(frames[0].request.systemPrompt, undefined, "Claude's preset is not replaced by Pi's harness");
      assert.equal(frames[0].request.appendSystemPrompt, ["portable custom", value].filter(Boolean).join("\n\n"));
      assert.deepEqual(frames[1].message, { role: "user", content: [{ type: "text", text: user }] });
      assert.equal(args[args.indexOf("--tools") + 1], "");
      assert.ok(args.includes("--strict-mcp-config"));
      assert.equal(child.exitCode, 0);
      assert.equal(child.killed, false);
    }
    const readded = providerInputs[2];
    assert.ok(readded.messages.some((message) => message.sections?.addendum === null), "real Pi sent a deletion delta");
    assert.equal(ai.getCurrentSystemPrompt(readded.messages),
      `portable custom\n\n${cwdSection}\n\n<addendum>\nportable addendum two\n</addendum>`);
    assert.notEqual(ai.getCurrentSystemPrompt(readded.messages), boundaries[8].prompt);
    assert.equal(providerInputs.length, 4);
    assert.equal(requests.length, 4, "the unknown-section turn reaches the SDK");
    assert.equal(boundaries.length, 12);
    assert.equal(toBridgeContext(providerInputs[3]).systemPrompt, boundaries.at(-1).prompt);
  });
});
