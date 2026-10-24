import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { failureDiagnostic } from "./diagnostics.ts";
import { PiRpcMonitor } from "./monitor.ts";
import { loadTargetSessionManager } from "./pi-session-projection.fixture.ts";

// These tests must use the selected installation, never a local or live fallback.
const root = process.env.PI_SESSION_PROJECTION_PACKAGE_ROOT;
assert.ok(root && path.isAbsolute(root), "select an isolated exact Pi 1.4.0 package");
await loadTargetSessionManager(root);
const require = createRequire(path.join(root, "package.json"));
for (const name of ["pi-agent-core", "pi-ai", "pi-tui"]) {
  const manifest = JSON.parse(readFileSync(path.join(root, "..", name, "package.json"), "utf8"));
  assert.equal(manifest.name, `@earendil-works/${name}`);
  assert.equal(manifest.version, "1.4.0");
}
const pi: typeof import("@earendil-works/pi-coding-agent") = await import(pathToFileURL(path.join(root, "dist/index.js")).href);
const ai: typeof import("@earendil-works/pi-ai") = await import(pathToFileURL(path.join(root, "../pi-ai/dist/index.js")).href);
const { Type }: typeof import("typebox") = await import(pathToFileURL(require.resolve("typebox")).href);
const { runAgentLoop } = await import(pathToFileURL(path.join(root, "../pi-agent-core/dist/agent-loop.js")).href);
const { toJsonEvent } = await import(pathToFileURL(path.join(root, "dist/modes/json-event.js")).href);
const completed = "Done.\nDELEGATE_RESULT: COMPLETED";
const privateMarker = "MALFORMED_ARGUMENT_FIXTURE_PRIVATE";

function call(id: string, raw: string): ToolCall {
  return { type: "toolCall", id, name: "write", ...ai.parseToolCallArguments(raw) };
}

