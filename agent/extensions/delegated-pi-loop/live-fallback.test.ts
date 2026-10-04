import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDelegatePrompt, LIVE_CONTINUATION_PROMPT, REPORT_RECOVERY_PROMPT, RESTART_AFTER_WORK_NOTE } from "./instructions.ts";
import { requireRole, validateRoutingConfig } from "./routing.ts";
import { runDelegate } from "./runner.ts";
import { finalizeDelegateRun } from "./result.ts";
import { terminationProbes, type TerminationProbes } from "./supervisor.ts";
import type { AttemptStatus, DelegateProgress, DelegateRunResult, RunOptions } from "./types.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "delegate-live-test-"));
process.env.PI_DELEGATE_ARTIFACT_PARENT = root;
after(async () => {
  delete process.env.PI_DELEGATE_ARTIFACT_PARENT;
  await rm(root, { recursive: true, force: true });
});

const routes = ["prov-a/model-a", "prov-b/model-b", "prov-c/model-c", "prov-d/model-d"];
const levels = ["high", "low", "off", "medium"];
const routingConfig = validateRoutingConfig({
  version: 2,
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  disabledProviders: [],
  models: Object.fromEntries(routes.map((route, i) => {
    const [provider, model] = route.split("/");
    return [model, { providers: { [provider!]: { thinking: [levels[i]], default: levels[i] } } }];
  })),
  profiles: { chain: { overridePolicy: "rejected", tiers: routes.map((route, i) => ({ model: route.split("/")[1], thinking: levels[i] })) } },
  assignments: { solution: ["chain"], review: ["chain"], implementation: "chain", remediation: "chain", verification: "chain", oracle: "chain" },
});

type Trace = { kind: string; pid: number; route?: string; args?: string[]; command?: { id: string; type: string; message?: string }; bytes?: number; descendant?: number };
type PrivateStatus = AttemptStatus & { liveReused: boolean };
interface FixtureOptions {
  behaviors?: string[];
  catalog?: string[];
  catalogDelayRoute?: number;
  catalogHangRoute?: number;
  catalogStartupMs?: number;
  runtimeStartupMs?: number;
  omitCatalogReadiness?: boolean;
  controlFault?: string;
  faultStep?: number;
  descendant?: boolean;
  padding?: number;
  idleFault?: boolean;
  fastlaneStates?: (string | null)[];
  startupStatus?: string;
  administrativeStatus?: boolean;
  parkedStatus?: boolean;
  obsoleteStatus?: boolean;
  sameModel?: boolean;
}

