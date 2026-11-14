import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = dirname(repository), out = process.env.PI_TEST_OUTPUT_DIR, modules = process.env.PI_TEST_NODE_MODULES;
const compiler = process.env.PI_TEST_COMPILER_NODE_MODULES;
for (const root of [out, modules, compiler]) {
  assert.ok(root && isAbsolute(root), "Explicit C8 output, SDK and compiler roots required");
  assert.equal(fs.realpathSync(root), root);
  assert.ok(root.startsWith(run + "/"));
}
assert.ok(out.startsWith(join(run, "reports") + "/"), "C8 output must be a canonical absolute child of RUN/reports");
assert.equal(process.version, "v26.13.1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
assert.equal(process.env.PI_OFFLINE, "1");
const { layout, localEntries, packages, hash, json } = await import(pathToFileURL(join(out, "layout.mjs")));
const { checkGuards } = await import(pathToFileURL(join(out, "guard.mjs")));
const piRoot = join(modules, "@earendil-works/pi-coding-agent");
for (const scope of ["@earendil-works", "@mariozechner"]) for (const name of ["pi-ai", "pi-coding-agent", "pi-agent-core", "pi-tui"]) {
  assert.equal(json(join(modules, scope, name, "package.json")).version, "1.5.2");
}
assert.equal(json(join(compiler, "typescript/package.json")).version, "6.0.3");
for (const pkg of packages) {
  assert.equal(json(join(modules, pkg.name, "package.json")).version, pkg.version);
  assert.deepEqual(json(join(modules, pkg.name, "package.json")).pi.extensions, [`./${pkg.entry}`]);
}
const pi = await import(pathToFileURL(join(piRoot, "dist/index.js")));
const ai = await import(pathToFileURL(join(modules, "@earendil-works/pi-ai/dist/index.js")));
assert.equal(pi.VERSION, "1.5.2");
assert.equal(pi.ModelRuntime, (await import(pathToFileURL(join(piRoot, "dist/core/model-runtime.js")))).ModelRuntime);
assert.equal(ai.Type, undefined, "Native SDK imports must not use the filesystem extension view");
pi.initTheme("dark", false);
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
const records = [], errors = [], requests = [], events = [];
const core = ["bash", "edit", "read", "write"], web = ["fetch_contents", "web_code_search", "web_search"];
const names = list => list.map(item => item.name).sort();
const noRetired = value => assert.doesNotMatch(JSON.stringify(value), /C8_RETIRED_|"(?:ctx_|codegraph_)[^"]*"/);
function environment(f, child = false) {
  process.env.PI_CODING_AGENT_DIR = f.agentDir;
  process.env.CLAUDE_CONFIG_DIR = join(f.root, "claude");
  if (child) process.env.PI_DELEGATED_CHILD = "1";
  else delete process.env.PI_DELEGATED_CHILD;
}
async function policy(f) {
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
  const source = await jiti.import(join(f.agentDir, "extensions/delegated-pi-loop/resources.ts"));
  const resources = source.readResourcesFile(join(f.agentDir, "extensions/delegated-pi-loop/resources.json"));
  return { source, resources };
}
function loaderOptions(args) {
  const options = { noExtensions: args.includes("--no-extensions"), noSkills: args.includes("--no-skills"), noPromptTemplates: args.includes("--no-prompt-templates"), noThemes: args.includes("--no-themes"), noContextFiles: args.includes("--no-context-files"), additionalExtensionPaths: [], additionalSkillPaths: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-e") options.additionalExtensionPaths.push(args[++i]);
    else if (args[i] === "--skill") options.additionalSkillPaths.push(args[++i]);
  }
  return options;
}
function inventory(session, loader, modelRuntime, phase, profile) {
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const entries = loaded.extensions.filter(e => !e.path.startsWith("<")).map(e => ({ path: e.path, resolvedPath: fs.realpathSync(e.resolvedPath), sha256: hash(e.resolvedPath), sourceInfo: e.sourceInfo, tools: [...e.tools.keys()], commands: [...e.commands.keys()], flags: [...e.flags.keys()], handlers: [...e.handlers.keys()] }));
  const tools = session.getAllTools(), active = session.getActiveToolNames().sort();
  const skills = loader.getSkills(), prompts = loader.getPrompts(), themes = loader.getThemes(), context = loader.getAgentsFiles().agentsFiles;
  const explicitOnly = skills.skills.filter(s => s.disableModelInvocation).map(s => s.name).sort();
  const diagnostics = [...skills.diagnostics, ...prompts.diagnostics, ...themes.diagnostics];
  const value = { phase, profile, entries, tools, active, stats: session.getSessionStats(), contextUsage: session.getContextUsage(), commands: loaded.runtime.getCommands(), providers: modelRuntime.getRegisteredProviderIds(), nativeProviders: modelRuntime.getProviders().map(p => p.id), skills, prompts, themes: themes.themes.map(t => ({ name: t.name, sourceInfo: t.sourceInfo })), themeDiagnostics: themes.diagnostics, context: context.map(c => ({ path: c.path, sha256: hash(c.path) })), explicitOnly, counts: { extensions: entries.length, allTools: tools.length, activeTools: active.length, skills: skills.skills.length, discoverableSkills: skills.skills.length - explicitOnly.length, explicitOnly: explicitOnly.length, collisions: diagnostics.filter(d => d.type === "collision").length, prompts: prompts.prompts.length, themes: themes.themes.length, context: context.length } };
  noRetired({ tools, active, prompts, systemPrompt: session.systemPrompt });
  assert.ok(!active.includes("AskClaude"));
  assert.ok(!active.includes("codemode") && !active.includes("tool_search"));
  assert.equal(session.settingsManager.getCacheWarmingMode(), "off");
  if (profile === "parent") {
    assert.equal(entries.length, localEntries.length + packages.length);
    for (const entry of localEntries) assert.ok(entries.some(e => e.path.endsWith(`/extensions/${entry}`)), entry);
    const accepted = new Map(json(join(out, "before.json")).graph.map(e => [e.path, e.sha256]));
    for (const pkg of packages) {
      const file = join(modules, pkg.name, pkg.entry), entry = entries.find(e => e.path === file || e.resolvedPath === file);
      assert.ok(entry, `Actual configured package entry: ${file}`);
      assert.equal(entry.sha256, accepted.get(relative(resolve(modules, "../../.."), file)));
      assert.equal(entry.sourceInfo.origin, "package");
      assert.equal(entry.sourceInfo.source, `npm:${pkg.name}@${pkg.version}`);
    }
    assert.deepEqual(explicitOnly, ["crit", "impeccable"]);
    assert.equal(skills.skills.filter(s => s.filePath.startsWith(join(process.env.PI_CODING_AGENT_DIR, "skills") + "/")).length, 39);
    const bundled = skills.skills.filter(s => s.sourceInfo.origin === "package");
    assert.ok(bundled.some(s => s.filePath.includes("/pi-btw/")));
    assert.ok(!bundled.some(s => s.filePath.includes("/pi-browser-harness/")), "Harness skills: [] stays explicit");
    assert.ok(active.includes("recall") && active.includes("delegate_run"));
    assert.equal(active.filter(n => n.startsWith("browser_")).length, 42);
    assert.deepEqual(themes.themes.map(t => t.name).sort(), ["dark", "light"]);
    assert.ok(context.some(c => c.path.endsWith("/agent/AGENTS.md")));
    assert.match(session.systemPrompt, /C8_PROJECT_POLICY/);
    assert.match(session.systemPrompt, /Global Agent Instructions/);
  } else {
    let expectedEntries = ["openai-codex-aliases/index.ts", "claude-bridge-provider/delegate-entry.ts"];
    if (profile !== "catalog") expectedEntries = ["delegated-pi-loop/index.ts", "openai-codex-aliases/index.ts", "web-search/index.ts", "fastlane/index.ts", "claude-bridge-provider/delegate-entry.ts"];
    assert.deepEqual(entries.map(e => e.path.split("/extensions/")[1]), expectedEntries);
    assert.deepEqual(active, profile === "catalog" ? core : [...core, ...web].sort());
    assert.ok(!tools.some(t => /^(?:delegate_|browser_|AskClaude|ctx_|codegraph_)/.test(t.name)));
    assert.equal(prompts.prompts.length, 0); assert.equal(themes.themes.length, 0);
    assert.equal(context.length, profile === "catalog" ? 0 : 2);
    if (profile !== "catalog") assert.match(session.systemPrompt, /C8_PROJECT_POLICY/);
    else assert.doesNotMatch(session.systemPrompt, /C8_PROJECT_POLICY|Global Agent Instructions/);
  }
  records.push(value); return value;
}

// These are real resource loaders and native sessions. Only provider replies are synthetic.
async function sdkFixture(f, args = [], profile = "parent") {
  environment(f, profile !== "parent");
  const faux = ai.fauxProvider({ provider: "c8-offline", models: [{ id: "fixture", contextWindow: 500000, maxTokens: 128 }], tokensPerSecond: 0 });
  faux.setResponses(Array.from({ length: 8 }, (_, i) => context => {
    requests.push({ profile, call: i + 1, context: structuredClone(context) });
    return ai.fauxAssistantMessage(`C8_FINITE_REPLY_${i + 1}`);
  }));
  const create = async ({ sessionManager, sessionStartEvent }) => {
    const modelRuntime = await pi.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = pi.SettingsManager.create(f.cwd, f.agentDir);
    const resourceLoader = new pi.DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager, ...loaderOptions(args), extensionFactories: [api => {
      for (const type of ["session_start", "resources_discover", "session_shutdown", "session_tree", "session_before_compact", "session_compact", "agent_start", "agent_end", "agent_settled"]) api.on(type, event => { events.push({ profile, type, reason: event.reason, oldLeafId: event.oldLeafId, newLeafId: event.newLeafId }); });
      api.on("tool_call", () => { errors.push("Unexpected tool call"); return { block: true, reason: "C8 must never execute tools" }; });
    }] });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    records.push({ phase: "provider-registration", profile, compatibility: resourceLoader.getExtensions().runtime.pendingProviderRegistrations.map(r => ({ name: r.name, extensionPath: r.extensionPath })), native: resourceLoader.getExtensions().runtime.pendingNativeProviderRegistrations.map(r => ({ name: r.provider.id, extensionPath: r.extensionPath })) });
    const result = await pi.createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, settingsManager, resourceLoader, modelRuntime, model: faux.getModel(), thinkingLevel: "off", sessionManager, sessionStartEvent });
    assert.deepEqual(result.extensionsResult.errors, []);
    return { ...result, services: { cwd: f.cwd, agentDir: f.agentDir, settingsManager, resourceLoader, modelRuntime, diagnostics: [] }, diagnostics: [] };
  };
  const runtime = await pi.createAgentSessionRuntime(create, { cwd: f.cwd, agentDir: f.agentDir, sessionManager: pi.SessionManager.create(f.cwd, join(f.root, "sessions")) });
  runtime.setRebindSession(session => session.bindExtensions({ mode: "rpc", onError: error => errors.push(error) }));
  await runtime.session.bindExtensions({ mode: "rpc", onError: error => errors.push(error) });
  const snap = phase => inventory(runtime.session, runtime.services.resourceLoader, runtime.services.modelRuntime, phase, profile);
  return { runtime, faux, snap };
}

