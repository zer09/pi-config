import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Supply an isolated, network-denied host. Never discover or fall back to a live installation.
const root = process.env.PI_TEST_TARGET_ROOT;
assert.ok(root && isAbsolute(root), "PI_TEST_TARGET_ROOT must select an isolated Pi 1.4.0 package");
assert.equal(fs.realpathSync(root), root);
const json = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
assert.equal(json(join(root, "package.json")).name, "@earendil-works/pi-coding-agent");
assert.equal(json(join(root, "package.json")).version, "1.4.0");
const modules = resolve(root, "../..");
for (const name of ["pi-ai", "pi-agent-core", "pi-tui"]) {
  assert.equal(json(join(modules, "@earendil-works", name, "package.json")).version, "1.4.0");
}
const pi = await import(pathToFileURL(join(root, "dist/index.js")));
assert.equal(pi.VERSION, "1.4.0");
const ai = await import(pathToFileURL(join(modules, "@earendil-works/pi-ai/dist/index.js")));
const { colorToHex } = await import(pathToFileURL(join(modules, "@earendil-works/pi-tui/dist/index.js")));
const { TuiBase } = await import(pathToFileURL(join(modules, "@earendil-works/pi-tui/dist/tui.js")));
const { InteractiveMode } = await import(pathToFileURL(join(root, "dist/modes/interactive/interactive-mode.js")));
const themeApi = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme.js")));
const { THEME_TOKENS } = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme-tokens.js")));
const require = createRequire(join(root, "package.json"));
const { default: Ajv } = require("ajv/dist/2020.js");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const custom = { customType: "startup-fixture", content: "custom context", display: false };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t, onBefore = () => {}, onInput = () => {}) {
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-140-startup-"));
  const cwd = join(dir, "cwd"), agentDir = join(dir, "agent");
  fs.mkdirSync(cwd);
  fs.mkdirSync(agentDir);
  const settingsManager = pi.SettingsManager.inMemory({
    cacheWarming: "off", enableInstallTelemetry: false, enableAnalytics: false,
    defaultProjectTrust: "never", retry: { enabled: false }, compaction: { enabled: false },
  });
  const faux = ai.fauxProvider({ provider: "startup-offline", models: [{ id: "fixture", contextWindow: 200000, maxTokens: 128 }], tokensPerSecond: 0 });
  const modelRuntime = await pi.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const starts = [], errors = [];
  const loader = new pi.DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noContextFiles: true, noThemes: true,
    additionalExtensionPaths: [join(repository, "agent/extensions/footer/index.ts")],
    extensionFactories: [(extension) => {
      extension.on("input", onInput);
      extension.on("before_agent_start", async (event, ctx) => {
        starts.push(structuredClone(event));
        await onBefore(event, ctx);
      });
    }],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await pi.createAgentSession({
    cwd, agentDir, resourceLoader: loader, settingsManager, modelRuntime,
    sessionManager: pi.SessionManager.inMemory(), model: faux.getModel(), thinkingLevel: "off", tools: ["read"],
  });
  pi.initTheme("dark", false);
  let footer, renderCount = 0, phase = "setup";
  const frames = [];
  const tui = new TuiBase({});
  tui.doRender = () => { if (footer) frames.push({ phase, ...snapshot() }); };
  const theme = themeApi.theme;
  await session.bindExtensions({ mode: "tui", onError: (error) => errors.push(error), uiContext: {
    theme,
    getAllThemes: () => [{ name: "dark" }], getTheme: () => theme,
    setFooter(factory) {
      footer?.dispose();
      footer = factory?.(tui, theme, {
        getGitBranch: () => null, getExtensionStatuses: () => new Map(),
        getAvailableProviderCount: () => 1, onBranchChange: () => () => {},
      });
    },
  } });
  const runtime = new pi.AgentSessionRuntime(session, { cwd, agentDir });
  t.after(async () => {
    await session.abort();
    await runtime.dispose();
    tui.stopped = true;
    tui.cancelRenderTimer();
    assert.deepEqual(errors, [], "target lifecycle handlers must not report extension errors");
    assert.equal(footer, undefined, "shutdown must remove the footer");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const line = () => strip(footer.render(240)[0]);
  const snapshot = () => {
    renderCount += 1;
    const rendered = line();
    return {
      at: Date.now(), beforeStarts: starts.length, actualQueue: session.pendingMessageCount,
      // The approved display reports host pending state, not an inferred count.
      footerQueue: rendered.includes("\uf46c queued"),
      queueSegment: rendered.match(/\uf46c \S+/)?.[0] ?? null,
      timer: rendered.match(/[\uf017\uf00c] \S+/)?.[0] ?? null,
    };
  };
  const userStarts = [], settlements = [];
  session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "user") userStarts.push(snapshot());
    if (event.type === "agent_settled") settlements.push({ aborted: event.aborted, ...snapshot() });
  });
  function registerActions() {
    const actions = new Map();
    let editorText = "";
    const mode = Object.create(InteractiveMode.prototype);
    Object.assign(mode, {
      runtimeHost: { session }, compactionQueuedMessages: [], isInitialized: true,
      footer: { invalidate() {} }, pendingMessagesContainer: { clear() {}, addChild() {} },
      programStatus: { handleEvent() {} }, ui: tui, showStatus() {}, getAppKeyDisplay: () => "dequeue",
      editor: { getText: () => editorText, setText: text => { editorText = text; },
        onAction: (name, handler) => actions.set(name, handler) },
    });
    mode.defaultEditor = mode.editor;
    mode.setupKeyHandlers();
    assert.equal(typeof actions.get("app.message.dequeue"), "function");
    assert.equal(typeof actions.get("app.message.followUp"), "function");
    session.subscribe(event => {
      if (event.type === "queue_update") void mode.handleEvent(event).catch(error => errors.push(error));
    });
    return {
      get editorText() { return editorText; },
      submit(text) {
        if (text !== undefined) editorText = text;
        return actions.get("app.message.followUp")();
      },
      dequeue() { actions.get("app.message.dequeue")(); },
    };
  }
  return { session, faux, starts, userStarts, settlements, line, snapshot, registerActions, frames,
    get renderCount() { return renderCount; }, phase(value) { phase = value; } };
}