async function fixture(settings: FixtureOptions = {}) {
  const cwd = await mkdtemp(path.join(root, "fixture-"));
  const script = path.join(cwd, "fake-pi.mjs");
  const fixtureRoutes = settings.sameModel ? routes.map((route) => route.split("/")[0] + "/model-a") : routes;
  await writeFile(script, `
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createFixtureSession } from ${JSON.stringify(new URL("./persisted-session.fixture.ts", import.meta.url).href)};
const settings = ${JSON.stringify(settings)};
const routes = ${JSON.stringify(fixtureRoutes)};
const args = process.argv.slice(2);
const persistPrompt = createFixtureSession(args);
const trace = (entry) => appendFileSync("trace.jsonl", JSON.stringify({ pid: process.pid, ...entry }) + "\\n", { mode: 0o600 });
if (args.includes("--list-models")) {
  const route = args[args.indexOf("--list-models") + 1];
  if (settings.catalogStartupMs) await new Promise((resolve) => setTimeout(resolve, settings.catalogStartupMs));
  trace({ kind: "catalog", route, args });
  const done = () => {
    if ((settings.catalog ?? routes).includes(route)) console.log(route.replace("/", " ") + " 100 100 yes yes");
    trace({ kind: "catalog-end", route });
    process.exit(0);
  };
  if (route === routes[settings.catalogHangRoute]) {
    if (!settings.omitCatalogReadiness) trace({ kind: "catalog-ready", route });
    setInterval(() => {}, 1000);
  } else if (route === routes[settings.catalogDelayRoute]) setTimeout(done, 2000);
  else done();
} else {
  if (settings.runtimeStartupMs) await new Promise((resolve) => setTimeout(resolve, settings.runtimeStartupMs));
  let provider = args[args.indexOf("--provider") + 1];
  let model = args[args.indexOf("--model") + 1];
  let thinking = args[args.indexOf("--thinking") + 1];
  let round = 0;
  let step = 0;
  let route = () => provider + "/" + model;
  const descendant = settings.descendant ? spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }) : undefined;
  trace({ kind: "start", route: route(), args, descendant: descendant?.pid });
  process.on("exit", () => trace({ kind: "exit", route: route() }));
  process.on("SIGTERM", () => {
    if (settings.obsoleteStatus) process.stdout.write(JSON.stringify({ type: "extension_ui_request", method: "setStatus", statusKey: "delegate-fastlane", statusText: "enabled" }) + "\\n");
    const done = () => process.exit(0);
    if (descendant && descendant.exitCode === null) { descendant.once("close", done); descendant.kill(); }
    else done();
  });
  const emit = (event, tail = "") => {
    const line = JSON.stringify(event) + "\\n" + tail;
    trace({ kind: "output", route: route(), bytes: Buffer.byteLength(line) });
    process.stdout.write(line);
  };
  const status = (statusText) => emit({ type: "extension_ui_request", method: "setStatus", statusKey: "delegate-fastlane", statusText });
  if (settings.startupStatus) status(settings.startupStatus);
  const settle = () => {
    emit({ type: "agent_end", willRetry: false }); emit({ type: "agent_settled" });
    if (settings.parkedStatus) status("enabled");
  };
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\\n")) {
      const newline = buffer.indexOf("\\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const command = JSON.parse(line);
      trace({ kind: command.type === "prompt" ? "prompt" : "control", route: route(), command, bytes: Buffer.byteLength(line + "\\n") });
      if (command.type !== "prompt") {
        step += 1;
        if (settings.administrativeStatus) status("enabled");
        const fault = settings.controlFault;
        const faultHere = step === (settings.faultStep ?? 1);
        if (faultHere && fault === "timeout") continue;
        if (faultHere && fault === "output") { process.stdout.write("x".repeat(20000)); continue; }
        if (faultHere && fault === "exit") { process.exit(3); }
        const response = { id: command.id, type: "response", command: command.type, success: true };
        if (faultHere && fault === "reject") { emit({ ...response, success: false, error: "CONTROL-PRIVATE-SENTINEL" }); continue; }
        if (faultHere && fault === "stale") response.id = "prompt-1";
        if (command.type === "get_state") {
          response.data = { model: { provider, id: model, baseUrl: "CONTROL-PRIVATE-SENTINEL" }, thinkingLevel: thinking,
            isStreaming: faultHere && fault === "busy", isCompacting: faultHere && fault === "compacting",
            pendingMessageCount: faultHere && fault === "queued" ? 1 : 0, messageCount: 10,
            sessionId: "CONTROL-PRIVATE-SENTINEL", sessionFile: "CONTROL-PRIVATE-SENTINEL" };
          if (faultHere && fault === "mismatch") response.data.thinkingLevel = "max";
        } else if (command.type === "set_model") {
          provider = command.provider; model = command.modelId; round = 0;
          response.data = { provider, id: model };
          if (faultHere && fault === "mismatch") response.data.id = "wrong";
        } else if (command.type === "set_thinking_level") thinking = command.level;
        // Keep the partial tail in the acknowledgement write so the boundary fault is deterministic.
        let tail = faultHere && fault === "partial" ? "{" : "";
        if (faultHere && fault === "status-partial") tail = JSON.stringify({ type: "extension_ui_request", method: "setStatus", statusKey: "delegate-fastlane", statusText: "enabled" });
        emit(response, tail);
        if (faultHere && fault === "exit-after-ack") process.exit(3);
        if (settings.administrativeStatus && !(faultHere && fault === "status-partial")) status("enabled");
        if (faultHere && fault === "duplicate") emit(response);
        if (faultHere && fault === "event") emit({ type: "agent_start" });
        continue;
      }
      round += 1;
      const configuredStatus = settings.fastlaneStates?.[routes.indexOf(route())];
      if (configuredStatus !== undefined && configuredStatus !== null) status(configuredStatus);
      const behavior = (settings.behaviors ?? ["provider", "complete"])[routes.indexOf(route())] ?? "complete";
      if (behavior === "reject" || (behavior === "recover-reject" && round === 2)) { emit({ id: command.id, type: "response", command: "prompt", success: false, error: "PROVIDER-PRIVATE-SENTINEL" }); continue; }
      emit({ id: command.id, type: "response", command: "prompt", success: true });
      persistPrompt(command.message);
      emit({ type: "agent_start" });
      if (behavior === "exit") { process.exit(3); }
      if (behavior === "invalid-stream") { process.stdout.write("{malformed\\n"); continue; }
      if (behavior === "stalled") continue;
      if (behavior === "output") { process.stdout.write("x".repeat(20000)); continue; }
      if (behavior === "tools-provider" || behavior === "active-provider") {
        emit({ type: "tool_execution_start", toolCallId: "work", toolName: "bash", args: { command: "TOOL-PRIVATE-SENTINEL" } });
        if (behavior === "tools-provider") emit({ type: "tool_execution_end", toolCallId: "work", toolName: "bash", result: {}, isError: false });
      }
      if (behavior.endsWith("provider") && (behavior !== "recover-provider" || round === 2)) {
        emit({ type: "message_update", assistantMessageEvent: { type: "error", errorMessage: "503 PROVIDER-PRIVATE-SENTINEL" }, padding: "x".repeat(settings.padding ?? 0) });
      } else if (behavior === "invalid") {
        emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "INVALID-REPORT-SENTINEL" }] } });
      } else if (behavior !== "missing" && !(round === 1 && (behavior === "recover" || behavior === "recover-provider" || behavior === "recover-reject"))) {
        emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Finished " + route() + " " + "x".repeat(settings.padding ?? 0) + "\\n\\nDELEGATE_RESULT: COMPLETED" }] } });
      }
      settle();
      if (settings.idleFault && route() === routes[0]) setTimeout(() => emit({ type: "agent_start" }), 40);
    }
  });
  setInterval(() => {}, 1000);
}
`, { mode: 0o700 });
  const options: RunOptions = {
    role: "solution-a", prompt: "Complete the one assigned increment.", cwd,
    piInvocation: { command: process.execPath, prefixArgs: [script] },
    routingConfig: settings.sameModel ? validateRoutingConfig({
      version: 2, thinkingLevels: ["high"], disabledProviders: [],
      models: { "model-a": { providers: Object.fromEntries(fixtureRoutes.map((route) =>
        [route.split("/")[0], { thinking: ["high"], default: "high" }])) } },
      profiles: { chain: { overridePolicy: "rejected", tiers: [{ model: "model-a", thinking: "high" }] } },
      assignments: { solution: ["chain"], review: ["chain"], implementation: "chain", remediation: "chain", verification: "chain", oracle: "chain" },
    }) : routingConfig,
    random: () => 0,
    resourceSelection: { catalogArgs: ["--no-extensions"], runtimeArgs: ["--no-extensions", "--no-skills"], verifyCatalogSpawn() {}, verifyRuntimeSpawn() {} },
    activityWarningMs: 200, activityIdleMs: 600, progressWarningMs: 1000, progressStallMs: 2000,
    reportRecoveryIdleMs: 500, graceMs: 100, cleanupTimeoutMs: 1000, catalogTimeoutMs: 500, liveSwitchTimeoutMs: 300,
  };
  return { cwd, options, trace: async (): Promise<Trace[]> => (await readFile(path.join(cwd, "trace.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line)) };
}

test("Fastlane fresh fallback and failed switches pass runtime-only intent to every spawn", async () => {
  for (const settings of [
    { behaviors: ["exit", "complete"], obsoleteStatus: true },
    { behaviors: ["provider", "complete"], controlFault: "reject", faultStep: 2, administrativeStatus: true, obsoleteStatus: true },
  ]) {
    await check({ ...settings, fastlaneStates: ["enabled", "inactive"] }, (result, trace, status) => {
      assert.equal(result.state, "completed");
      assert.equal(trace.filter((entry) => entry.kind === "start").length, 2);
      for (const start of trace.filter((entry) => entry.kind === "start")) {
        assert.equal(start.args!.filter((arg) => arg === "--fastlane").length, 1);
      }
      for (const catalog of trace.filter((entry) => entry.kind === "catalog")) assert.ok(!catalog.args!.includes("--fastlane"));
      assert.equal(status[0]!.fastlaneState, "enabled");
      assert.equal(status[1]!.fastlaneState, "inactive");
      assert.equal(result.progress.fastlaneState, "inactive");
    }, { fastlane: true });
  }
});

test("Fastlane confirmation resets across eligible, ineligible, eligible retained routes and catalogs", async () => {
  const progress: DelegateProgress[] = [];
  await check({ behaviors: ["provider", "provider", "complete"], fastlaneStates: ["enabled", "inactive", "enabled"], administrativeStatus: true, parkedStatus: true }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    assert.deepEqual(status.map((entry) => entry.fastlaneState), ["enabled", "inactive", "enabled"]);
    assert.equal(result.progress.fastlaneState, "enabled");
    for (const item of progress.filter((item) => item.state === "catalog_check")) assert.equal(item.fastlaneState, undefined);
    for (const item of progress.filter((item) => item.attempt === 2 && item.state === "running")) assert.notEqual(item.fastlaneState, "enabled");
  }, { fastlane: true, onProgress: (item) => progress.push(item) });
});

test("parked and administrative Fastlane status cannot confirm an unconfirmed retained attempt", async () => {
  const progress: DelegateProgress[] = [];
  await check({ behaviors: ["provider", "complete"], fastlaneStates: ["enabled", null], administrativeStatus: true, parkedStatus: true }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    assert.equal(status[0]!.fastlaneState, "enabled");
    assert.equal(status[1]!.fastlaneState, "unknown");
    for (const item of progress.filter((item) => item.attempt === 2)) assert.notEqual(item.fastlaneState, "enabled");
  }, { fastlane: true, onProgress: (item) => progress.push(item) });
});

test("buffered partial administrative Fastlane status blocks reuse without confirming its replacement", async () => {
  const progress: DelegateProgress[] = [];
  await check({ behaviors: ["provider", "complete"], fastlaneStates: ["enabled", null], administrativeStatus: true, controlFault: "status-partial", faultStep: 4, obsoleteStatus: true }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 2);
    assert.equal(status[1]!.liveReused, false);
    assert.equal(status[1]!.fastlaneState, "unknown");
    for (const item of progress.filter((item) => item.attempt === 2)) assert.notEqual(item.fastlaneState, "enabled");
  }, { fastlane: true, onProgress: (item) => progress.push(item) });
});

