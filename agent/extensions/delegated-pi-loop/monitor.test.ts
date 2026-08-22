import assert from "node:assert/strict";
import test from "node:test";
import { machineErrorEnvelope, parseDelegateOutcome, PiRpcMonitor } from "./monitor.ts";

type Round = 1 | 2;

function monitor(): { monitor: PiRpcMonitor; tick: () => void } {
  let monotonic = 1000;
  let wall = 0;
  const instance = new PiRpcMonitor(
    monotonic,
    "2026-01-01T00:00:00.000Z",
    () => monotonic,
    () => `2026-01-01T00:00:${String(wall++).padStart(2, "0")}.000Z`,
  );
  return { monitor: instance, tick: () => { monotonic += 100; } };
}

function consume(instance: PiRpcMonitor, round: Round, event: Record<string, unknown>): void {
  instance.consumeEvent(round, event);
}

function assistant(text: string, stopReason = "stop"): Record<string, unknown> {
  return {
    type: "message_end",
    message: { role: "assistant", stopReason, content: [{ type: "text", text }] },
  };
}

function settle(instance: PiRpcMonitor, round: Round, report?: string): void {
  consume(instance, round, { type: "agent_start" });
  if (report !== undefined) consume(instance, round, assistant(report));
  consume(instance, round, { type: "agent_end", willRetry: false });
  consume(instance, round, { type: "agent_settled" });
}

test("records sanitized last event, tool name, and receipt time", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  tick();
  consume(instance, 1, { type: "agent_start" });
  tick();
  consume(instance, 1, {
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "read",
    args: { path: "PRIVATE_PATH" },
  });
  const snapshot = instance.snapshot();
  assert.equal(snapshot.lastEvent, "tool_execution_start");
  assert.equal(snapshot.lastEventDetail, "read");
  assert.equal(snapshot.toolExecutionCount, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_PATH/);
});

test("accepts exactly one terminal marker at the final line", () => {
  assert.equal(parseDelegateOutcome("Done\n\nDELEGATE_RESULT: COMPLETED"), "completed");
  assert.equal(parseDelegateOutcome("DELEGATE_RESULT: COMPLETED\nmore"), undefined);
  assert.equal(parseDelegateOutcome("DELEGATE_RESULT: COMPLETED\nDELEGATE_RESULT: COMPLETED"), undefined);
});

test("empty deltas do not reset activity", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  const before = instance.snapshot();
  tick();
  consume(instance, 1, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "" } });
  assert.equal(instance.snapshot().lastActivityMonotonic, before.lastActivityMonotonic);
});

test("tracks retry lifecycle and provisional completed result through settlement", () => {
  const { monitor: instance } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "agent_end", willRetry: true });
  consume(instance, 1, { type: "auto_retry_start", errorMessage: "retry" });
  consume(instance, 1, { type: "auto_retry_end", success: true });
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, assistant("Done\n\nDELEGATE_RESULT: COMPLETED"));
  assert.equal(instance.classifyRound(1), "running");
  consume(instance, 1, { type: "agent_end", willRetry: false });
  assert.equal(instance.classifyRound(1), "running");
  consume(instance, 1, { type: "agent_settled" });
  assert.equal(instance.classifyRound(1), "completed");
  assert.equal(instance.snapshot().agentStartCount, 2);
});

test("BLOCKED and FAILED become terminal immediately", () => {
  for (const [marker, expected] of [["BLOCKED", "blocked"], ["FAILED", "delegate_failed"]] as const) {
    const { monitor: instance } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, assistant(`Stopped\n\nDELEGATE_RESULT: ${marker}`));
    assert.equal(instance.classifyRound(1), expected);
  }
});

test("allows one second report round only after clean missing or invalid settlement", () => {
  for (const firstReport of [undefined, "report without marker", "DELEGATE_RESULT: COMPLETED\nDELEGATE_RESULT: COMPLETED"]) {
    const { monitor: instance } = monitor();
    instance.acceptPrompt(1);
    settle(instance, 1, firstReport);
    const expected = firstReport === undefined ? "missing_report" : "invalid_result";
    assert.equal(instance.classifyRound(1), expected);
    instance.acceptPrompt(2);
    settle(instance, 2, "Recovered\n\nDELEGATE_RESULT: COMPLETED");
    assert.equal(instance.classifyRound(2), "completed");
    assert.equal(instance.finalReport(), "Recovered\n\nDELEGATE_RESULT: COMPLETED");
    assert.equal(instance.snapshot().reportRound, 2);
    assert.equal(instance.snapshot().agentStartCount, 2);
  }
});

