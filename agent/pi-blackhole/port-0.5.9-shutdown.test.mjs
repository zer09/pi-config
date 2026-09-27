import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import dns from "node:dns";
import fs, {
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
import fsPromises from "node:fs/promises";
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
// Keep the accepted replacement/queue fixtures unchanged. Test runtime disposal,
// the same shutdown operation used on graceful RPC stdin end, not hard process signals.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../..");
const installed = join(repository, "agent/npm/node_modules/pi-blackhole");
const piRoot = "/home/gc/.bun/install/global/node_modules/@earendil-works/pi-coding-agent";
const aiRoot = "/home/gc/.bun/install/global/node_modules/@earendil-works/pi-ai";
const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const originalCanary = "ORIGINAL_VISIBLE_SHUTDOWN_GOAL";
const visibleCanary = "VISIBLE_SHUTDOWN_CANARY";
const omittedCanary = "OMITTED_SHUTDOWN_CANARY";
const oldPrompt = "OLD_SHUTDOWN_PROMPT_CANARY: complete the offline request.";
const oldResponse = `OLD_SHUTDOWN_RESPONSE_CANARY\n${"Synthetic pressure. ".repeat(2_600)}`;
const staleWarning = "Observational memory: auto-compaction skipped — the extension ctx went stale before the deferred " +
  "compaction ran (in-memory sessions disposed right after agent_end lose this race); see /blackhole-memory status";
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

async function bounded(promise, description) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
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
    // Blackhole owns the threshold, not Pi's built-in automatic compaction.
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

if (process.argv[2] === "--shutdown-fixture") {
  await runShutdownFixture(process.argv[3], process.argv[4]);
} else {
  test("Pi 0.87.1 runtime dispose cancels package-discovered Blackhole's deferred compaction", { timeout: 120_000 }, async (t) => {
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
    const root = mkdtempSync(join(realpathSync(tmpdir()), "pi-blackhole-0.5.9-shutdown-"));
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
        assert.ok(!existsSync(root), "temporary package, HOME, sessions and caches must be removed");
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
      ["--unhandled-rejections=strict", fileURLToPath(import.meta.url), "--shutdown-fixture", candidateRoot, sandbox],
      { cwd: join(sandbox, "cwd"), env, encoding: "utf8", timeout: 90_000 },
    );
    console.log(output.trim());
    assert.match(output, /PASS package discovery shutdown/);
    assert.ok(!existsSync(join(candidateRoot, "node_modules")), "discovery must not install dependencies");
    assert.ok(!existsSync(join(env.PI_CODING_AGENT_DIR, "npm")), "no package installation is allowed");
    assert.equal(readdirSync(env.PI_CODING_AGENT_SESSION_DIR).length, 1, "only the synthetic old session file may exist");
  });
}

