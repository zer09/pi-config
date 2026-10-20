import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run with Node 24: node --test agent/tests/retired-extension-discovery.test.mjs
// Load real local extensions only. Never start a session, invoke a tool, or request inference.
const filename = fileURLToPath(import.meta.url);
const repository = resolve(dirname(filename), "../..");
const retiredEntries = ["codegraph/index.ts", "context-mode/src/index.ts"];
const activeEntries = [
  "delegated-pi-loop/index.ts", "fastlane/index.ts", "footer/index.ts", "github-ci/index.ts",
  "openai-codex-aliases/index.ts", "theme-overrides/index.ts", "web-search/index.ts",
];
const json = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

function installedPiRoot() {
  const marker = join("node_modules", "@earendil-works", "pi-coding-agent");
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    try {
      const path = fs.realpathSync(join(dir, "pi"));
      const index = path.lastIndexOf(marker);
      if (index >= 0) return path.slice(0, index + marker.length);
    } catch {
      // Keep searching when this PATH directory has no Pi executable.
    }
  }
  throw new Error("The installed Pi package must be available through PATH");
}

function environment(root) {
  return {
    PATH: join(root, "no-executables"), HOME: join(root, "home"), USERPROFILE: join(root, "home"),
    PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
    XDG_CACHE_HOME: join(root, "cache"), XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
    TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
    JITI_FS_CACHE: "false", JITI_CACHE_DIR: join(root, "cache/jiti"),
    NODE_DISABLE_COMPILE_CACHE: "1", TERM: "dumb",
  };
}

async function runFixture(root, piRoot) {
  assert.deepEqual({ ...process.env }, environment(root), "no inherited credentials or session pointers");
  const agentDir = join(root, "agent");
  const cwd = join(root, "cwd");
  assert.equal(process.cwd(), cwd);
  const attemptedImports = [];
  const originalRead = fs.readFileSync;
  fs.readFileSync = function (path, ...args) {
    const value = path instanceof URL ? fileURLToPath(path) : String(path);
    const entry = relative(join(agentDir, "extensions"), value).split(sep).join("/");
    // Discovery may read manifests, but it must not import any retired source.
    if (/^(?:codegraph|context-mode)\//.test(entry) && /\.[cm]?[jt]s$/.test(entry)) {
      attemptedImports.push(entry);
      throw new Error("Retired extension import attempted");
    }
    return originalRead.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const manifest = json(join(piRoot, "package.json"));
    const pi = await import(pathToFileURL(join(piRoot, manifest.exports["."].import)));
    assert.equal(pi.getAgentDir(), agentDir);
    const settingsManager = pi.SettingsManager.create(cwd, agentDir);
    const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noThemes: true });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, [], "all real active local extensions must load");
    assert.deepEqual(loaded.extensions.map((extension) => relative(join(agentDir, "extensions"), extension.path).split(sep).join("/")).sort(), [...activeEntries].sort());
    assert.deepEqual(attemptedImports, [], "disabled source must never reach the extension importer");
    const tools = loaded.extensions.flatMap((extension) => [...extension.tools.keys()]).sort();
    assert.deepEqual(tools, [
      "delegate_model_catalog", "delegate_run", "fetch_contents", "github_ci_wait", "web_code_search", "web_search",
    ]);
    assert.ok(tools.every((name) => !/^(?:codegraph_|ctx_)/.test(name)));
    assert.ok(loaded.runtime.pendingNativeProviderRegistrations.length > 0, "alias providers remain registered");
    const prompts = loader.getPrompts();
    assert.deepEqual(prompts.diagnostics, []);
    const expectedPrompts = fs.readdirSync(join(agentDir, "prompts"))
      .filter((name) => name.endsWith(".md") && name !== "codegraph-upgrade.md")
      .map((name) => name.slice(0, -3)).sort();
    assert.ok(expectedPrompts.length > 0, "unrelated prompts remain available");
    assert.deepEqual(prompts.prompts.map((prompt) => prompt.name).sort(), expectedPrompts);
    const globalContext = loader.getAgentsFiles().agentsFiles.find((file) => file.path === join(agentDir, "AGENTS.md"));
    assert.equal(globalContext?.content, fs.readFileSync(join(agentDir, "AGENTS.md"), "utf8"), "runtime context loading remains enabled");
    console.log(`PASS production discovery (Pi ${pi.VERSION}): 7 local extensions, 6 tools, retired imports=0, prompt excluded, context enabled`);
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
  }
}

if (process.argv[2] === "--fixture") {
  await runFixture(process.argv[3], process.argv[4]);
} else {
  test("settings exclude the retained extensions and upgrade prompt by exact agent-relative path", () => {
    const settings = json(join(repository, "agent/settings.json"));
    assert.deepEqual(settings.extensions, [
      "-builtin:mcp", "-builtin:llama.cpp", "-builtin:codemode", "-builtin:tool-search",
      ...retiredEntries.map((entry) => `-extensions/${entry}`),
    ]);
    assert.deepEqual(settings.prompts, ["-prompts/codegraph-upgrade.md"]);
    for (const entry of retiredEntries) assert.ok(fs.statSync(join(repository, "agent/extensions", entry)).isFile());
    assert.ok(fs.statSync(join(repository, "agent/prompts/codegraph-upgrade.md")).isFile());
  });

  test("production parent discovery filters retired resources before tool registration", { timeout: 60000 }, (t) => {
    const piRoot = installedPiRoot();
    const root = fs.mkdtempSync("/tmp/pi-retirement-discovery-");
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const dir of ["home", "cwd/.git", "agent", "sessions", "tmp", "cache", "config", "data", "state"]) {
      fs.mkdirSync(join(root, dir), { recursive: true });
    }
    // Copy tracked resources, not live state, dependencies, graph indexes, or caches.
    const tracked = childProcess.execFileSync("git", ["ls-files", "-z", "--", "agent/extensions", "agent/prompts", "agent/skills/*/SKILL.md", "agent/AGENTS.md"], {
      cwd: repository, encoding: "utf8", timeout: 10000,
    }).split("\0").filter(Boolean);
    for (const path of tracked) {
      assert.ok(path.startsWith("agent/") && !path.split("/").includes(".."));
      fs.mkdirSync(dirname(join(root, path)), { recursive: true });
      fs.copyFileSync(join(repository, path), join(root, path));
    }
    const settings = json(join(repository, "agent/settings.json"));
    // Package installs are outside this local discovery proof. Keep production resource filters unchanged.
    fs.writeFileSync(join(root, "agent/settings.json"), JSON.stringify({
      ...settings, packages: [], defaultProjectTrust: "never", enableInstallTelemetry: false, enableAnalytics: false,
    }));
    const result = childProcess.spawnSync(process.execPath, [filename, "--fixture", root, piRoot], {
      cwd: join(root, "cwd"), env: environment(root), encoding: "utf8", timeout: 45000,
      maxBuffer: 1024 * 1024, killSignal: "SIGKILL",
    });
    if (result.stdout) t.diagnostic(result.stdout.trim());
    if (result.stderr) t.diagnostic(result.stderr.trim());
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS production discovery/);
  });
}
