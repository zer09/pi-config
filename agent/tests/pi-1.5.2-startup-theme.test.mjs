import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Never discover a live SDK, compiler, account, or model configuration.
const modules = process.env.PI_TEST_NODE_MODULES, compiler = process.env.PI_TEST_COMPILER_NODE_MODULES;
for (const root of [modules, compiler]) {
  assert.ok(root && isAbsolute(root), "Explicit isolated SDK/compiler roots required");
  assert.equal(fs.realpathSync(root), root);
}
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
for (const name of ["pi-coding-agent", "pi-agent-core", "pi-ai", "pi-tui"]) {
  assert.equal(json(join(modules, "@earendil-works", name, "package.json")).version, "1.5.2");
}
assert.equal(json(join(compiler, "typescript/package.json")).version, "6.0.3");
const root = join(modules, "@earendil-works/pi-coding-agent");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const native = file => import(pathToFileURL(join(root, "dist", file)));
// Keep the SDK native. Only its catalog input excludes unused real providers.
let catalogBindings = 0;
const catalogHook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-ai/providers/all" && context.parentURL === pathToFileURL(join(root, "dist/core/model-runtime.js")).href) {
    catalogBindings++;
    return { url: "data:text/javascript," + encodeURIComponent("export const builtinProviders = () => []; export const getBuiltinModelDataGeneratedAt = () => undefined;"), shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const pi = await native("index.js");
const ai = await import(pathToFileURL(join(modules, "@earendil-works/pi-ai/dist/index.js")));
const tuiApi = await import(pathToFileURL(join(modules, "@earendil-works/pi-tui/dist/index.js")));
catalogHook.deregister();
const { InteractiveMode } = await native("modes/interactive/interactive-mode.js");
const themeApi = await native("modes/interactive/theme/theme.js");
const { validateThemeJson } = await native("modes/interactive/theme/theme-schema.js");
const { THEME_TOKENS } = await native("modes/interactive/theme/theme-tokens.js");
themeApi.setThemeJsonValidator(validateThemeJson);
const require = createRequire(join(root, "package.json"));
const strip = text => text.replace(/\x1b\[[0-9;]*m/g, "");
const custom = { customType: "startup-fixture", content: "synthetic context", display: false };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(t, before = () => {}) {
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-152-startup-")), cwd = join(dir, "cwd"), agentDir = join(dir, "agent");
  fs.mkdirSync(cwd); fs.mkdirSync(agentDir);
  const settingsPath = join(agentDir, "settings.json");
  const saved = { cacheWarming: "off", theme: "dark", tuiMode: "regular", lastChangelogVersion: "1.4.0", packages: [],
    enableAnalytics: false, enableInstallTelemetry: false, defaultProjectTrust: "never", retry: { enabled: false }, compaction: { enabled: false } };
  fs.writeFileSync(settingsPath, JSON.stringify(saved) + "\n");
  const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  const faux = ai.fauxProvider({ provider: "startup-offline", models: [{ id: "fixture", contextWindow: 200000, maxTokens: 128 }], tokensPerSecond: 0 });
  const modelRuntime = await pi.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const starts = [], errors = [], frames = [], held = [];
  const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noContextFiles: true, noThemes: true,
    additionalExtensionPaths: [join(repository, "agent/extensions/footer/index.ts"), join(repository, "agent/extensions/theme-overrides/index.ts")],
    extensionFactories: [extension => { extension.on("before_agent_start", async (event, ctx) => { starts.push(structuredClone(event)); await before(event, ctx); }); }],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const themeExtension = loader.getExtensions().extensions.find(extension => extension.path.endsWith("theme-overrides/index.ts"));
  assert.ok(themeExtension);
  assert.deepEqual([...themeExtension.commands.keys()], ["theme-sync"]);
  assert.equal(themeExtension.handlers.size, 0, "the real loader must not add startup hooks or polling");
  const { session } = await pi.createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager, modelRuntime,
    sessionManager: pi.SessionManager.inMemory(cwd), model: faux.getModel(), thinkingLevel: "off", tools: ["read"] });
  pi.initTheme("dark", false);
  let footer;
  const tui = new tuiApi.TuiMainScreen({});
  const line = () => strip(footer.render(400)[0]);
  tui.doRender = () => { if (footer) frames.push(line()); };
  assert.equal(tui.mode, "regular"); assert.equal(settingsManager.getTuiMode(), "regular");
  await session.bindExtensions({ mode: "tui", onError: error => errors.push(error), uiContext: {
    theme: themeApi.theme, getAllThemes: () => [{ name: "dark" }], getTheme: () => themeApi.theme,
    setFooter(factory) {
      footer?.dispose();
      footer = factory?.(tui, themeApi.theme, { getGitBranch: () => null, getExtensionStatuses: () => new Map(),
        getAvailableProviderCount: () => 1, onBranchChange: () => () => {} });
    },
  } });
  const runtime = new pi.AgentSessionRuntime(session,
    { cwd, agentDir, settingsManager, modelRuntime, resourceLoader: loader, diagnostics: [] },
    () => { throw new Error("Session replacement is outside this startup fixture"); });
  t.after(async () => {
    for (const gate of held) gate.resolve();
    await session.abort(); await runtime.dispose();
    tui.stopped = true; tui.cancelRenderTimer();
    assert.deepEqual(errors, []); assert.equal(footer, undefined, "shutdown removes the footer");
    const after = json(settingsPath);
    for (const [key, value] of Object.entries(saved)) assert.deepEqual(after[key], value, key);
    const hostAdded = Object.keys(after).filter(key => !Object.hasOwn(saved, key));
    assert.ok(hostAdded.every(key => key === "extensionChangelogVersions"));
    t.diagnostic(JSON.stringify({ hostAddedSettings: hostAdded, providerCalls: faux.state.callCount }));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function hold() {
    const entered = deferred(), release = deferred(); held.push(release);
    faux.appendResponses([async () => { entered.resolve(); await release.promise; return ai.fauxAssistantMessage("offline reply"); }]);
    return { entered, release };
  }
  return { session, faux, starts, frames, line, hold };
}
function timer(f) { return f.line().match(/[\uf017\uf00c] \S+/)?.[0] ?? null; }
function queue(f, count) {
  assert.equal(f.session.pendingMessageCount, count);
  assert.equal(f.line().includes("\uf46c queued"), count > 0);
}

test("native target bindings and strict production theme/ExecResult fixture contracts", async () => {
  assert.equal(pi.VERSION, "1.5.2"); assert.equal(catalogBindings, 1); assert.equal(ai.Type, undefined);
  assert.equal(pi.ModelRuntime, (await native("core/model-runtime.js")).ModelRuntime);
  const view = await native("core/extensions/pi-ai-extension-view.js");
  assert.equal(typeof view.Type.Object, "function");
  assert.equal(view.createAssistantMessageEventStream, ai.createAssistantMessageEventStream);
  const ts = require(join(compiler, "typescript"));
  const filename = join(tmpdir(), "pi-152-theme-contract.ts");
  const fixtureText = fs.readFileSync(join(repository, "agent/extensions/theme-overrides/index.test.ts"), "utf8");
  const helper = fixtureText.match(/function validLightResult\(\): ExecResult \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, "Compile the actual Bun fixture helper without inventing bun:test declarations");
  const text = 'import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";\n' + helper + '\nexport const exec: ExtensionAPI["exec"] = async () => validLightResult();';
  const options = { noEmit: true, allowImportingTsExtensions: true, strict: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ["node"], typeRoots: [join(compiler, "@types")], paths: {
      "@earendil-works/pi-coding-agent": [join(root, "dist/index.d.ts")],
      "@earendil-works/pi-ai": [join(modules, "@earendil-works/pi-ai/dist/index.d.ts")],
      "@earendil-works/pi-tui": [join(modules, "@earendil-works/pi-tui/dist/index.d.ts")],
    } };
  const production = ["index.ts", "apply-override.ts", "system-appearance.ts", "system-commands.ts", "theme-state.ts"].map(file => join(repository, "agent/extensions/theme-overrides", file));
  function check(source, files) {
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (file, language, ...args) => file === filename ? ts.createSourceFile(file, source, language) : original(file, language, ...args);
    const program = ts.createProgram(files, options, host);
    for (const path of [join(root, "dist/index.d.ts"), join(compiler, "@types/node/index.d.ts")]) assert.ok(program.getSourceFiles().some(file => file.fileName === path));
    return ts.getPreEmitDiagnostics(program).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
  }
  assert.deepEqual(check(text, [...production, filename]), []);
  const missing = check(text + '\nexport const missing: ExecResult = { stdout: "", stderr: "", code: 0, killed: false };', [filename]);
  assert.equal(missing.length, 1); assert.equal(missing[0].code, 2741); assert.match(missing[0].message, /truncated/);
});

test("synthetic Windows wrapper preserves quoted argv, explicit themes and management/mode bypasses", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-theme-wrapper-")), home = join(dir, "home");
  try {
    const fakePi = join(home, ".bun/bin/pi"), registry = join(dir, "reg.exe");
    fs.mkdirSync(dirname(fakePi), { recursive: true });
    fs.writeFileSync(fakePi, 'console.log(JSON.stringify({ args: process.argv.slice(2), injected: process.env.PI_THEME_WRAPPER_INJECTED }));\n');
    fs.writeFileSync(registry, '#!/usr/bin/env node\nprocess.stdout.write("AppsUseLightTheme REG_DWORD 0x1");\n', { mode: 0o755 });
    const args = ["--name", `literal "double" and 'single'`, "--theme", join(dir, "custom theme.json"), "--", "", "line 1\nline 2", "$(never execute)", "`never execute`"];
    const env = { ...process.env, HOME: home, PATH: `${dir}:${process.env.PATH}`, PI_THEME_WRAPPER_INJECTED: "stale-parent-value" };
    for (const explicit of [false, true]) {
      const original = explicit ? ["--use-theme", "custom", ...args] : args;
      const result = spawnSync("bash", [join(repository, "agent/bin/pi"), ...original], { encoding: "utf8", env });
      assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
      const actual = JSON.parse(result.stdout);
      assert.deepEqual(actual.args, explicit ? original : ["--use-theme", "light", ...original]);
      assert.equal(actual.injected, explicit ? undefined : "1");
    }
    // A working light probe makes these true bypass checks, not no-evidence passes.
    for (const original of [["auth", "login"], ["auth", "logout"], ["update"], ["install", "npm:fixture@1"],
      ["remove", "npm:fixture@1"], ["uninstall", "npm:fixture@1"], ["config"], ["list"],
      ["--print", "hello"], ["--mode", "json"], ["--mode=rpc"]]) {
      const result = spawnSync("bash", [join(repository, "agent/bin/pi"), ...original], { encoding: "utf8", env });
      assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
      const actual = JSON.parse(result.stdout); assert.deepEqual(actual.args, original); assert.equal(actual.injected, undefined);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ordinary and custom starts preserve native prompt sections and only user runs start the footer timer", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const customReply = f.hold();
  const customRun = f.session.sendCustomMessage(custom, { triggerTurn: true });
  await customReply.entered.promise;
  assert.equal(f.starts[0].messageType, "custom"); assert.equal(Object.hasOwn(f.starts[0], "prompt"), false);
  assert.equal(timer(f), null);
  customReply.release.resolve(); await customRun;
  const reply = f.hold(), run = f.session.prompt("ordinary user");
  await reply.entered.promise;
  assert.equal(f.starts[1].messageType, "user"); assert.equal(f.starts[1].prompt, "ordinary user");
  assert.match(timer(f), /^\uf017 /);
  reply.release.resolve(); await run;
  const completed = timer(f); assert.match(completed, /^\uf00c /);
  f.faux.appendResponses([ai.fauxAssistantMessage("custom reply")]);
  await f.session.sendCustomMessage(custom, { triggerTurn: true });
  assert.equal(timer(f), completed);
  for (const start of f.starts) {
    assert.deepEqual(start.systemPromptOptions.selectedTools, ["read"]);
    assert.deepEqual(start.systemPromptOptions, f.starts[0].systemPromptOptions);
    assert.equal(start.systemPrompt, f.starts[0].systemPrompt);
  }
  assert.equal(f.faux.state.callCount, 3);
});

test("held startup and queued delivery use one whole-run timer and the real host queue", { timeout: 30000 }, async t => {
  const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  const f = await fixture(t, async () => { entered.resolve(); await release.promise; });
  const first = f.hold(), next = f.hold();
  const originalNow = Date.now; let now = 100000; Date.now = () => now;
  try {
    const run = f.session.prompt("initial user"); await entered.promise;
    assert.equal(f.session.isIdle, false);
    now = 101000; await f.session.prompt("follow-up", { streamingBehavior: "followUp" }); queue(f, 1);
    await f.session.sendCustomMessage(custom, { triggerTurn: true });
    assert.equal(timer(f), "\uf017 1.0s"); queue(f, 1);
    await new Promise(done => setTimeout(done, 300));
    assert.ok(f.frames.some(line => line.includes("\uf46c queued") && line.includes("\uf017 1.0s")), "the regular TUI schedules a real footer frame during held startup");
    now = 102000; release.resolve(); await first.entered.promise;
    assert.equal(timer(f), "\uf017 2.0s"); queue(f, 1);
    now = 104000; first.release.resolve(); await next.entered.promise;
    queue(f, 0); assert.equal(timer(f), "\uf017 4.0s"); assert.equal(f.starts.length, 1);
    now = 105000; next.release.resolve(); await run; await f.session.waitForIdle();
    assert.equal(timer(f), "\uf00c 5.0s"); assert.equal(f.faux.state.callCount, 2);
  } finally { release.resolve(); first.release.resolve(); next.release.resolve(); Date.now = originalNow; }
});

for (const clear of [true, false]) test(`startup abort ${clear ? "after TUI dequeue clears" : "without dequeue retains"} pending work without carrying its timer`, { timeout: 30000 }, async t => {
  const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  let first = true;
  const f = await fixture(t, async () => { if (first) { first = false; entered.resolve(); await release.promise; } });
  const originalNow = Date.now; let now = 200000; Date.now = () => now;
  try {
    const run = f.session.prompt("abort during startup"); await entered.promise;
    now = 201000; await f.session.prompt("restored follow-up", { streamingBehavior: "followUp" }); queue(f, 1);
    if (clear) {
      const actions = new Map(); let restored = "";
      const mode = Object.create(InteractiveMode.prototype);
      Object.assign(mode, { runtimeHost: { session: f.session }, compactionQueuedMessages: [], pendingBashComponents: [], isInitialized: true,
        footer: { invalidate() {} }, pendingMessagesContainer: { clear() {}, addChild() {} }, programStatus: { handleEvent() {} },
        ui: { requestRender() {} }, showStatus() {}, getAppKeyDisplay: () => "dequeue",
        editor: { getText: () => restored, setText: text => { restored = text; }, onAction: (name, handler) => actions.set(name, handler) } });
      mode.defaultEditor = mode.editor; mode.setupKeyHandlers();
      actions.get("app.message.dequeue")(); assert.equal(restored, "restored follow-up"); queue(f, 0);
    }
    now = 202000; const abort = f.session.abort(); release.resolve(); await Promise.all([run, abort]);
    assert.equal(f.faux.state.callCount, 0); queue(f, clear ? 0 : 1); assert.equal(timer(f), "\uf00c 2.0s");
    f.session.clearQueue();
    const response = f.hold(); now = 210000; const later = f.session.prompt("later user"); await response.entered.promise;
    assert.equal(timer(f), "\uf017 0.0s"); queue(f, 0);
    response.release.resolve(); await later;
  } finally { release.resolve(); Date.now = originalNow; }
});

test("footer lifetime totals and latest-assistant cache hit remain distinct from native context usage", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const usage = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  f.session.sessionManager.appendMessage({ ...ai.fauxAssistantMessage("earlier"), usage: usage(300, 20, 100) });
  f.session.sessionManager.appendMessage({ ...ai.fauxAssistantMessage("latest"), usage: usage(100, 30, 100) });
  f.session.sessionManager.appendUsage("fixture", "startup-offline", "fixture", usage(600, 50, 0));
  const line = f.line();
  assert.ok(line.includes("(50%) (↑1k/R200 · ↓100)"), line);
  const current = f.session.getContextUsage(); assert.ok(current && current.tokens !== null);
  assert.notEqual(current.tokens, 1200, "current context is not lifetime input plus cached tokens");
  const tokens = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" }).format(current.tokens).replace("K", "k");
  assert.ok(line.includes(`(${tokens}/200k)`), line);
  assert.ok(!line.includes("(16%)"), "standalone usage must not replace the latest assistant cache hit");
});

test("native schema validation and initial/reload theme loading preserve both tracked palettes", async t => {
  const schema = json(join(root, "schemas/theme.schema.json"));
  assert.equal(schema.$id, "https://pi.dev/schemas/theme.schema.json");
  const { default: Ajv } = require("ajv/dist/2020.js");
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-152-themes-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(join(dir, "themes"));
  const palettes = { dark: "f149ebdbff483936c50c2d44dc89fed4096dfdf9cc27bd570bdac521a5a65d8f", light: "b931597a1b3d390dbeb44e0fedb96eeb7c37060e41d0e3682044ddd3c88a4faf" };
  for (const name of ["dark", "light"]) {
    const path = join(repository, "agent/themes", `${name}.json`), data = json(path);
    assert.equal(data.$schema, schema.$id); assert.ok(validate(data), JSON.stringify(validate.errors)); validateThemeJson(name, data);
    const invalid = { ...data, colors: { ...data.colors, unknownToken: "#123456" } };
    assert.equal(validate(invalid), false); assert.throws(() => validateThemeJson(name, invalid), /Invalid theme/);
    const invalidPath = join(dir, `${name}-invalid.json`); fs.writeFileSync(invalidPath, JSON.stringify(invalid));
    assert.throws(() => themeApi.loadThemeFromPath(invalidPath, "truecolor"), /Invalid theme/);
    delete data.$schema;
    assert.equal(createHash("sha256").update(JSON.stringify(data)).digest("hex"), palettes[name]);
    const theme = themeApi.loadThemeFromPath(path, "truecolor");
    for (const token of Object.keys(data.colors)) {
      const method = THEME_TOKENS[token].slot === "background" ? "bg" : "fg";
      assert.ok(theme[method](token, "probe").includes("probe"));
      const variable = data.vars[data.colors[token]];
      if (variable?.startsWith("#")) assert.equal(tuiApi.colorToHex(theme.colors[token]).toLowerCase(), variable.toLowerCase());
    }
    fs.copyFileSync(path, join(dir, "themes", `${name}.json`));
  }
  const loader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: pi.SettingsManager.inMemory({ cacheWarming: "off", defaultProjectTrust: "never" }),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true });
  for (let pass = 0; pass < 2; pass++) {
    await loader.reload(); assert.deepEqual(loader.getThemes().diagnostics, []);
    assert.deepEqual(loader.getThemes().themes.map(theme => theme.name).sort(), ["dark", "light"]);
    for (const theme of loader.getThemes().themes) {
      const path = join(dir, "themes", `${theme.name}.json`), data = json(path);
      assert.equal(theme.sourcePath, path);
      assert.equal(tuiApi.colorToHex(theme.colors.accent).toLowerCase(), data.vars[data.colors.accent].toLowerCase());
    }
    if (pass === 0) for (const name of ["dark", "light"]) {
      const path = join(dir, "themes", `${name}.json`), data = json(path); data.vars.accent = "#123456"; fs.writeFileSync(path, JSON.stringify(data));
    }
  }
});
