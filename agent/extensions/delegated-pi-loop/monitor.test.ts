import assert from "node:assert/strict";
import test from "node:test";
import { machineErrorEnvelope, parseDelegateOutcome, parseDelegateTerminal, PiRpcMonitor } from "./monitor.ts";

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

test("parses accepted reason codes for BLOCKED and FAILED terminals", () => {
  const cases = [
    ["BLOCKED", "evidence_inaccessible"],
    ["BLOCKED", "user_decision_required"],
    ["BLOCKED", "assignment_conflict"],
    ["BLOCKED", "policy_restriction"],
    ["BLOCKED", "budget_exhausted"],
    ["BLOCKED", "external_dependency"],
    ["BLOCKED", "finding_reported"],
    ["FAILED", "execution_failure"],
    ["FAILED", "verification_failure"],
    ["FAILED", "internal_inconsistency"],
    ["FAILED", "policy_violation"],
  ] as const;
  for (const [marker, code] of cases) {
    const terminal = parseDelegateTerminal(`Stopped.\n\nDELEGATE_REASON: ${code}\nDELEGATE_RESULT: ${marker}`);
    assert.equal(terminal.outcome, marker.toLowerCase(), code);
    assert.deepEqual(terminal.reason, { status: "accepted", code }, code);
  }
});

test("legacy BLOCKED and FAILED without a reason line stay terminal with reason missing", () => {
  for (const [marker, outcome] of [["BLOCKED", "blocked"], ["FAILED", "failed"]] as const) {
    const terminal = parseDelegateTerminal(`Stopped.\n\nDELEGATE_RESULT: ${marker}`);
    assert.equal(terminal.outcome, outcome);
    assert.deepEqual(terminal.reason, { status: "missing" });
  }
});

test("unknown, malformed, path-like, credential-like, overlong, and Unicode reason values are discarded", () => {
  const rejectedValues = [
    "not_a_code",
    "budget exhausted",
    "/home/gc/PRIVATE_PATH",
    "sk-PRIVATE-KEY-9f2a",
    `${"a".repeat(200)}`,
    "réason",
    "Budget_Exhausted",
    "budget_exhausted extra",
    "",
  ];
  for (const value of rejectedValues) {
    const terminal = parseDelegateTerminal(`Stopped.\n\nDELEGATE_REASON: ${value}\nDELEGATE_RESULT: BLOCKED`);
    assert.equal(terminal.outcome, "blocked", value);
    assert.deepEqual(terminal.reason, { status: "rejected" }, value);
  }
});

test("outcome-mismatched, duplicate, and misplaced reason lines are discarded", () => {
  // FAILED-only code paired with BLOCKED and the reverse.
  assert.deepEqual(
    parseDelegateTerminal("Stopped.\n\nDELEGATE_REASON: execution_failure\nDELEGATE_RESULT: BLOCKED").reason,
    { status: "rejected" },
  );
  assert.deepEqual(
    parseDelegateTerminal("Stopped.\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: FAILED").reason,
    { status: "rejected" },
  );
  // Duplicate reason lines, one above the marker and one in the body.
  assert.deepEqual(
    parseDelegateTerminal(
      "DELEGATE_REASON: budget_exhausted\n\nStopped.\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: BLOCKED",
    ).reason,
    { status: "rejected" },
  );
  // Misplaced: a reason line exists but not directly above the marker.
  assert.deepEqual(
    parseDelegateTerminal("DELEGATE_REASON: budget_exhausted\n\nStopped.\n\nDELEGATE_RESULT: BLOCKED").reason,
    { status: "rejected" },
  );
});

test("a reason line paired with COMPLETED invalidates the terminal structure", () => {
  assert.equal(
    parseDelegateOutcome("Done.\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: COMPLETED"),
    undefined,
  );
  assert.equal(
    parseDelegateTerminal("DELEGATE_REASON: budget_exhausted\n\nDone.\n\nDELEGATE_RESULT: COMPLETED").outcome,
    undefined,
  );
  const plain = parseDelegateTerminal("Done.\n\nDELEGATE_RESULT: COMPLETED");
  assert.equal(plain.outcome, "completed");
  assert.equal(plain.reason, undefined);
});

test("empty deltas and unchanged queue heartbeats do not reset activity", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  for (const type of ["thinking_delta", "text_delta", "toolcall_delta"]) {
    const before = instance.snapshot().lastActivityMonotonic;
    tick();
    consume(instance, 1, { type: "message_update", assistantMessageEvent: { type, delta: "" } });
    assert.equal(instance.snapshot().lastActivityMonotonic, before, type);
  }
  let before = instance.snapshot().lastActivityMonotonic;
  tick();
  consume(instance, 1, { type: "bash_execution_update", delta: "" });
  assert.equal(instance.snapshot().lastActivityMonotonic, before);

  consume(instance, 1, { type: "queue_update", steering: [], followUp: [] });
  before = instance.snapshot().lastActivityMonotonic;
  tick();
  consume(instance, 1, { type: "queue_update", steering: [], followUp: [] });
  assert.equal(instance.snapshot().lastActivityMonotonic, before);

  tick();
  consume(instance, 1, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "live" } });
  assert.ok(instance.snapshot().lastActivityMonotonic > before);
});