test("SDK parent: configured active source/packages survive reload, resume, tree and compaction", { timeout: 60000 }, async () => {
  checkGuards();
  const f = layout("sdk-parent", modules), { runtime, faux, snap } = await sdkFixture(f);
  const { checkFooter } = await import(pathToFileURL(join(out, "footer-check.mjs")));
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
  const formatter = await jiti.import(join(f.agentDir, "extensions/footer/token-format.ts"));
  const footerEvidence = [];
  try {
    const initial = snap("initial");
    assert.equal(faux.state.callCount, 0, "Initialization makes no inference");
    await runtime.session.prompt("C8 first synthetic user message");
    await runtime.session.prompt("C8 second synthetic user message");
    assert.equal(faux.state.callCount, 2);
    const firstAssistant = runtime.session.sessionManager.getEntries().find(e => e.type === "message" && e.message.role === "assistant");
    const leaf = runtime.session.sessionManager.getLeafId();
    assert.notEqual(firstAssistant.id, leaf);
    assert.equal((await runtime.session.navigateTree(firstAssistant.id, { summarize: false })).cancelled, false);
    assert.equal(runtime.session.sessionManager.getLeafId(), firstAssistant.id);
    assert.deepEqual(snap("tree-moved").active, initial.active);
    assert.equal((await runtime.session.navigateTree(leaf, { summarize: false })).cancelled, false);
    assert.equal(runtime.session.sessionManager.getLeafId(), leaf);
    assert.deepEqual(snap("tree-restored").active, initial.active);
    await runtime.session.reload();
    assert.deepEqual(snap("reloaded").active, initial.active);
    const sessionFile = runtime.session.sessionFile;
    assert.equal((await runtime.switchSession(sessionFile)).cancelled, false);
    assert.deepEqual(snap("resumed").active, initial.active);
    // RPC skips footer installation, so call the unchanged formatter on the current native session.
    footerEvidence.push(checkFooter(runtime.session, formatter, "before-compaction"));
    const compacted = await runtime.session.compact("Keep the synthetic user policy intact.");
    footerEvidence.push(checkFooter(runtime.session, formatter, "immediately-after-compaction"));
    assert.ok(compacted.summary.length > 0);
    assert.ok(runtime.session.sessionManager.getEntries().some(e => e.type === "compaction"));
    assert.deepEqual(snap("compacted").active, initial.active);
    await runtime.session.prompt("C8 post-compaction synthetic user message");
    footerEvidence.push(checkFooter(runtime.session, formatter, "after-post-compaction-reply"));
    assert.ok(footerEvidence.some(e => Math.floor(e.latestPercent) !== Math.round(e.latestPercent)), "Native history must expose cache-hit flooring, not only rounding-equivalent values");
    fs.writeFileSync(join(f.root, "footer-evidence.json"), JSON.stringify(footerEvidence, null, 2));
    assert.deepEqual(snap("post-compaction").active, initial.active);
    assert.ok(faux.state.callCount >= 3 && faux.state.callCount <= 5, "Finite fake turns and at most native compaction summary calls");
    assert.equal(runtime.session.getSessionStats().toolCalls, 0);
    const billedEntries = runtime.session.sessionManager.getEntries().filter(e => e.type === "compaction" || (e.type === "message" && e.message.role === "assistant"));
    const billedTokens = billedEntries.reduce((sum, e) => sum + (e.message?.usage?.totalTokens ?? e.usage?.totalTokens ?? 0), 0);
    assert.ok(billedTokens > 0);
    assert.equal(runtime.session.getSessionStats().tokens.total, billedTokens, "Lifetime usage includes actual faux estimates from pre-compaction messages");
    assert.equal(runtime.services.resourceLoader.getExtensions().runtime.flagValues.get("fastlane"), false);
    const footer = runtime.services.resourceLoader.getExtensions().extensions.find(e => e.path.endsWith("/footer/index.ts"));
    assert.ok(footer.handlers.has("agent_settled"));
    const flags = runtime.services.resourceLoader.getExtensions().extensions.flatMap(e => [...e.flags.values()]);
    assert.ok(flags.some(flag => flag.name === "fastlane" && flag.default === false));
  } finally { await runtime.dispose(); }
  assert.deepEqual(errors, []);
  assert.ok(events.some(e => e.profile === "parent" && e.type === "session_shutdown" && e.reason === "quit"));
  fs.writeFileSync(join(f.root, "sdk-evidence.json"), JSON.stringify({ records, events, requests }, null, 2));
});