async function fixture(t: TestContext, responses: AssistantMessage[], toolFails = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "delegate-target-"));
  const settingsManager = pi.SettingsManager.inMemory({
    cacheWarming: "off", enableInstallTelemetry: false, enableAnalytics: false,
    retry: { enabled: false }, compaction: { enabled: false }, defaultProjectTrust: "never",
  });
  const faux = ai.fauxProvider({ provider: "delegated-offline", tokensPerSecond: 0 });
  faux.setResponses(responses);
  const modelRuntime = await pi.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: directory, agentDir: directory, settingsManager, noExtensions: true,
    noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true,
  });
  await resourceLoader.reload();
  let mutations = 0;
  const values: unknown[] = [];
  const { session } = await pi.createAgentSession({
    cwd: directory, agentDir: directory, settingsManager, resourceLoader, modelRuntime,
    sessionManager: pi.SessionManager.inMemory(), model: faux.getModel(), thinkingLevel: "off",
    tools: ["write"], customTools: [{
      name: "write", label: "fixture write", description: "Record a fake mutation",
      parameters: Type.Object({ value: Type.String() }),
      async execute(_id, args) {
        mutations += 1;
        values.push((args as { value: unknown }).value);
        if (toolFails) throw new Error("ordinary fixture tool error");
        return { content: [{ type: "text", text: "recorded" }], details: undefined };
      },
    }],
  });
  t.after(async () => {
    await session.abort();
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  let now = 0;
  const monitor = new PiRpcMonitor(0, "2026-01-01T00:00:00.000Z", () => now);
  monitor.acceptPrompt(1);
  const observations: {
    event: Record<string, unknown>;
    before: ReturnType<PiRpcMonitor["snapshot"]>;
    after: ReturnType<PiRpcMonitor["snapshot"]>;
  }[] = [];
  let round: 1 | 2 = 1;
  session.subscribe((event) => {
    const wire = JSON.parse(JSON.stringify(toJsonEvent(event))) as Record<string, unknown>;
    now += 100;
    const before = monitor.snapshot();
    monitor.recordValidRpc();
    monitor.consumeEvent(round, wire);
    assert.doesNotMatch(JSON.stringify(monitor), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError|Received arguments/);
    observations.push({ event: wire, before, after: monitor.snapshot() });
  });
  await session.prompt("offline assignment");
  return {
    monitor, observations, mutations, values,
    async recoverReport() {
      round = 2;
      monitor.beginRecovery();
      monitor.acceptPrompt(2);
      faux.setResponses([ai.fauxAssistantMessage(completed)]);
      await session.prompt("Return only the terminal report");
    },
  };
}

const rejections = [
  { label: "parser-stop", raw: `{"value":"${privateMarker}"`, stopReason: "stop" },
  { label: "parser-toolUse", raw: `{"value":"${privateMarker}"`, stopReason: "toolUse" },
  { label: "parser-length", raw: `{"value":"${privateMarker}"`, stopReason: "length" },
  { label: "parseable-length", raw: `{"value":"${privateMarker}"}`, stopReason: "length" },
  { label: "schema", raw: `{"private":"${privateMarker}"}`, stopReason: "stop" },
] as const;

for (const { label, raw, stopReason } of rejections) {
  test(`target rejected final arguments (${label}) never execute or earn assignment credit`, async (t) => {
    const invalid = call("invalid", raw);
    if (label.startsWith("parser")) {
      assert.deepEqual(invalid.arguments, {});
      assert.ok(invalid.argumentsError?.includes(privateMarker));
    } else {
      assert.equal(invalid.argumentsError, undefined, "target rejection need not have a parser marker");
    }
    const f = await fixture(t, [
      ai.fauxAssistantMessage([{ type: "text", text: completed }, invalid], { stopReason }),
      ai.fauxAssistantMessage(""),
    ]);
    assert.equal(f.mutations, 0, "target validation must not run the tool");
    const start = f.observations.find(({ event }) => event.type === "tool_execution_start")!;
    const end = f.observations.find(({ event }) => event.type === "tool_execution_end")!;
    assert.ok(start && end, "target emits start and error-end even without execution");
    assert.deepEqual(start.event.args, invalid.arguments);
    assert.equal(end.event.isError, true);
    assert.equal(Object.hasOwn(end.event, "durationMs"), false);
    assert.equal(start.after.activeToolCount, 1, "starts retain active-tool telemetry");
    const firstMessage = f.observations.find(({ event }) => event.type === "message_end"
      && (event.message as AssistantMessage).role === "assistant")!;
    const firstTurn = f.observations.find(({ event }) => event.type === "turn_end")!;
    for (const observation of [firstMessage, start, end, firstTurn]) {
      assert.equal(observation.after.structuralProgressCount, observation.before.structuralProgressCount, observation.event.type as string);
      assert.equal(observation.after.outcome, undefined, "malformed arguments cannot publish a terminal claim");
      assert.equal(observation.after.finalReport, undefined, "discard text accompanying malformed arguments");
      assert.equal(observation.after.toolExecutionCount, 0, "validation is not tool execution");
      assert.ok(observation.after.lastValidRpcMonotonic > observation.before.lastValidRpcMonotonic, "protocol health remains independent");
    }
    assert.equal(f.monitor.classifyRound(1), "missing_report");
    assert.equal(f.monitor.snapshot().structuralProgressCount, 1, "an empty follow-up cannot credit a rejected-only run");
    assert.deepEqual(f.monitor.snapshot().errors, [], "malformed arguments are not protocol errors");
    assert.equal(f.monitor.snapshot().activeToolCount, 0);
    assert.doesNotMatch(JSON.stringify(f.observations.map(({ after }) => after)), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError|Received arguments/);
    assert.doesNotMatch(JSON.stringify(f.monitor), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError|Received arguments/);
    const snapshot = f.monitor.snapshot();
    const diagnostic = failureDiagnostic({
      label: "implementation", role: "implementation", state: "missing_report",
      report: f.monitor.finalReport() ?? "", artifactDir: "fixture", attempts: [],
      startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z",
      elapsedSeconds: 1, streamErrors: snapshot.errors,
      progress: {
        ...snapshot, label: "implementation", role: "implementation", state: "missing_report",
        protocol: "pi-rpc", attempt: 1, activityIdleSeconds: 0, elapsedSeconds: 1,
        restartAfterWorkCount: 0, reportNudgeCount: 0,
      },
    });
    assert.doesNotMatch(JSON.stringify(diagnostic), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError|Received arguments/);
    assert.equal(f.monitor.snapshot().agentSettledSeen, true, "real SDK settlement cannot hide provisional credit");
    await f.recoverReport();
    assert.equal(f.monitor.classifyRound(2), "completed", "reporting-only recovery remains available");
    assert.equal(f.monitor.snapshot().toolExecutionCount, 0);
    f.monitor.clearEphemeralState();
    assert.doesNotMatch(JSON.stringify(f.monitor), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError|Received arguments/);
  });
}

for (const { label, raw, stopReason, callCount } of rejections
  .filter(({ label }) => label !== "parser-toolUse" && label !== "parser-length")
  .flatMap((rejection) => [1, 65].map((callCount) => ({ ...rejection, callCount })))) {
  test(`target loop ending with ${callCount} rejected ${label} calls cannot claim completion or progress`, async () => {
    const faux = ai.createFauxCore({ provider: "final-malformed-offline", tokensPerSecond: 0 });
    faux.setResponses([ai.fauxAssistantMessage([
      { type: "text", text: completed },
      ...Array.from({ length: callCount }, (_, index) => call(`invalid-${index}`, raw)),
    ], { stopReason })]);
    let mutations = 0;
    let now = 0;
    const monitor = new PiRpcMonitor(0, "2026-01-01T00:00:00.000Z", () => now);
    monitor.acceptPrompt(1);
    const eventTypes: string[] = [];
    await runAgentLoop([{ role: "user", content: "assignment", timestamp: 0 }], {
      messages: [], tools: [{
        name: "write", label: "fixture write", description: "Record a fake mutation",
        parameters: Type.Object({ value: Type.String() }),
        async execute() {
          mutations += 1;
          return { content: [{ type: "text", text: "recorded" }], details: undefined };
        },
      }],
    }, {
      model: faux.getModel(), convertToLlm: (messages: unknown[]) => messages,
      // End at the real loop's supported turn boundary, without inventing lifecycle events.
      finishTurn: () => ({ action: "end" }),
    }, (event: Record<string, unknown>) => {
      const wire = JSON.parse(JSON.stringify(toJsonEvent(event))) as Record<string, unknown>;
      now += 100;
      const before = monitor.snapshot();
      monitor.recordValidRpc();
      monitor.consumeEvent(1, wire);
      const after = monitor.snapshot();
      assert.equal(after.structuralProgressCount, before.structuralProgressCount, wire.type as string);
      assert.equal(after.toolExecutionCount, 0, wire.type as string);
      assert.equal(after.outcome, undefined, wire.type as string);
      assert.equal(after.finalReport, undefined, wire.type as string);
      assert.doesNotMatch(JSON.stringify(after), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError|Received arguments/);
      assert.doesNotMatch(JSON.stringify(monitor), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError|Received arguments/);
      eventTypes.push(wire.type as string);
    }, undefined, faux.streamSimple);
    assert.equal(eventTypes.at(-1), "agent_end");
    assert.equal(eventTypes.filter((type) => type === "tool_execution_end").length, callCount);
    assert.equal(mutations, 0);
    assert.equal(monitor.outcome(), undefined);
    assert.equal(monitor.finalReport(), undefined);
    assert.equal(monitor.snapshot().toolExecutionCount, 0);
    assert.equal(monitor.snapshot().structuralProgressCount, 1, "only prompt acceptance is progress");
    assert.equal(monitor.snapshot().activeToolCount, 0);
    assert.deepEqual(monitor.snapshot().errors, []);
    assert.notEqual(monitor.classifyRound(1, true), "completed");
    const retained = monitor as unknown as {
      invalidToolCallIds: Set<string>;
      turnSummary: { distinct: Set<string> };
      agentSummary: { distinct: Set<string> };
    };
    assert.ok(retained.invalidToolCallIds.size <= 64);
    assert.ok(retained.turnSummary.distinct.size <= 64);
    assert.ok(retained.agentSummary.distinct.size <= 64);
    assert.doesNotMatch(JSON.stringify(monitor), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError|Received arguments/);
    monitor.clearEphemeralState();
    assert.equal(retained.invalidToolCallIds.size, 0);
    assert.equal(retained.turnSummary.distinct.size, 0);
    assert.equal(retained.agentSummary.distinct.size, 0);
  });
}

for (const { label, raw, stopReason } of rejections.filter(({ label }) => label !== "parser-toolUse" && label !== "parser-length")) {
  test(`target corrected continuation can execute and settle after ${label} rejection`, async (t) => {
    const f = await fixture(t, [
      ai.fauxAssistantMessage(call("invalid", raw), { stopReason }),
      ai.fauxAssistantMessage(call("corrected", '{"value":"corrected"}')),
      ai.fauxAssistantMessage(completed),
    ]);
    assert.equal(f.mutations, 1);
    assert.equal(f.monitor.snapshot().toolExecutionCount, 1);
    assert.equal(f.monitor.classifyRound(1), "completed");
    assert.equal(f.monitor.snapshot().agentSettledSeen, true);
    assert.deepEqual(f.monitor.snapshot().errors, []);
    const ends = f.observations.filter(({ event }) => event.type === "tool_execution_end");
    assert.equal(ends[0]!.after.structuralProgressCount, ends[0]!.before.structuralProgressCount);
    assert.ok(ends[1]!.after.structuralProgressCount > ends[1]!.before.structuralProgressCount);
    assert.doesNotMatch(JSON.stringify(f.monitor.snapshot()), /MALFORMED_ARGUMENT_FIXTURE_PRIVATE|argumentsError/);
  });
}

for (const control of ["success", "thrown-error", "coercion"]) {
  test(`target ${control} duration zero confirms execution before message/report credit`, async (t) => {
    const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
    Object.defineProperty(performance, "now", { configurable: true, value: () => 0 });
    try {
      const raw = control === "coercion" ? '{"value":1}' : '{"value":"ok"}';
      const f = await fixture(t, [ai.fauxAssistantMessage([
        { type: "text", text: completed }, call("valid", raw),
      ]), ai.fauxAssistantMessage(completed)], control === "thrown-error");
      const message = f.observations.find(({ event }) => event.type === "message_end"
        && (event.message as AssistantMessage).role === "assistant")!;
      const start = f.observations.find(({ event }) => event.type === "tool_execution_start")!;
      const end = f.observations.find(({ event }) => event.type === "tool_execution_end")!;
      const turn = f.observations.find(({ event }) => event.type === "turn_end")!;
      for (const observation of [message, start]) {
        assert.equal(observation.after.toolExecutionCount, 0);
        assert.equal(observation.after.structuralProgressCount, observation.before.structuralProgressCount);
        assert.equal(observation.after.finalReport, undefined);
        assert.equal(observation.after.outcome, undefined);
      }
      assert.equal(start.after.activeToolCount, 1);
      assert.equal(end.event.durationMs, 0);
      assert.equal(end.event.isError, control === "thrown-error");
      assert.equal(end.after.toolExecutionCount, 1);
      assert.equal(end.after.structuralProgressCount, end.before.structuralProgressCount + 1);
      assert.equal(end.after.outcome, undefined, "message credit waits until the turn closes");
      assert.equal(turn.after.outcome, "completed");
      assert.equal(turn.after.structuralProgressCount, turn.before.structuralProgressCount + 2);
      assert.equal(f.mutations, 1);
      assert.deepEqual(f.values, [control === "coercion" ? "1" : "ok"]);
      assert.equal(f.monitor.classifyRound(1), "completed");
      assert.deepEqual(f.monitor.snapshot().errors, []);
    } finally {
      if (descriptor) Object.defineProperty(performance, "now", descriptor);
      else Reflect.deleteProperty(performance, "now");
    }
  });
}

test("target ordinary tool errors still earn completed-tool novelty and allow completion", async (t) => {
  const f = await fixture(t, [ai.fauxAssistantMessage(call("ordinary", '{"value":"ok"}')), ai.fauxAssistantMessage(completed)], true);
  const end = f.observations.find(({ event }) => event.type === "tool_execution_end")!;
  assert.equal(f.mutations, 1);
  assert.equal(end.event.isError, true);
  assert.equal(end.after.structuralProgressCount, end.before.structuralProgressCount + 1);
  assert.equal(f.monitor.snapshot().toolExecutionCount, 1);
  assert.equal(f.monitor.classifyRound(1), "completed");
});

test("target canonical calls keep argument identity and ignore volatile call ids", async (t) => {
  const f = await fixture(t, [
    ai.fauxAssistantMessage(call("one", '{"value":"same"}')),
    ai.fauxAssistantMessage(call("two", '{"value":"same"}')),
    ai.fauxAssistantMessage(call("three", '{"value":"different"}')),
    ai.fauxAssistantMessage(completed),
  ]);
  const messages = f.observations.filter(({ event }) => event.type === "message_end"
    && (event.message as AssistantMessage).role === "assistant");
  for (const message of messages.slice(0, 3)) {
    assert.equal(message.after.structuralProgressCount, message.before.structuralProgressCount, "tool-bearing message credit waits for outcomes");
    assert.equal(message.after.outcome, undefined);
  }
  const turns = f.observations.filter(({ event }) => event.type === "turn_end");
  assert.equal(turns[1]!.after.structuralProgressCount, turns[1]!.before.structuralProgressCount, "same call with another id is a duplicate");
  assert.ok(turns[1]!.after.duplicateCheckpointCount > turns[1]!.before.duplicateCheckpointCount);
  assert.equal(turns[2]!.after.structuralProgressCount, turns[2]!.before.structuralProgressCount + 2, "changed canonical message and turn are novel");
  const ends = f.observations.filter(({ event }) => event.type === "tool_execution_end");
  assert.equal(ends[1]!.after.structuralProgressCount, ends[1]!.before.structuralProgressCount);
  assert.equal(ends[2]!.after.structuralProgressCount, ends[2]!.before.structuralProgressCount + 1);
  assert.equal(f.mutations, 3);
  assert.equal(f.monitor.classifyRound(1), "completed");
});

for (const { label, raw } of rejections.filter(({ stopReason }) => stopReason === "stop")) {
  test(`target valid sibling retains progress beside ${label} rejection without report credit`, async (t) => {
    const f = await fixture(t, [ai.fauxAssistantMessage([
      { type: "text", text: completed }, call("invalid", raw), call("valid", '{"value":"ok"}'),
    ]), ai.fauxAssistantMessage(completed)]);
    const ends = f.observations.filter(({ event }) => event.type === "tool_execution_end");
    assert.equal(ends[0]!.after.structuralProgressCount, ends[0]!.before.structuralProgressCount);
    assert.equal(ends[1]!.after.structuralProgressCount, ends[1]!.before.structuralProgressCount + 1);
    const firstTurn = f.observations.find(({ event }) => event.type === "turn_end")!;
    assert.equal(firstTurn.after.outcome, undefined, "a valid sibling does not validate rejected-call report text");
    assert.equal(firstTurn.after.finalReport, undefined);
    assert.equal(f.mutations, 1);
    assert.equal(f.monitor.snapshot().toolExecutionCount, 1);
    assert.equal(f.monitor.classifyRound(1), "completed");
  });
}