test("same-model retained fallback needs a new provider-request Fastlane confirmation", async () => {
  for (const next of [null, "enabled"]) {
    await check({ sameModel: true, behaviors: ["provider", "complete"], fastlaneStates: ["enabled", next], administrativeStatus: true }, (result, trace, status) => {
      assert.equal(result.state, "completed");
      assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
      assert.equal(status[1]!.liveReused, true);
      assert.equal(status[1]!.fastlaneState, next ?? "unknown");
    }, { fastlane: true });
  }
});

test("omitted and false Fastlane never inherit emitted enabled state or pass a flag", async () => {
  for (const fastlane of [undefined, false]) {
    await check({ startupStatus: "enabled", fastlaneStates: ["enabled"], behaviors: ["complete"] }, (result, trace) => {
      assert.equal(result.state, "completed");
      assert.equal(result.progress.fastlaneRequested, false);
      assert.equal(result.progress.fastlaneState, "unknown");
      for (const item of trace.filter((entry) => entry.args)) assert.ok(!item.args!.includes("--fastlane"));
    }, { fastlane });
  }
});

function gone(pid: number): boolean {
  try { process.kill(pid, 0); return false; } catch { return true; }
}

async function statuses(result: DelegateRunResult): Promise<PrivateStatus[]> {
  const entries = (await readdir(result.artifactDir)).filter((name) => name.startsWith("attempt-")).sort();
  return Promise.all(entries.map(async (name) => JSON.parse(await readFile(path.join(result.artifactDir, name, "status.json"), "utf8"))));
}

async function check(settings: FixtureOptions, body: (result: DelegateRunResult, trace: Trace[], status: PrivateStatus[]) => void | Promise<void>, overrides: Partial<RunOptions> = {}, control?: RetainedCatalogControl) {
  const f = await fixture(settings);
  let result: DelegateRunResult | undefined;
  const verify = async (received: DelegateRunResult) => {
    result = received;
    const trace = await f.trace();
    await body(result, trace, await statuses(result));
    const starts = trace.filter((entry) => entry.kind === "start");
    for (const entry of starts) {
      assert.ok(gone(entry.pid), "every execution leader must be gone");
      if (entry.descendant) assert.ok(gone(entry.descendant), "every descendant must be gone");
    }
    for (let i = 1; i < starts.length; i++) {
      const priorExit = trace.findIndex((entry) => entry.kind === "exit" && entry.pid === starts[i - 1]!.pid);
      assert.ok(priorExit >= 0 && priorExit < trace.indexOf(starts[i]!), "positive cleanup precedes every fresh spawn");
    }
    assert.doesNotMatch(JSON.stringify({ ...result, report: undefined }), /CONTROL-PRIVATE-SENTINEL|PROVIDER-PRIVATE-SENTINEL|TOOL-PRIVATE-SENTINEL|INVALID-REPORT-SENTINEL/);
  };
  try {
    const options = { ...f.options, ...overrides };
    if (control) await runRetainedCatalogScenario(f, options, control, verify);
    else await verify(await runDelegate(options));
  } finally {
    if (result) await rm(result.artifactDir, { recursive: true, force: true });
    // The opt-in driver also owns children with no trace before abort.
    let trace: Trace[];
    if (control) trace = await readScenarioTrace(f);
    else trace = await f.trace();
    for (const entry of trace) {
      if (entry.kind !== "start" && !(control && entry.kind === "catalog")) continue;
      if (gone(entry.pid) && (!control || gone(-entry.pid))) continue;
      try { process.kill(-entry.pid, "SIGKILL"); } catch {}
    }
  }
}

