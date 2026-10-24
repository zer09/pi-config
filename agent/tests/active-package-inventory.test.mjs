import assert from "node:assert/strict";
import fs from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const modules = process.env.PI_TEST_NODE_MODULES;
const root = process.env.PI_TEST_INTEGRATION_ROOT;
const report = process.env.PI_TEST_INVENTORY_REPORT;
for (const path of [modules, root, report]) assert.ok(path && isAbsolute(path), "Explicit isolated targets required");
assert.equal(process.env.PI_OFFLINE, "1");
const agentDir = join(root, "agent"), cwd = join(root, "cwd");
process.env.PI_CODING_AGENT_DIR = agentDir;
const pi = await import(pathToFileURL(join(modules, "@earendil-works/pi-coding-agent/dist/index.js")));
const ai = await import(pathToFileURL(join(modules, "@earendil-works/pi-ai/dist/index.js")));
assert.equal(pi.VERSION, "1.4.0");
pi.initTheme("dark", false);
const errors = [], records = [];
const sortedNames = items => items.map(item => item.name).sort();
async function create(manager, extensionFactories = []) {
  const faux = ai.fauxProvider({ provider: "e-offline", models: [{ id: "fixture", contextWindow: 500000, maxTokens: 128 }], tokensPerSecond: 0 });
  faux.setResponses([() => {
    const message = ai.fauxAssistantMessage("E_OFFLINE_TURN_COMPLETE");
    message.usage = { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 23, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    return message;
  }]);
  const modelRuntime = await pi.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = pi.SettingsManager.create(cwd, agentDir);
  const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, modelRuntime, model: faux.getModel(), thinkingLevel: "off", sessionManager: manager });
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
  return { session, loader, faux };
}
async function close(session) {
  await session.abort();
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  session.dispose();
}
function inventory(session, loader, phase) {
  const entries = loader.getExtensions().extensions.map(entry => ({ path: entry.path, sourceInfo: entry.sourceInfo }));
  assert.equal(entries.length, 12);
  assert.equal(entries.filter(entry => entry.path.startsWith(join(agentDir, "extensions") + "/")).length, 7);
  assert.ok(entries.some(entry => entry.path === join(modules, "pi-blackhole/index.ts")), "Discovery selects repaired source, not bundle");
  assert.ok(entries.some(entry => entry.path === join(modules, "pi-btw/extensions/btw.ts")));
  assert.ok(entries.every(entry => !/(?:codegraph|context-mode|delegate-entry)/.test(entry.path)));
  const tools = sortedNames(session.getAllTools()), active = session.getActiveToolNames().sort();
  assert.equal(tools.length, 57);
  assert.equal(active.length, 53);
  assert.equal(tools.filter(name => name.startsWith("browser_")).length, 42);
  for (const name of ["browser_set_headers", "browser_clear_headers", "recall"]) assert.ok(active.includes(name));
  assert.ok(!tools.includes("AskClaude"));
  assert.ok(!tools.some(name => /^(?:ctx_|codegraph_)/.test(name)));
  const commands = session.extensionRunner.getRegisteredCommands().map(command => command.name).sort();
  assert.equal(commands.length, 24);
  const skills = loader.getSkills().skills.map(skill => ({ name: skill.name, filePath: skill.filePath }));
  assert.ok(!skills.some(skill => skill.filePath.startsWith(join(modules, "pi-browser-harness") + "/")));
  assert.ok(skills.some(skill => skill.filePath.startsWith(join(modules, "pi-btw") + "/")));
  const prompts = loader.getPrompts().prompts.map(prompt => ({ name: prompt.name }));
  assert.ok(!prompts.some(prompt => prompt.name === "codegraph-upgrade"));
  assert.ok(!session.systemPrompt.includes("RETIRED_SENTINEL"));
  const value = { phase, entries, tools, active, commands, skills, prompts, themes: loader.getThemes().themes.map(theme => theme.name).sort() };
  records.push(value);
  return value;
}
test("selected packages retain exact discovery, fake completion, reload, resume and tree inventory", { timeout: 90000 }, async () => {
  const manager = pi.SessionManager.create(cwd, join(root, "sessions"));
  const first = await create(manager);
  try {
    const initial = inventory(first.session, first.loader, "sdk-start");
    await first.session.prompt("Synthetic integration acceptance");
    assert.equal(first.session.getLastAssistantText(), "E_OFFLINE_TURN_COMPLETE");
    assert.equal(first.faux.state.callCount, 1);
    const final = first.session.messages.findLast(message => message.role === "assistant");
    assert.ok(final.usage.totalTokens > 0);
    assert.equal(first.session.getSessionStats().tokens.total, final.usage.totalTokens);
    await first.session.reload();
    assert.deepEqual(inventory(first.session, first.loader, "sdk-reload").tools, initial.tools);
    const path = first.session.sessionFile;
    await close(first.session);
    const resumed = await create(pi.SessionManager.open(path));
    try {
      assert.deepEqual(inventory(resumed.session, resumed.loader, "sdk-resume").active, initial.active);
      const leaf = resumed.session.sessionManager.getLeafId();
      const earlier = resumed.session.sessionManager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user");
      assert.ok(earlier && earlier.id !== leaf);
      // Navigating to the current leaf is a no-op, so cross a real tree boundary.
      assert.equal((await resumed.session.navigateTree(earlier.id, { summarize: false })).cancelled, false);
      assert.notEqual(resumed.session.sessionManager.getLeafId(), leaf);
      const tree = inventory(resumed.session, resumed.loader, "sdk-tree");
      assert.deepEqual(tree.tools, initial.tools);
      assert.deepEqual(tree.active, initial.active);
      assert.deepEqual(tree.commands, initial.commands);
      assert.equal((await resumed.session.navigateTree(leaf, { summarize: false })).cancelled, false);
      assert.equal(resumed.session.sessionManager.getLeafId(), leaf);
      assert.deepEqual(inventory(resumed.session, resumed.loader, "sdk-tree-restored").active, initial.active);
    } finally { await close(resumed.session); }
  } finally { first.session.dispose(); }
  assert.deepEqual(errors, []);
  fs.writeFileSync(report, JSON.stringify(records, null, 2));
});
test("old retired loadouts preserve new stock headers and default-inactive tools across runtime replacement", { timeout: 90000 }, async () => {
  const manager = pi.SessionManager.create(cwd, join(root, "sessions"));
  manager.appendMessage({ role: "system", content: "SYNTHETIC_OLD_LOADOUT", toolsAdded: ["read", "ctx_execute", "codegraph_search"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } })), timestamp: 1 });
  manager.appendMessage({ role: "user", content: "Old fixture", timestamp: 2 });
  manager.appendMessage({ ...ai.fauxAssistantMessage("old"), provider: "e-offline", model: "fixture" });
  const fixture = api => {
    for (const [name, defaultActive] of [["fixture-on", true], ["fixture-off", false]]) api.registerTool({ name, label: name, description: name, defaultActive, parameters: { type: "object", properties: {} }, execute: async () => { throw Error("Never execute fixture"); } });
  };
  const first = await create(manager, [fixture]);
  const verify = session => {
    const active = session.getActiveToolNames();
    for (const name of ["fixture-on", "browser_set_headers", "browser_clear_headers", "web_search"]) assert.ok(active.includes(name), `${name} missing from ${active.join(",")}`);
    assert.ok(!active.includes("fixture-off"));
    assert.ok(!active.some(name => /^(?:ctx_|codegraph_)/.test(name)));
  };
  try {
    verify(first.session);
    await first.session.reload(); verify(first.session);
    const leaf = manager.getLeafId();
    const earlier = manager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user");
    assert.ok(earlier && earlier.id !== leaf);
    assert.equal((await first.session.navigateTree(earlier.id, { summarize: false })).cancelled, false);
    assert.notEqual(manager.getLeafId(), leaf); verify(first.session);
    assert.equal((await first.session.navigateTree(leaf, { summarize: false })).cancelled, false);
    assert.equal(manager.getLeafId(), leaf); verify(first.session);
    const path = first.session.sessionFile;
    await close(first.session);
    const resumed = await create(pi.SessionManager.open(path), [fixture]);
    try { verify(resumed.session); } finally { await close(resumed.session); }
  } finally { first.session.dispose(); }
  assert.deepEqual(errors, []);
});
