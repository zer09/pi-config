import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import dns from "node:dns";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";
import workerThreads from "node:worker_threads";

// Run directly with Node 24: node --test agent/tests/pi-0.87.1-all-active-lifecycle.test.mjs
// Only the test harness starts a bounded Node worker. No extension may launch a process.
// This is a headless lifecycle gate, not a provider, browser, tool, or TUI test.
const filename = fileURLToPath(import.meta.url);
const repository = resolve(dirname(filename), "../..");
const globalModules = "/home/gc/.bun/install/global/node_modules";
const piRoot = join(globalModules, "@earendil-works/pi-coding-agent");
const aiRoot = join(globalModules, "@earendil-works/pi-ai");
const npmRoot = join(repository, "agent/npm/node_modules");
const localEntries = [
  "codegraph/index.ts", "context-mode/src/index.ts", "delegated-pi-loop/index.ts",
  "fastlane/index.ts", "footer/index.ts", "github-ci/index.ts",
  "openai-codex-aliases/index.ts", "theme-overrides/index.ts", "web-search/index.ts",
].map((entry) => join(repository, "agent/extensions", entry));
const packages = [
  { name: "pi-blackhole", version: "0.5.9", entry: "index.ts" },
  { name: "pi-btw", version: "0.6.1", entry: "extensions/btw.ts" },
  { name: "pi-browser-harness", version: "0.10.2", entry: "src/index.ts" },
  { name: "pi-claude-bridge", version: "0.8.0", entry: "src/index.ts" },
].map((pkg) => ({ ...pkg, root: join(npmRoot, pkg.name) }));
const lifecycle = [
  "session_start", "agent_start", "agent_end", "agent_before_settle", "agent_settled", "session_shutdown",
];
const reply = "ALL_ACTIVE_OFFLINE_TURN_COMPLETE";
const json = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const within = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

function snapshot(paths) {
  const records = [];
  function visit(path) {
    const stat = fs.lstatSync(path, { bigint: true });
    let content;
    if (stat.isSymbolicLink()) content = `link:${fs.readlinkSync(path)}`;
    else if (stat.isDirectory()) {
      content = "directory";
      // Package-owned files are protected; dependency trees are read-only under the worker guards.
      for (const name of fs.readdirSync(path).sort()) {
        if (name !== "node_modules") visit(join(path, name));
      }
    } else content = hash(fs.readFileSync(path));
    records.push([path, String(stat.mode), String(stat.mtimeNs), content]);
  }
  for (const path of [...new Set(paths)].sort()) visit(path);
  return records;
}

function environment(root) {
  return {
    PATH: join(root, "no-executables"),
    HOME: join(root, "home"), USERPROFILE: join(root, "home"),
    PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
    XDG_CACHE_HOME: join(root, "cache"), XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
    JITI_FS_CACHE: "false", JITI_CACHE_DIR: join(root, "cache/jiti"),
    NODE_DISABLE_COMPILE_CACHE: "1", BROWSER: "false", TERM: "dumb",
  };
}

function prepare(root, tracked) {
  // The marker contains Pi's ancestor discovery inside the disposable workspace.
  for (const path of ["home", "agent/pi-blackhole", "sessions", "cwd/.pi", "cwd/.git", "cache", "config", "data", "state", "claude", "tmp"]) {
    fs.mkdirSync(join(root, path), { recursive: true });
  }
  fs.writeFileSync(join(root, "tracked.json"), JSON.stringify(tracked));
  fs.writeFileSync(join(root, "agent/settings.json"), JSON.stringify({
    extensions: localEntries,
    packages: packages.map((pkg) => pkg.name === "pi-browser-harness" ? { source: pkg.root, skills: [] } : pkg.root),
    cacheWarming: "off", sessionDir: join(root, "sessions"),
    defaultProjectTrust: "never", enableInstallTelemetry: false, enableAnalytics: false,
    defaultTools: [], retry: { enabled: false },
    compaction: { enabled: true, reserveTokens: 1024, keepRecentTokens: 1024 },
  }));
  fs.writeFileSync(join(root, "agent/pi-blackhole/pi-blackhole-config.json"), JSON.stringify({
    memory: false, compaction: "auto", compactionEngine: "blackhole", compactAfterPercent: 0.9,
    compactAfterTokens: 180000, midRunCompaction: "off", compactionSummaryMode: "default",
    statusBar: false, showPreCompactionMessage: false, retainedToolOutputMaxTokens: 0,
    debug: false, debugLog: false,
  }));
  fs.writeFileSync(join(root, "cwd/.pi/settings.json"), "{}\n");
}