test("SDK strict policy: exact runtime/catalog initialization and selected-skill progressive discovery", { timeout: 60000 }, async () => {
  const f = layout("sdk-child", modules), { source, resources } = await policy(f);
  const selection = source.buildDelegateResourceSelection(resources);
  assert.deepEqual(resources.runtimeExtensions.map(p => relative(join(f.agentDir, "extensions"), p)), ["delegated-pi-loop/index.ts", "openai-codex-aliases/index.ts", "web-search/index.ts", "fastlane/index.ts", "claude-bridge-provider/delegate-entry.ts"]);
  assert.deepEqual(resources.catalogExtensions.map(p => relative(join(f.agentDir, "extensions"), p)), ["openai-codex-aliases/index.ts", "claude-bridge-provider/delegate-entry.ts"]);
  for (const name of ["unknown-c8", "crit", "impeccable", "pi-browser-harness"]) assert.throws(() => source.buildDelegateResourceSelection(resources, [name]), /not approved/);
  for (const profile of ["runtime", "catalog"]) {
    selection[profile === "runtime" ? "verifyRuntimeSpawn" : "verifyCatalogSpawn"]();
    const child = await sdkFixture(f, selection[profile === "runtime" ? "runtimeArgs" : "catalogArgs"], profile);
    try { assert.equal(child.snap("initialized").counts.skills, 0); assert.equal(child.faux.state.callCount, 0); }
    finally { await child.runtime.dispose(); }
  }
  const selected = source.buildDelegateResourceSelection(resources, ["uv", "uv"]);
  const child = await sdkFixture(f, selected.runtimeArgs, "runtime");
  try {
    const value = child.snap("selected-uv");
    assert.deepEqual(value.skills.skills.map(s => s.name), ["uv"]);
    const prompt = child.runtime.session.systemPrompt;
    assert.match(prompt, /<name>uv<\/name>/);
    const body = fs.readFileSync(join(f.agentDir, "skills/uv/SKILL.md"), "utf8").split("---").slice(2).join("---").trim();
    assert.ok(body.length > 200); assert.equal(prompt.includes(body), false, "Only metadata, never the selected skill body, enters initial context");
    for (const skill of [...f.skillRoots.filter(name => name !== "uv"), "unknown-c8"]) assert.ok(!prompt.includes(`<name>${skill}</name>`));
    await child.runtime.session.prompt("C8 selected-skill metadata only, no tool execution");
    const request = requests.findLast(r => r.profile === "runtime");
    assert.ok(!JSON.stringify(request.context).includes(JSON.stringify(body).slice(1, -1)));
    assert.deepEqual(names(ai.getCurrentTools(request.context.messages)), [...core, ...web].sort());
    await child.runtime.session.prompt("/skill:uv C8 explicit progressive expansion, without tools");
    const expanded = requests.findLast(r => r.profile === "runtime").context;
    assert.ok(expanded.messages.some(m => m.role === "user" && JSON.stringify(m.content).includes(JSON.stringify(body).slice(1, -1))), "The explicit native skill command loads the selected body");
    assert.equal(child.faux.state.callCount, 2);
    for (const skill of f.skillRoots.filter(name => name !== "uv")) {
      const unselected = fs.readFileSync(join(f.agentDir, "skills", skill, "SKILL.md"), "utf8").split("---").slice(2).join("---").trim();
      assert.ok(!JSON.stringify(expanded).includes(JSON.stringify(unselected).slice(1, -1)), `No unselected ${skill} body enters a request`);
    }
    const manager = child.runtime.session.sessionManager, leaf = manager.getLeafId();
    const earlier = manager.getEntries().find(e => e.type === "message" && e.message.role === "assistant");
    assert.equal((await child.runtime.session.navigateTree(earlier.id, { summarize: false })).cancelled, false);
    assert.notEqual(manager.getLeafId(), leaf);
    child.snap("selected-tree-moved");
    assert.equal((await child.runtime.session.navigateTree(leaf, { summarize: false })).cancelled, false);
    assert.equal(manager.getLeafId(), leaf);
    child.snap("selected-tree-restored");
    await child.runtime.session.reload(); assert.deepEqual(child.snap("selected-reload").skills.skills.map(s => s.name), ["uv"]);
    assert.equal((await child.runtime.switchSession(child.runtime.session.sessionFile)).cancelled, false);
    assert.deepEqual(child.snap("selected-resume").skills.skills.map(s => s.name), ["uv"]);
    assert.ok((await child.runtime.session.compact("Retain the synthetic policy.")).summary.length > 0);
    assert.deepEqual(child.snap("selected-compaction").skills.skills.map(s => s.name), ["uv"]);
    assert.equal(child.runtime.session.getSessionStats().toolCalls, 0);
  } finally { await child.runtime.dispose(); }
  // The production pre-spawn verifier must reject a path that changes after selection.
  const entry = resources.runtimeExtensions[2]; fs.renameSync(entry, `${entry}.saved`);
  try { assert.throws(selected.verifyRuntimeSpawn, /disappeared/); }
  finally { fs.renameSync(`${entry}.saved`, entry); }
  selected.verifyRuntimeSpawn(); selected.verifyCatalogSpawn();
  assert.deepEqual(errors, []);
  fs.writeFileSync(join(f.root, "sdk-evidence.json"), JSON.stringify({ records, events, requests }, null, 2));
});