interface RetainedCatalogEvidence {
  owned: { pid: number; catalog: boolean; probes: TerminationProbes }[];
  deliveredRoutes: string[];
  trace?: Trace[];
  artifactDir?: string;
  finalized?: boolean;
}
interface RetainedCatalogControl {
  t: TestContext;
  guardMs?: number;
  evidence?: RetainedCatalogEvidence;
}

async function readScenarioTrace(f: Awaited<ReturnType<typeof fixture>>): Promise<Trace[]> {
  return f.trace().catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

async function runRetainedCatalogScenario(
  f: Awaited<ReturnType<typeof fixture>>,
  options: RunOptions,
  control: RetainedCatalogControl,
  body: (result: DelegateRunResult) => Promise<void>,
) {
  const realNow = performance.now.bind(performance);
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const originalBuild = terminationProbes.build;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(f.cwd, "diagnostics");
  const controller = new AbortController();
  const evidence = control.evidence ?? { owned: [], deliveredRoutes: [] };
  let age = realNow();
  let runningSince: number | undefined;
  const now = () => age + (runningSince === undefined ? 0 : realNow() - runningSince);
  const pause = () => { age = now(); runningSince = undefined; };
  const resume = () => { runningSince ??= realNow(); };
  const clock = control.t.mock.method(performance, "now", now);
  let nextCatalog: string | undefined;
  let catalogOrdinal = 0;
  const timers: { route: string; handle: NodeJS.Timeout; deadline: number; armed: boolean; fire: () => void }[] = [];
  // Verification arms only the next catalog deadline, not equal-duration live-switch timers.
  const timerMock = control.t.mock.method(globalThis, "setTimeout", (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (nextCatalog === undefined) return realSetTimeout(callback, ms, ...args);
    const route = nextCatalog;
    nextCatalog = undefined;
    const handle = realSetTimeout(() => {}, 0);
    realClearTimeout(handle);
    timers.push({ route, handle, deadline: now() + (ms ?? 0), armed: true, fire: () => callback(...args) });
    return handle;
  });
  const clearMock = control.t.mock.method(globalThis, "clearTimeout", (handle: NodeJS.Timeout | undefined) => {
    const timer = timers.find((entry) => entry.handle === handle);
    if (timer) timer.armed = false;
    realClearTimeout(handle);
  });
  let cleanups = 0;
  terminationProbes.build = (child) => {
    // Cleanup and its probes share the same epoch and consume real elapsed time.
    resume();
    cleanups += 1;
    const real = originalBuild(child);
    evidence.owned.push({ pid: child.pid!, catalog: child.spawnargs.includes("--list-models"), probes: real });
    return {
      ...real,
      waitForClose: async (ms: number) => {
        try { return await real.waitForClose(ms); }
        finally {
          cleanups -= 1;
          if (cleanups === 0 && !controller.signal.aborted) pause();
        }
      },
    };
  };
  let failure: Error | undefined;
  let settled = false;
  const abort = () => {
    resume();
    // No fixture barriers remain: abort releases the actual catalog and retained session.
    controller.abort();
  };
  const guard = realSetTimeout(() => {
    failure = new Error("Retained catalog scenario guard expired before readiness or settlement");
    abort();
  }, control.guardMs ?? 5000);
  const onAbort = () => { failure ??= new Error("Retained catalog scenario test aborted"); abort(); };
  control.t.signal.addEventListener("abort", onAbort, { once: true });
  const driver = (async () => {
    while (!settled && !controller.signal.aborted) {
      const timer = timers.find((entry) => entry.route === routes[2] && entry.armed);
      if (timer && (await readScenarioTrace(f)).some((entry) => entry.kind === "catalog-ready" && entry.route === timer.route)) {
        timer.armed = false;
        pause();
        age += Math.max(0, timer.deadline - now());
        evidence.deliveredRoutes.push(timer.route);
        timer.fire();
      }
      await new Promise<void>((resolve) => realSetTimeout(resolve, 10));
    }
  })().catch((error: Error) => { failure = error; abort(); });
  try {
    const selection = options.resourceSelection!;
    const result = await runDelegate({
      ...options,
      signal: controller.signal,
      resourceSelection: {
        ...selection,
        verifyCatalogSpawn: () => {
          selection.verifyCatalogSpawn();
          pause();
          nextCatalog = routes[catalogOrdinal++];
        },
      },
    });
    evidence.artifactDir = result.artifactDir;
    try {
      settled = true;
      realClearTimeout(guard);
      await driver;
      if (failure) throw failure;
      assert.deepEqual(evidence.deliveredRoutes, [routes[2]], "only the ready hanging catalog receives its deadline");
      assert.ok(timers.every((timer) => !timer.armed), "settlement disarms every catalog deadline");
      await body(result);
    } finally {
      await finalizeDelegateRun(result);
      evidence.finalized = true;
    }
  } finally {
    settled = true;
    abort();
    realClearTimeout(guard);
    control.t.signal.removeEventListener("abort", onAbort);
    try {
      await driver;
      // Probe ownership comes from actual children, including children with no trace yet.
      for (const { probes } of evidence.owned) {
        if (probes.groupExists()) probes.signalGroup("SIGKILL");
        assert.ok(await probes.waitForClose(3000), "owned streams must close before restoring hooks");
        const deadline = realNow() + 3000;
        while (probes.groupExists() && realNow() < deadline) {
          await new Promise<void>((resolve) => realSetTimeout(resolve, 25));
        }
        assert.equal(probes.groupExists(), false, "every exact owned catalog and execution group must be reaped");
        assert.equal(probes.processIsRunning(), false, "every owned leader must be reaped");
      }
      evidence.trace = await readScenarioTrace(f);
    } finally {
      terminationProbes.build = originalBuild;
      clearMock.mock.restore();
      timerMock.mock.restore();
      clock.mock.restore();
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  }
}

test("one execution PID switches all route controls in order and continues the accepted assignment exactly", async () => {
  await check({ behaviors: ["tools-provider", "complete"], descendant: true }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((entry) => entry.state), ["provider_failed", "completed"]);
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    const commands = trace.filter((entry) => entry.command);
    assert.equal(new Set(commands.map((entry) => entry.pid)).size, 1);
    assert.deepEqual(commands.map((entry) => entry.command!.type), ["prompt", "get_state", "set_model", "set_thinking_level", "get_state", "prompt"]);
    assert.deepEqual(commands.map((entry) => entry.command!.id), ["prompt-1", "route-2:switch-1", "route-2:switch-2", "route-2:switch-3", "route-2:switch-4", "route-2:prompt-1"]);
    assert.equal(commands.at(-1)!.command!.message, LIVE_CONTINUATION_PROMPT);
    assert.match(commands[0]!.command!.message!, /Complete the one assigned increment/);
    assert.equal(result.progress.restartAfterWorkCount, 0);
    assert.ok(result.attempts.every((attempt) => !attempt.restartAfterWork));
    assert.deepEqual(status.map((entry) => entry.liveReused), [false, true]);
    assert.deepEqual(status.map((entry) => entry.toolExecutionCount), [1, 0]);
    assert.deepEqual(status.map((entry) => entry.reportNudgeCount), [0, 0]);
    assert.doesNotMatch(JSON.stringify(status), /CONTROL-PRIVATE-SENTINEL|PROVIDER-PRIVATE-SENTINEL|TOOL-PRIVATE-SENTINEL/);
  });
});