function holdResponse(faux) {
  const entered = deferred(), release = deferred();
  faux.appendResponses([async () => {
    entered.resolve();
    await release.promise;
    return ai.fauxAssistantMessage("offline reply");
  }]);
  return { entered, release };
}

test("target custom and ordinary starts preserve prompt/tool sections and user timer meaning", { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const first = holdResponse(f.faux);
  const customRun = f.session.sendCustomMessage(custom, { triggerTurn: true });
  await first.entered.promise;
  assert.equal(f.starts[0].messageType, "custom");
  assert.equal(Object.hasOwn(f.starts[0], "prompt"), false);
  assert.ok(!f.line().includes("\uf017"), "a target custom-only start has no user timer");
  first.release.resolve();
  await customRun;
  assert.ok(!f.line().includes("\uf00c"));

  const second = holdResponse(f.faux);
  const userRun = f.session.prompt("ordinary user");
  await second.entered.promise;
  assert.equal(f.starts[1].messageType, "user");
  assert.equal(f.starts[1].prompt, "ordinary user");
  assert.ok(f.line().includes("\uf017"));
  second.release.resolve();
  await userRun;
  assert.ok(f.line().includes("\uf00c"));
  const completed = f.line().match(/\uf00c \S+/)[0];

  f.faux.appendResponses([ai.fauxAssistantMessage("custom reply")]);
  await f.session.sendCustomMessage(custom, { triggerTurn: true });
  assert.ok(f.line().includes(completed), "custom starts preserve the completed user timer");
  for (const start of f.starts) {
    assert.deepEqual(start.systemPromptOptions, f.starts[0].systemPromptOptions);
    assert.equal(start.systemPrompt, f.starts[0].systemPrompt);
    assert.deepEqual(start.systemPromptOptions.selectedTools, ["read"]);
  }
  assert.equal(f.faux.state.callCount, 3);
});