test("cumulative tool and lifecycle counts span both report rounds", () => {
  const { monitor: instance } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "tool_execution_start", toolName: "read" });
  consume(instance, 1, assistant("invalid"));
  consume(instance, 1, { type: "agent_end", willRetry: false });
  consume(instance, 1, { type: "agent_settled" });
  instance.acceptPrompt(2);
  consume(instance, 2, { type: "agent_start" });
  consume(instance, 2, { type: "tool_execution_start", toolName: "bash" });
  consume(instance, 2, assistant("done\n\nDELEGATE_RESULT: COMPLETED"));
  consume(instance, 2, { type: "agent_end", willRetry: false });
  consume(instance, 2, { type: "agent_settled" });
  const snapshot = instance.snapshot();
  assert.equal(snapshot.toolExecutionCount, 2);
  assert.equal(snapshot.agentStartCount, 2);
  assert.equal(snapshot.agentEndCount, 2);
});

test("missing and invalid results remain terminal after round two", () => {
  const missing = monitor().monitor;
  missing.acceptPrompt(1);
  settle(missing, 1);
  missing.acceptPrompt(2);
  settle(missing, 2);
  assert.equal(missing.classifyRound(2), "missing_report");

  const invalid = monitor().monitor;
  invalid.acceptPrompt(1);
  settle(invalid, 1, "bad");
  invalid.acceptPrompt(2);
  settle(invalid, 2, "still bad");
  assert.equal(invalid.classifyRound(2), "invalid_result");
});

test("rejects an unexpected second agent start before recovery acceptance", () => {
  const { monitor: instance } = monitor();
  instance.acceptPrompt(1);
  settle(instance, 1);
  consume(instance, 1, { type: "agent_start" });
  assert.equal(instance.classifyRound(1), "invalid_stream");
});

test("typed provider errors classify before missing reports without retaining text", () => {
  const { monitor: instance } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "message_update", assistantMessageEvent: { type: "error" } });
  consume(instance, 1, { type: "agent_end", willRetry: false });
  consume(instance, 1, { type: "agent_settled" });
  assert.equal(instance.classifyRound(1), "provider_failed");
  assert.equal(instance.snapshot().providerFailureCategory, "provider_unavailable");
});

test("credit and quota exhaustion get bounded categories and never become missing_report", () => {
  for (const [text, category] of [
    ["credit balance depleted: PRIVATE_BALANCE", "credits_exhausted"],
    ["insufficient_quota for PRIVATE_ACCOUNT", "quota_exhausted"],
  ] as const) {
    const { monitor: instance } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, { type: "message_update", assistantMessageEvent: { type: "error", errorMessage: text } });
    consume(instance, 1, { type: "agent_end", willRetry: false });
    consume(instance, 1, { type: "agent_settled" });
    assert.equal(instance.classifyRound(1), "provider_failed");
    assert.equal(instance.snapshot().providerFailureCategory, category);
    assert.doesNotMatch(JSON.stringify(instance.snapshot()), /PRIVATE|BALANCE|ACCOUNT/);
  }
});

test("a later valid result supersedes transient provider evidence", () => {
  const { monitor: instance } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "message_update", assistantMessageEvent: { type: "error", errorMessage: "503 unavailable" } });
  consume(instance, 1, { type: "agent_end", willRetry: true });
  consume(instance, 1, { type: "auto_retry_end", success: true });
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, assistant("Done\n\nDELEGATE_RESULT: COMPLETED"));
  consume(instance, 1, { type: "agent_end", willRetry: false });
  consume(instance, 1, { type: "agent_settled" });
  assert.equal(instance.classifyRound(1), "completed");
});

test("recognizes only single-line machine error envelopes", () => {
  assert.equal(machineErrorEnvelope("[error] Service temporarily unavailable"), true);
  assert.equal(machineErrorEnvelope("[error] Service temporarily unavailable\n\nDetails"), false);
  assert.equal(machineErrorEnvelope("Report mentions service temporarily unavailable"), false);
});