test("a rejected initial prompt resends the original complete assignment, not a continuation", async () => {
  const f = await fixture({ behaviors: ["reject", "complete"] });
  const result = await runDelegate(f.options);
  try {
    const prompts = (await f.trace()).filter((entry) => entry.kind === "prompt");
    assert.equal(result.state, "completed");
    assert.equal(prompts[0]!.pid, prompts[1]!.pid);
    const original = buildDelegatePrompt(requireRole(routingConfig, f.options.role), f.cwd, f.options.prompt);
    assert.equal(prompts[0]!.command!.message, original);
    assert.equal(prompts[1]!.command!.message, original);
    assert.equal(prompts[1]!.command!.id, "route-2:prompt-1");
    assert.ok(gone(prompts[0]!.pid));
  } finally {
    await rm(result.artifactDir, { recursive: true, force: true });
  }
});

test("missing and invalid reports recover independently per route, including provider failure during recovery", async () => {
  await check({ behaviors: ["missing", "invalid", "recover-provider", "recover"] }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(status.map((entry) => entry.state), ["missing_report", "invalid_result", "provider_failed", "completed"]);
    assert.deepEqual(status.map((entry) => entry.reportNudgeCount), [1, 1, 1, 1]);
    assert.ok(status.every((entry) => entry.reportRecoveryAccepted));
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    const prompts = trace.filter((entry) => entry.kind === "prompt");
    assert.equal(prompts.length, 8);
    for (let i = 0; i < 4; i++) {
      assert.equal(prompts[i * 2 + 1]!.command!.message, REPORT_RECOVERY_PROMPT);
      if (i > 0) {
        assert.equal(prompts[i * 2]!.command!.message, LIVE_CONTINUATION_PROMPT);
        assert.equal(prompts[i * 2]!.command!.id, `route-${i + 1}:prompt-1`);
        assert.equal(prompts[i * 2 + 1]!.command!.id, `route-${i + 1}:prompt-2`);
      }
    }
    assert.equal(result.progress.restartAfterWorkCount, 0);
    assert.doesNotMatch(result.report, /INVALID-REPORT-SENTINEL/);
    assert.equal(status.at(-1)!.providerFailureCategory, undefined);
  });
});

for (const behaviors of [["provider", "reject", "complete"], ["recover-reject", "complete"]]) {
  test(`a rejected later prompt keeps earlier accepted context: ${behaviors.join(",")}`, async () => {
    await check({ behaviors }, (result, trace) => {
      assert.equal(result.state, "completed");
      const prompts = trace.filter((entry) => entry.kind === "prompt");
      assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
      assert.equal(prompts.at(-1)!.command!.message, LIVE_CONTINUATION_PROMPT);
    });
  });
}

test("catalog skip and timeout keep one idle execution child and process-local ordinals", async (t) => {
  await check({ behaviors: ["provider"], catalog: [routes[0]!, routes[3]!], catalogHangRoute: 2, descendant: true }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((entry) => entry.state), ["provider_failed", "catalog_unavailable", "timed_out", "completed"]);
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    assert.deepEqual(trace.filter((entry) => entry.kind === "catalog").map((entry) => entry.route), routes);
    assert.equal(trace.filter((entry) => entry.kind === "prompt").at(-1)!.command!.id, "route-2:prompt-1");
    assert.deepEqual(status.map((entry) => entry.liveReused), [false, true]);
    const firstPrompt = trace.findIndex((entry) => entry.kind === "prompt");
    const secondCatalog = trace.findIndex((entry) => entry.kind === "catalog" && entry.route === routes[1]);
    assert.ok(firstPrompt < secondCatalog, "fallback catalogs are on demand, never prefetched");
  }, { catalogTimeoutMs: 300 }, { t });
});