test("target queued work during a custom-only run does not create a user timer", { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const first = holdResponse(f.faux), queued = holdResponse(f.faux);
  try {
    const run = f.session.sendCustomMessage(custom, { triggerTurn: true });
    await first.entered.promise;
    await f.session.prompt("user queued during custom work", { streamingBehavior: "followUp" });
    assert.equal(f.snapshot().actualQueue, 1);
    assert.equal(f.snapshot().footerQueue, true);
    assert.equal(f.snapshot().timer, null);
    first.release.resolve();
    await queued.entered.promise;
    assert.equal(f.snapshot().actualQueue, 0);
    assert.equal(f.snapshot().footerQueue, false);
    assert.equal(f.snapshot().timer, null, "queued delivery must not fabricate an initial user start");
    queued.release.resolve();
    await run;
    await f.session.waitForIdle();
    assert.equal(f.snapshot().timer, null);
    assert.deepEqual(f.starts.map((start) => start.messageType), ["custom"]);
    assert.equal(f.faux.state.callCount, 2);
  } finally {
    first.release.resolve(); queued.release.resolve();
  }
});

test("target held startup keeps the host queue indicator and one whole-run timer", { timeout: 30000 }, async (t) => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, async () => {
    if (f.starts.length === 1) { entered.resolve(); await release.promise; }
  });
  const first = holdResponse(f.faux), queued = holdResponse(f.faux), next = holdResponse(f.faux);
  const originalNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  try {
    const run = f.session.prompt("initial user");
    await entered.promise;
    assert.equal(f.session.isIdle, false);
    now = 101000;
    await f.session.prompt("queued user", { streamingBehavior: "followUp" });
    const duringStartup = f.snapshot();
    assert.equal(duringStartup.actualQueue, 1);
    assert.equal(duringStartup.footerQueue, true);
    await f.session.sendCustomMessage(custom, { triggerTurn: true });
    assert.deepEqual(f.snapshot(), duringStartup, "busy custom work must preserve user timing and queue state");
    now = 102000;
    release.resolve();
    await first.entered.promise;
    const heldInitial = f.snapshot();
    assert.equal(heldInitial.actualQueue, 1);
    assert.equal(heldInitial.footerQueue, true, "initial delivery leaves pending work indicated");
    assert.equal(heldInitial.timer, "\uf017 2.0s");
    now = 104000;
    first.release.resolve();
    await queued.entered.promise;
    const heldQueued = f.snapshot();
    assert.equal(f.starts.length, 1, "Pi emits no second before_agent_start for queued work");
    assert.equal(f.userStarts.length, 2);
    assert.equal(heldQueued.actualQueue, 0);
    assert.equal(heldQueued.footerQueue, false);
    assert.equal(heldQueued.timer, "\uf017 4.0s");
    now = 105000;
    queued.release.resolve();
    await run;
    await f.session.waitForIdle();
    assert.equal(f.snapshot().timer, "\uf00c 5.0s");
    now = 110000;
    const nextRun = f.session.prompt("later user", { source: "rpc" });
    await next.entered.promise;
    const heldNext = f.snapshot();
    assert.equal(heldNext.timer, "\uf017 0.0s", "a later run must start a fresh timer");
    next.release.resolve();
    await nextRun;
    assert.equal(f.faux.state.callCount, 3);
    console.log(JSON.stringify({ scenario: "held-startup-follow-up", duringStartup, heldInitial, heldQueued, heldNext }));
  } finally {
    release.resolve(); first.release.resolve(); queued.release.resolve(); next.release.resolve();
    Date.now = originalNow;
  }
});

