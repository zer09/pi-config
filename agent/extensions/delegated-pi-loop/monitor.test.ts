import assert from "node:assert/strict";
import test from "node:test";
import { machineErrorEnvelope, parseDelegateOutcome, PiJsonMonitor } from "./monitor.ts";

function monitor(): { monitor: PiJsonMonitor; tick: () => void } {
  let monotonic = 1000;
  let wall = 0;
  const instance = new PiJsonMonitor(
    monotonic,
    "2026-01-01T00:00:00.000Z",
    () => monotonic,
    () => `2026-01-01T00:00:0${wall++}.000Z`,
  );
  return {
    monitor: instance,
    tick: () => { monotonic += 100; },
  };
}

function consume(instance: PiJsonMonitor, event: unknown): void {
  instance.consumeLine(JSON.stringify(event));
}

test("records sanitized last event, tool name, and receipt time", () => {
  const { monitor: instance, tick } = monitor();
  consume(instance, { type: "session", version: 3, id: "test" });
  tick();
  consume(instance, { type: "agent_start" });
  tick();
  consume(instance, {
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "read",
    args: { path: "PRIVATE_PATH" },
  });

  const snapshot = instance.snapshot();
  assert.equal(snapshot.lastEvent, "tool_execution_start");
  assert.equal(snapshot.lastEventDetail, "read");
  assert.equal(snapshot.lastEventAt, "2026-01-01T00:00:02.000Z");
  assert.equal(snapshot.toolExecutionCount, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_PATH/);
});

test("accepts completed report only at the final non-whitespace line", () => {
  assert.equal(parseDelegateOutcome("Done\n\nDELEGATE_RESULT: COMPLETED"), "completed");
  assert.equal(parseDelegateOutcome("DELEGATE_RESULT: COMPLETED\nmore"), undefined);
  assert.equal(parseDelegateOutcome("DELEGATE_RESULT: COMPLETED\nDELEGATE_RESULT: COMPLETED"), undefined);
});

test("empty deltas do not reset activity", () => {
  const { monitor: instance, tick } = monitor();
  consume(instance, { type: "session" });
  tick();
  consume(instance, { type: "agent_start" });
  const before = instance.snapshot();
  tick();
  consume(instance, {
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "" },
  });
  const after = instance.snapshot();
  assert.equal(after.lastEvent, "agent_start");
  assert.equal(after.lastActivityMonotonic, before.lastActivityMonotonic);
});

test("tracks retry lifecycle and final settled completion", () => {
  const { monitor: instance } = monitor();
  const events = [
    { type: "session" },
    { type: "agent_start" },
    { type: "agent_end", willRetry: true },
    { type: "auto_retry_start", errorMessage: "retry" },
    { type: "auto_retry_end", success: true },
    { type: "agent_start" },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "Done\n\nDELEGATE_RESULT: COMPLETED" }],
      },
    },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  for (const event of events) consume(instance, event);
  const snapshot = instance.snapshot();
  assert.equal(snapshot.outcome, "completed");
  assert.equal(snapshot.agentStartCount, 2);
  assert.equal(snapshot.agentEndCount, 2);
  assert.equal(snapshot.agentSettledSeen, true);
});

test("recognizes only single-line machine error envelopes", () => {
  assert.equal(machineErrorEnvelope("[error] Service temporarily unavailable"), true);
  assert.equal(machineErrorEnvelope("[error] Service temporarily unavailable\n\nDetails"), false);
  assert.equal(machineErrorEnvelope("Report mentions service temporarily unavailable"), false);
});

test("typed scanner errors set route unavailable without retaining text", () => {
  const { monitor: instance } = monitor();
  consume(instance, { type: "session" });
  consume(instance, { type: "agent_start" });
  consume(instance, {
    type: "message_update",
    assistantMessageEvent: { type: "error", errorMessage: "scanner_error: unexpected EOF" },
  });
  const snapshot = instance.snapshot();
  assert.equal(snapshot.routeUnavailableSeen, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /scanner_error|unexpected EOF/);
});