test("retained catalog startup beyond 300 ms preserves skip, timeout, reuse, and ordinals", async (t) => {
  const originals = { now: performance.now, setTimeout, clearTimeout, build: terminationProbes.build, agentDir: process.env.PI_CODING_AGENT_DIR };
  const evidence: RetainedCatalogEvidence = { owned: [], deliveredRoutes: [] };
  const started = performance.now();
  await check({
    behaviors: ["provider"], catalog: [routes[0]!, routes[3]!], catalogHangRoute: 2, descendant: true,
    catalogStartupMs: 350, runtimeStartupMs: 350,
  }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((entry) => entry.state), ["provider_failed", "catalog_unavailable", "timed_out", "completed"]);
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    assert.deepEqual(trace.filter((entry) => entry.kind === "catalog").map((entry) => entry.route), routes);
    assert.equal(trace.filter((entry) => entry.kind === "prompt").at(-1)!.command!.id, "route-2:prompt-1");
    assert.deepEqual(status.map((entry) => entry.liveReused), [false, true]);
    const firstPrompt = trace.findIndex((entry) => entry.kind === "prompt");
    const secondCatalog = trace.findIndex((entry) => entry.kind === "catalog" && entry.route === routes[1]);
    assert.ok(firstPrompt < secondCatalog, "fallback catalogs are on demand, never prefetched");
    assert.deepEqual(evidence.deliveredRoutes, [routes[2]]);
    assert.equal(evidence.owned.filter((entry) => entry.catalog).length, 4);
    assert.equal(evidence.owned.filter((entry) => !entry.catalog).length, 1);
    assert.equal(trace.filter((entry) => entry.kind === "catalog-ready").length, 1);
    assert.equal(trace.filter((entry) => entry.kind === "catalog-end").length, 3);
  }, { catalogTimeoutMs: 300 }, { t, evidence });
  assert.ok(performance.now() - started >= 5 * 350, "real catalog and execution startup must exceed the unchanged 300 ms deadlines");
  assert.equal(performance.now, originals.now);
  assert.equal(setTimeout, originals.setTimeout);
  assert.equal(clearTimeout, originals.clearTimeout);
  assert.equal(terminationProbes.build, originals.build);
  assert.equal(process.env.PI_CODING_AGENT_DIR, originals.agentDir);
  assert.equal(evidence.finalized, true);
  await assert.rejects(readdir(evidence.artifactDir!), { code: "ENOENT" });
});

for (const early of [false, true]) {
  test(`retained catalog guard ${early ? "before any trace" : "without readiness"} settles and reaps every owned group`, async (t) => {
    const originals = { now: performance.now, setTimeout, clearTimeout, build: terminationProbes.build, agentDir: process.env.PI_CODING_AGENT_DIR };
    const evidence: RetainedCatalogEvidence = { owned: [], deliveredRoutes: [] };
    let reachedBody = false;
    const started = performance.now();
    await assert.rejects(check({
      behaviors: ["provider"], catalog: [routes[0]!, routes[3]!], catalogHangRoute: 2, descendant: true,
      omitCatalogReadiness: true, catalogStartupMs: early ? 2000 : undefined,
    }, () => {
      reachedBody = true;
    }, { catalogTimeoutMs: 300 }, { t, guardMs: 1000, evidence }), /Retained catalog scenario guard expired before readiness or settlement/);
    assert.equal(reachedBody, false, "guard failure must precede normal result assertions");
    assert.ok(performance.now() - started >= 1000, "the guard and abort cleanup must use real elapsed time");
    assert.equal(performance.now, originals.now);
    assert.equal(setTimeout, originals.setTimeout);
    assert.equal(clearTimeout, originals.clearTimeout);
    assert.equal(terminationProbes.build, originals.build);
    assert.equal(process.env.PI_CODING_AGENT_DIR, originals.agentDir);
    assert.equal(evidence.finalized, true);
    await assert.rejects(readdir(evidence.artifactDir!), { code: "ENOENT" });
    assert.deepEqual(evidence.deliveredRoutes, []);
    const trace = evidence.trace!;
    if (early) {
      assert.deepEqual(trace, [], "early guard cleanup must not depend on a trace file");
      assert.equal(evidence.owned.length, 1, "the actual untraced catalog child is still owned");
      assert.equal(evidence.owned[0]!.catalog, true);
    } else {
      assert.equal(trace.some((entry) => entry.kind === "catalog-ready"), false);
      assert.deepEqual(trace.filter((entry) => entry.kind === "catalog").map((entry) => entry.route), routes.slice(0, 3));
      assert.equal(evidence.owned.filter((entry) => entry.catalog).length, 3);
      assert.equal(evidence.owned.filter((entry) => !entry.catalog).length, 1);
      const execution = trace.find((entry) => entry.kind === "start")!;
      assert.ok(execution.descendant && gone(execution.descendant), "guard failure must reap the execution descendant");
    }
    for (const { pid, probes } of evidence.owned) {
      assert.ok(gone(pid), "guard rejection must follow leader reaping");
      assert.ok(gone(-pid), "guard rejection must follow exact process-group reaping");
      assert.equal(probes.groupExists(), false);
      assert.equal(probes.processIsRunning(), false);
    }
    assert.deepEqual((await readdir(root)).filter((name) => name.startsWith("delegated-pi-")), [], "guard failure must leave no owned run artifacts");
  });
}

test("ordinary live-fallback check after catalog guards keeps default clocks, timers, and controls", async () => {
  const started = performance.now();
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.ok(performance.now() > started);
  await check({ behaviors: ["provider", "complete"], descendant: true }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((entry) => entry.state), ["provider_failed", "completed"]);
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    assert.deepEqual(trace.filter((entry) => entry.kind === "catalog").map((entry) => entry.route), routes.slice(0, 2));
    assert.deepEqual(trace.filter((entry) => entry.command).map((entry) => entry.command!.type), ["prompt", "get_state", "set_model", "set_thinking_level", "get_state", "prompt"]);
    assert.equal(trace.filter((entry) => entry.kind === "prompt").at(-1)!.command!.id, "route-2:prompt-1");
    assert.deepEqual(status.map((entry) => entry.liveReused), [false, true]);
  });
});

for (const [controlFault, faultStep] of [
  ["reject", 1], ["reject", 2], ["reject", 3], ["reject", 4],
  ["mismatch", 1], ["mismatch", 2], ["mismatch", 4],
  ["busy", 1], ["busy", 4], ["compacting", 1], ["queued", 4],
  ["timeout", 1], ["timeout", 4], ["exit", 2], ["exit-after-ack", 4], ["output", 1],
  ["duplicate", 1], ["duplicate", 4], ["stale", 2], ["event", 2], ["partial", 2],
] as const) {
  test(`live switch ${controlFault} at step ${faultStep} cleans up before fresh fallback`, async () => {
    await check({ behaviors: ["tools-provider", "complete"], controlFault, faultStep, descendant: !controlFault.startsWith("exit") }, (result, trace, status) => {
      assert.equal(result.state, "completed");
      assert.equal(trace.filter((entry) => entry.kind === "start").length, 2);
      assert.ok(status.every((entry) => !entry.liveReused));
      const prompts = trace.filter((entry) => entry.kind === "prompt");
      assert.notEqual(prompts[0]!.pid, prompts[1]!.pid);
      assert.equal(prompts[1]!.command!.message, LIVE_CONTINUATION_PROMPT);
      assert.equal(prompts[1]!.command!.message!.split(RESTART_AFTER_WORK_NOTE).length - 1, 0);
      assert.equal(result.progress.restartAfterWorkCount, 0);
      assert.ok(result.attempts.every((entry) => !entry.restartAfterWork));
    }, { maxOutputBytes: 9000 });
  });
}