test("target TUI queue-clear then abort removes cancelled timing without erasing the completed duration", { timeout: 30000 }, async (t) => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, async () => {
    if (f.starts.length === 1) { entered.resolve(); await release.promise; }
  });
  const originalNow = Date.now;
  let now = 200000;
  Date.now = () => now;
  const responses = [];
  try {
    const run = f.session.prompt("initial user");
    await entered.promise;
    now = 201000;
    await f.session.prompt("cancelled first follow-up", { streamingBehavior: "followUp" });
    now = 201500;
    await f.session.prompt("cancelled second follow-up", { streamingBehavior: "followUp" });
    await f.session.prompt("cancelled steering", { streamingBehavior: "steer" });
    assert.equal(f.snapshot().actualQueue, 3);
    assert.equal(f.snapshot().footerQueue, true);
    // InteractiveMode restores queued input to the editor before it aborts the run.
    const cleared = f.session.clearQueue();
    assert.equal(cleared.followUp.length, 2);
    assert.equal(cleared.steering.length, 1);
    now = 202000;
    const abort = f.session.abort();
    release.resolve();
    await Promise.all([run, abort]);
    const settled = f.snapshot();
    assert.equal(f.settlements[0].aborted, true);
    assert.equal(f.faux.state.callCount, 0);
    assert.equal(settled.actualQueue, 0);
    assert.equal(settled.footerQueue, false);
    assert.equal(settled.timer, "\uf00c 2.0s");
    now = 205000;
    f.faux.appendResponses([ai.fauxAssistantMessage("custom reply")]);
    await f.session.sendCustomMessage(custom, { triggerTurn: true });
    assert.equal(f.snapshot().timer, "\uf00c 2.0s", "custom settlement must preserve the last user duration");
    const later = [];
    for (const at of [210000, 220000]) {
      now = at;
      const response = holdResponse(f.faux);
      responses.push(response);
      const nextRun = f.session.prompt("later user", { source: "rpc" });
      await response.entered.promise;
      later.push(f.snapshot());
      assert.equal(f.snapshot().timer, "\uf017 0.0s");
      assert.equal(f.snapshot().actualQueue, 0);
      assert.equal(f.snapshot().footerQueue, false);
      response.release.resolve();
      await nextRun;
    }
    console.log(JSON.stringify({ scenario: "tui-clear-abort", settled, later }));
  } finally {
    release.resolve();
    for (const response of responses) response.release.resolve();
    Date.now = originalNow;
  }
});

test("target bare SDK abort retains queued work without carrying timing into a fresh run", { timeout: 30000 }, async (t) => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, async () => {
    if (f.starts.length === 1) { entered.resolve(); await release.promise; }
  });
  const next = holdResponse(f.faux), queued = holdResponse(f.faux);
  const originalNow = Date.now;
  let now = 300000;
  Date.now = () => now;
  try {
    const run = f.session.prompt("initial user");
    await entered.promise;
    now = 301000;
    await f.session.prompt("retained follow-up", { streamingBehavior: "followUp" });
    now = 302000;
    const abort = f.session.abort();
    release.resolve();
    await Promise.all([run, abort]);
    const settled = f.snapshot();
    assert.equal(settled.actualQueue, 1);
    assert.equal(settled.footerQueue, true, "bare abort does not clear Pi's queues");
    assert.equal(settled.timer, "\uf00c 2.0s");
    now = 310000;
    const nextRun = f.session.prompt("later user", { source: "rpc" });
    await next.entered.promise;
    assert.equal(f.snapshot().actualQueue, 1);
    assert.equal(f.snapshot().footerQueue, true, "the new initial message leaves retained work indicated");
    assert.equal(f.snapshot().timer, "\uf017 0.0s");
    now = 312000;
    next.release.resolve();
    await queued.entered.promise;
    const delivered = f.snapshot();
    assert.equal(delivered.actualQueue, 0);
    assert.equal(delivered.footerQueue, false);
    assert.equal(delivered.timer, "\uf017 2.0s");
    assert.equal(f.starts.length, 2);
    queued.release.resolve();
    await nextRun;
    console.log(JSON.stringify({ scenario: "sdk-abort-retains-follow-up", settled, delivered }));
  } finally {
    release.resolve(); next.release.resolve(); queued.release.resolve();
    Date.now = originalNow;
  }
});