async function rpc(f, cli, resourceArgs, profile) {
  const probe = join(out, "rpc-probe.ts"), report = join(f.root, "rpc.jsonl");
  const manager = pi.SessionManager.create(f.cwd, join(f.root, "sessions"));
  manager.appendMessage({ role: "user", content: "C8 synthetic persisted seed", timestamp: 1 });
  manager.appendMessage({ ...ai.fauxAssistantMessage("C8 synthetic persisted seed reply"), provider: "c8-offline", model: "fixture" });
  const seed = manager.getSessionFile();
  const env = { ...process.env, PI_CODING_AGENT_DIR: f.agentDir, CLAUDE_CONFIG_DIR: join(f.root, "claude"), C8_RPC_CHILD: "1", C8_PROBE_REPORT: report, PI_CACHE_WARMING: "off", NODE_OPTIONS: `--import=${out}/guard.mjs` };
  delete env.PI_DELEGATED_CHILD;
  if (profile !== "parent") env.PI_DELEGATED_CHILD = "1";
  const args = [cli, "--mode", "rpc", "--session", seed, "--session-dir", join(f.root, "sessions"), "--offline", "--no-approve", "--provider", "c8-offline", "--model", "fixture", "--models", "c8-offline/fixture", ...resourceArgs, "-e", probe];
  const start = performance.now(), child = spawn(process.execPath, args, { cwd: f.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const messages = [], waiters = new Map(); let buffer = "", stderr = "", sequence = 0;
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stderr.on("data", data => { stderr += data; });
  child.stdout.on("data", data => {
    buffer += data; assert.ok(buffer.length < 1024 * 1024);
    for (let newline; (newline = buffer.indexOf("\n")) !== -1;) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (!line) continue;
      const message = JSON.parse(line); messages.push(message);
      if (message.type === "response") waiters.get(message.id)?.resolve(message);
    }
  });
  const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  async function send(type, data = {}) {
    const id = `c8-${++sequence}`, waiter = Promise.withResolvers(); waiters.set(id, waiter);
    child.stdin.write(JSON.stringify({ id, type, ...data }) + "\n");
    const response = await Promise.race([waiter.promise, closed.then(exit => { throw Error(`C8 early RPC exit ${JSON.stringify(exit)}: ${stderr}`); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error(`C8 RPC response deadline: ${type}`)), 20000); timer.unref(); })]);
    assert.equal(response.success, true, JSON.stringify(response)); return response.data;
  }
  try {
    const state = await send("get_state"); assert.equal(state.model.provider, "c8-offline"); assert.equal(state.isStreaming, false);
    await send("prompt", { message: "/c8-snapshot initial" });
    const commands = await send("get_commands"); assert.ok(commands.commands.some(c => c.name === "c8-snapshot"));
    const catalog = await send("get_available_models");
    assert.ok(catalog.models.some(m => m.provider === "c8-offline" && m.id === "fixture"));
    await send("prompt", { message: "/c8-reload" });
    await send("prompt", { message: "/c8-snapshot reloaded" });
    await send("new_session");
    await send("switch_session", { sessionPath: seed });
    await send("prompt", { message: "/c8-snapshot resumed" });
    const entries = await send("get_entries"), oldLeaf = entries.leafId;
    const earlier = entries.entries.find(e => e.type === "message" && e.message.role === "user");
    assert.ok(earlier && earlier.id !== oldLeaf);
    await send("prompt", { message: `/c8-tree ${earlier.id}` });
    assert.notEqual((await send("get_entries")).leafId, oldLeaf);
    await send("prompt", { message: "/c8-snapshot tree-moved" });
    await send("prompt", { message: `/c8-tree ${oldLeaf}` });
    assert.equal((await send("get_entries")).leafId, oldLeaf);
    await send("prompt", { message: "/c8-snapshot tree-restored" });
    child.stdin.end();
    const exit = await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("C8 RPC cleanup deadline")), 20000); timer.unref(); })]);
    assert.deepEqual(exit, { code: 0, signal: null });
    const evidence = fs.readFileSync(report, "utf8").trim().split("\n").map(JSON.parse);
    const snapshots = evidence.filter(e => e.phase);
    assert.deepEqual(snapshots.map(e => e.phase), ["initial", "reloaded", "resumed", "tree-moved", "tree-restored"]);
    for (const value of snapshots) {
      noRetired({ active: value.active, tools: value.tools, commands: value.commands, systemPrompt: value.systemPrompt });
      assert.equal(value.version, "1.5.2"); assert.equal(value.agentDir, f.agentDir);
      assert.equal(value.settings.cacheWarming, "off"); assert.equal(value.settings.tuiMode, "regular");
      assert.deepEqual(value.settings.packages, f.settings.packages);
      if (profile === "catalog") assert.equal(value.fastlaneState, undefined);
      else assert.deepEqual(value.fastlaneState, { active: false });
      assert.deepEqual(value.ownFlagVisibility, {}, "Pi flags are visible only to their registering extension");
      assert.ok(!value.active.includes("AskClaude"));
      if (profile === "parent") {
        assert.ok(value.active.includes("delegate_run") && value.active.includes("recall"));
        assert.equal(value.active.filter(n => n.startsWith("browser_")).length, 42);
        assert.ok(value.commands.some(c => c.name === "skill:uv"));
      } else {
        assert.deepEqual([...value.active].sort(), profile === "catalog" ? core : [...core, ...web].sort());
        assert.ok(!value.commands.some(c => c.source === "skill" || c.source === "prompt"));
      }
      if (profile === "catalog") assert.doesNotMatch(value.systemPrompt, /C8_PROJECT_POLICY|Global Agent Instructions/);
      else assert.match(value.systemPrompt, /C8_PROJECT_POLICY/);
      assert.deepEqual([...value.active].sort(), [...snapshots[0].active].sort());
    }
    assert.equal(evidence.filter(e => e.event === "session_tree").length, 2);
    assert.ok(evidence.some(e => e.event === "session_start" && e.reason === "reload"));
    assert.ok(evidence.some(e => e.event === "session_start" && e.reason === "resume"));
    assert.ok(evidence.some(e => e.event === "resources_discover"));
    assert.deepEqual(evidence.at(-1), { event: "session_shutdown", reason: "quit", cleanup: "complete" });
    assert.ok(!evidence.some(e => e.forbiddenInference || e.forbiddenAgentStart));
    assert.ok(!messages.some(e => /^(?:agent_start|tool_execution_start|extension_error)$/.test(e.type)));
    assert.doesNotMatch(stderr, /error|failed|denied/i);
    fs.writeFileSync(join(f.root, "rpc-execution.json"), JSON.stringify({ executable: process.execPath, cli, cliSha256: hash(cli), args, profile, exit, elapsedMs: Math.round(performance.now() - start), messages, stderr, evidence }, null, 2));
    return snapshots[0];
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.stdin.end(); child.kill("SIGTERM"); await closed; }
    fs.writeFileSync(join(f.root, "rpc-diagnostics.json"), JSON.stringify({ messages, stderr, code: child.exitCode, signal: child.signalCode }, null, 2));
  }
}

