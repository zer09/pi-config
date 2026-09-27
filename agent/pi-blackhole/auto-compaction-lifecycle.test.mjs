import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import dns from "node:dns";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const blackholeRoot = resolve(process.env.PI_BLACKHOLE_PACKAGE_ROOT ?? join(here, "../npm/node_modules/pi-blackhole"));
const piRoot = join(dirname(blackholeRoot), "@earendil-works/pi-coding-agent");
const aiRoot = join(dirname(blackholeRoot), "@earendil-works/pi-ai");
const visibleCanary = "VISIBLE_CONTEXT_EDIT_LIFECYCLE_CANARY";
const omittedCanary = "OMITTED_CONTEXT_EDIT_LIFECYCLE_CANARY";
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

// Hash package-owned files, not the separate dependency installations.
function packageHash(root) {
  const hash = createHash("sha256");
  function visit(prefix = "") {
    for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules") continue;
      const relative = join(prefix, entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile()) hash.update(relative).update("\0").update(readFileSync(join(root, relative))).update("\0");
    }
  }
  visit();
  return hash.digest("hex");
}

async function waitFor(check, description) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await sleep(20);
  }
}

test("Pi 0.87.1 settles before Blackhole 0.5.8 compacts once, using edited context without rewriting history", { timeout: 30_000 }, async (t) => {
  assert.equal(json(join(blackholeRoot, "package.json")).version, "0.5.8");
  assert.deepEqual(json(join(blackholeRoot, "package.json")).pi.extensions, ["./index.ts"]);
  const piManifest = json(join(piRoot, "package.json"));
  assert.equal(piManifest.name, "@earendil-works/pi-coding-agent");
  assert.equal(piManifest.version, "0.87.1");
  const beforeHashes = [blackholeRoot, piRoot, aiRoot].map(packageHash);
  const root = mkdtempSync(join(tmpdir(), "pi-blackhole-lifecycle-"));
  const home = join(root, "home");
  const agentDir = join(home, ".pi", "agent");
  const sessionDir = join(agentDir, "sessions");
  const work = join(root, "work");
  const cache = join(root, "cache");
  const temporary = join(root, "tmp");
  const previousCwd = process.cwd();
  let session;
  let releaseSettle;
  let prompting;
  const settleGate = new Promise((resolve) => { releaseSettle = resolve; });
  const networkAttempts = [];
  const subprocessAttempts = [];
  const extensionErrors = [];

  // This is a disposable, single-file Node test worker. Keep HOME and guards
  // isolated until exit so late package exit hooks cannot reach the real agent.
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    PI_OFFLINE: "1",
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    JITI_FS_CACHE: "false",
    JITI_CACHE_DIR: join(cache, "jiti"),
    PATH: join(root, "no-executables"),
    TERM: "dumb",
  });
  for (const path of [home, agentDir, sessionDir, work, cache, temporary, join(agentDir, "pi-blackhole")]) {
    mkdirSync(path, { recursive: true });
  }
  process.chdir(work);

  const denyNetwork = () => {
    networkAttempts.push("network");
    throw new Error("Network is forbidden in the offline lifecycle fixture");
  };
  for (const [object, names] of [
    [globalThis, ["fetch", "WebSocket"]],
    [net, ["connect", "createConnection"]],
    [net.Socket.prototype, ["connect"]],
    [tls, ["connect"]],
    [http, ["request", "get"]],
    [https, ["request", "get"]],
    [http2, ["connect"]],
    [dgram, ["createSocket"]],
    [dns, ["lookup", "resolve"]],
    [dns.promises, ["lookup", "resolve"]],
  ]) {
    for (const name of names) object[name] = denyNetwork;
  }
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    childProcess[name] = (file, args) => {
      subprocessAttempts.push({ name, file, args });
      throw new Error("Subprocesses are forbidden in the offline lifecycle fixture");
    };
  }
  syncBuiltinESMExports();

  t.after(async () => {
    releaseSettle();
    await session?.abort();
    await prompting?.catch(() => {});
    if (session) {
      await session.extensionRunner.emit({ type: "session_shutdown" });
      session.dispose();
    }
    // Let deferred work see the stale context and drain the real debug buffer.
    await sleep(1_200);
    try {
      assert.deepEqual([blackholeRoot, piRoot, aiRoot].map(packageHash), beforeHashes, "installed package files changed");
      assert.deepEqual(networkAttempts, [], "a forbidden network call was attempted");
      assert.deepEqual(extensionErrors, [], "extension handlers must not fail silently");
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    cacheWarming: "off",
    enableInstallTelemetry: false,
    enableAnalytics: false,
    packages: [],
    defaultTools: [],
    retry: { enabled: false },
    // Only Blackhole owns the threshold. Pi's real compact() still runs.
    compaction: { enabled: false, reserveTokens: 1_024, keepRecentTokens: 64 },
  }));
  writeFileSync(join(agentDir, "pi-blackhole", "pi-blackhole-config.json"), JSON.stringify({
    compaction: "auto",
    compactionEngine: "blackhole",
    compactionSummaryMode: "default",
    compactAfterPercent: 0.02,
    compactAfterTokens: 180_000,
    midRunCompaction: "off",
    tailBehavior: "minimal",
    memory: false,
    statusBar: false,
    showPreCompactionMessage: false,
    retainedToolOutputMaxTokens: 0,
    debug: false, // The legacy snapshot uses a fixed /tmp path; never enable it.
    debugLog: true, // The JSONL trace respects the isolated agent directory.
  }));

  const pi = await import(pathToFileURL(join(piRoot, piManifest.exports["."].import)).href);
  const aiManifest = json(join(aiRoot, "package.json"));
  const ai = await import(pathToFileURL(join(aiRoot, aiManifest.exports["."].import)).href);
  assert.equal(pi.VERSION, "0.87.1");
  assert.equal(pi.getAgentDir(), agentDir);
  // The SDK does not initialize the theme. Blackhole accesses ctx.ui.theme
  // even headlessly; use Pi's public initializer without starting a watcher.
  pi.initTheme("dark", false);

  const faux = ai.fauxProvider({
    provider: "blackhole-offline-fixture",
    models: [{ id: "fixture", contextWindow: 20_000, maxTokens: 128 }],
    tokensPerSecond: 0,
  });
  const requests = [];
  faux.setResponses([(context) => {
    requests.push(structuredClone(context));
    return ai.fauxAssistantMessage("Offline turn complete.");
  }]);
  const modelRuntime = await pi.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const model = faux.getModel();
  const settingsManager = pi.SettingsManager.create(work, agentDir);
  assert.equal(settingsManager.getCacheWarmingMode(), "off");
  const events = [];
  const boundaries = [];
  const compactionEnds = [];
  const loader = new pi.DefaultResourceLoader({
    cwd: work,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "Run only the offline lifecycle fixture.",
    additionalExtensionPaths: [join(blackholeRoot, "index.ts")],
    extensionFactories: [(extension) => {
      for (const type of ["agent_end", "agent_before_settle", "agent_settled"]) {
        extension.on(type, async (_event, ctx) => {
          events.push(type);
          boundaries.push({ type, idle: ctx.isIdle() });
          if (type === "agent_before_settle") await settleGate;
        });
      }
      for (const type of ["session_before_compact", "session_compact", "session_compact_failed"]) {
        extension.on(type, () => { events.push(type); });
      }
    }],
  });
  await loader.reload();
  const extensions = loader.getExtensions();
  assert.deepEqual(extensions.errors, [], "the installed extension must load without errors");
  assert.equal(extensions.extensions.length, 2, "load only Blackhole and the passive lifecycle observer");
  assert.ok(extensions.extensions.some((extension) => extension.resolvedPath === join(blackholeRoot, "index.ts")));

  // Seed only synthetic messages through the real persistent SessionManager.
  const manager = pi.SessionManager.create(work, sessionDir);
  assert.equal(manager.isPersisted(), true, "in-memory sessions take Blackhole's inline path instead");
  manager.appendMessage({ role: "user", content: `Implement ${visibleCanary} carefully.`, timestamp: 1 });
  manager.appendMessage({ ...ai.fauxAssistantMessage("Starting the fixture."), provider: model.provider, model: model.id });
  const omittedId = manager.appendMessage({ role: "user", content: `Implement ${omittedCanary} too.`, timestamp: 2 });
  manager.appendMessage({ ...ai.fauxAssistantMessage("Synthetic progress. ".repeat(250)), provider: model.provider, model: model.id });
  const editId = manager.appendContextEdit(omittedId, null);
  const created = await pi.createAgentSession({
    cwd: work,
    agentDir,
    resourceLoader: loader,
    modelRuntime,
    model,
    thinkingLevel: "off",
    sessionManager: manager,
    settingsManager,
    tools: [],
  });
  session = created.session;
  assert.deepEqual(created.extensionsResult.errors, []);
  await session.bindExtensions({ mode: "print", onError: (error) => { extensionErrors.push(error); } });
  session.subscribe((event) => {
    if (event.type === "agent_settled") events.push("public:agent_settled");
    if (event.type === "compaction_start" || event.type === "compaction_end") events.push(event.type);
    if (event.type === "compaction_end") compactionEnds.push(event);
  });
  const sessionFile = manager.getSessionFile();
  assert.equal(dirname(sessionFile), sessionDir);
  const debugFile = join(agentDir, "pi-blackhole", "debug.ndjson");
  const trace = () => {
    if (!existsSync(debugFile)) return [];
    return readFileSync(debugFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  };
  const traceEvents = (name) => trace().filter((entry) => entry.event === name);

  prompting = session.prompt("Retain this final user turn.");
  await waitFor(() => events.includes("agent_before_settle"), "the real pre-settlement boundary");
  // Exercise the installed 200ms idle poll, not just its first timer tick.
  await sleep(250);
  assert.deepEqual(events, ["agent_end", "agent_before_settle"]);
  assert.equal(session.isIdle, false);
  const rawBefore = readFileSync(sessionFile, "utf8");
  const entriesBefore = structuredClone(manager.getEntries());
  assert.ok(rawBefore.includes(omittedCanary));
  assert.ok(rawBefore.includes(visibleCanary));
  releaseSettle();
  await prompting;
  await session.waitForIdle();
  await waitFor(() => compactionEnds.length > 0, "deferred compaction_end");
  assert.equal(compactionEnds[0].aborted, false);
  assert.equal(compactionEnds[0].errorMessage, undefined);
  assert.ok(compactionEnds[0].result, "the real compaction must succeed");
  await waitFor(() => traceEvents("compaction_trigger.onComplete").length > 0, "Blackhole's completion trace");
  await session.waitForIdle();
  // Observe another full debug flush and several idle polls without prompting.
  await sleep(1_200);

  assert.deepEqual(events, [
    "agent_end", "agent_before_settle", "agent_settled", "public:agent_settled",
    "compaction_start", "session_before_compact", "session_compact", "compaction_end",
  ]);
  assert.deepEqual(boundaries.map(({ idle }) => idle), [false, false, true]);
  assert.equal(session.isIdle, true);
  for (const name of ["compaction_trigger.scheduled", "compaction_trigger.microtask.calling_compact", "compaction_trigger.onComplete"]) {
    assert.equal(traceEvents(name).length, 1, `${name} must occur exactly once, including after idle`);
  }
  assert.equal(traceEvents("compaction_trigger.onError").length, 0);
  assert.equal(traceEvents("compaction_trigger.microtask.error").length, 0);
  assert.equal(traceEvents("compaction_trigger.microtask.bail").length, 0);
  assert.ok(traceEvents("compaction_trigger.microtask.idle_check").some(({ data }) => data.isIdle === false));
  const tokenChecks = traceEvents("compaction_trigger.tokens");
  assert.equal(tokenChecks.length, 1);
  assert.equal(tokenChecks[0].data.threshold, 400, "use the installed percentage threshold patch");
  assert.ok(tokenChecks[0].data.tokens >= 400);
  assert.equal(compactionEnds.length, 1);

  const entriesAfter = manager.getEntries();
  const compactions = entriesAfter.filter((entry) => entry.type === "compaction");
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0].fromHook, true, "Blackhole, not Pi's model summarizer, owns the summary");
  assert.ok(compactions[0].summary.includes(visibleCanary), "positive control must survive compaction");
  assert.ok(!compactions[0].summary.includes(omittedCanary), "omitted context must not reappear in the fresh summary");
  const rawAfter = readFileSync(sessionFile, "utf8");
  assert.ok(rawAfter.startsWith(rawBefore), "persisted pre-compaction bytes must remain unchanged");
  assert.deepEqual(entriesAfter.slice(0, entriesBefore.length), entriesBefore, "raw entries must remain unchanged");
  assert.deepEqual(manager.getEntry(editId).replacement, null);
  assert.ok(rawAfter.includes(omittedCanary), "omission must not erase raw history");
  // JSONL omits undefined optional fields in the new compaction entry.
  assert.deepEqual(rawAfter.trim().split("\n").map((line) => JSON.parse(line)).slice(1), JSON.parse(JSON.stringify(entriesAfter)));
  assert.equal(faux.state.callCount, 1, "no extra inference, summarization, retry, or cache-warming requests");
  assert.equal(requests.length, 1);
  assert.ok(JSON.stringify(requests[0]).includes(visibleCanary));
  assert.ok(!JSON.stringify(requests[0]).includes(omittedCanary));
  assert.equal(settingsManager.getCacheWarmingMode(), "off");
  assert.equal(json(join(agentDir, "settings.json")).cacheWarming, "off");
  assert.deepEqual(extensionErrors, []);
  assert.deepEqual(networkAttempts, []);
  // Blackhole catches the denied, optional Git annotation probe. No process ran.
  assert.deepEqual(subprocessAttempts, [{ name: "execFileSync", file: "git", args: ["rev-parse", "--show-toplevel"] }]);
  t.diagnostic("one schedule, attempt, and success; zero network; Git probe blocked; raw history unchanged");
});