for (const source of ["interactive", "extension", "rpc"]) {
  test(`target ${source} queued deliveries update the host indicator without resetting whole-run timing`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t);
    const first = holdResponse(f.faux), steering = holdResponse(f.faux), followUp = holdResponse(f.faux);
    const originalNow = Date.now;
    let now = 400000;
    Date.now = () => now;
    try {
      const run = f.session.prompt("initial user");
      await first.entered.promise;
      now = 401000;
      await f.session.prompt("queued follow-up", { streamingBehavior: "followUp" });
      now = 402000;
      if (source === "extension") {
        await f.session.sendUserMessage("queued steering", { deliverAs: "steer" });
      } else {
        await f.session.prompt("queued steering", { streamingBehavior: "steer", source });
      }
      assert.equal(f.snapshot().actualQueue, 2);
      assert.equal(f.snapshot().footerQueue, true);
      now = 403000;
      first.release.resolve();
      await steering.entered.promise;
      assert.equal(f.snapshot().actualQueue, 1);
      assert.equal(f.snapshot().footerQueue, true);
      assert.equal(f.snapshot().timer, "\uf017 3.0s", "steering must not reset the running timer");
      now = 404000;
      steering.release.resolve();
      await followUp.entered.promise;
      assert.equal(f.snapshot().actualQueue, 0);
      assert.equal(f.snapshot().footerQueue, false);
      assert.equal(f.snapshot().timer, "\uf017 4.0s", "follow-ups must not reset the running timer");
      assert.equal(f.starts.length, 1);
      followUp.release.resolve();
      await run;
    } finally {
      first.release.resolve(); steering.release.resolve(); followUp.release.resolve();
      Date.now = originalNow;
    }
  });
}

for (const variant of ["unique", "identical-content-and-time", "transformed-after-footer"]) {
  test(`target held preparation delivers selected follow-up before late steering: ${variant}`, { timeout: 30000 }, async (t) => {
    const originalNow = Date.now;
    let now = 100000;
    const transform = variant === "transformed-after-footer";
    const identical = variant === "identical-content-and-time";
    const followText = "synthetic payload alpha";
    const lateText = identical ? followText : "synthetic payload beta";
    const inputs = [];
    const f = await fixture(t, undefined, async (event) => {
      inputs.push({ at: Date.now(), ...event });
      if (transform && event.streamingBehavior === "followUp") {
        await Promise.resolve();
        now = 101250;
        return { action: "transform", text: `${event.text} transformed` };
      }
      return { action: "continue" };
    });
    const first = holdResponse(f.faux), second = holdResponse(f.faux), third = holdResponse(f.faux);
    const preparing = deferred(), releasePreparation = deferred();
    const originalPrepare = f.session.agent.prepareNextTurnWithContext;
    let preparationCount = 0;
    f.session.agent.prepareNextTurnWithContext = async (turn, signal) => {
      if (++preparationCount === 1) {
        preparing.resolve();
        await releasePreparation.promise;
      }
      return await originalPrepare.call(f.session.agent, turn, signal);
    };
    let followMessage, lateMessage;
    const deliveries = [];
    f.session.subscribe((event) => {
      if (event.type !== "message_start" || event.message.role !== "user") return;
      let label = "initial";
      // These object references prove target delivery order only; input events do not expose them.
      if (event.message === followMessage) label = "followUp";
      else if (event.message === lateMessage) label = "late-steering";
      deliveries.push({ label, ...f.snapshot() });
    });
    Date.now = () => now;
    try {
      const run = f.session.prompt("synthetic initial payload");
      await first.entered.promise;
      now = 101000;
      await f.session.prompt(followText, { streamingBehavior: "followUp" });
      [followMessage] = f.session.agent.peekQueuedMessages();
      assert.equal(followMessage.role, "user");
      assert.equal(f.snapshot().actualQueue, 1);
      assert.equal(f.snapshot().footerQueue, true);
      now = identical ? 101000 : 101500;
      first.release.resolve();
      await preparing.promise;
      assert.equal(f.session.agent.hasQueuedMessages(), false, "the follow-up is already drained before preparation");
      assert.equal(deliveries.length, 1, "the selected follow-up has not emitted yet");
      now = identical ? 101000 : 102000;
      await f.session.prompt(lateText, { streamingBehavior: "steer" });
      [lateMessage] = f.session.agent.peekQueuedMessages();
      assert.ok(lateMessage && lateMessage !== followMessage);
      assert.equal(f.snapshot().actualQueue, 2, "Pi still reports the selected follow-up pending until message_start");
      assert.equal(f.snapshot().footerQueue, true);
      now = 104000;
      releasePreparation.resolve();
      await second.entered.promise;
      assert.equal(deliveries[1].label, "followUp");
      assert.equal(deliveries[1].actualQueue, 1);
      assert.equal(deliveries[1].footerQueue, true);
      assert.equal(deliveries[1].timer, "\uf017 4.0s");
      assert.equal(f.session.agent.peekQueuedMessages()[0], lateMessage, "late steering is still queued after the selected delivery");
      now = 105000;
      second.release.resolve();
      await third.entered.promise;
      assert.equal(deliveries[2].label, "late-steering");
      assert.equal(deliveries[2].actualQueue, 0);
      assert.equal(deliveries[2].footerQueue, false);
      assert.equal(deliveries[2].timer, "\uf017 5.0s", "late steering must not reset the whole-run timer");
      now = 106000;
      third.release.resolve();
      await run;
      await f.session.waitForIdle();
      assert.equal(f.starts.length, 1, "queued work emits no new before_agent_start");
      assert.equal(f.faux.state.callCount, 3);
      assert.equal(f.snapshot().timer, "\uf00c 6.0s");
      assert.equal(f.snapshot().actualQueue, 0);
      assert.equal(f.snapshot().footerQueue, false);
      const followInput = inputs.find((input) => input.streamingBehavior === "followUp");
      assert.equal(JSON.stringify(followMessage) === JSON.stringify(lateMessage), identical);
      assert.equal(followInput.text === followMessage.content[0].text, !transform);
      assert.equal(followInput.at === followMessage.timestamp, !transform);
      console.log(JSON.stringify({ scenario: `held-preparation-${variant}`, deliveries, settled: f.snapshot() }));
    } finally {
      releasePreparation.resolve(); first.release.resolve(); second.release.resolve(); third.release.resolve();
      Date.now = originalNow;
    }
  });
}