for (const behavior of ["provider", "tools-provider", "recover-provider"]) {
  test(`live switch partial at step 4 fresh-retries the same target after ${behavior}`, async () => {
    await check({ behaviors: [behavior, "complete"], controlFault: "partial", faultStep: 4, descendant: true }, (result, trace, status) => {
      assert.equal(result.state, "completed");
      assert.deepEqual(result.attempts.map(({ route, state }) => ({ route, state })), [
        { route: `${routes[0]}:${levels[0]}`, state: "provider_failed" },
        { route: `${routes[1]}:${levels[1]}`, state: "completed" },
      ]);
      assert.equal(result.selectedRoute, `${routes[1]}:${levels[1]}`);
      assert.deepEqual(status.map((entry) => entry.state), ["provider_failed", "completed"]);
      assert.deepEqual(status.map((entry) => entry.liveReused), [false, false]);
      assert.ok(status.every((entry) => entry.streamErrors.length === 0));
      const starts = trace.filter((entry) => entry.kind === "start");
      assert.deepEqual(starts.map((entry) => entry.route), routes.slice(0, 2));
      assert.notEqual(starts[0]!.pid, starts[1]!.pid);
      const controls = trace.filter((entry) => entry.kind === "control");
      assert.deepEqual(controls.map((entry) => entry.command!.type), ["get_state", "set_model", "set_thinking_level", "get_state"]);
      assert.deepEqual(controls.map((entry) => entry.command!.id), ["route-2:switch-1", "route-2:switch-2", "route-2:switch-3", "route-2:switch-4"]);
      assert.ok(controls.every((entry) => entry.pid === starts[0]!.pid));
      const priorExit = trace.findIndex((entry) => entry.kind === "exit" && entry.pid === starts[0]!.pid);
      assert.ok(trace.indexOf(controls[3]!) < priorExit && priorExit < trace.indexOf(starts[1]!), "cleanup follows the final control and precedes fresh B");
      const prompts = trace.filter((entry) => entry.kind === "prompt");
      const original = prompts[0]!.command!.message!;
      const fresh = prompts.at(-1)!;
      assert.equal(fresh.pid, starts[1]!.pid);
      assert.equal(fresh.route, routes[1]);
      assert.equal(fresh.command!.id, "prompt-1");
      assert.ok(prompts.every((entry) => !entry.command!.id.startsWith("route-")), "the retained child receives no fallback prompt");
      assert.match(original, /Complete the one assigned increment/);
      assert.equal(fresh.command!.message, LIVE_CONTINUATION_PROMPT);
      assert.equal(result.progress.restartAfterWorkCount, 0);
      assert.deepEqual(result.attempts.map((entry) => Boolean(entry.restartAfterWork)), [false, false]);
      assert.doesNotMatch(JSON.stringify(status), /CONTROL-PRIVATE-SENTINEL|PROVIDER-PRIVATE-SENTINEL|TOOL-PRIVATE-SENTINEL/);
    });
  });
}

test("idle activity during a catalog timeout terminates the retained group before another route", async () => {
  await check({ behaviors: ["tools-provider"], catalogDelayRoute: 1, idleFault: true, descendant: true }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts[1]!.state, "timed_out");
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 2);
    assert.equal(trace.filter((entry) => entry.kind === "control").length, 0);
    assert.ok(status.every((entry) => !entry.liveReused));
    assert.equal(result.progress.restartAfterWorkCount, 0);
  }, { catalogTimeoutMs: 300 });
});

test("live reuse preserves resource arguments and verifies resources only before fresh spawns", async () => {
  for (const controlFault of [undefined, "reject"]) {
    let catalogs = 0;
    let executions = 0;
    await check({ behaviors: ["provider", "complete"], controlFault }, (result, trace) => {
      assert.equal(result.state, "completed");
      assert.equal(catalogs, 2);
      assert.equal(executions, controlFault === undefined ? 2 : 4, "preparation and final spawn checks never run for retained reuse");
      assert.equal(trace.filter((entry) => entry.kind === "start").length, executions / 2);
    }, { resourceSelection: {
      catalogArgs: Object.freeze(["--no-extensions"]), runtimeArgs: Object.freeze(["--no-extensions", "--no-skills"]),
      verifyCatalogSpawn() { catalogs += 1; }, verifyRuntimeSpawn() { executions += 1; },
    } });
  }
});

for (const [behavior, expected] of [
  ["stalled", "stalled"], ["output", "output_limit"], ["invalid-stream", "invalid_stream"],
  ["exit", "child_failed"], ["active-provider", "provider_failed"],
] as const) {
  test(`${behavior} never retains a child`, async () => {
    await check({ behaviors: [behavior, "complete"] }, (result, trace, status) => {
      assert.equal(result.state, "completed");
      assert.equal(status[0]!.state, expected);
      assert.equal(trace.filter((entry) => entry.kind === "control").length, 0);
      assert.equal(trace.filter((entry) => entry.kind === "start").length, 2);
      assert.ok(status.every((entry) => !entry.liveReused));
    }, { maxOutputBytes: 9000 });
  });
}