function verifyPins() {
  for (const pkg of packages) {
    const manifest = json(join(pkg.root, "package.json"));
    assert.equal(manifest.name, pkg.name);
    assert.equal(manifest.version, pkg.version);
    assert.deepEqual(manifest.pi.extensions, [`./${pkg.entry}`]);
  }
  for (const name of ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"]) {
    assert.equal(json(join(globalModules, "@earendil-works", name, "package.json")).version, "0.87.1");
  }
  // These hashes are the accepted installed patch artifacts, not stock npm source.
  assert.equal(hash(fs.readFileSync(join(npmRoot, "pi-blackhole/src/hooks/before-compact.ts"))),
    "0898de0d68af964968087a18741c69b4211dc5289d7c685422c8e632fcbbcf1b");
  assert.equal(hash(fs.readFileSync(join(npmRoot, "pi-claude-bridge/src/transcript.ts"))),
    "d4583d9739b3d9a65d0b458c6d50261a7fe8dc8a07ef5e7fce81b1a904b05427");
  assert.match(fs.readFileSync(join(npmRoot, "pi-btw/extensions/btw.ts"), "utf8"),
    /await modelRuntime\.setRuntimeApiKey\(model\.provider, auth\.apiKey, \{ signal: ctx\.signal \}\)/);
  assert.deepEqual(json(join(repository, "agent/settings.json")).packages, [
    "npm:pi-blackhole@0.5.9", "npm:pi-btw@0.6.1",
    { source: "npm:pi-browser-harness@0.10.2", skills: [] }, "npm:pi-claude-bridge@0.8.0",
  ]);
}