function assertQueue(f, count) {
  const value = f.snapshot();
  assert.equal(value.actualQueue, count);
  assert.equal(value.footerQueue, count > 0);
  assert.equal(value.queueSegment, count > 0 ? "\uf46c queued" : null);
  return value;
}

async function actionFixture(t, onInput) {
  const held = [];
  const originalNow = Date.now;
  let run;
  t.after(async () => {
    for (const response of held) response.release.resolve();
    if (run) await run;
    Date.now = originalNow;
  });
  const f = await fixture(t, undefined, onInput);
  const actions = f.registerActions();
  const hold = () => { const response = holdResponse(f.faux); held.push(response); return response; };
  const first = hold(), next = hold();
  let now = 100000;
  Date.now = () => now;
  run = f.session.prompt("initial user");
  await first.entered.promise;
  return { f, actions, first, next, run, hold, now(value) { now = value; } };
}

test("target registered TUI dequeue without abort hides pending state on scheduled frames", { timeout: 30000 }, async t => {
  const { f, actions, first, next, run, now } = await actionFixture(t);
  await actions.submit("restored input");
  assert.equal(f.session.pendingMessageCount, 1);
  now(101000);
  f.phase("dequeued");
  actions.dequeue();
  assert.equal(actions.editorText, "restored input");
  await new Promise(resolve => setTimeout(resolve, 300));
  const empty = assertQueue(f, 0);
  assert.equal(f.session.isStreaming, true);
  assert.equal(f.settlements.length, 0);
  assert.equal(empty.timer, "\uf017 1.0s");
  const frames = f.frames.filter(frame => frame.phase === "dequeued");
  assert.ok(frames.length > 0);
  assert.ok(frames.every(frame => frame.actualQueue === 0 && frame.queueSegment === null));
  now(102000);
  await actions.submit();
  assertQueue(f, 1);
  now(103000);
  first.release.resolve();
  await next.entered.promise;
  assert.equal(assertQueue(f, 0).timer, "\uf017 3.0s");
  now(104000);
  next.release.resolve();
  await run;
  assert.equal(assertQueue(f, 0).timer, "\uf00c 4.0s");
  assert.equal(f.settlements.length, 1);
  assert.equal(f.starts.length, 1);
  console.log(JSON.stringify({ scenario: "registered-dequeue", empty, settled: f.snapshot() }));
});