async function runShutdownFixture(candidateRoot, sandbox) {
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

  // Install the accepted fixtures' guards before importing Pi, including swallowed failures.
  const calls = { network: [], browser: [], subprocess: [], originalSession: [] };
  const blocked = (kind, name) => () => {
    calls[kind].push({ name });
    throw new Error(`${kind} is forbidden in the offline shutdown fixture`);
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
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    childProcess[name] = blocked("subprocess", name);
  }
  childProcess.ChildProcess.prototype.spawn = blocked("subprocess", "ChildProcess.prototype.spawn");

  // No real session is opened or inventoried. Only synthetic JSONL is allowed.
  const originalSessionRoots = ["sessions", "delegate-sessions", "subagent-sessions"]
    .map((name) => join(repository, "agent", name));
  const guardSessionPath = (value, name) => {
    if (value instanceof URL) value = fileURLToPath(value);
    if (Buffer.isBuffer(value)) value = value.toString();
    if (typeof value !== "string") return;
    const path = resolve(value);
    if (originalSessionRoots.some((root) => path === root || isWithin(root, path)) ||
        (path.endsWith(".jsonl") && !isWithin(sessionDir, path))) {
      blocked("originalSession", name)();
    }
  };
  for (const object of [fs, fsPromises]) {
    for (const name of [
      "access", "appendFile", "chmod", "chown", "exists", "lstat", "mkdir", "open", "opendir",
      "readFile", "readdir", "readlink", "realpath", "rm", "rmdir", "stat", "truncate", "unlink", "utimes", "writeFile",
      "createReadStream", "createWriteStream", "watch", "watchFile", "copyFile", "cp", "rename", "link", "symlink",
    ].flatMap((name) => [name, `${name}Sync`])) {
      if (typeof object[name] !== "function") continue;
      const original = object[name];
      const guarded = function (...args) {
        guardSessionPath(args[0], name);
        if (/^(copyFile|cp|rename|link|symlink)(Sync)?$/.test(name)) guardSessionPath(args[1], name);
        return Reflect.apply(original, this, args);
      };
      // Node exposes a second realpath implementation on the function itself.
      if (original.native) {
        guarded.native = (...args) => {
          guardSessionPath(args[0], `${name}.native`);
          return original.native(...args);
        };
      }
      object[name] = guarded;
    }
  }
  syncBuiltinESMExports();

  const warnings = [];
  const consoleErrors = [];
  const unhandled = [];
  console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };
  console.error = (...args) => { consoleErrors.push(args.map(String).join(" ")); };
  process.on("unhandledRejection", (error) => { unhandled.push(String(error)); });

  const piManifest = json(join(piRoot, "package.json"));
  const aiManifest = json(join(aiRoot, "package.json"));
  assert.equal(piManifest.version, "0.87.1");
  assert.equal(aiManifest.version, "0.87.1");
  const pi = await import(pathToFileURL(join(piRoot, piManifest.exports["."].import)).href);
  const ai = await import(pathToFileURL(join(aiRoot, aiManifest.exports["."].import)).href);
  assert.equal(pi.VERSION, "0.87.1");
  assert.equal(pi.getAgentDir(), agentDir);
  pi.initTheme("dark", false);

  const beforeSettle = gate();
  const requests = [];
  const events = [];
  const boundaries = [];
  const starts = [];
  const shutdowns = [];
  const compactCalls = [];
  const extensionErrors = [];
  const invalidations = [];
  let runtime;
  let session;
  let services;
  let prompting;
  let disposing;
  let heldContext;
  let settleHeld = false;
  let invalidatedAt;

  const faux = ai.fauxProvider({
    provider: "blackhole-offline-shutdown-fixture",
    models: [{ id: "fixture", contextWindow: 20_000, maxTokens: 16_000 }],
    tokensPerSecond: 0,
    tokenSize: { min: 1_024, max: 1_024 },
  });
  faux.setResponses([(context) => {
    events.push("request:old");
    requests.push({
      sessionId: session.sessionId,
      context: structuredClone(context),
      canonical: structuredClone(pi.convertToLlm(session.sessionManager.buildSessionProjection().messages)),
      idle: session.isIdle,
      streaming: session.isStreaming,
    });
    return ai.fauxAssistantMessage(oldResponse);
  }]);
  const model = faux.getModel();
  const threshold = Math.floor(model.contextWindow * 0.65);
  assert.equal(threshold, 13_000);

  const createRuntime = async ({ cwd, agentDir: dir, sessionManager, sessionStartEvent }) => {
    assert.equal(cwd, work);
    assert.equal(dir, agentDir);
    assert.equal(sessionManager.isPersisted(), true);
    assert.equal(sessionManager.getSessionDir(), sessionDir);
    assert.equal(session, undefined, "shutdown must not create a replacement runtime");
    const modelRuntime = await pi.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    services = await pi.createAgentSessionServices({
      cwd, agentDir: dir, modelRuntime,
      resourceLoaderOptions: {
        noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        systemPrompt: "Run only the offline 0.5.9 shutdown fixture.",
        extensionFactories: [(extension) => {
          extension.on("session_start", (event, ctx) => {
            events.push("old:session_start");
            starts.push({ event: structuredClone(event), id: ctx.sessionManager.getSessionId() });
          });
          extension.on("session_shutdown", (event, ctx) => {
            events.push(`old:session_shutdown:${event.reason}`);
            shutdowns.push({
              event: structuredClone(event), id: ctx.sessionManager.getSessionId(),
              file: ctx.sessionManager.getSessionFile(), idle: ctx.isIdle(), held: settleHeld,
            });
          });
          for (const type of ["agent_start", "agent_end", "agent_before_settle"]) {
            extension.on(type, async (_event, ctx) => {
              events.push(`old:${type}`);
              boundaries.push({ type, idle: ctx.isIdle() });
              if (type === "agent_before_settle") {
                heldContext = ctx;
                settleHeld = true;
                await beforeSettle.promise;
                settleHeld = false;
              }
            });
          }
          extension.on("agent_settled", () => {
            // Shutdown invalidates contexts before the held boundary can finish.
            // Observe host state here; do not make the observer itself use a stale ctx.
            events.push("old:agent_settled");
            boundaries.push({ type: "agent_settled", idle: session.isIdle });
          });
          for (const type of ["session_before_switch", "session_before_compact", "session_compact", "session_compact_failed"]) {
            extension.on(type, () => { events.push(`old:${type}`); });
          }
        }],
      },
    });
    assert.deepEqual(services.diagnostics, []);
    assert.equal(services.settingsManager.getCacheWarmingMode(), "off");
    const loaded = services.resourceLoader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 2, "load only the package and boundary observer");
    const packageExtension = loaded.extensions.find((extension) => extension.sourceInfo?.source === candidateRoot);
    assert.ok(packageExtension, "the candidate must be active through settings package discovery");
    assert.equal(packageExtension.path, join(candidateRoot, "index.ts"));
    assert.deepEqual(packageExtension.sourceInfo, {
      path: join(candidateRoot, "index.ts"), source: candidateRoot,
      scope: "user", origin: "package", baseDir: candidateRoot,
    });
    assert.equal(realpathSync(packageExtension.resolvedPath), realpathSync(join(candidateRoot, "index.ts")));
    const created = await pi.createAgentSessionFromServices({
      services, sessionManager, sessionStartEvent, model, thinkingLevel: "off", tools: [],
    });
    assert.deepEqual(created.extensionsResult.errors, []);
    session = created.session;
    // Observe even a stale ctx.compact attempt. Forward unchanged; never fake idle or compaction.
    const runner = session.extensionRunner;
    const createContext = runner.createContext.bind(runner);
    runner.createContext = (...args) => {
      const ctx = createContext(...args);
      const compact = ctx.compact;
      ctx.compact = (...compactArgs) => {
        compactCalls.push("old");
        return compact(...compactArgs);
      };
      return ctx;
    };
    return { ...created, services, diagnostics: services.diagnostics };
  };

  const manager = pi.SessionManager.create(work, sessionDir);
  const visibleId = manager.appendMessage({ role: "user", content: `Implement ${originalCanary} carefully.`, timestamp: 1 });
  manager.appendMessage({ ...ai.fauxAssistantMessage("Starting the fixture."), provider: model.provider, model: model.id });
  const omittedId = manager.appendMessage({ role: "user", content: `Implement ${omittedCanary} too.`, timestamp: 2 });
  const seedReply = ai.fauxAssistantMessage("Synthetic progress.");
  seedReply.usage = { ...seedReply.usage, input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1_000 };
  manager.appendMessage({ ...seedReply, provider: model.provider, model: model.id });
  const visibleEditId = manager.appendContextEdit(visibleId, { content: `Implement ${visibleCanary} carefully.` });
  const omittedEditId = manager.appendContextEdit(omittedId, null);

  const debugFile = join(agentDir, "pi-blackhole/debug.ndjson");
  const trace = () => {
    if (!existsSync(debugFile)) return [];
    const contents = readFileSync(debugFile, "utf8").trim();
    return contents ? contents.split("\n").map((line) => JSON.parse(line)) : [];
  };
  const traceEvents = (name) => trace().filter((entry) => entry.event === name);
  const nonIdlePolls = () => traceEvents("compaction_trigger.microtask.idle_check")
    .filter(({ data }) => data.isIdle === false).length;
  const assertNoCompaction = () => {
    assert.deepEqual(compactCalls, [], "the old ctx.compact must never be called, even after invalidation");
    assert.equal(session.isCompacting, false);
    assert.equal(manager.getEntries().filter((entry) => entry.type === "compaction").length, 0);
    for (const name of ["compaction_trigger.microtask.calling_compact", "compaction_trigger.onComplete",
      "compaction_trigger.onError", "compaction_trigger.microtask.error", "compaction_trigger.microtask.recheck_tokens"]) {
      assert.equal(traceEvents(name).length, 0, `${name} must never occur`);
    }
    assert.deepEqual(extensionErrors, []);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(unhandled, []);
  };

  try {
    runtime = await pi.createAgentSessionRuntime(createRuntime, { cwd: work, agentDir, sessionManager: manager });
    assert.ok(runtime instanceof pi.AgentSessionRuntime);
    assert.equal(runtime.dispose, pi.AgentSessionRuntime.prototype.dispose);
    runtime.setBeforeSessionInvalidate(() => {
      events.push("old:invalidate");
      invalidatedAt = Date.now();
      invalidations.push({ id: heldContext.sessionManager.getSessionId(), idle: heldContext.isIdle(), held: settleHeld });
    });
    session.subscribe((event) => {
      if (["agent_settled", "compaction_start", "compaction_end", "queue_update"].includes(event.type)) {
        events.push(`old:public:${event.type}`);
      }
    });
    await session.bindExtensions({ mode: "print", onError: (error) => { extensionErrors.push(error); } });
    const oldId = session.sessionId;
    const oldFile = session.sessionFile;
    assert.equal(dirname(oldFile), sessionDir);
    const seededRaw = readFileSync(oldFile, "utf8");
    assert.ok(session.getContextUsage().tokens < threshold);

    prompting = session.prompt(oldPrompt);
    // Keep failures observed during disposal, but still require successful completion below.
    prompting.catch(() => {});
    await waitFor(() => settleHeld, "the old pre-settlement gate");
    await waitFor(() => nonIdlePolls() >= 2, "two real non-idle polls with old compaction pending");
    const beforeShutdownEvents = ["old:session_start", "old:agent_start", "request:old", "old:agent_end", "old:agent_before_settle"];
    assert.deepEqual(events, beforeShutdownEvents);
    assert.equal(session.isIdle, false);
    assert.equal(session.isStreaming, true);
    assert.equal(heldContext.sessionManager.getSessionId(), oldId);
    assertNoCompaction();
    assert.equal(traceEvents("compaction_trigger.scheduled").length, 1);
    assert.equal(traceEvents("compaction_trigger.microtask.bail").length, 0);
    assert.deepEqual(warnings, []);
    const firstCompleted = manager.getEntries().at(-1).message;
    assert.deepEqual(firstCompleted.content, [{ type: "text", text: oldResponse }]);
    assert.equal(firstCompleted.stopReason, "stop");
    assert.ok(firstCompleted.usage.output >= threshold, "the synthetic response itself crosses 65%");
    const pollsBeforeShutdown = nonIdlePolls();
    const rawBeforeShutdown = readFileSync(oldFile, "utf8");
    const entriesBeforeShutdown = structuredClone(manager.getEntries());
    assert.ok(rawBeforeShutdown.startsWith(seededRaw));

    // Unlike newSession(), dispose() does not wait for abort()/settlement. Keep
    // the gate held until the real runtime has shut down and invalidated its ctx.
    disposing = runtime.dispose();
    await bounded(disposing, "AgentSessionRuntime.dispose() with the boundary still held");
    assert.equal(settleHeld, true);
    assert.equal(session.isIdle, false);
    assert.equal(runtime.session, session, "quit must not replace the old session");
    assert.equal(runtime.session.sessionId, oldId);
    assert.equal(runtime.session.sessionFile, oldFile);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].id, oldId);
    assert.deepEqual(shutdowns, [{
      id: oldId, file: oldFile, idle: false, held: true,
      event: { type: "session_shutdown", reason: "quit" },
    }]);
    assert.deepEqual(invalidations, [{ id: oldId, idle: false, held: true }]);
    assert.deepEqual(events, [...beforeShutdownEvents, "old:session_shutdown:quit", "old:invalidate"]);
    assert.throws(() => heldContext.sessionManager, /extension ctx is stale/);
    assert.throws(() => heldContext.isIdle(), /extension ctx is stale/);
    assertNoCompaction();
    assert.equal(readFileSync(oldFile, "utf8"), rawBeforeShutdown);

    beforeSettle.release();
    await bounded(prompting, "the held prompt to finish after shutdown");
    await bounded(session.waitForIdle(), "the disposed session to finish settlement");
    assert.equal(settleHeld, false);
    // Stock 0.5.9 leaves this controller waiting on shutdown. Its next session
    // identity check handles Pi's invalidated ctx with the documented stale skip.
    await waitFor(() => traceEvents("compaction_trigger.microtask.bail").length > 0, "the deferred wait's stale-context cancellation");
    assert.deepEqual(traceEvents("compaction_trigger.microtask.bail").map(({ data }) => data), [{ reason: "stale_ctx" }]);
    assert.ok(Date.parse(traceEvents("compaction_trigger.microtask.bail")[0].ts) >= invalidatedAt);
    assert.deepEqual(warnings, [staleWarning], "allow only the handled headless warning, not extension errors");
    const expectedEvents = [...beforeShutdownEvents, "old:session_shutdown:quit", "old:invalidate", "old:agent_settled"];
    const completedTrace = trace();
    // Six real poll periods and more than one debug flush period expose duplicate work.
    for (let checkpoint = 0; checkpoint < 6; checkpoint++) {
      await sleep(200);
      assert.deepEqual(events, expectedEvents, "disposal removes public listeners before the held boundary settles");
      assertNoCompaction();
      assert.deepEqual(trace(), completedTrace, "the deferred wait must stay cancelled after shutdown");
      assert.equal(readFileSync(oldFile, "utf8"), rawBeforeShutdown, "shutdown must preserve the entire old raw prefix");
      assert.deepEqual(manager.getEntries(), entriesBeforeShutdown);
      assert.equal(shutdowns.length, 1);
      assert.equal(invalidations.length, 1);
      assert.equal(faux.state.callCount, 1);
      assert.equal(requests.length, 1);
      assert.deepEqual(warnings, [staleWarning]);
      assert.equal(session.isIdle, true);
      assert.equal(session.isStreaming, false);
      assert.equal(session.pendingMessageCount, 0);
    }
    assert.deepEqual(boundaries, [
      { type: "agent_start", idle: false },
      { type: "agent_end", idle: false },
      { type: "agent_before_settle", idle: false },
      { type: "agent_settled", idle: true },
    ]);
    assert.equal(traceEvents("compaction_trigger.scheduled").length, 1);
    assert.equal(traceEvents("compaction_trigger.microtask.bail").length, 1);
    assert.equal(traceEvents("compaction_trigger.microtask.idle_check").filter(({ data }) => data.isIdle).length, 0);
    for (const { data } of traceEvents("compaction_trigger.microtask.session_check")) {
      assert.deepEqual(data, { currentSessionId: oldId, expectedSessionId: oldId, match: true });
    }
    assert.deepEqual(traceEvents("compaction_trigger.threshold_reached").map(({ data }) => data.sessionId), [oldId]);
    const tokenChecks = traceEvents("compaction_trigger.tokens");
    assert.equal(tokenChecks.length, 1);
    assert.equal(tokenChecks[0].data.threshold, threshold);
    assert.ok(tokenChecks[0].data.tokens >= threshold);
    assert.deepEqual(traceEvents("compaction_trigger.agent_end").map(({ data }) => data.memory), [false]);

    const persisted = rawBeforeShutdown.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(persisted[0].id, oldId);
    assert.deepEqual(persisted.slice(1), JSON.parse(JSON.stringify(manager.getEntries())));
    assert.equal(persisted.filter((entry) => entry.type === "compaction").length, 0);
    assert.deepEqual(manager.getEntry(visibleEditId).replacement, { content: `Implement ${visibleCanary} carefully.` });
    assert.equal(manager.getEntry(omittedEditId).replacement, null);
    for (const canary of [originalCanary, visibleCanary, omittedCanary]) assert.ok(rawBeforeShutdown.includes(canary));
    assert.equal(requests[0].sessionId, oldId);
    assert.deepEqual(requests[0].context.messages, requests[0].canonical, "the request must use Pi's canonical projection");
    assert.equal(requests[0].idle, false);
    assert.equal(requests[0].streaming, true);
    const serialized = JSON.stringify(requests[0].context);
    assert.ok(serialized.includes(visibleCanary));
    assert.ok(!serialized.includes(originalCanary));
    assert.ok(!serialized.includes(omittedCanary));
    const textOf = (message) => typeof message.content === "string"
      ? message.content : message.content.map((block) => block.text ?? "").join("");
    assert.equal(textOf(requests[0].context.messages.at(-1)), oldPrompt);
    for (const text of [oldPrompt, oldResponse]) {
      assert.equal(persisted.filter((entry) => entry.type === "message" && textOf(entry.message) === text).length, 1);
    }
    assert.equal(faux.getPendingResponseCount(), 0);
    assert.equal(faux.state.deferredFetchCount, 0);
    assert.deepEqual(faux.state.cancelledDeferred, []);
    assert.equal(readFileSync(settingsPath, "utf8"), settingsBefore);
    assert.equal(readFileSync(configPath, "utf8"), configBefore);
    assert.equal(services.settingsManager.getCacheWarmingMode(), "off");
    console.log("PASS package discovery shutdown: dispose=published; reason=quit; shutdowns=1; oldCtx=invalidated; scheduled=1; cancelled=stale_ctx; expectedWarnings=1; ctx.compact=0; fakeRequests=1; source=package");
    console.log(`PASS pressure and persistence: firstOutputTokens=${firstCompleted.usage.output}; threshold=${threshold}; nonIdlePollsBeforeShutdown=${pollsBeforeShutdown}; old raw prefix unchanged; persistedCompactions=0; stableCheckpoints=6`);
  } finally {
    try {
      // Dispose at most once, including failure cleanup. Never emit shutdown by hand.
      if (runtime && !disposing) disposing = runtime.dispose();
      await bounded(disposing, "shutdown cleanup");
    } finally {
      beforeSettle.release();
      await bounded(prompting?.catch(() => {}), "prompt cleanup");
    }
    // Keep guards active through teardown and another full debug flush period.
    await sleep(1_200);
    if (session) assertNoCompaction();
    assert.deepEqual(extensionErrors, [], "no silent extension errors, including during teardown");
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(unhandled, []);
    assert.deepEqual(calls, { network: [], browser: [], subprocess: [], originalSession: [] });
    assert.ok(!existsSync(join(agentDir, "auth.json")));
    assert.ok(!existsSync(join(agentDir, "models.json")));
    console.log("PASS guards: network=0; browser=0; subprocesses=0; original-session access=0; extension errors=0; unhandled rejections=0");
  }
}
