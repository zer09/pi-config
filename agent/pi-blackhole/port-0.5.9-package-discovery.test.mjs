import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.9.mjs";
import { reapplyNullableProviderHeadersPatch } from "./reapply-nullable-provider-headers-patch-0.5.9.mjs";
import { reapplyContextEditCompactionPatch } from "./reapply-context-edit-compaction-patch-0.5.9.mjs";

// Acquisition is separate. This test never installs or fetches dependencies.
// PI_BLACKHOLE_0_5_9_TARBALL=/tmp/.../pi-blackhole-0.5.9.tgz node --test <this-file>
// Only package discovery and a synthetic hook call run here, not a settled turn.
const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../..");
const installed = join(repository, "agent/npm/node_modules/pi-blackhole");
const piRoot = "/home/gc/.bun/install/global/node_modules/@earendil-works/pi-coding-agent";
const acceptedCandidateNames = [
  "reapply-compact-after-percent-patch-0.5.9.mjs",
  "reapply-compact-after-percent-patch-0.5.9.test.mjs",
  "reapply-nullable-provider-headers-patch-0.5.9.mjs",
  "reapply-nullable-provider-headers-patch-0.5.9.test.mjs",
  "reapply-context-edit-compaction-patch-0.5.9.mjs",
  "reapply-context-edit-compaction-patch-0.5.9.test.mjs",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function snapshot(root) {
  const files = {};
  function visit(path, rel) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) files[rel] = `link:${readlinkSync(path)}`;
    else if (stat.isDirectory()) {
      files[rel] = "directory";
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${rel}/${name}`);
    } else files[rel] = hash(readFileSync(path));
  }
  visit(root, "");
  return files;
}

function protectedSnapshot() {
  const paths = [
    installed, realpathSync(piRoot), join(repository, "agent/settings.json"),
    join(here, "pi-blackhole-config.json"),
    ...acceptedCandidateNames.map((name) => join(here, name)),
    ...readdirSync(here).filter((name) => /\.(mjs|md)$/.test(name) &&
      !acceptedCandidateNames.includes(name) && name !== "port-0.5.9-package-discovery.test.mjs")
      .map((name) => join(here, name)),
  ];
  return Object.fromEntries(paths.map((path) => [path, snapshot(path)]));
}

function unpackPinnedArchive(bytes, target) {
  assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, registryIntegrity,
    "tarball must match the pinned pi-blackhole@0.5.9 registry SRI before extraction");
  const tar = gunzipSync(bytes);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0", "only regular archive files are allowed");
    assert.equal(header[345], 0, "tar prefixes are not allowed");
    assert.ok(name.startsWith("package/"));
    const rel = name.slice("package/".length);
    assert.ok(rel && !rel.split("/").some((part) => part === ".." || part === ""));
    assert.ok(!files.has(rel));
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    files.set(rel, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(files.size, 132);
  for (const [rel, content] of files) {
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), content);
  }
  return files;
}

function isolatedEnv(sandbox) {
  // An allowlist, not a copy of process.env: no credentials, provider or session survives.
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(sandbox, "home"), TMPDIR: join(sandbox, "tmp"),
    XDG_CACHE_HOME: join(sandbox, "cache"), XDG_CONFIG_HOME: join(sandbox, "config"),
    XDG_DATA_HOME: join(sandbox, "data"), XDG_STATE_HOME: join(sandbox, "state"),
    PI_CODING_AGENT_DIR: join(sandbox, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(sandbox, "sessions"),
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
    JITI_FS_CACHE: "false", JITI_CACHE_DIR: join(sandbox, "cache/jiti"),
    NODE_DISABLE_COMPILE_CACHE: "1", BROWSER: "false",
  };
}

if (process.argv.includes("--discovery-fixture")) {
  await runDiscovery(...process.argv.slice(process.argv.indexOf("--discovery-fixture") + 1));
} else {
  test("Pi 0.87.1 discovers the pi-blackhole@0.5.9 candidate through a local package manifest", { timeout: 120_000 }, async (t) => {
    const protectedBefore = protectedSnapshot();
    assert.equal(readJson(join(installed, "package.json")).version, "0.5.8");
    assert.equal(readJson(join(piRoot, "package.json")).version, "0.87.1");
    const root = mkdtempSync(join(realpathSync(tmpdir()), "pi-blackhole-0.5.9-package-discovery-"));
    t.after(() => {
      try {
        assert.deepEqual(protectedSnapshot(), protectedBefore,
          "live 0.5.8, Pi runtime/declarations, settings/config, six accepted files and existing tests/docs must remain byte-identical");
        console.log("PASS protected files byte-identical: live 0.5.8, Pi 0.87.1, settings/config, six accepted helpers/tests and prior integration");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    assert.ok(!isWithin(repository, root));
    assert.ok(process.env.PI_BLACKHOLE_0_5_9_TARBALL,
      "set PI_BLACKHOLE_0_5_9_TARBALL to the separately acquired pinned archive");
    const tarball = realpathSync(process.env.PI_BLACKHOLE_0_5_9_TARBALL);
    assert.ok([realpathSync("/tmp"), realpathSync(tmpdir())].some((dir) => isWithin(dir, tarball)));
    assert.ok(lstatSync(tarball).isFile());
    const candidateRoot = join(root, "candidate");
    const files = unpackPinnedArchive(readFileSync(tarball), candidateRoot);
    const stockManifest = readJson(join(candidateRoot, "package.json"));
    assert.equal(stockManifest.name, "pi-blackhole");
    assert.equal(stockManifest.version, "0.5.9");
    assert.deepEqual(stockManifest.pi.extensions, ["./dist/index.js"]);
    for (const apply of [reapplyCompactAfterPercentPatch, reapplyNullableProviderHeadersPatch, reapplyContextEditCompactionPatch]) {
      assert.match(apply(candidateRoot), /^patched:/);
    }
    assert.deepEqual(readJson(join(candidateRoot, "package.json")).pi.extensions, ["./index.ts"]);
    assert.equal(hash(readFileSync(join(candidateRoot, "dist/index.js"))), hash(files.get("dist/index.js")),
      "the candidate must leave the stock bundle untouched");
    const candidateBefore = snapshot(candidateRoot);

    // Change only a disposable copy's manifest. Both copies retain the patched source.
    const controlRoot = join(root, "stock-manifest-control");
    cpSync(candidateRoot, controlRoot, { recursive: true });
    writeFileSync(join(controlRoot, "package.json"), files.get("package.json"));
    const controlBefore = snapshot(controlRoot);
    assert.deepEqual(Object.keys(candidateBefore).filter((key) => candidateBefore[key] !== controlBefore[key]), ["/package.json"]);

    for (const [mode, packageRoot] of [["candidate", candidateRoot], ["stock-manifest", controlRoot]]) {
      await t.test(mode, () => {
        const sandbox = join(root, `${mode}-runtime`);
        const env = isolatedEnv(sandbox);
        for (const path of ["home", "tmp", "cache", "config", "data", "state", "agent/pi-blackhole", "cwd/.pi", "sessions"]) {
          mkdirSync(join(sandbox, path), { recursive: true });
        }
        // This directory entry is the sole extension source. There is no CLI/source-path override.
        writeFileSync(join(env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({
          packages: [packageRoot], cacheWarming: "off", sessionDir: env.PI_CODING_AGENT_SESSION_DIR,
          defaultProjectTrust: "never", enableInstallTelemetry: false, enableAnalytics: false,
        }));
        writeFileSync(join(sandbox, "cwd/.pi/settings.json"), "{}");
        writeFileSync(join(env.PI_CODING_AGENT_DIR, "pi-blackhole/pi-blackhole-config.json"), JSON.stringify({
          compaction: "manual", compactionEngine: "blackhole", tailBehavior: "minimal",
          memory: false, fullFoldAlways: true, retainedToolOutputMaxTokens: 0,
          debug: false, debugLog: false, statusBar: false,
        }));
        const output = execFileSync(process.execPath,
          [fileURLToPath(import.meta.url), "--discovery-fixture", packageRoot, sandbox, mode],
          { cwd: join(sandbox, "cwd"), env, encoding: "utf8", timeout: 50_000 });
        console.log(output.trim());
        assert.match(output, /PASS package discovery and synthetic hook/);
        assert.deepEqual(snapshot(candidateRoot), candidateBefore, "loader must not write into the accepted candidate");
        assert.deepEqual(snapshot(controlRoot), controlBefore, "loader must not write into the control package");
        assert.deepEqual(readdirSync(env.PI_CODING_AGENT_SESSION_DIR), [], "no session files are used or created");
        assert.ok(!existsSync(join(packageRoot, "node_modules")), "local discovery must not install dependencies");
        assert.ok(!existsSync(join(env.PI_CODING_AGENT_DIR, "npm")), "no package installation is allowed");
      });
    }
  });
}

async function runDiscovery(packageRoot, sandbox, mode) {
  assert.ok(["candidate", "stock-manifest"].includes(mode));
  assert.deepEqual({ ...process.env }, isolatedEnv(sandbox), "fixture must not inherit any ambient environment");
  assert.equal(process.cwd(), join(sandbox, "cwd"));
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const settingsPath = join(agentDir, "settings.json");
  const settingsBefore = readFileSync(settingsPath, "utf8");
  const configPath = join(agentDir, "pi-blackhole/pi-blackhole-config.json");
  const configBefore = readFileSync(configPath, "utf8");
  assert.deepEqual(readJson(settingsPath).packages, [packageRoot]);
  assert.equal(readJson(settingsPath).cacheWarming, "off");
  assert.ok(!existsSync(join(agentDir, "auth.json")));
  assert.ok(!existsSync(join(agentDir, "models.json")));

  // Install guards before importing Pi or any candidate runtime module.
  const require = createRequire(join(piRoot, "package.json"));
  const calls = { network: 0, browser: 0, subprocess: 0, inference: 0, sessionFile: 0, gitProbe: 0 };
  const blocked = (kind) => () => {
    calls[kind]++;
    throw new Error(`${kind} is forbidden in the discovery fixture`);
  };
  const noNetwork = blocked("network");
  const net = require("node:net");
  net.Socket.prototype.connect = noNetwork;
  net.connect = net.createConnection = noNetwork;
  require("node:tls").connect = noNetwork;
  require("node:dgram").createSocket = noNetwork;
  require("node:http2").connect = noNetwork;
  for (const protocol of ["node:http", "node:https"]) {
    require(protocol).request = require(protocol).get = noNetwork;
  }
  for (const name of ["lookup", "resolve", "resolve4", "resolve6", "reverse"]) {
    require("node:dns")[name] = noNetwork;
    require("node:dns").promises[name] = noNetwork;
  }
  globalThis.fetch = globalThis.WebSocket = globalThis.EventSource = noNetwork;
  globalThis.open = blocked("browser");
  const childProcess = require("node:child_process");
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "fork"]) {
    childProcess[name] = blocked("subprocess");
  }
  childProcess.ChildProcess.prototype.spawn = blocked("subprocess");
  childProcess.execFileSync = (file, args) => {
    // The compiler probes Git even without a repository. Deny that probe without launching Git.
    if (file === "git" && JSON.stringify(args) === '["rev-parse","--show-toplevel"]') {
      calls.gitProbe++;
      throw new Error("Discovery fixture has no Git repository");
    }
    return blocked("subprocess")();
  };
  syncBuiltinESMExports();

  try {
    const manifest = readJson(join(piRoot, "package.json"));
    const pi = await import(pathToFileURL(join(piRoot, manifest.exports["."].import)).href);
    assert.equal(pi.VERSION, "0.87.1");
    assert.equal(pi.getAgentDir(), agentDir);
    const settingsManager = pi.SettingsManager.create(process.cwd(), agentDir);
    const loader = new pi.DefaultResourceLoader({
      cwd: process.cwd(), agentDir, settingsManager,
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1, "exactly the configured package must load");
    const extension = loaded.extensions[0];
    const entrypoint = mode === "candidate" ? "index.ts" : "dist/index.js";
    const entryPath = join(packageRoot, entrypoint);
    assert.deepEqual(readJson(join(packageRoot, "package.json")).pi.extensions, [`./${entrypoint}`]);
    assert.equal(extension.path, entryPath);
    assert.equal(realpathSync(extension.resolvedPath), realpathSync(entryPath));
    assert.deepEqual(extension.sourceInfo, {
      path: entryPath, source: packageRoot, scope: "user", origin: "package", baseDir: packageRoot,
    }, "the loader must attribute the resolved manifest entry to the settings package, not a CLI extension");
    const expectedHooks = [
      "session_start", "session_before_compact", "session_compact", "session_compact_failed",
      "context", "agent_start", "turn_end", "agent_end", "session_shutdown",
    ];
    for (const event of expectedHooks) assert.ok(extension.handlers.get(event)?.length > 0, `missing real hook: ${event}`);
    assert.equal(extension.handlers.get("session_before_compact").length, 1);
    assert.ok(extension.commands.size > 0);
    assert.ok(extension.tools.size > 0);
    console.log(`PASS ${mode}: settings packages=[local directory] -> ${entrypoint}; errors=0; origin=package; expected hooks=${expectedHooks.length}`);

    const timestamp = "2026-01-01T00:00:00.000Z";
    const message = (id, content) => ({ type: "message", id, timestamp, message: { role: "user", content, timestamp: 1 } });
    const edit = (id, targetId, content) => ({
      type: "context_edit", id, targetId, timestamp, replacement: content === null ? null : { content },
    });
    const branch = [
      message("u0", "Implement ORIGINAL_GOAL carefully."),
      message("u1", "Remove OMITTED_GOAL and verify tests."),
      message("u2", "Keep UNCHANGED_GOAL in the summary."),
      message("tail", "Keep this tail."),
      edit("replacement", "u0", "Implement PROJECTED_GOAL carefully."),
      edit("omission", "u1", null),
      edit("tail-edit", "tail", "EDITED_TAIL_NOT_SUMMARIZED"),
    ].map((entry, i, entries) => ({ parentId: entries[i - 1]?.id ?? null, ...entry }));
    const rawBefore = JSON.stringify(branch);
    const projection = pi.buildSessionProjection(branch);
    const projectedById = new Map(projection.entries.map(({ sourceEntry, messages }) => [sourceEntry.id, messages]));
    assert.equal(projectedById.get("u0")[0].content, "Implement PROJECTED_GOAL carefully.");
    assert.deepEqual(projectedById.get("u1"), []);
    // Materialize Pi's public projection for an independent no-edit hook input.
    const materialized = branch.filter((entry) => entry.type === "message")
      .flatMap((entry) => projectedById.get(entry.id).map((message) => ({ ...entry, message })))
      .map((entry, i, entries) => ({ ...entry, parentId: entries[i - 1]?.id ?? null }));
    const ctx = {
      cwd: process.cwd(), hasUI: false, ui: { notify() {} },
      modelRegistry: new Proxy({}, { get: () => blocked("inference") }),
      sessionManager: { getEntries: () => branch, getSessionFile: blocked("sessionFile") },
    };
    const event = {
      type: "session_before_compact", branchEntries: branch, customInstructions: "__pi_vcc__",
      preparation: {
        firstKeptEntryId: "tail", tokensBefore: 100,
        fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      },
    };
    // Invoke the callback registered by package discovery, never a separately imported helper.
    const hook = extension.handlers.get("session_before_compact")[0];
    const result = await hook(event, ctx);
    const expected = await hook({ ...event, branchEntries: materialized }, ctx);
    assert.ok(result?.compaction);
    assert.ok(expected?.compaction);
    assert.equal(result.compaction.firstKeptEntryId, "tail");
    assert.equal(result.compaction.tokensBefore, 100);
    assert.match(expected.compaction.summary, /PROJECTED_GOAL/);
    assert.doesNotMatch(expected.compaction.summary, /ORIGINAL_GOAL|OMITTED_GOAL|EDITED_TAIL_NOT_SUMMARIZED/);
    if (mode === "candidate") {
      assert.equal(result.compaction.summary, expected.compaction.summary,
        "discovered source hook must summarize Pi-projected content");
      assert.match(result.compaction.summary, /UNCHANGED_GOAL/);
      assert.match(result.compaction.summary, /#0\b/);
      assert.match(result.compaction.summary, /#2\b/);
      assert.doesNotMatch(result.compaction.summary, /#1\b/);
    } else {
      assert.notEqual(result.compaction.summary, expected.compaction.summary,
        "the stock manifest must bypass the patched source even though index.ts is present");
      assert.match(result.compaction.summary, /ORIGINAL_GOAL|OMITTED_GOAL/);
      assert.doesNotMatch(result.compaction.summary, /PROJECTED_GOAL/);
    }
    assert.equal(JSON.stringify(branch), rawBefore, "the hook must not mutate raw synthetic history");
    assert.equal(readFileSync(settingsPath, "utf8"), settingsBefore);
    assert.equal(readFileSync(configPath, "utf8"), configBefore);
    console.log(`PASS package discovery and synthetic hook: ${mode}; projection=${mode === "candidate" ? "honored" : "bypassed (negative control)"}; raw history unchanged`);
  } finally {
    assert.deepEqual({ ...calls, gitProbe: 0 }, {
      network: 0, browser: 0, subprocess: 0, inference: 0, sessionFile: 0, gitProbe: 0,
    }, "no external activity is allowed, including swallowed failures");
    console.log(`PASS guards: zero network/browser/inference/session reads or launched subprocesses; denied Git probes=${calls.gitProbe}`);
  }
}