test("meaningful lifecycle and nonempty delta events reset idle age", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  const events = [
    { type: "turn_start" },
    { type: "message_start" },
    { type: "message_update", assistantMessageEvent: { type: "thinking_start" } },
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } },
    { type: "message_update", assistantMessageEvent: { type: "thinking_end" } },
    { type: "message_update", assistantMessageEvent: { type: "text_start" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } },
    { type: "message_update", assistantMessageEvent: { type: "text_end" } },
    { type: "message_update", assistantMessageEvent: { type: "toolcall_start" } },
    { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: "{}" } },
    { type: "message_update", assistantMessageEvent: { type: "toolcall_end" } },
  ];
  for (const event of events) {
    const before = instance.snapshot().lastActivityMonotonic;
    tick();
    consume(instance, 1, event);
    assert.ok(instance.snapshot().lastActivityMonotonic > before, JSON.stringify(event));
  }
});

test("tracks multiple active tools by call id with bounded safe metadata", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "a", toolName: `${"x".repeat(100)}` });
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "b", toolName: "bash" });
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolCallId: "a", toolName: `${"x".repeat(100)}` });
  let snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolCount, 2);
  assert.equal(snapshot.activeToolName, "bash");
  assert.equal(snapshot.activeToolElapsedSeconds, 0.1);
  assert.equal(snapshot.lastEvent, "tool_execution_update");
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "b", toolName: "bash" });
  snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolCount, 1);
  assert.equal(snapshot.activeToolName?.length, 80);
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "a", toolName: `${"x".repeat(100)}` });
  assert.equal(instance.snapshot().activeToolCount, 0);
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

test("snapshots carry the typed reason, status, and misuse flag without raw reason text", () => {
  // Accepted finding_reported on BLOCKED sets the misuse flag from the outcome.
  const misuse = monitor().monitor;
  misuse.acceptPrompt(1);
  consume(misuse, 1, { type: "agent_start" });
  consume(misuse, 1, assistant("Reported a finding.\n\nDELEGATE_REASON: finding_reported\nDELEGATE_RESULT: BLOCKED"));
  let snapshot = misuse.snapshot();
  assert.equal(snapshot.outcome, "blocked");
  assert.equal(snapshot.terminalReason, "finding_reported");
  assert.equal(snapshot.reasonStatus, "accepted");
  assert.equal(snapshot.blockedMisuseSuspected, true);
  assert.equal(misuse.classifyRound(1), "blocked");

  // Any other accepted BLOCKED code keeps the flag off; the role is irrelevant.
  const plain = monitor().monitor;
  plain.acceptPrompt(1);
  consume(plain, 1, { type: "agent_start" });
  consume(plain, 1, assistant("Stopped.\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: BLOCKED"));
  snapshot = plain.snapshot();
  assert.equal(snapshot.terminalReason, "budget_exhausted");
  assert.equal(snapshot.reasonStatus, "accepted");
  assert.equal(snapshot.blockedMisuseSuspected, false);

  // A bare legacy BLOCKED stays terminal with unspecified and missing.
  const legacy = monitor().monitor;
  legacy.acceptPrompt(1);
  consume(legacy, 1, { type: "agent_start" });
  consume(legacy, 1, assistant("Stopped.\n\nDELEGATE_RESULT: BLOCKED"));
  snapshot = legacy.snapshot();
  assert.equal(snapshot.terminalReason, "unspecified");
  assert.equal(snapshot.reasonStatus, "missing");
  assert.equal(snapshot.blockedMisuseSuspected, undefined);
  assert.equal(legacy.classifyRound(1), "blocked");

  // A rejected reason value exposes only unspecified plus rejected, and the
  // raw value never reaches the snapshot.
  const rejected = monitor().monitor;
  rejected.acceptPrompt(1);
  consume(rejected, 1, { type: "agent_start" });
  consume(
    rejected,
    1,
    assistant("Stopped.\n\nDELEGATE_REASON: /home/gc/SECRET-PATH/sk-RAWTOKEN99\nDELEGATE_RESULT: FAILED"),
  );
  snapshot = rejected.snapshot();
  assert.equal(snapshot.outcome, "failed");
  assert.equal(snapshot.terminalReason, "unspecified");
  assert.equal(snapshot.reasonStatus, "rejected");
  assert.equal(snapshot.blockedMisuseSuspected, undefined);
  // finalReport is the in-memory report by design; every other snapshot
  // field stays free of the raw delegate-authored reason value.
  const { finalReport: _finalReport, ...snapshotWithoutReport } = snapshot;
  assert.doesNotMatch(JSON.stringify(snapshotWithoutReport), /SECRET|RAWTOKEN/);
  assert.equal(rejected.classifyRound(1), "delegate_failed");

  // COMPLETED carries no reason fields at all.
  const completed = monitor().monitor;
  completed.acceptPrompt(1);
  settle(completed, 1, "Done.\n\nDELEGATE_RESULT: COMPLETED");
  snapshot = completed.snapshot();
  assert.equal(snapshot.outcome, "completed");
  assert.equal(snapshot.terminalReason, undefined);
  assert.equal(snapshot.reasonStatus, undefined);
  assert.equal(snapshot.blockedMisuseSuspected, undefined);
});
