import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import dns from "node:dns";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.9.mjs";
import { reapplyNullableProviderHeadersPatch } from "./reapply-nullable-provider-headers-patch-0.5.9.mjs";
import { reapplyContextEditCompactionPatch } from "./reapply-context-edit-compaction-patch-0.5.9.mjs";

// Acquisition is separate; this gate never installs or fetches dependencies.
// PI_BLACKHOLE_0_5_9_TARBALL=/tmp/.../pi-blackhole-0.5.9.tgz node --test <this-file>
// Based on the accepted lifecycle gate, without changing it or the installed runtime.
// Covers one queued follow-up, not session replacement or shutdown races.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../..");
const installed = join(repository, "agent/npm/node_modules/pi-blackhole");
const piRoot = "/home/gc/.bun/install/global/node_modules/@earendil-works/pi-coding-agent";
const aiRoot = "/home/gc/.bun/install/global/node_modules/@earendil-works/pi-ai";
const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const originalCanary = "ORIGINAL_VISIBLE_QUEUED_CONTINUATION_GOAL";
const visibleCanary = "VISIBLE_QUEUED_CONTINUATION_CANARY";
const omittedCanary = "OMITTED_QUEUED_CONTINUATION_CANARY";
const firstPrompt = "Complete the first offline request.";
const followUpPrompt = "Complete this queued follow-up only after the first response.";
const firstResponse = `FIRST_OFFLINE_RESPONSE\n${"Synthetic pressure. ".repeat(2_600)}`;
const secondResponse = "SECOND_OFFLINE_RESPONSE: queued follow-up complete.";
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function packageSnapshot(root, { includeMtimes = true, excludeDependencies = false } = {}) {
  const files = {};
  function visit(path, rel = "") {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) files[rel] = `link:${readlinkSync(path)}`;
    else if (stat.isDirectory()) {
      if (excludeDependencies && rel.endsWith("/node_modules")) return;
      files[rel] = "directory";
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${rel}/${name}`);
    } else files[rel] = hash(readFileSync(path));
    if (includeMtimes) files[rel] += `:${stat.mtimeNs}`;
  }
  visit(root);
  return files;
}

function protectedSnapshot() {
  const paths = [
    installed, piRoot, aiRoot,
    join(dirname(piRoot), "pi-agent-core"), join(dirname(piRoot), "pi-tui"),
    join(repository, ".gitignore"), join(repository, "agent/settings.json"),
    join(here, "pi-blackhole-config.json"),
    ...readdirSync(here).filter((name) => /\.(mjs|md)$/.test(name)).map((name) => join(here, name)),
  ];
  return Object.fromEntries(paths.map((path) => [path, packageSnapshot(realpathSync(path))]));
}

function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function waitFor(check, description) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await sleep(20);
  }
}

function gate() {
  let release;
  const promise = new Promise((resolveGate) => { release = resolveGate; });
  return { promise, release };
}

function unpackPinnedArchive(bytes, target) {
  assert.equal(
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    registryIntegrity,
    "tarball must match the pinned pi-blackhole@0.5.9 registry SRI before extraction",
  );
  const tar = gunzipSync(bytes);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0", `archive entry must be regular: ${name}`);
    assert.equal(header[345], 0, "archive must not use a tar prefix");
    assert.ok(name.startsWith("package/"), `unexpected archive entry: ${name}`);
    const rel = name.slice("package/".length);
    assert.ok(rel && !rel.split("/").some((part) => part === ".." || part === ""));
    assert.ok(!files.has(rel), `duplicate archive entry: ${rel}`);
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    files.set(rel, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(files.size, 132, "unexpected file count in the pinned registry archive");
  for (const [rel, content] of files) {
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), content);
  }
  return files;
}

function isolatedEnv(sandbox) {
  return {
    // Only the parent starts this child via an absolute Node path.
    PATH: join(sandbox, "no-executables"),
    HOME: join(sandbox, "home"),
    USERPROFILE: join(sandbox, "home"),
    PI_CODING_AGENT_DIR: join(sandbox, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(sandbox, "sessions"),
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    XDG_CACHE_HOME: join(sandbox, "cache"),
    XDG_CONFIG_HOME: join(sandbox, "config"),
    XDG_DATA_HOME: join(sandbox, "data"),
    XDG_STATE_HOME: join(sandbox, "state"),
    TMPDIR: join(sandbox, "tmp"),
    TMP: join(sandbox, "tmp"),
    TEMP: join(sandbox, "tmp"),
    JITI_FS_CACHE: "false",
    JITI_CACHE_DIR: join(sandbox, "cache/jiti"),
    NODE_DISABLE_COMPILE_CACHE: "1",
    BROWSER: "false",
    TERM: "dumb",
  };
}

function writeFixtureSettings(sandbox, candidateRoot) {
  const env = isolatedEnv(sandbox);
  const agentDir = env.PI_CODING_AGENT_DIR;
  mkdirSync(join(agentDir, "pi-blackhole"), { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    packages: [candidateRoot],
    cacheWarming: "off",
    sessionDir: env.PI_CODING_AGENT_SESSION_DIR,
    defaultProjectTrust: "never",
    enableInstallTelemetry: false,
    enableAnalytics: false,
    defaultTools: [],
    retry: { enabled: false },
    // Blackhole owns the threshold; Pi's real compaction API still runs.
    compaction: { enabled: false, reserveTokens: 1_024, keepRecentTokens: 64 },
  }));
  writeFileSync(join(agentDir, "pi-blackhole/pi-blackhole-config.json"), JSON.stringify({
    compaction: "auto",
    compactionEngine: "blackhole",
    compactionSummaryMode: "default",
    compactAfterPercent: 0.65,
    compactAfterTokens: 180_000,
    midRunCompaction: "off",
    tailBehavior: "minimal",
    memory: false,
    statusBar: false,
    showPreCompactionMessage: false,
    retainedToolOutputMaxTokens: 0,
    debug: false, // The legacy snapshot writes to a fixed /tmp path; never enable it.
    debugLog: true, // This trace respects the isolated agent directory.
  }));
  writeFileSync(join(sandbox, "cwd/.pi/settings.json"), "{}\n");
}

if (process.argv[2] === "--queued-continuation-fixture") {
  await runQueuedContinuationFixture(process.argv[3], process.argv[4]);
} else {
  test("Pi 0.87.1 defers package-discovered Blackhole compaction across a queued follow-up", { timeout: 120_000 }, async (t) => {
    assert.equal(json(join(installed, "package.json")).version, "0.5.9");
    assert.deepEqual(json(join(installed, "package.json")).pi?.extensions, ["./index.ts"]);
    assert.equal(json(join(piRoot, "package.json")).version, "0.87.1");
    assert.equal(json(join(aiRoot, "package.json")).version, "0.87.1");

    const suppliedTarball = process.env.PI_BLACKHOLE_0_5_9_TARBALL;
    assert.ok(suppliedTarball, "set PI_BLACKHOLE_0_5_9_TARBALL to the separately acquired pinned archive");
    const tarballPath = realpathSync(suppliedTarball);
    assert.ok(
      [realpathSync("/tmp"), realpathSync(tmpdir())].some((root) => isWithin(root, tarballPath)),
      "the pinned tarball must be a disposable file under /tmp",
    );
    assert.ok(lstatSync(tarballPath).isFile());

    const protectedBefore = protectedSnapshot();
    const root = mkdtempSync(join(realpathSync(tmpdir()), "pi-blackhole-0.5.9-queued-"));
    const candidateRoot = join(root, "candidate");
    let candidateBefore;
    t.after(() => {
      try {
        assert.deepEqual(protectedSnapshot(), protectedBefore,
          "live packages, settings/config and accepted helpers/tests/docs must retain bytes and mtimes");
        if (candidateBefore) {
          assert.deepEqual(packageSnapshot(candidateRoot), candidateBefore, "runtime must not write candidate source");
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
        assert.ok(!existsSync(root), "temporary package, HOME, session and caches must be removed");
      }
      t.diagnostic("protected files and candidate bytes/mtimes unchanged; temporary root removed");
    });
    assert.ok(!isWithin(repository, root));

    const files = unpackPinnedArchive(readFileSync(tarballPath), candidateRoot);
    const stockManifest = JSON.parse(files.get("package.json").toString("utf8"));
    assert.deepEqual(
      { name: stockManifest.name, version: stockManifest.version },
      { name: "pi-blackhole", version: "0.5.9" },
    );
    assert.deepEqual(stockManifest.pi?.extensions, ["./dist/index.js"]);
    const patchResults = [
      reapplyCompactAfterPercentPatch(candidateRoot),
      reapplyNullableProviderHeadersPatch(candidateRoot),
      reapplyContextEditCompactionPatch(candidateRoot),
    ];
    assert.deepEqual(patchResults.map((result) => /^patched:/.test(result)), [true, true, true]);
    assert.deepEqual(json(join(candidateRoot, "package.json")).pi.extensions, ["./index.ts"]);
    assert.equal(hash(readFileSync(join(candidateRoot, "dist/index.js"))), hash(files.get("dist/index.js")),
      "the stock bundle must remain untouched; discovery must load patched source");
    const contentOptions = { includeMtimes: false, excludeDependencies: true };
    assert.deepEqual(
      packageSnapshot(realpathSync(installed), contentOptions),
      packageSnapshot(candidateRoot, contentOptions),
      "live patched 0.5.9 must match all candidate package-owned bytes and inventory before execution",
    );
    t.diagnostic("live patched 0.5.9 matches SRI-pinned three-patch candidate bytes/inventory (excluding nested dependencies)");
    candidateBefore = packageSnapshot(candidateRoot);

    const sandbox = join(root, "sandbox");
    const env = isolatedEnv(sandbox);
    for (const path of ["home", "tmp", "cache", "config", "data", "state", "agent", "cwd/.pi", "sessions"]) {
      mkdirSync(join(sandbox, path), { recursive: true });
    }
    writeFixtureSettings(sandbox, candidateRoot);
    const output = childProcess.execFileSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--queued-continuation-fixture", candidateRoot, sandbox],
      { cwd: join(sandbox, "cwd"), env, encoding: "utf8", timeout: 90_000 },
    );
    console.log(output.trim());
    assert.match(output, /PASS package discovery queued continuation/);
    assert.ok(!existsSync(join(candidateRoot, "node_modules")), "discovery must not install dependencies");
    assert.ok(!existsSync(join(env.PI_CODING_AGENT_DIR, "npm")), "no package installation is allowed");
    assert.equal(readdirSync(env.PI_CODING_AGENT_SESSION_DIR).length, 1, "only the synthetic session may exist");
  });
}

async function runQueuedContinuationFixture(candidateRoot, sandbox) {
  const env = isolatedEnv(sandbox);
  assert.deepEqual({ ...process.env }, env, "the child must inherit only synthetic offline settings");
  assert.equal(process.cwd(), join(sandbox, "cwd"));
  assert.equal(realpathSync(candidateRoot), candidateRoot);
  assert.equal(json(join(candidateRoot, "package.json")).version, "0.5.9");
  assert.deepEqual(json(join(candidateRoot, "package.json")).pi.extensions, ["./index.ts"]);

  const agentDir = env.PI_CODING_AGENT_DIR;
  const sessionDir = env.PI_CODING_AGENT_SESSION_DIR;
  const work = join(sandbox, "cwd");
  const settingsPath = join(agentDir, "settings.json");
  const configPath = join(agentDir, "pi-blackhole/pi-blackhole-config.json");
  const settingsBefore = readFileSync(settingsPath, "utf8");
  const configBefore = readFileSync(configPath, "utf8");
  assert.deepEqual(json(settingsPath).packages, [candidateRoot]);
  assert.equal(json(settingsPath).cacheWarming, "off");
  assert.equal(json(settingsPath).compaction.enabled, false);
  assert.equal(json(configPath).memory, false);
  assert.equal(json(configPath).compactAfterPercent, 0.65);
  assert.ok(!existsSync(join(agentDir, "auth.json")));
  assert.ok(!existsSync(join(agentDir, "models.json")));

  // Install guards before importing Pi, including guards for swallowed failures.
  const calls = { network: [], browser: [], subprocess: [] };
  const blocked = (kind, name) => () => {
    calls[kind].push({ name });
    throw new Error(`${kind} is forbidden in the offline queued-continuation fixture`);
  };
  const noNetwork = blocked("network", "network");
  for (const [object, names] of [
    [net, ["connect", "createConnection"]],
    [net.Socket.prototype, ["connect"]],
    [tls, ["connect"]],
    [http, ["request", "get"]],
    [https, ["request", "get"]],
    [http2, ["connect"]],
    [dgram, ["createSocket"]],
    [dns, ["lookup", "resolve", "resolve4", "resolve6", "reverse"]],
    [dns.promises, ["lookup", "resolve", "resolve4", "resolve6", "reverse"]],
  ]) {
    for (const name of names) object[name] = noNetwork;
  }
  globalThis.fetch = globalThis.WebSocket = globalThis.EventSource = noNetwork;
  globalThis.open = blocked("browser", "browser");
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "fork"]) {
    childProcess[name] = blocked("subprocess", name);
  }
  childProcess.ChildProcess.prototype.spawn = blocked("subprocess", "ChildProcess.prototype.spawn");
  childProcess.execFileSync = (file, args) => {
    if (file === "git" && JSON.stringify(args) === '["rev-parse","--show-toplevel"]') {
      // Deny Blackhole's optional annotation probe without launching Git.
      calls.subprocess.push({ name: "execFileSync", file, args });
      throw new Error("Queued-continuation fixture has no Git repository");
    }
    return blocked("subprocess", "execFileSync")(file, args);
  };
  syncBuiltinESMExports();

  const piManifest = json(join(piRoot, "package.json"));
  const aiManifest = json(join(aiRoot, "package.json"));
  assert.equal(piManifest.version, "0.87.1");
  assert.equal(aiManifest.version, "0.87.1");
  const pi = await import(pathToFileURL(join(piRoot, piManifest.exports["."].import)).href);
  const ai = await import(pathToFileURL(join(aiRoot, aiManifest.exports["."].import)).href);
  assert.equal(pi.VERSION, "0.87.1");
  assert.equal(pi.getAgentDir(), agentDir);
  pi.initTheme("dark", false);

  const firstSettle = gate();
  const secondRequest = gate();
  const finalSettle = gate();
  const requests = [];
  const events = [];
  const boundaries = [];
  const queueUpdates = [];
  const compactionEnds = [];
  const extensionErrors = [];
  let beforeSettleCount = 0;
  let settledAt;
  let session;
  let prompting;

  const faux = ai.fauxProvider({
    provider: "blackhole-offline-queued-fixture",
    models: [{ id: "fixture", contextWindow: 20_000, maxTokens: 16_000 }],
    tokensPerSecond: 0,
    tokenSize: { min: 1_024, max: 1_024 },
  });
  faux.setResponses([firstResponse, secondResponse].map((text, index) => async (context) => {
    events.push(`request:${index + 1}`);
    requests.push({
      context: structuredClone(context),
      canonical: structuredClone(pi.convertToLlm(manager.buildSessionProjection().messages)),
      idle: session.isIdle,
      streaming: session.isStreaming,
      compactions: manager.getEntries().filter((entry) => entry.type === "compaction").length,
    });
    if (index === 1) await secondRequest.promise;
    return ai.fauxAssistantMessage(text);
  }));
  const modelRuntime = await pi.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const model = faux.getModel();
  const threshold = Math.floor(model.contextWindow * 0.65);
  assert.equal(threshold, 13_000);
  const settingsManager = pi.SettingsManager.create(work, agentDir);
  assert.equal(settingsManager.getCacheWarmingMode(), "off");

  const loader = new pi.DefaultResourceLoader({
    cwd: work,
    agentDir,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "Run only the offline 0.5.9 queued-continuation fixture.",
    extensionFactories: [(extension) => {
      for (const type of ["agent_start", "agent_end", "agent_before_settle", "agent_settled"]) {
        extension.on(type, async (_event, ctx) => {
          events.push(type);
          boundaries.push({ type, idle: ctx.isIdle() });
          if (type === "agent_before_settle") {
            beforeSettleCount++;
            if (beforeSettleCount === 1) await firstSettle.promise;
            if (beforeSettleCount === 2) await finalSettle.promise;
          }
          if (type === "agent_settled") settledAt = Date.now();
        });
      }
      for (const type of ["session_before_compact", "session_compact", "session_compact_failed"]) {
        extension.on(type, () => { events.push(type); });
      }
    }],
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, [], "package-discovered extension must load without errors");
  assert.equal(loaded.extensions.length, 2, "load only the package and boundary observer");
  const packageExtension = loaded.extensions.find((extension) => extension.sourceInfo?.source === candidateRoot);
  assert.ok(packageExtension, "the candidate package must be active through settings package discovery");
  assert.equal(packageExtension.path, join(candidateRoot, "index.ts"));
  assert.deepEqual(packageExtension.sourceInfo, {
    path: join(candidateRoot, "index.ts"), source: candidateRoot,
    scope: "user", origin: "package", baseDir: candidateRoot,
  }, "the manifest entry must come from settings packages, not a source-path override");
  assert.equal(realpathSync(packageExtension.resolvedPath), realpathSync(join(candidateRoot, "index.ts")));

  const manager = pi.SessionManager.create(work, sessionDir);
  assert.equal(manager.isPersisted(), true, "use the real persisted SessionManager");
  const visibleId = manager.appendMessage({
    role: "user", content: `Implement ${originalCanary} carefully.`, timestamp: 1,
  });
  manager.appendMessage({ ...ai.fauxAssistantMessage("Starting the fixture."), provider: model.provider, model: model.id });
  const omittedId = manager.appendMessage({
    role: "user", content: `Implement ${omittedCanary} too.`, timestamp: 2,
  });
  const seedReply = ai.fauxAssistantMessage("Synthetic progress.");
  seedReply.usage = { ...seedReply.usage, input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1_000 };
  manager.appendMessage({ ...seedReply, provider: model.provider, model: model.id });
  const visibleEditId = manager.appendContextEdit(visibleId, { content: `Implement ${visibleCanary} carefully.` });
  const omittedEditId = manager.appendContextEdit(omittedId, null);

  try {
    const created = await pi.createAgentSession({
      cwd: work, agentDir, resourceLoader: loader, modelRuntime, model,
      thinkingLevel: "off", sessionManager: manager, settingsManager, tools: [],
    });
    session = created.session;
    assert.deepEqual(created.extensionsResult.errors, []);
    await session.bindExtensions({ mode: "print", onError: (error) => { extensionErrors.push(error); } });
    session.subscribe((event) => {
      if (event.type === "agent_settled") events.push("public:agent_settled");
      if (event.type === "compaction_start" || event.type === "compaction_end") events.push(event.type);
      if (event.type === "compaction_end") compactionEnds.push(event);
      if (event.type === "queue_update") {
        queueUpdates.push(structuredClone(event));
        events.push(`queue:${event.followUp.length}`);
      }
    });

    const sessionFile = manager.getSessionFile();
    assert.equal(dirname(sessionFile), sessionDir);
    const seededRaw = readFileSync(sessionFile, "utf8");
    assert.ok(session.getContextUsage().tokens < threshold, "the seed must start below the 65% threshold");
    const debugFile = join(agentDir, "pi-blackhole", "debug.ndjson");
    const trace = () => {
      if (!existsSync(debugFile)) return [];
      const contents = readFileSync(debugFile, "utf8").trim();
      return contents ? contents.split("\n").map((line) => JSON.parse(line)) : [];
    };
    const traceEvents = (name) => trace().filter((entry) => entry.event === name);
    const nonIdlePolls = () => traceEvents("compaction_trigger.microtask.idle_check")
      .filter(({ data }) => data.isIdle === false).length;
    const assertNoCompaction = () => {
      assert.equal(session.isStreaming, true);
      assert.equal(session.isIdle, false);
      assert.equal(session.isCompacting, false);
      assert.equal(compactionEnds.length, 0);
      assert.equal(manager.getEntries().filter((entry) => entry.type === "compaction").length, 0);
      assert.ok(!events.includes("compaction_start"));
      assert.ok(!events.includes("agent_settled"));
      assert.equal(traceEvents("compaction_trigger.microtask.calling_compact").length, 0);
      assert.equal(traceEvents("compaction_trigger.onComplete").length, 0);
      assert.deepEqual(extensionErrors, []);
    };

    prompting = session.prompt(firstPrompt);
    await waitFor(() => beforeSettleCount === 1, "the first pre-settlement gate");
    await waitFor(() => nonIdlePolls() >= 2, "two actual non-idle polls with the first wait pending");
    assert.deepEqual(events, ["agent_start", "request:1", "agent_end", "agent_before_settle"]);
    assertNoCompaction();
    assert.equal(traceEvents("compaction_trigger.scheduled").length, 1);
    const firstCompleted = manager.getEntries().at(-1).message;
    assert.deepEqual(firstCompleted.content, [{ type: "text", text: firstResponse }]);
    assert.equal(firstCompleted.stopReason, "stop");
    assert.ok(firstCompleted.usage.output >= threshold, "the synthetic first response itself crosses 65%");
    const rawAfterFirst = readFileSync(sessionFile, "utf8");
    assert.ok(rawAfterFirst.startsWith(seededRaw));

    // Queue through Pi while isStreaming is still true, not via a second idle prompt.
    const pollsBeforeQueue = nonIdlePolls();
    await session.prompt(followUpPrompt, { streamingBehavior: "followUp" });
    assert.deepEqual(session.getFollowUpMessages(), [followUpPrompt]);
    assert.equal(session.pendingMessageCount, 1);
    assert.equal(requests.length, 1);
    await waitFor(() => nonIdlePolls() > pollsBeforeQueue, "an idle poll while the real follow-up remains queued");
    assertNoCompaction();
    assert.equal(traceEvents("compaction_trigger.scheduled").length, 1);
    assert.equal(traceEvents("compaction_trigger.microtask.bail").length, 0);
    assert.equal(readFileSync(sessionFile, "utf8"), rawAfterFirst, "queueing must not rewrite or prematurely persist history");

    firstSettle.release();
    await waitFor(() => requests.length === 2, "the queued native-provider request");
    // Pi starts a new low-level run. Blackhole cancels the first wait on agent_start.
    // Hold request two until that cancellation is observable, before a new wait can start.
    await waitFor(() => traceEvents("compaction_trigger.microtask.bail").length === 1, "the first wait's cancellation");
    assertNoCompaction();
    assert.deepEqual(traceEvents("compaction_trigger.microtask.bail").map(({ data }) => data.reason), ["aborted_agent_start"]);
    assert.equal(traceEvents("compaction_trigger.scheduled").length, 1);
    assert.equal(beforeSettleCount, 1);
    assert.deepEqual(session.getFollowUpMessages(), []);
    assert.equal(session.pendingMessageCount, 0);
    assert.deepEqual(events, [
      "agent_start", "request:1", "agent_end", "agent_before_settle", "queue:1",
      "agent_start", "queue:0", "request:2",
    ]);
    const pollsAfterCancellation = nonIdlePolls();

    secondRequest.release();
    await waitFor(() => beforeSettleCount === 2, "the final pre-settlement gate");
    await waitFor(() => nonIdlePolls() >= pollsAfterCancellation + 2, "two polls from the new deferred wait");
    assertNoCompaction();
    assert.equal(traceEvents("compaction_trigger.scheduled").length, 2, "the continuation must re-evaluate eligibility once");
    assert.equal(traceEvents("compaction_trigger.microtask.bail").length, 1);
    const secondCompleted = manager.getEntries().at(-1).message;
    assert.deepEqual(secondCompleted.content, [{ type: "text", text: secondResponse }]);
    assert.equal(secondCompleted.stopReason, "stop");
    const rawBefore = readFileSync(sessionFile, "utf8");
    const entriesBefore = structuredClone(manager.getEntries());
    assert.ok(rawBefore.startsWith(rawAfterFirst));
    assert.ok(rawBefore.includes(visibleCanary));
    assert.ok(rawBefore.includes(omittedCanary));

    finalSettle.release();
    await prompting;
    await session.waitForIdle();
    await waitFor(() => compactionEnds.length > 0, "deferred compaction_end after final settlement");
    assert.equal(compactionEnds[0].aborted, false);
    assert.equal(compactionEnds[0].errorMessage, undefined);
    assert.ok(compactionEnds[0].result, "Blackhole's deferred compaction must succeed");
    await waitFor(() => traceEvents("compaction_trigger.onComplete").length > 0, "Blackhole's completion trace");
    await session.waitForIdle();

    const expectedEvents = [
      "agent_start", "request:1", "agent_end", "agent_before_settle", "queue:1",
      "agent_start", "queue:0", "request:2", "agent_end", "agent_before_settle",
      "agent_settled", "public:agent_settled", "compaction_start",
      "session_before_compact", "session_compact", "compaction_end",
    ];
    const rawAfter = readFileSync(sessionFile, "utf8");
    const completedTrace = trace();
    // Observe six real 200ms polling periods and more than one 1000ms log-flush period.
    // Stable history, events and traces at every checkpoint detect orphaned idle work.
    for (let checkpoint = 0; checkpoint < 6; checkpoint++) {
      await sleep(200);
      assert.deepEqual(events, expectedEvents);
      assert.equal(session.isIdle, true);
      assert.equal(session.isStreaming, false);
      assert.equal(session.isCompacting, false);
      assert.equal(session.pendingMessageCount, 0);
      assert.equal(faux.state.callCount, 2);
      assert.equal(requests.length, 2);
      assert.equal(compactionEnds.length, 1);
      assert.deepEqual(trace(), completedTrace, "no idle work may continue after successful compaction");
      assert.equal(readFileSync(sessionFile, "utf8"), rawAfter, "idle observation must not append duplicate work");
      assert.deepEqual(extensionErrors, []);
    }

    assert.deepEqual(boundaries, [
      { type: "agent_start", idle: false },
      { type: "agent_end", idle: false },
      { type: "agent_before_settle", idle: false },
      { type: "agent_start", idle: false },
      { type: "agent_end", idle: false },
      { type: "agent_before_settle", idle: false },
      { type: "agent_settled", idle: true },
    ]);
    assert.deepEqual(queueUpdates, [
      { type: "queue_update", steering: [], followUp: [followUpPrompt] },
      { type: "queue_update", steering: [], followUp: [] },
    ]);
    assert.equal(traceEvents("compaction_trigger.scheduled").length, 2);
    assert.equal(traceEvents("compaction_trigger.microtask.bail").length, 1);
    for (const name of ["compaction_trigger.microtask.calling_compact", "compaction_trigger.onComplete"]) {
      assert.equal(traceEvents(name).length, 1, `${name} must occur exactly once`);
    }
    assert.equal(traceEvents("compaction_trigger.onError").length, 0);
    assert.equal(traceEvents("compaction_trigger.microtask.error").length, 0);
    const idleChecks = traceEvents("compaction_trigger.microtask.idle_check");
    assert.equal(idleChecks.filter(({ data }) => data.isIdle).length, 1);
    assert.equal(idleChecks.at(-1).data.isIdle, true);
    assert.ok(Date.parse(traceEvents("compaction_trigger.microtask.calling_compact")[0].ts) >= settledAt,
      "the only attempt must follow final agent_settled");
    assert.equal(traceEvents("compaction_trigger.onComplete")[0].data.result, true);
    const tokenChecks = traceEvents("compaction_trigger.tokens");
    assert.equal(tokenChecks.length, 2);
    for (const { data } of tokenChecks) {
      assert.equal(data.threshold, threshold, "use 65% of the declared context, not the 180000-token fallback");
      assert.ok(data.tokens >= threshold, "both responses must leave compaction eligible");
    }
    const rechecks = traceEvents("compaction_trigger.microtask.recheck_tokens");
    assert.equal(rechecks.length, 1);
    assert.equal(rechecks[0].data.ok, true);
    assert.equal(rechecks[0].data.threshold, threshold);
    assert.deepEqual(traceEvents("compaction_trigger.agent_end").map(({ data }) => data.memory), [false, false]);

    const entriesAfter = manager.getEntries();
    const compactions = entriesAfter.filter((entry) => entry.type === "compaction");
    assert.equal(compactions.length, 1);
    assert.equal(compactions[0].fromHook, true, "Blackhole must provide the summary hook");
    assert.ok(compactions[0].summary.includes(visibleCanary));
    assert.ok(!compactions[0].summary.includes(omittedCanary));
    assert.ok(!compactions[0].summary.includes(originalCanary));
    assert.ok(rawAfter.startsWith(seededRaw), "prompting must not rewrite the seed");
    assert.ok(rawAfter.startsWith(rawBefore), "the prior raw JSONL prefix must remain unchanged");
    assert.deepEqual(entriesAfter.slice(0, entriesBefore.length), entriesBefore);
    assert.deepEqual(manager.getEntry(visibleEditId).replacement, { content: `Implement ${visibleCanary} carefully.` });
    assert.equal(manager.getEntry(omittedEditId).replacement, null);
    assert.ok(rawAfter.includes(omittedCanary), "omitted raw history must remain persisted");
    assert.ok(rawAfter.includes(originalCanary), "replaced raw history must remain persisted");
    const persistedEntries = rawAfter.trim().split("\n").map((line) => JSON.parse(line)).slice(1);
    assert.deepEqual(persistedEntries, JSON.parse(JSON.stringify(entriesAfter)));
    assert.equal(persistedEntries.filter((entry) => entry.type === "compaction").length, 1);

    for (const [index, request] of requests.entries()) {
      assert.deepEqual(request.context.messages, request.canonical, `request ${index + 1} must use Pi's canonical projection`);
      assert.equal(request.idle, false);
      assert.equal(request.streaming, true);
      assert.equal(request.compactions, 0, "neither request may observe premature compaction");
      const serialized = JSON.stringify(request.context);
      assert.ok(serialized.includes(visibleCanary));
      assert.ok(!serialized.includes(omittedCanary));
      assert.ok(!serialized.includes(originalCanary));
    }
    const textOf = (message) => typeof message.content === "string"
      ? message.content : message.content.map((block) => block.text ?? "").join("");
    assert.equal(textOf(requests[0].context.messages.at(-1)), firstPrompt);
    assert.ok(!JSON.stringify(requests[0].context).includes(followUpPrompt));
    assert.deepEqual(requests[1].context.messages.slice(-3).map((message) => [message.role, textOf(message)]), [
      ["user", firstPrompt], ["assistant", firstResponse], ["user", followUpPrompt],
    ]);
    for (const text of [firstPrompt, firstResponse, followUpPrompt, secondResponse]) {
      assert.equal(persistedEntries.filter((entry) => entry.type === "message" && textOf(entry.message) === text).length, 1);
    }
    assert.equal(faux.getPendingResponseCount(), 0);
    assert.equal(faux.state.deferredFetchCount, 0);
    assert.deepEqual(faux.state.cancelledDeferred, []);
    assert.equal(settingsManager.getCacheWarmingMode(), "off");
    assert.equal(readFileSync(settingsPath, "utf8"), settingsBefore);
    assert.equal(readFileSync(configPath, "utf8"), configBefore);
    console.log(`PASS package discovery queued continuation: events=${events.join(">")}; scheduled=2; cancelledWait=1; attempt=1; success=1; fakeRequests=2; source=package`);
    console.log(`PASS pressure and persistence: firstOutputTokens=${firstCompleted.usage.output}; threshold=${threshold}; nonIdlePolls=${nonIdlePolls()}; no compaction before final settlement or between requests; canonical projections; unchanged raw prefix; persistedCompactions=1; stableCheckpoints=6`);
  } finally {
    firstSettle.release();
    secondRequest.release();
    finalSettle.release();
    await session?.abort();
    await prompting?.catch(() => {});
    if (session) {
      await session.extensionRunner.emit({ type: "session_shutdown" });
      session.dispose();
    }
    // Teardown only; no replacement or shutdown-race assertions. Keep guards active until exit.
    await sleep(1_200);
    assert.deepEqual(extensionErrors, [], "extension handlers must not fail silently, including during teardown");
    assert.deepEqual(calls, {
      network: [], browser: [],
      subprocess: [{ name: "execFileSync", file: "git", args: ["rev-parse", "--show-toplevel"] }],
    });
    assert.ok(!existsSync(join(agentDir, "auth.json")));
    assert.ok(!existsSync(join(agentDir, "models.json")));
    console.log("PASS guards: network=0; browser=0; launched subprocesses=0; optional Git probe denied once; extension errors=0");
  }
}