for (const count of [1, 3]) {
  test(`target registered TUI dequeue resubmits ${count} restored messages as one before any render`, { timeout: 30000 }, async t => {
    const { f, actions, first, next, run, now } = await actionFixture(t);
    for (let i = 0; i < count; i++) await actions.submit(`restored ${i + 1}`);
    assert.equal(f.session.pendingMessageCount, count);
    const renders = f.renderCount;
    actions.dequeue();
    assert.equal(actions.editorText, Array.from({ length: count }, (_, i) => `restored ${i + 1}`).join("\n\n"));
    await actions.submit();
    assert.equal(f.renderCount, renders, "no render supplies an admission/dequeue boundary");
    const resubmitted = assertQueue(f, 1);
    assert.equal(f.session.isStreaming, true);
    assert.equal(f.settlements.length, 0);
    now(103000);
    first.release.resolve();
    await next.entered.promise;
    assert.equal(assertQueue(f, 0).timer, "\uf017 3.0s");
    next.release.resolve();
    await run;
    assert.equal(assertQueue(f, 0).timer, "\uf00c 3.0s");
    assert.equal(f.userStarts.length, 2);
    assert.equal(f.starts.length, 1);
    console.log(JSON.stringify({ scenario: `immediate-resubmit-${count}`, resubmitted, settled: f.snapshot() }));
  });
}

test("target registered TUI delayed continuing admission is not queued during interim frames", { timeout: 30000 }, async t => {
  const entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  const { f, actions, first, next, run, now } = await actionFixture(t, async event => {
    if (event.streamingBehavior) { entered.resolve(); await release.promise; }
    return { action: "continue" };
  });
  f.phase("admitting");
  const pending = actions.submit("held continuing input");
  await entered.promise;
  await new Promise(resolve => setTimeout(resolve, 300));
  assertQueue(f, 0);
  const frames = f.frames.filter(frame => frame.phase === "admitting");
  assert.ok(frames.length > 0);
  assert.ok(frames.every(frame => frame.actualQueue === 0 && frame.queueSegment === null));
  release.resolve();
  await pending;
  assertQueue(f, 1);
  now(103000);
  first.release.resolve();
  await next.entered.promise;
  assert.equal(assertQueue(f, 0).timer, "\uf017 3.0s");
  next.release.resolve();
  await run;
  assert.equal(assertQueue(f, 0).timer, "\uf00c 3.0s");
  assert.equal(f.starts.length, 1);
});

for (const order of [[1, 2], [2, 1]]) {
  test(`target registered TUI overlapping admissions indicate actual pending state in order ${order.join("-")}`, { timeout: 30000 }, async t => {
    const gates = new Map([1, 2].map(n => [n, { entered: deferred(), release: deferred() }]));
    t.after(() => { for (const gate of gates.values()) gate.release.resolve(); });
    let ordinal = 0;
    const observations = [];
    const { f, actions, first, next, run, hold, now } = await actionFixture(t, async (event, ctx) => {
      if (!event.streamingBehavior) return { action: "continue" };
      observations.push(ctx.hasPendingMessages());
      const gate = gates.get(++ordinal);
      gate.entered.resolve();
      await gate.release.promise;
      return { action: "continue" };
    });
    const last = hold();
    const pending = new Map();
    f.phase("overlap");
    pending.set(1, actions.submit("same payload"));
    await gates.get(1).entered.promise;
    pending.set(2, actions.submit("same payload"));
    await gates.get(2).entered.promise;
    assert.deepEqual(observations, [false, false]);
    await new Promise(resolve => setTimeout(resolve, 300));
    assertQueue(f, 0);
    assert.ok(f.frames.some(frame => frame.phase === "overlap"));
    assert.ok(f.frames.filter(frame => frame.phase === "overlap").every(frame => frame.queueSegment === null));
    let admitted = 0;
    for (const n of order) {
      gates.get(n).release.resolve();
      await pending.get(n);
      assertQueue(f, ++admitted);
    }
    const accepted = f.snapshot();
    now(103000);
    first.release.resolve();
    await next.entered.promise;
    assert.equal(assertQueue(f, 1).timer, "\uf017 3.0s");
    assert.equal(f.userStarts.length, 2);
    now(104000);
    next.release.resolve();
    await last.entered.promise;
    assert.equal(assertQueue(f, 0).timer, "\uf017 4.0s");
    assert.equal(f.userStarts.length, 3);
    now(105000);
    last.release.resolve();
    await run;
    assert.equal(assertQueue(f, 0).timer, "\uf00c 5.0s");
    assert.equal(f.starts.length, 1);
    console.log(JSON.stringify({ scenario: `overlap-${order.join("-")}`, accepted, settled: f.snapshot() }));
  });
}