test("RPC fresh bundled/unbundled parent and lean-child resource/lifecycle parity", { timeout: 120000 }, async () => {
  assert.equal(process.env.PI_TEST_CHILD_NODE, process.execPath);
  const results = [];
  for (const cli of [process.env.PI_TEST_CHILD_PI, process.env.PI_TEST_CHILD_PI_BUNDLED]) {
    assert.ok([join(piRoot, "dist/cli.js"), join(piRoot, "dist/bundle/cli.js")].includes(cli));
    assert.equal(fs.realpathSync(cli), cli);
    for (const profile of ["parent", "runtime", "catalog"]) {
      const f = layout(`rpc-${profile}`, modules), { source, resources } = await policy(f);
      const selection = source.buildDelegateResourceSelection(resources);
      selection.verifyRuntimeSpawn(); selection.verifyCatalogSpawn();
      let args = [];
      if (profile === "runtime") args = selection.runtimeArgs;
      else if (profile === "catalog") args = selection.catalogArgs;
      results.push({ cli, profile, snapshot: await rpc(f, cli, args, profile) });
    }
  }
  for (const profile of ["parent", "runtime", "catalog"]) {
    const [a, b] = results.filter(r => r.profile === profile).map(r => r.snapshot);
    assert.deepEqual([...a.active].sort(), [...b.active].sort());
    assert.deepEqual(names(a.tools), names(b.tools));
    assert.deepEqual(names(a.commands), names(b.commands));
    assert.deepEqual([...a.providers].sort(), [...b.providers].sort());
  }
  fs.writeFileSync(join(out, `parity-${process.env.PI_TEST_RUN_NAME}.json`), JSON.stringify(results, null, 2));
});
