import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

// Run with: node --test agent/tests/retired-session-tools.test.mjs (Linux, bubblewrap).
if (process.argv[2] !== "--fixture") {
  test("old sessions keep current tools without reactivating retired tools", t => {
    const agent = resolve(import.meta.dirname, "..");
    const modules = process.env.PI_TEST_NODE_MODULES ?? join(process.env.BUN_INSTALL ?? join(homedir(), ".bun"), "install/global/node_modules");
    const { packages, extensions } = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
    // Exercise the configured npm packages and local web-search without mounting live agent state.
    const output = execFileSync("bwrap", [
      "--unshare-all", "--die-with-parent", "--new-session", "--clearenv",
      "--ro-bind", "/usr", "/usr", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
      "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--dir", "/tmp/home", "--dir", "/tmp/cwd",
      "--ro-bind", process.execPath, "/bin/node", "--ro-bind", modules, "/host/node_modules",
      "--ro-bind", join(agent, "npm"), "/tmp/agent/npm",
      "--ro-bind", join(agent, "extensions/web-search"), "/tmp/agent/extensions/web-search",
      "--ro-bind", import.meta.filename, "/host/test.mjs", "--chdir", "/tmp/cwd",
      "--setenv", "HOME", "/tmp/home", "--setenv", "PI_CODING_AGENT_DIR", "/tmp/agent",
      "--setenv", "PI_OFFLINE", "1", "--setenv", "PI_CACHE_WARMING", "off",
      "/bin/node", "/host/test.mjs", "--fixture", JSON.stringify({ packages, extensions, cacheWarming: "off" }),
    ], { encoding: "utf8", timeout: 60000 });
    assert.match(output, /Verified reload, tree navigation and resume on Pi /);
    t.diagnostic(output.trim());
  });
} else {
  const agentDir = process.env.PI_CODING_AGENT_DIR, cwd = process.cwd();
  assert.equal(agentDir, "/tmp/agent");
  assert.equal(cwd, "/tmp/cwd");
  writeFileSync(join(agentDir, "settings.json"), process.argv[3], { flag: "wx" });
  // Mirror the two retired entry points without loading retired code. Discovery must skip both.
  for (const [name, entry] of [["codegraph", "index.ts"], ["context-mode", "src/index.ts"]]) {
    const dir = join(agentDir, "extensions", name);
    mkdirSync(resolve(dir, entry, ".."), { recursive: true });
    if (entry.startsWith("src/")) writeFileSync(join(dir, "package.json"), JSON.stringify({ pi: { extensions: [`./${entry}`] } }));
    writeFileSync(join(dir, entry), `export default function () { throw Error('Loaded retired ${name}'); }`);
  }
  const pi = await import("@earendil-works/pi-coding-agent");
  const ai = await import("@earendil-works/pi-ai");
  pi.initTheme("dark", false);
  const faux = ai.fauxProvider({ models: [{ id: "fixture", contextWindow: 32768, maxTokens: 128 }] });
  const errors = [];
  async function create(sessionManager, reason) {
    const modelRuntime = await pi.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = pi.SettingsManager.create(cwd, agentDir);
    const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: [api => {
      for (const [name, defaultActive] of [["fixture-on", true], ["fixture-off", false]]) {
        api.registerTool({ name, label: name, description: name, defaultActive, parameters: { type: "object", properties: {} }, execute: () => assert.fail("No tool calls expected") });
      }
    }] });
    await resourceLoader.reload();
    const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, modelRuntime, model: faux.getModel(), sessionManager, sessionStartEvent: { type: "session_start", reason } });
    await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
    return session;
  }
  function verify(session) {
    const loaded = session.resourceLoader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    const sources = loaded.extensions.filter(e => e.sourceInfo?.origin === "package").map(e => e.sourceInfo.source);
    assert.deepEqual([...new Set(sources)].sort(), JSON.parse(process.argv[3]).packages.map(p => p.source ?? p).sort());
    const active = session.getActiveToolNames();
    for (const name of ["fixture-on", "web_search", "recall", "browser_set_headers", "browser_clear_headers"]) assert.ok(active.includes(name), `Missing ${name}`);
    assert.ok(session.getAllTools().some(tool => tool.name === "fixture-off"));
    assert.ok(!active.includes("fixture-off"));
    assert.ok(!active.some(name => /^(?:ctx_|codegraph_)/.test(name)), "Retired tools must stay inactive");
  }
  async function close(session) {
    try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
    finally { session.dispose(); }
  }
  const manager = pi.SessionManager.create(cwd, "/tmp/sessions");
  const oldList = manager.appendMessage({ role: "system", content: "Old tool list", toolsAdded: ["read", "ctx_execute", "codegraph_search"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } })), timestamp: 1 });
  const user = manager.appendMessage({ role: "user", content: "Old turn", timestamp: 2 });
  const leaf = manager.appendMessage(ai.fauxAssistantMessage("Old reply"));
  const session = await create(manager, "startup");
  const path = session.sessionFile;
  try {
    verify(session);
    await session.reload(); verify(session);
    for (const [id, expectedLeaf] of [[user, oldList], [leaf, leaf]]) {
      assert.notEqual(manager.getLeafId(), expectedLeaf, "Exercise real tree navigation");
      assert.equal((await session.navigateTree(id, { summarize: false })).cancelled, false);
      assert.equal(manager.getLeafId(), expectedLeaf);
      verify(session);
    }
  } finally { await close(session); }
  const saved = pi.SessionManager.open(path);
  assert.equal(saved.getSessionId(), manager.getSessionId());
  assert.ok(saved.getBranch().some(entry => entry.id === oldList), "Resume the branch with retired tool names");
  const resumed = await create(saved, "resume");
  try { verify(resumed); } finally { await close(resumed); }
  assert.deepEqual(errors, []);
  assert.equal(faux.state.callCount, 0);
  console.log(`Verified reload, tree navigation and resume on Pi ${pi.VERSION}`);
}