// All checks below run before either Pi or an extension is imported.
async function installGuards(root, tracked, canary) {
  const raw = { ...fs };
  const rawPromises = { ...fsp };
  const audit = { forbidden: [], deniedGitProbe: [], deniedPlatformProbe: 0, reads: 0, writes: 0, selfChecks: 0 };
  let selfCheck = false;
  const deny = (kind, detail) => {
    if (selfCheck) audit.selfChecks++;
    else audit.forbidden.push({ kind, detail });
    throw new Error(`OFFLINE_GUARD ${kind}: ${detail}`);
  };
  const blocked = (kind, detail) => () => deny(kind, detail);
  const sourceFiles = new Set([...tracked, filename].map((path) => resolve(path)));
  const dependencyRoots = [
    globalModules, npmRoot,
    join(repository, "agent/extensions/codegraph/node_modules"),
    join(repository, "agent/extensions/context-mode/node_modules"),
  ];
  const sourceDirectories = new Set();
  for (const path of [...sourceFiles, ...dependencyRoots, root]) {
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      sourceDirectories.add(dir);
      if (dir === dirname(dir)) break;
    }
  }
  const fds = new Map();
  function pathValue(value) {
    if (typeof value === "number") {
      if (!fds.has(value)) deny("file-descriptor", "unapproved descriptor");
      return fds.get(value).path;
    }
    if (value instanceof URL) return fileURLToPath(value);
    if (Buffer.isBuffer(value)) return value.toString();
    if (typeof value !== "string") deny("path", "unsupported path value");
    return resolve(value);
  }
  function check(value, mode = "read") {
    const path = pathValue(value);
    // Never inspect credentials, original sessions, or a graph database, even through a source symlink.
    if (/(?:^|\/)(?:auth\.json|credentials(?:\.json)?|\.codegraph|\.codebase-memory)(?:\/|$)/.test(path)) {
      deny(mode, path);
    }
    const temporary = within(root, path);
    const dependency = dependencyRoots.some((dir) => within(dir, path));
    const source = sourceFiles.has(path);
    // Directory import resolution can try the directory before its tracked index.ts.
    const sourceDirectory = sourceDirectories.has(path) && within(join(repository, "agent/extensions"), path);
    const metadata = mode === "metadata" && sourceDirectories.has(path);
    // Module resolution probes nonexistent ancestor package manifests. Permit only absence, not contents.
    const missingManifest = path.endsWith("/package.json") && sourceDirectories.has(dirname(path)) && !raw.existsSync(path);
    // Jiti probes .js/.mjs/index variants before resolving a tracked .ts file.
    // This permits absent-path metadata only, never untracked file contents.
    const missingSourceCandidate = mode === "metadata" && within(join(repository, "agent/extensions"), path) && !raw.existsSync(path);
    if (mode === "write" ? !temporary : !(temporary || dependency || source || sourceDirectory || metadata || missingManifest || missingSourceCandidate)) deny(mode, path);
    let ancestor = path;
    while (!raw.existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
    const canonical = raw.realpathSync(ancestor);
    if (mode === "write") {
      if (!within(root, canonical)) deny("write-symlink", path);
      audit.writes++;
    } else {
      const canonicalAllowed = within(root, canonical) || sourceFiles.has(canonical) ||
        dependencyRoots.some((dir) => within(dir, canonical)) || sourceDirectories.has(canonical);
      if (!canonicalAllowed) deny("read-symlink", path);
      if (mode === "read") audit.reads++;
    }
    return path;
  }
  function guardDisposable(handle, symbol) {
    // Node's removal closures bypass exported fs methods. Recheck the original path at disposal.
    const path = pathValue(handle.path);
    for (const method of ["remove", symbol]) {
      const original = handle[method];
      handle[method] = function (...args) {
        check(path, "write");
        return original.apply(this, args);
      };
    }
    return handle;
  }
  const writing = (flags = "r") => typeof flags === "number"
    ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0
    : /[wa+]/.test(flags);
  for (const name of ["readFile", "readFileSync", "readdir", "readdirSync", "opendir", "opendirSync", "readlink", "readlinkSync", "createReadStream", "openAsBlob"]) {
    fs[name] = function (path, ...args) {
      if (name === "readFileSync" && path === "/proc/version") {
        // Pi and is-wsl catch this optional probe. Do not read /proc or pretend it succeeded.
        audit.deniedPlatformProbe++;
        throw new Error("Offline fixture: WSL probe denied");
      }
      check(path);
      return raw[name].call(this, path, ...args);
    };
  }
  for (const name of ["stat", "statSync", "lstat", "lstatSync", "exists", "existsSync", "access", "accessSync", "realpath", "realpathSync", "statfs", "statfsSync"]) {
    fs[name] = function (path, ...args) { check(path, "metadata"); return raw[name].call(this, path, ...args); };
    if (raw[name].native) fs[name].native = function (path, ...args) {
      check(path, "metadata"); return raw[name].native.call(this, path, ...args);
    };
  }
  for (const name of ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync", "mkdtempDisposableSync", "rm", "rmSync", "rmdir", "rmdirSync", "unlink", "unlinkSync", "truncate", "truncateSync", "chmod", "chmodSync", "chown", "chownSync", "lchown", "lchownSync", "utimes", "utimesSync", "lutimes", "lutimesSync", "createWriteStream"]) {
    fs[name] = function (path, ...args) {
      check(path, "write");
      const result = raw[name].call(this, path, ...args);
      return name === "mkdtempDisposableSync" ? guardDisposable(result, Symbol.dispose) : result;
    };
  }
  for (const name of ["rename", "renameSync", "copyFile", "copyFileSync", "cp", "cpSync"]) {
    fs[name] = function (from, to, ...args) {
      check(from, name.startsWith("rename") ? "write" : "read"); check(to, "write");
      return raw[name].call(this, from, to, ...args);
    };
  }
  // No glob cwd/pattern confinement is implemented, so never start glob traversal.
  for (const name of ["link", "linkSync", "symlink", "symlinkSync", "watch", "watchFile", "unwatchFile", "glob", "globSync"]) fs[name] = blocked("filesystem", name);
  fs.openSync = function (path, flags, ...args) {
    const write = writing(flags);
    const approved = check(path, write ? "write" : "read");
    const fd = raw.openSync.call(this, path, flags, ...args);
    fds.set(fd, { path: approved, write });
    return fd;
  };
  fs.open = function (path, flags, ...args) {
    const write = writing(flags);
    const approved = check(path, write ? "write" : "read");
    const callback = args.pop();
    return raw.open.call(this, path, flags, ...args, (error, fd) => {
      if (!error) fds.set(fd, { path: approved, write });
      callback(error, fd);
    });
  };
  for (const name of ["read", "readSync", "readv", "readvSync", "write", "writeSync", "writev", "writevSync", "ftruncate", "ftruncateSync", "fchmod", "fchmodSync", "fchown", "fchownSync", "futimes", "futimesSync"]) {
    fs[name] = function (fd, ...args) {
      const write = !name.startsWith("read");
      if (!(write && (fd === 1 || fd === 2))) check(fd, write ? "write" : "read");
      return raw[name].call(this, fd, ...args);
    };
  }
  for (const name of ["readFile", "readdir", "opendir", "readlink", "stat", "statfs", "lstat", "access", "realpath", "writeFile", "appendFile", "mkdir", "mkdtemp", "mkdtempDisposable", "rm", "rmdir", "unlink", "truncate", "chmod", "lchmod", "chown", "lchown", "utimes", "lutimes", "rename", "copyFile", "cp", "link", "symlink", "watch", "glob", "open"]) {
    const original = rawPromises[name];
    fsp[name] = function (path, ...args) {
      if (["link", "symlink", "watch", "glob"].includes(name)) return deny("filesystem", `promises.${name}`);
      let mode = "read";
      if (["stat", "statfs", "lstat", "access", "realpath"].includes(name)) mode = "metadata";
      if (["writeFile", "appendFile", "mkdir", "mkdtemp", "mkdtempDisposable", "rm", "rmdir", "unlink", "truncate", "chmod", "lchmod", "chown", "lchown", "utimes", "lutimes", "rename"].includes(name)) mode = "write";
      if (name === "open" && writing(args[0])) mode = "write";
      const approved = check(path, mode);
      if (["rename", "copyFile", "cp"].includes(name)) check(args[0], "write");
      const result = original.call(this, path, ...args);
      if (name === "open") return result.then((handle) => {
        fds.set(handle.fd, { path: approved, write: mode === "write" });
        return handle;
      });
      if (name === "mkdtempDisposable") return result.then((handle) => guardDisposable(handle, Symbol.asyncDispose));
      return result;
    };
  }
  // Bound this inventory to Node 24. Any new unwrapped callable export requires review before Pi loads.
  // Stream constructors use guarded open/mkdir; the remaining exceptions are data or fd-only helpers.
  assert.equal(process.versions.node.split(".")[0], "24", "review the fs inventory for a new Node major");
  for (const [name, original, guarded, passthrough] of [
    ["fs", raw, fs, ["Dir", "Dirent", "FileReadStream", "FileWriteStream", "ReadStream", "Stats", "Utf8Stream", "WriteStream", "_toUnixTimestamp", "close", "closeSync", "fdatasync", "fdatasyncSync", "fstat", "fstatSync", "fsync", "fsyncSync"]],
    ["fs/promises", rawPromises, fsp, []],
  ]) {
    assert.deepEqual(Object.keys(original).filter((key) => typeof original[key] === "function" && original[key] === guarded[key]).sort(),
      passthrough.sort(), `review unguarded Node 24 ${name} methods`);
  }
  for (const [object, names] of [
    [net, ["connect", "createConnection", "createServer"]],
    [net.Socket.prototype, ["connect"]], [net.Server.prototype, ["listen"]],
    [tls, ["connect", "createServer"]], [http, ["request", "get", "createServer"]],
    [https, ["request", "get", "createServer"]], [http2, ["connect", "createServer", "createSecureServer"]],
    [dgram, ["createSocket"]],
  ]) for (const name of names) object[name] = blocked("network", name);
  for (const object of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
    for (const name of Object.getOwnPropertyNames(object)) {
      if (/^(?:resolve|lookup|reverse)/.test(name)) object[name] = blocked("network", `dns.${name}`);
    }
  }
  for (const name of ["fetch", "WebSocket", "EventSource", "open"]) globalThis[name] = blocked("network/browser", name);
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    childProcess[name] = function (file, args, options) {
      if (name === "execFileSync" && file === "git" && JSON.stringify(args) === '["rev-parse","--show-toplevel"]' && options?.cwd === join(root, "cwd")) {
        // Blackhole's optional annotation probe is denied, not simulated or executed.
        audit.deniedGitProbe.push("git rev-parse --show-toplevel");
        throw new Error("Offline fixture: Git probe denied");
      }
      return deny("subprocess", name);
    };
  }
  childProcess.ChildProcess.prototype.spawn = blocked("subprocess", "ChildProcess.spawn");
  workerThreads.Worker = blocked("worker", "Worker");
  process.kill = blocked("process", "kill");
  process.chdir = blocked("process", "chdir");
  syncBuiltinESMExports();
  registerHooks({ load(url, context, nextLoad) {
    if (url.startsWith("file:")) check(new URL(url));
    else if (!url.startsWith("node:")) deny("module", "non-file module");
    return nextLoad(url, context);
  } });
  const fsExports = await import("node:fs");
  const promiseExports = await import("node:fs/promises");
  for (const name of ["openAsBlob", "lutimes", "lutimesSync", "statfs", "statfsSync", "mkdtempDisposableSync", "glob", "globSync"]) {
    assert.equal(fsExports[name], fs[name], `syncBuiltinESMExports: fs.${name}`);
  }
  for (const name of ["lutimes", "statfs", "mkdtempDisposable", "glob"]) {
    assert.equal(promiseExports[name], fsp[name], `syncBuiltinESMExports: promises.${name}`);
  }
  const callbackCall = (name, ...args) => new Promise((accept, reject) => {
    fs[name](...args, (error, value) => { if (error) reject(error); else accept(value); });
  });
  const disposableParent = join(root, "tmp/guard-disposables");
  fs.mkdirSync(disposableParent);
  const prefix = join(disposableParent, "owned-");
  const disposables = [
    [fs.mkdtempDisposableSync(prefix), "remove"],
    [fs.mkdtempDisposableSync(prefix), Symbol.dispose],
    [await fsp.mkdtempDisposable(prefix), "remove"],
    [await fsp.mkdtempDisposable(prefix), Symbol.asyncDispose],
  ];
  for (const [handle, method] of disposables) {
    assert.equal(typeof handle[method], "function");
    assert.ok(within(disposableParent, handle.path));
    fs.writeFileSync(join(handle.path, "owned.txt"), "disposable guard self-check");
  }
  const beforeSelfChecks = structuredClone(audit);
  let checks = 0;
  selfCheck = true;
  try {
    for (const operation of [
      () => fs.readFileSync("/pi-all-active-forbidden"),
      () => fs.writeFileSync(localEntries[0], "forbidden"),
      () => fsp.readFile("/pi-all-active-forbidden"),
      () => fs.watch(root), () => childProcess.spawn("forbidden"),
      () => net.connect(1), () => globalThis.fetch("https://invalid.invalid"),
    ]) { assert.throws(operation, /OFFLINE_GUARD/); checks++; }
    const canaryLink = join(canary, "symlink");
    for (const [name, operation] of [
      ["openAsBlob", async () => (await fs.openAsBlob(pathToFileURL(join(canary, "payload")))).text()],
      ["lutimesSync", () => fs.lutimesSync(canaryLink, 1, 1)],
      ["lutimes callback", () => callbackCall("lutimes", canaryLink, 1, 1)],
      ["promises.lutimes", () => fsp.lutimes(canaryLink, 1, 1)],
      ["statfsSync", () => fs.statfsSync(canary)],
      ["statfs callback", () => callbackCall("statfs", canary)],
      ["promises.statfs", () => fsp.statfs(canary)],
      ["mkdtempDisposableSync", () => fs.mkdtempDisposableSync(join(canary, "leaked-"))],
      ["promises.mkdtempDisposable", () => fsp.mkdtempDisposable(join(canary, "leaked-"))],
      ["symlink openAsBlob", async () => (await fs.openAsBlob(join(root, "canary-escape/payload"))).text()],
      ["symlink statfs", () => fsp.statfs(join(root, "canary-escape"))],
      ["symlink mkdtempDisposable", () => fsp.mkdtempDisposable(join(root, "canary-escape/leaked-"))],
    ]) {
      await assert.rejects(async () => operation(), /OFFLINE_GUARD/, name);
      checks++;
    }
    // Glob can escape through either cwd or its pattern. Deny even fixture-local globs.
    for (const [pattern, cwd] of [
      ["*", canary], [join(canary, "*"), root], [join(relative(root, canary), "*"), root], ["*", root],
    ]) {
      for (const operation of [
        () => fs.globSync(pattern, { cwd }),
        () => callbackCall("glob", pattern, { cwd }),
        () => Array.fromAsync(fsp.glob(pattern, { cwd })),
      ]) {
        await assert.rejects(async () => operation(), /OFFLINE_GUARD/);
        checks++;
      }
    }
    // Simulate a replaced parent using only owned paths; disposal must recheck its captured path.
    raw.renameSync(disposableParent, `${disposableParent}-saved`);
    try {
      raw.symlinkSync(canary, disposableParent);
      try {
        for (const [handle, method] of disposables) {
          await assert.rejects(async () => handle[method](), /OFFLINE_GUARD/, `disposal ${String(method)}`);
          checks++;
        }
      } finally { raw.unlinkSync(disposableParent); }
    } finally { raw.renameSync(`${disposableParent}-saved`, disposableParent); }
  } finally { selfCheck = false; }
  assert.deepEqual(audit, { ...beforeSelfChecks, selfChecks: beforeSelfChecks.selfChecks + checks },
    "denied attempts must change only selfChecks, not reads, writes, or forbidden");
  assert.deepEqual(audit.forbidden, []);
  for (const [handle, method] of disposables) {
    await handle[method]();
    assert.equal(fs.existsSync(handle.path), false, "approved disposable handles still remove their directories");
  }
  console.log(`PASS guard self-checks: ${checks} OFFLINE_GUARD denials; only selfChecks increments; sync/async disposal works`);
  return audit;
}