test("live output accounting includes controls and resets the per-route limit", async () => {
  // Leave room for the expanded child policy within each route's byte limit.
  await check({ behaviors: ["provider", "complete"], padding: 3500 }, async (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    const accounted = status.reduce((sum, entry) => sum + entry.outputBytes, 0);
    const wireBytes = trace.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
    const stderrBytes = (await Promise.all(status.map(async (entry) => (await readFile(entry.stderrPath)).byteLength)))
      .reduce((sum, bytes) => sum + bytes, 0);
    assert.equal(accounted, wireBytes + stderrBytes, "every prompt, response, event, control, and stderr byte is counted exactly once");
    assert.ok(status.every((entry) => entry.outputBytes <= 9000));
    assert.ok(accounted > 9000, "a later route receives its own output limit");
  }, { maxOutputBytes: 9000 });
});

test("a persisted replacement after multiple live routes does not mark a context-free restart", async () => {
  await check({ behaviors: ["tools-provider", "provider", "complete"], controlFault: "reject", faultStep: 5, descendant: true }, (result, trace, status) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(status.map((entry) => entry.liveReused), [false, true, false]);
    assert.deepEqual(result.attempts.map((entry) => Boolean(entry.restartAfterWork)), [false, false, false]);
    assert.equal(result.progress.restartAfterWorkCount, 0);
    const prompts = trace.filter((entry) => entry.kind === "prompt");
    assert.equal(prompts[1]!.command!.message, LIVE_CONTINUATION_PROMPT);
    assert.equal(prompts[2]!.command!.message, LIVE_CONTINUATION_PROMPT);
  });
});

test("exhausted catalogs clean up the retained leader and descendant without restarting", async () => {
  await check({ behaviors: ["tools-provider"], catalog: [routes[0]!], descendant: true }, (result, trace) => {
    assert.equal(result.state, "routes_unavailable");
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    assert.equal(trace.filter((entry) => entry.kind === "control").length, 0);
    assert.equal(result.progress.restartAfterWorkCount, 0);
    assert.equal(result.report, "");
  });
});

async function waitForTrace(f: Awaited<ReturnType<typeof fixture>>, matches: (entry: Trace) => boolean) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    let trace: Trace[] = [];
    try { trace = await f.trace(); } catch {}
    if (trace.some(matches)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("fixture did not reach the expected boundary");
}

for (const boundary of ["catalog", "control", "continuation"] as const) {
  test(`cancellation during retained ${boundary} removes every child and never restarts`, async () => {
    const controller = new AbortController();
    const f = await fixture({
      behaviors: ["tools-provider", "stalled"], descendant: true,
      ...(boundary === "catalog" ? { catalogDelayRoute: 1 } : {}),
      ...(boundary === "control" ? { controlFault: "timeout" } : {}),
    });
    const running = runDelegate({ ...f.options, signal: controller.signal, liveSwitchTimeoutMs: 1000 });
    let result: DelegateRunResult | undefined;
    try {
      await waitForTrace(f, (entry) => {
        if (boundary === "catalog") return entry.kind === "catalog" && entry.route === routes[1];
        if (boundary === "control") return entry.kind === "control";
        return entry.command?.id === "route-2:prompt-1";
      });
      controller.abort("PRIVATE-CANCEL-SENTINEL");
      result = await running;
      assert.equal(result.state, "interrupted");
      const starts = (await f.trace()).filter((entry) => entry.kind === "start");
      assert.equal(starts.length, 1);
      assert.ok(gone(starts[0]!.pid));
      assert.ok(gone(starts[0]!.descendant!));
      assert.equal(result.progress.restartAfterWorkCount, 0);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE-CANCEL-SENTINEL/);
    } finally {
      controller.abort();
      result ??= await running;
      await rm(result.artifactDir, { recursive: true, force: true });
    }
  });
}

for (const boundary of ["catalog", "continuation"] as const) {
  test(`a callback exception at retained ${boundary} cleans up before rethrowing`, async () => {
    const f = await fixture({ behaviors: ["provider", "stalled"], descendant: true });
    const error = new Error("caller-owned failure");
    await assert.rejects(runDelegate({ ...f.options, onProgress(progress: DelegateProgress) {
      if (progress.attempt === 2 && (boundary === "catalog" ? progress.state === "catalog_check" : progress.state === "running")) throw error;
    } }), (caught) => caught === error);
    const starts = (await f.trace()).filter((entry) => entry.kind === "start");
    assert.equal(starts.length, 1);
    assert.ok(gone(starts[0]!.pid));
    assert.ok(gone(starts[0]!.descendant!));
    assert.ok(!(await readdir(root)).some((name) => name.startsWith("delegated-pi-")), "throw paths remove private artifacts");
  });
}

test("a catalog resource-verification exception cleans up the retained process and descendant", async () => {
  const f = await fixture({ behaviors: ["provider"], descendant: true });
  const error = new Error("resource verification failed");
  let catalogs = 0;
  await assert.rejects(runDelegate({ ...f.options, resourceSelection: {
    ...f.options.resourceSelection!, verifyCatalogSpawn() { if (++catalogs === 2) throw error; },
  } }), (caught) => caught === error);
  const starts = (await f.trace()).filter((entry) => entry.kind === "start");
  assert.equal(starts.length, 1);
  assert.ok(gone(starts[0]!.pid));
  assert.ok(gone(starts[0]!.descendant!));
});

for (const target of ["execution", "catalog"] as const) {
  test(`${target} cleanup uncertainty is terminal and removes the retained child`, async () => {
    const original = terminationProbes.build;
    let executionSeen = false;
    terminationProbes.build = (child) => {
      const probes = original(child);
      const catalog = child.spawnargs.includes("--list-models");
      if (!catalog) executionSeen = true;
      const shouldFail = target === "execution" ? !catalog : catalog && child.spawnargs.includes(routes[1]!);
      if (!shouldFail) return probes;
      let now = performance.now();
      return { ...probes, now: () => now, groupExists: () => true,
        delay: async (ms) => { now += ms; await new Promise<void>((resolve) => setTimeout(resolve, 5)); } };
    };
    try {
      await check({ behaviors: ["provider", "complete"], controlFault: "reject" }, (result, trace) => {
        assert.equal(result.state, "cleanup_failed");
        assert.equal(result.cleanupFailureReason, "group_alive");
        assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
        assert.ok(executionSeen);
      });
    } finally {
      terminationProbes.build = original;
    }
  });
}