test("target abort during startup settles the timer without a provider request", { timeout: 30000 }, async (t) => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, async () => { entered.resolve(); await release.promise; });
  const run = f.session.prompt("aborted startup");
  await entered.promise;
  assert.ok(f.line().includes("\uf017"));
  const abort = f.session.abort();
  release.resolve();
  await Promise.all([run, abort]);
  assert.equal(f.session.isIdle, true);
  assert.equal(f.faux.state.callCount, 0);
  assert.ok(f.line().includes("\uf00c"));
});

test("target theme schema and real initial/reload loader preserve both palettes", async (t) => {
  const schema = json(join(root, "schemas/theme.schema.json"));
  assert.equal(schema.$id, "https://pi.dev/schemas/theme.schema.json");
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-140-themes-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(join(dir, "themes"));
  const palettes = {
    dark: "f149ebdbff483936c50c2d44dc89fed4096dfdf9cc27bd570bdac521a5a65d8f",
    light: "b931597a1b3d390dbeb44e0fedb96eeb7c37060e41d0e3682044ddd3c88a4faf",
  };
  for (const name of ["dark", "light"]) {
    const path = join(repository, "agent/themes", `${name}.json`);
    const data = json(path);
    assert.equal(data.$schema, schema.$id);
    assert.ok(validate(data), JSON.stringify(validate.errors));
    delete data.$schema;
    assert.equal(createHash("sha256").update(JSON.stringify(data)).digest("hex"), palettes[name], "only the schema reference may change");
    const theme = themeApi.loadThemeFromPath(path, "truecolor");
    for (const token of Object.keys(data.colors)) {
      const method = THEME_TOKENS[token].slot === "background" ? "bg" : "fg";
      assert.ok(theme[method](token, "probe").includes("probe"));
      const variable = data.vars[data.colors[token]];
      if (variable?.startsWith("#")) assert.equal(colorToHex(theme.colors[token]).toLowerCase(), variable.toLowerCase());
    }
    fs.copyFileSync(path, join(dir, "themes", `${name}.json`));
  }
  const loader = new pi.DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager: pi.SettingsManager.inMemory({ defaultProjectTrust: "never" }),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
  });
  for (let pass = 0; pass < 2; pass++) {
    await loader.reload();
    assert.deepEqual(loader.getThemes().diagnostics, []);
    assert.deepEqual(loader.getThemes().themes.map((theme) => theme.name).sort(), ["dark", "light"]);
    for (const theme of loader.getThemes().themes) {
      const path = join(dir, "themes", `${theme.name}.json`);
      assert.equal(theme.sourcePath, path);
      const data = json(path);
      assert.equal(colorToHex(theme.colors.accent).toLowerCase(), data.vars[data.colors.accent].toLowerCase());
    }
    if (pass === 0) {
      const path = join(dir, "themes/dark.json");
      const changed = json(path);
      changed.vars.accent = "#123456";
      fs.writeFileSync(path, JSON.stringify(changed));
    }
  }
});