async function runFixture(root, canary) {
  assert.equal(fs.realpathSync(root), root);
  assert.ok(root.startsWith("/tmp/pi-0.87.1-all-active-"));
  assert.deepEqual({ ...process.env }, environment(root), "do not inherit credentials or original session pointers");
  assert.equal(process.cwd(), join(root, "cwd"));
  assert.equal(fs.realpathSync(canary), canary);
  assert.ok(canary.startsWith("/tmp/pi-0.87.1-all-active-canary-"));
  assert.equal(within(root, canary), false);
  const tracked = json(join(root, "tracked.json"));
  const audit = await installGuards(root, tracked, canary);
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  const cwd = join(root, "cwd");
  const isolatedConfig = [join(agentDir, "settings.json"), join(agentDir, "pi-blackhole/pi-blackhole-config.json"), join(cwd, ".pi/settings.json")];
  const before = snapshot(isolatedConfig);
  let runtime;
  const extensionErrors = [];
  const events = [];
  const publicEvents = [];
  const unexpected = [];
  const finishedMessages = [];
  const streamedText = [];
  try {
    const pi = await import(pathToFileURL(join(piRoot, json(join(piRoot, "package.json")).exports["."].import)));
    const ai = await import(pathToFileURL(join(aiRoot, json(join(aiRoot, "package.json")).exports["."].import)));
    assert.equal(pi.VERSION, "0.87.1");
    assert.equal(pi.getAgentDir(), agentDir);
    pi.initTheme("dark", false);
    const faux = ai.fauxProvider({
      provider: "all-active-offline-fixture", models: [{ id: "one-turn", contextWindow: 200000, maxTokens: 128 }], tokensPerSecond: 0,
    });
    const requests = [];
    faux.setResponses([(context) => {
      requests.push(structuredClone(context));
      assert.equal(requests.length, 1, "no retries, compaction, warming, or continuation inference");
      return ai.fauxAssistantMessage(reply);
    }]);
    const modelRuntime = await pi.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = pi.SettingsManager.create(cwd, agentDir);
    assert.equal(settingsManager.getCacheWarmingMode(), "off");
    assert.equal(json(isolatedConfig[1]).memory, false);
    const loader = new pi.DefaultResourceLoader({
      cwd, agentDir, settingsManager, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: "Return one offline fixture response. Do not call any tool.",
      extensionFactories: [(extension) => {
        for (const type of lifecycle) extension.on(type, (event) => {
          events.push(type);
          if (type === "session_shutdown") assert.equal(event.reason, "quit");
        });
        for (const type of ["session_before_compact", "session_compact", "session_compact_failed", "tool_call", "tool_result"]) {
          extension.on(type, () => { unexpected.push(type); throw new Error(`Unexpected fixture event: ${type}`); });
        }
      }],
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    // A missing native/optional binary is a hard failure. Never replace a package with a stub.
    assert.deepEqual(loaded.errors, [], "all 13 real extensions must load without errors");
    assert.equal(loaded.extensions.length, 14, "13 active extensions plus the passive observer");
    for (const path of localEntries) {
      const extension = loaded.extensions.find((item) => item.path === path);
      assert.ok(extension, `missing local extension: ${path}`);
      assert.equal(fs.realpathSync(extension.resolvedPath), fs.realpathSync(path));
      assert.deepEqual(extension.sourceInfo, { path, source: "local", scope: "user", origin: "top-level", baseDir: undefined });
    }
    for (const pkg of packages) {
      const path = join(pkg.root, pkg.entry);
      const extension = loaded.extensions.find((item) => item.path === path);
      assert.ok(extension, `missing package extension: ${pkg.name}`);
      assert.equal(fs.realpathSync(extension.resolvedPath), fs.realpathSync(path));
      assert.deepEqual(extension.sourceInfo, { path, source: pkg.root, scope: "user", origin: "package", baseDir: pkg.root });
    }
    assert.ok(loader.getSkills().skills.every((skill) => !within(packages[2].root, skill.filePath)), "Browser Harness skills: [] must apply");
    console.log("PASS discovery: 9 local + 4 pinned packages + observer; sourceInfo exact; load errors=0; browser skills=0");

    const manager = pi.SessionManager.create(cwd, sessionDir);
    assert.equal(manager.isPersisted(), true);
    const created = await pi.createAgentSession({
      cwd, agentDir, settingsManager, sessionManager: manager, modelRuntime, model: faux.getModel(),
      resourceLoader: loader, thinkingLevel: "off", tools: [],
    });
    const session = created.session;
    runtime = new pi.AgentSessionRuntime(session, { cwd, agentDir }, async () => { throw new Error("Session replacement is out of scope"); });
    assert.deepEqual(created.extensionsResult.errors, []);
    session.subscribe((event) => {
      if (lifecycle.includes(event.type)) publicEvents.push(event.type);
      if (/compaction|retry|tool_execution/.test(event.type)) unexpected.push(event.type);
      if (event.type === "message_end") finishedMessages.push(event.message);
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") streamedText.push(event.assistantMessageEvent.delta);
    });
    await session.bindExtensions({ mode: "print", onError: (error) => { extensionErrors.push(error); } });
    await session.prompt("Complete the isolated all-active lifecycle fixture without tools.");
    await session.waitForIdle();
    // Let deferred extension work run without introducing a second turn.
    await sleep(1200);
    assert.deepEqual(events, lifecycle.slice(0, -1));
    assert.deepEqual(publicEvents, ["agent_start", "agent_end", "agent_settled"]);
    assert.equal(session.isIdle, true);
    assert.equal(faux.state.callCount, 1);
    assert.equal(requests.length, 1);
    assert.deepEqual(finishedMessages.map((message) => message.role), ["system", "user", "assistant"]);
    assert.equal(streamedText.join(""), reply);
    assert.equal(session.getLastAssistantText(), reply);
    const sessionFile = manager.getSessionFile();
    assert.equal(dirname(sessionFile), sessionDir);
    const settledBytes = fs.readFileSync(sessionFile, "utf8");
    await runtime.dispose();
    runtime = undefined;
    await sleep(1200);
    assert.deepEqual(events, lifecycle);
    const raw = fs.readFileSync(sessionFile, "utf8");
    assert.ok(raw.startsWith(settledBytes), "shutdown may append extension state but must not rewrite the settled transcript");
    const entries = raw.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entries[0].type, "session");
    assert.equal(entries[0].cwd, cwd);
    assert.equal(entries.filter((entry) => entry.type === "message" && entry.message.role === "user").length, 1);
    const assistants = entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant");
    assert.equal(assistants.length, 1);
    assert.deepEqual(assistants[0].message.content, [{ type: "text", text: reply }]);
    assert.equal(assistants[0].message.stopReason, "stop");
    assert.equal(entries.filter((entry) => ["compaction", "context_edit", "usage", "custom_message"].includes(entry.type)).length, 0);
    assert.equal(fs.readdirSync(sessionDir).length, 1);
    assert.equal(faux.state.callCount, 1, "no post-settlement or shutdown inference");
    assert.deepEqual(unexpected, []);
    console.log(`PASS lifecycle: ${events.join(" -> ")}; fake requests=1; persisted user=1; persisted assistant=1; duplicate output=0; compaction=0`);
  } catch (error) {
    // Keep the primary load/lifecycle failure visible if a final guard assertion also fails.
    console.error(error);
    throw error;
  } finally {
    if (runtime) { await runtime.session.abort(); await runtime.dispose(); await sleep(1200); }
    assert.deepEqual(snapshot(isolatedConfig), before, "isolated settings/config must remain unchanged");
    assert.deepEqual(extensionErrors, [], "including shutdown handlers");
    const guardSummary = { ...audit, forbidden: audit.forbidden.slice(0, 12), forbiddenCount: audit.forbidden.length };
    console.log(`GUARDS ${JSON.stringify(guardSummary)}`);
    assert.ok(audit.deniedGitProbe.length <= 1, "only the known optional Git annotation probe may be denied");
    assert.ok(audit.deniedPlatformProbe <= 1, "the optional WSL probe stays denied, including on early failure");
    assert.equal(audit.forbidden.length, 0, "swallowed guard failures also fail the test; see GUARDS");
  }
}

if (process.argv[2] === "--fixture") {
  await runFixture(process.argv[3], process.argv[4]);
} else {
  test("Pi 0.87.1: all active extensions, one isolated persisted offline lifecycle", { timeout: 120000 }, (t) => {
    verifyPins();
    // Read the Git index only to bound source access. Never traverse runtime state or original sessions.
    const tracked = childProcess.execFileSync("git", ["ls-files", "-z", "--", "agent/extensions", "agent/skills/*/SKILL.md"], {
      cwd: repository, encoding: "utf8", timeout: 10000,
    }).split("\0").filter(Boolean).map((path) => join(repository, path));
    for (const path of localEntries) assert.ok(tracked.includes(path));
    const blackhole = join(repository, "agent/pi-blackhole");
    const protectedPaths = [
      ...packages.map((pkg) => pkg.root),
      ...["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"].map((name) => join(globalModules, "@earendil-works", name)),
      ...tracked.filter((path) => within(join(repository, "agent/extensions"), path)),
      join(repository, "agent/settings.json"), join(repository, "agent/browser-harness.json"),
      join(repository, "agent/npm/package.json"), join(repository, "agent/npm/package-lock.json"),
      join(npmRoot, ".package-lock.json"), join(blackhole, "pi-blackhole-config.json"),
      ...fs.readdirSync(blackhole).filter((name) => /\.(?:mjs|md)$/.test(name)).map((name) => join(blackhole, name)),
    ];
    const before = snapshot(protectedPaths);
    const root = fs.mkdtempSync("/tmp/pi-0.87.1-all-active-");
    const canary = fs.mkdtempSync("/tmp/pi-0.87.1-all-active-canary-");
    const canaryFile = join(canary, "payload");
    const canaryLink = join(canary, "symlink");
    const canaryBytes = "owned external guard canary\n";
    fs.writeFileSync(canaryFile, canaryBytes);
    fs.symlinkSync("payload", canaryLink);
    fs.symlinkSync(canary, join(root, "canary-escape"));
    const canaryPaths = [canary, canaryFile, canaryLink];
    const canaryBefore = canaryPaths.map((path) => fs.lstatSync(path, { bigint: true }));
    t.after(() => {
      try {
        assert.deepEqual(snapshot(protectedPaths), before, "live package-owned files, tracked extension source, settings/config, manifests, and accepted Blackhole files: bytes and mtimes");
        t.diagnostic(`protected records=${before.length}; SHA-256/mode/mtimeNs unchanged`);
        // Compare timestamps before verification reads can update atime themselves.
        assert.deepEqual(canaryPaths.map((path) => fs.lstatSync(path, { bigint: true })), canaryBefore,
          "external canary metadata, including atimeNs/mtimeNs/ctimeNs, must not change");
        assert.equal(fs.readFileSync(canaryFile, "utf8"), canaryBytes);
        assert.equal(fs.readlinkSync(canaryLink), "payload");
        assert.deepEqual(fs.readdirSync(canary).sort(), ["payload", "symlink"]);
        t.diagnostic("external canary bytes, symlink, timestamps, and directory entries unchanged");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(canary, { recursive: true, force: true });
        assert.equal(fs.existsSync(root), false);
        assert.equal(fs.existsSync(canary), false);
        t.diagnostic("isolated HOME, settings, session, cwd, config, cache, and external canary removed");
      }
    });
    prepare(root, tracked);
    const result = childProcess.spawnSync(process.execPath, [filename, "--fixture", root, canary], {
      cwd: join(root, "cwd"), env: environment(root), encoding: "utf8", timeout: 90000,
      maxBuffer: 2 * 1024 * 1024, killSignal: "SIGKILL",
    });
    if (result.stdout) t.diagnostic(result.stdout.trim());
    if (result.stderr) t.diagnostic(result.stderr.trim());
    assert.equal(result.error, undefined, "bounded fixture worker must exit normally");
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, "isolated all-active lifecycle failed; do not weaken guards or substitute package entrypoints");
    assert.match(result.stdout, /PASS guard self-checks:/);
    assert.match(result.stdout, /PASS discovery:/);
    assert.match(result.stdout, /PASS lifecycle:/);
    assert.match(result.stdout, /"forbidden":\[\]/);
  });
}
