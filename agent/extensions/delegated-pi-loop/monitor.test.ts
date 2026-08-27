import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  boundedDigest,
  DIGEST_STRING_CHUNK_UNITS,
  machineErrorEnvelope,
  parseDelegateOutcome,
  parseDelegateTerminal,
  PiRpcMonitor,
} from "./monitor.ts";

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

test("entry_appended is RPC-only: repetition never renews activity, structure, phase, or detail", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  tick();
  consume(instance, 1, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "live" } });
  consume(instance, 1, { type: "agent_end", willRetry: false });
  consume(instance, 1, { type: "agent_settled" });
  assert.equal(instance.classifyRound(1), "missing_report");
  const fields = (snapshot: ReturnType<PiRpcMonitor["snapshot"]>) => ({
    lastEvent: snapshot.lastEvent,
    lastEventDetail: snapshot.lastEventDetail,
    lastEventAt: snapshot.lastEventAt,
    phase: snapshot.phase,
    lastActivityMonotonic: snapshot.lastActivityMonotonic,
    activityEventCount: snapshot.activityEventCount,
    lastStructuralProgressMonotonic: snapshot.lastStructuralProgressMonotonic,
    structuralProgressCount: snapshot.structuralProgressCount,
    duplicateCheckpointCount: snapshot.duplicateCheckpointCount,
    toolExecutionCount: snapshot.toolExecutionCount,
  });
  // Repeated session-log records inside round 1 are valid framed records but
  // carry no task activity: no clock, counter, phase, last-event, or detail
  // surface may move, and the payload content is never inspected or retained.
  const before = fields(instance.snapshot());
  for (let index = 0; index < 5; index += 1) {
    tick();
    consume(instance, 1, {
      type: "entry_appended",
      entry: { content: `SECRET-PAYLOAD-${index}`, path: "/home/gc/SECRET-PATH-9f2a" },
    });
  }
  assert.deepEqual(fields(instance.snapshot()), before, "round-1 repetition is inert");
  instance.beginRecovery();
  instance.acceptPrompt(2);
  const recovering = fields(instance.snapshot());
  for (let index = 0; index < 5; index += 1) {
    tick();
    consume(instance, 2, { type: "entry_appended", entry: { content: `SECRET-RECOVERY-${index}` } });
  }
  assert.deepEqual(fields(instance.snapshot()), recovering, "round-2 repetition is inert");
  const after = instance.snapshot();
  assert.deepEqual(after.errors, []);
  assert.doesNotMatch(JSON.stringify(after), /SECRET|PAYLOAD|home\/gc/);
  // A later real event still renews normally after the ignored records.
  tick();
  consume(instance, 2, { type: "agent_start" });
  assert.ok(instance.snapshot().lastActivityMonotonic > after.lastActivityMonotonic);
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

test("tracks multiple active tools by call id with ingress-sanitized safe metadata", () => {
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
  // A non-allowlisted child name maps to the fixed unknown label at ingress.
  assert.equal(snapshot.lastEventDetail, "unknown");
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "b", toolName: "bash" });
  snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolCount, 1);
  assert.equal(snapshot.activeToolName, "unknown");
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

test("cumulative round-1 tool counts are preserved and round-2 tool starts are rejected", () => {
  const { monitor: instance } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "tool_execution_start", toolName: "read" });
  consume(instance, 1, assistant("invalid"));
  consume(instance, 1, { type: "agent_end", willRetry: false });
  consume(instance, 1, { type: "agent_settled" });
  instance.acceptPrompt(2);
  consume(instance, 2, { type: "agent_start" });
  consume(instance, 2, assistant("done\n\nDELEGATE_RESULT: COMPLETED"));
  const before = instance.snapshot();
  // The recovery round is reporting-only: a tool start there is a fixed
  // stream error before any count, state, or clock mutation.
  consume(instance, 2, { type: "tool_execution_start", toolName: "bash" });
  const snapshot = instance.snapshot();
  assert.equal(instance.classifyRound(2), "invalid_stream");
  assert.ok(snapshot.errors.includes("tool_execution_in_recovery_round"));
  assert.equal(snapshot.toolExecutionCount, 1, "the cumulative round-1 count is preserved");
  assert.equal(snapshot.activeToolCount, 1, "only the round-1 tool stays active");
  assert.equal(snapshot.agentStartCount, 2);
  assert.equal(snapshot.agentEndCount, 1);
  assert.equal(snapshot.lastActivityMonotonic, before.lastActivityMonotonic, "no activity credit");
  assert.equal(snapshot.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic, "no progress credit");
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

test("identical accumulated tool updates renew neither activity nor tool novelty", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName: "bash" });
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolCallId: "t", toolName: "bash", partialResult: { out: "same" } });
  const before = instance.snapshot();
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolCallId: "t", toolName: "bash", partialResult: { out: "same" } });
  let after = instance.snapshot();
  assert.equal(after.lastActivityMonotonic, before.lastActivityMonotonic);
  assert.equal(after.activeToolLastNovelUpdateMonotonic, before.activeToolLastNovelUpdateMonotonic);
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolCallId: "t", toolName: "bash", partialResult: { out: "changed" } });
  after = instance.snapshot();
  // A changed accumulated update renews accepted activity and tool novelty
  // only; generic changing output is never structural progress.
  assert.ok(after.lastActivityMonotonic > before.lastActivityMonotonic);
  assert.ok(after.activeToolLastNovelUpdateMonotonic !== undefined
    && after.activeToolLastNovelUpdateMonotonic > before.activeToolLastNovelUpdateMonotonic!);
  assert.equal(after.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic);
});

test("completed tool ends are novel checkpoints and exact repeated cycles are duplicates", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    tick();
    consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName: "read" });
    tick();
    const before = instance.snapshot();
    consume(instance, 1, { type: "tool_execution_end", toolCallId: "t", toolName: "read", result: { ok: true }, isError: false });
    const after = instance.snapshot();
    assert.equal(after.activeToolCount, 0);
    if (cycle === 0) {
      assert.ok(after.lastStructuralProgressMonotonic > before.lastStructuralProgressMonotonic);
      assert.equal(after.duplicateCheckpointCount, 0);
    } else {
      assert.equal(after.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic);
      assert.equal(after.duplicateCheckpointCount, cycle);
      assert.equal(after.duplicateCheckpointsSinceNovel, cycle);
    }
  }
});

test("exact repeated authoritative messages never renew structural progress", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, assistant("identical payload"));
  const novelAt = instance.snapshot().lastStructuralProgressMonotonic;
  for (let repeat = 0; repeat < 3; repeat += 1) {
    tick();
    consume(instance, 1, assistant("identical payload"));
  }
  let snapshot = instance.snapshot();
  assert.equal(snapshot.lastStructuralProgressMonotonic, novelAt);
  assert.equal(snapshot.duplicateCheckpointCount, 3);
  assert.equal(snapshot.duplicateCheckpointsSinceNovel, 3);
  // A short alternating cycle stays inside the bounded recent index: the
  // first visit of each payload is novel, and every repeat is a duplicate.
  for (const text of ["A", "B", "A", "B"]) {
    tick();
    consume(instance, 1, assistant(text));
  }
  snapshot = instance.snapshot();
  assert.equal(snapshot.duplicateCheckpointCount, 5);
  const alternatedAt = snapshot.lastStructuralProgressMonotonic;
  assert.ok(alternatedAt > novelAt);
  // Further repeats of the same short cycle never renew progress again.
  tick();
  consume(instance, 1, assistant("A"));
  consume(instance, 1, assistant("B"));
  snapshot = instance.snapshot();
  assert.equal(snapshot.lastStructuralProgressMonotonic, alternatedAt);
  assert.equal(snapshot.duplicateCheckpointCount, 7);
  // One genuinely novel checkpoint clears the since-novel counter.
  tick();
  consume(instance, 1, assistant("fresh"));
  snapshot = instance.snapshot();
  assert.ok(snapshot.lastStructuralProgressMonotonic > alternatedAt);
  assert.equal(snapshot.duplicateCheckpointCount, 7);
  assert.equal(snapshot.duplicateCheckpointsSinceNovel, 0);
});

test("retry and compaction transitions renew activity but never structural progress", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "turn_start" });
  const progressAt = instance.snapshot().lastStructuralProgressMonotonic;
  for (const event of [
    { type: "auto_retry_start", errorMessage: "transient" },
    { type: "auto_retry_end", success: true },
    { type: "compaction_start" },
    { type: "compaction_end", aborted: false },
    { type: "summarization_retry_scheduled" },
    { type: "summarization_retry_attempt_start" },
    { type: "summarization_retry_finished" },
  ]) {
    tick();
    const before = instance.snapshot();
    consume(instance, 1, event);
    const after = instance.snapshot();
    assert.ok(after.lastActivityMonotonic > before.lastActivityMonotonic, event.type);
    assert.equal(after.lastStructuralProgressMonotonic, progressAt, event.type);
  }
  // A subsequent lifecycle-valid completed turn renews structural progress.
  tick();
  consume(instance, 1, { type: "turn_end" });
  assert.ok(instance.snapshot().lastStructuralProgressMonotonic > progressAt);
});

test("valid RPC records renew RPC health without task activity and UI traffic renews nothing", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  const before = instance.snapshot();
  tick();
  instance.recordValidRpc();
  const after = instance.snapshot();
  assert.ok(after.lastValidRpcMonotonic > before.lastValidRpcMonotonic);
  assert.equal(after.lastActivityMonotonic, before.lastActivityMonotonic);
  assert.equal(after.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic);
  tick();
  instance.recordUiActivity("app.setState");
  const later = instance.snapshot();
  assert.equal(later.lastActivityMonotonic, after.lastActivityMonotonic);
  assert.equal(later.lastValidRpcMonotonic, after.lastValidRpcMonotonic);
});

test("snapshots never carry checkpoint digests or tool checkpoint material", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, assistant("report body"));
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: { cmd: "SECRET-COMMAND" } });
  consume(instance, 1, { type: "tool_execution_update", toolCallId: "t", toolName: "bash", partialResult: { out: "SECRET-OUTPUT" } });
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "t", toolName: "bash", result: { stdout: "SECRET-RESULT" } });
  const content = JSON.stringify(instance.snapshot());
  // Tool arguments, accumulated output, and results never cross the monitor
  // boundary, and no HMAC key or SHA-256 digest ever serializes.
  assert.doesNotMatch(content, /SECRET-COMMAND|SECRET-OUTPUT|SECRET-RESULT/);
  assert.doesNotMatch(content, /[0-9a-f]{64}/);
  assert.doesNotMatch(content, /digest|hmac/i);
});

test("volatile-only assistant message differences are duplicate checkpoints", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  const semantic = {
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: "same report" }],
  };
  consume(instance, 1, { type: "message_end", message: { ...semantic, responseId: "resp-1", timestamp: 1000 } });
  const novelAt = instance.snapshot().lastStructuralProgressMonotonic;
  // Every volatile-only difference (ids, timestamps, usage, provider/api/model
  // metadata, signatures) keeps the checkpoint a duplicate.
  tick();
  consume(instance, 1, {
    type: "message_end",
    message: {
      ...semantic,
      responseId: "resp-2",
      timestamp: 9999,
      usage: { input: 12, output: 34, total: 46 },
      provider: "zai",
      api: "responses",
      model: "glm-9",
      signature: "opaque-signature-A",
    },
  });
  let snapshot = instance.snapshot();
  assert.equal(snapshot.lastStructuralProgressMonotonic, novelAt);
  assert.equal(snapshot.duplicateCheckpointCount, 1);
  // A thinking signature and volatile tool-call id inside content are volatile too.
  tick();
  consume(instance, 1, {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "tool_use",
      content: [
        { type: "thinking", thinking: "plan", signature: "sig-A" },
        { type: "tool_call", toolCallId: "call-1", toolName: "read", arguments: { path: "PRIVATE" } },
      ],
    },
  });
  tick();
  consume(instance, 1, {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "tool_use",
      usage: { total: 1 },
      content: [
        { type: "thinking", thinking: "plan", signature: "sig-B-different-opaque" },
        { type: "tool_call", toolCallId: "call-2-different-volatile-id", toolName: "read", arguments: { path: "PRIVATE" } },
      ],
    },
  });
  snapshot = instance.snapshot();
  assert.equal(snapshot.duplicateCheckpointCount, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|sig-B|call-2/);
});

test("semantic assistant changes are novel checkpoints", () => {
  const semanticChanges: ReadonlyArray<Record<string, unknown>> = [
    { stopReason: "length" },
    { content: [{ type: "text", text: "changed text" }] },
    { content: [{ type: "thinking", thinking: "changed thinking" }] },
    { content: [{ type: "tool_call", toolName: "bash", arguments: { cmd: "ls" } }] },
    { content: [{ type: "tool_call", toolName: "read", arguments: { path: "other" } }] },
  ];
  for (const change of semanticChanges) {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, {
      type: "message_end",
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "same" }] },
    });
    const before = instance.snapshot();
    tick();
    consume(instance, 1, {
      type: "message_end",
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "same" }], ...change },
    });
    const after = instance.snapshot();
    assert.ok(after.lastStructuralProgressMonotonic > before.lastStructuralProgressMonotonic, JSON.stringify(change));
  }
});

test("tool checkpoints ignore volatile call ids and react to semantic changes", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  // Same semantic tool call under different volatile ids is a duplicate.
  for (const id of ["call-1", "call-2"]) {
    tick();
    consume(instance, 1, { type: "tool_execution_start", toolCallId: id, toolName: "read", args: { path: "PRIVATE" } });
    consume(instance, 1, { type: "tool_execution_end", toolCallId: id, toolName: "read", result: { ok: true } });
  }
  let snapshot = instance.snapshot();
  assert.equal(snapshot.duplicateCheckpointCount, 1);
  const duplicateAt = snapshot.lastStructuralProgressMonotonic;
  // Anonymous correlation keys are volatile too: two identical anonymous
  // completed calls with no ids at all stay duplicates.
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolName: "read", args: { path: "PRIVATE" } });
  consume(instance, 1, { type: "tool_execution_end", toolName: "read", result: { ok: true } });
  snapshot = instance.snapshot();
  assert.equal(snapshot.duplicateCheckpointCount, 2);
  assert.equal(snapshot.lastStructuralProgressMonotonic, duplicateAt);
  // Semantic changes are novel: start arguments, final result, error status, and name.
  const novelCases: ReadonlyArray<[Record<string, unknown>, Record<string, unknown>]> = [
    [{ toolCallId: "a", toolName: "read", args: { path: "OTHER" } }, { toolCallId: "a", toolName: "read", result: { ok: true } }],
    [{ toolCallId: "b", toolName: "read", args: { path: "PRIVATE" } }, { toolCallId: "b", toolName: "read", result: { ok: false } }],
    [{ toolCallId: "c", toolName: "read", args: { path: "PRIVATE" } }, { toolCallId: "c", toolName: "read", result: { ok: true }, isError: true }],
    [{ toolCallId: "d", toolName: "bash", args: { path: "PRIVATE" } }, { toolCallId: "d", toolName: "bash", result: { ok: true } }],
  ];
  for (const [start, end] of novelCases) {
    const before = instance.snapshot();
    tick();
    consume(instance, 1, { type: "tool_execution_start", ...start });
    consume(instance, 1, { type: "tool_execution_end", ...end });
    assert.ok(
      instance.snapshot().lastStructuralProgressMonotonic > before.lastStructuralProgressMonotonic,
      JSON.stringify(start),
    );
  }
  assert.doesNotMatch(JSON.stringify(instance.snapshot()), /PRIVATE|OTHER/);
});

test("wide, compact-numeric, multibyte, and near-limit payloads digest boundedly without novelty", () => {
  const payloadMessage = (payload: unknown): Record<string, unknown> => ({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "cover" }, { type: "tool_call", toolName: "bash", arguments: payload }],
    },
  });
  const adversarial = [
    // Wide array: compact to build, huge under full serialization.
    { wide: Array.from({ length: 200_000 }, (_, index) => index) },
    // Compact numeric expansion: repeated small numbers expand during traversal.
    { expansion: Array.from({ length: 200_000 }, () => 1234567) },
    // Wide object: many keys.
    { manyKeys: Object.fromEntries(Array.from({ length: 120_000 }, (_, index) => [`k${index}`, index])) },
    // Multibyte: 90_000 euro signs are 270_000 UTF-8 bytes, over the byte cap
    // even though the character count stays below it.
    { multibyte: "€".repeat(90_000) },
    // Near the protocol line limit: one oversized string.
    { huge: "x".repeat(8 * 1024 * 1024 - 512) },
    // Deep nesting past the depth cap.
    { deep: nest(64) },
  ];
  for (const payload of adversarial) {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    const baseline = instance.snapshot();
    tick();
    consume(instance, 1, payloadMessage(payload));
    let snapshot = instance.snapshot();
    // Over-budget digestion earns no structural novelty and no duplicate count.
    assert.equal(snapshot.lastStructuralProgressMonotonic, baseline.lastStructuralProgressMonotonic);
    assert.equal(snapshot.structuralProgressCount, baseline.structuralProgressCount);
    assert.equal(snapshot.duplicateCheckpointCount, 0);
    // A second identical over-budget payload still earns nothing: it never
    // becomes a duplicate and never renews.
    tick();
    consume(instance, 1, payloadMessage(payload));
    snapshot = instance.snapshot();
    assert.equal(snapshot.lastStructuralProgressMonotonic, baseline.lastStructuralProgressMonotonic);
    assert.equal(snapshot.duplicateCheckpointCount, 0);
    // A later semantic payload still digests normally after the over-budget one.
    tick();
    consume(instance, 1, assistant("still digests"));
    assert.ok(instance.snapshot().lastStructuralProgressMonotonic > baseline.lastStructuralProgressMonotonic);
  }
  function nest(depth: number): unknown {
    let value: unknown = { leaf: true };
    for (let index = 0; index < depth; index += 1) value = { child: value };
    return value;
  }
});

test("multibyte payloads just under the byte cap digest and repeat as duplicates", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  // 60_000 euro signs stay under the 256 KiB UTF-8 byte cap.
  const payload = { type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "€".repeat(60_000) }] } };
  consume(instance, 1, payload);
  const novelAt = instance.snapshot().lastStructuralProgressMonotonic;
  tick();
  consume(instance, 1, payload);
  const snapshot = instance.snapshot();
  assert.equal(snapshot.lastStructuralProgressMonotonic, novelAt);
  assert.equal(snapshot.duplicateCheckpointCount, 1);
});

test("over-budget tool updates cannot prove change and renew neither tool nor activity liveness", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: {} });
  const started = instance.snapshot();
  // Identical over-budget accumulated updates: no activity renewal at all.
  const huge = { partialResult: { out: "x".repeat(8 * 1024 * 1024 - 512) } };
  for (let index = 0; index < 3; index += 1) {
    tick();
    consume(instance, 1, { type: "tool_execution_update", toolCallId: "t", toolName: "bash", ...huge });
  }
  const snapshot = instance.snapshot();
  assert.equal(snapshot.lastActivityMonotonic, started.lastActivityMonotonic);
  assert.equal(snapshot.activeToolLastNovelUpdateMonotonic, started.activeToolLastNovelUpdateMonotonic);
  // A later bounded update still renews normally.
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolCallId: "t", toolName: "bash", partialResult: { out: "small" } });
  const recovered = instance.snapshot();
  assert.ok(recovered.lastActivityMonotonic > started.lastActivityMonotonic);
  assert.ok(recovered.activeToolLastNovelUpdateMonotonic! > started.activeToolLastNovelUpdateMonotonic!);
});

test("nested turn starts, unmatched turn ends, and agent ends with open turns are invalid", () => {
  // Nested turn_start.
  const nested = monitor().monitor;
  nested.acceptPrompt(1);
  consume(nested, 1, { type: "agent_start" });
  consume(nested, 1, { type: "turn_start" });
  const before = nested.snapshot();
  consume(nested, 1, { type: "turn_start" });
  const nestedSnapshot = nested.snapshot();
  assert.equal(nested.classifyRound(1), "invalid_stream");
  assert.ok(nestedSnapshot.errors.includes("nested_turn_start"));
  assert.equal(nestedSnapshot.lastActivityMonotonic, before.lastActivityMonotonic, "no activity credit");
  assert.equal(nestedSnapshot.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic, "no progress credit");

  // Unmatched turn_end.
  const unmatched = monitor().monitor;
  unmatched.acceptPrompt(1);
  consume(unmatched, 1, { type: "agent_start" });
  consume(unmatched, 1, { type: "turn_end" });
  assert.equal(unmatched.classifyRound(1), "invalid_stream");
  assert.ok(unmatched.snapshot().errors.includes("turn_end_without_open_turn"));

  // Upstream failure-shaped unmatched turn_end still classifies invalid_stream.
  const failureShaped = monitor().monitor;
  failureShaped.acceptPrompt(1);
  consume(failureShaped, 1, { type: "agent_start" });
  consume(failureShaped, 1, { type: "turn_end", errorMessage: "503 Service temporarily unavailable PRIVATE" });
  assert.equal(failureShaped.classifyRound(1), "invalid_stream");
  assert.equal(failureShaped.snapshot().providerFailureCategory, undefined);
  assert.doesNotMatch(JSON.stringify(failureShaped.snapshot()), /PRIVATE/);

  // agent_end with an open turn earns no credit and keeps the agent running.
  const openAtEnd = monitor().monitor;
  openAtEnd.acceptPrompt(1);
  consume(openAtEnd, 1, { type: "agent_start" });
  consume(openAtEnd, 1, { type: "turn_start" });
  const beforeEnd = openAtEnd.snapshot();
  consume(openAtEnd, 1, { type: "agent_end", willRetry: false });
  const endSnapshot = openAtEnd.snapshot();
  assert.equal(openAtEnd.classifyRound(1), "invalid_stream");
  assert.ok(endSnapshot.errors.includes("agent_end_with_open_turn"));
  assert.equal(endSnapshot.agentEndCount, 0);
  assert.equal(endSnapshot.lastActivityMonotonic, beforeEnd.lastActivityMonotonic);
  assert.equal(endSnapshot.lastStructuralProgressMonotonic, beforeEnd.lastStructuralProgressMonotonic);
});

test("lifecycle-valid repeated and alternating turns keep identical identities", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  const runTurn = (text: string): void => {
    consume(instance, 1, { type: "turn_start" });
    consume(instance, 1, assistant(text));
    consume(instance, 1, { type: "turn_end" });
  };
  runTurn("identical turn");
  const firstNovelAt = instance.snapshot().lastStructuralProgressMonotonic;
  // A repeated identical turn is a duplicate checkpoint: the duplicate
  // message identity stays in the turn summary, so the repeated turn cannot
  // become novel by omission.
  tick();
  runTurn("identical turn");
  let snapshot = instance.snapshot();
  assert.equal(snapshot.lastStructuralProgressMonotonic, firstNovelAt);
  assert.equal(snapshot.duplicateCheckpointCount, 2);
  // An alternating turn cycle repeats both identities as duplicates.
  runTurn("turn alpha");
  runTurn("turn beta");
  const alternatedAt = instance.snapshot().lastStructuralProgressMonotonic;
  tick();
  runTurn("turn alpha");
  runTurn("turn beta");
  snapshot = instance.snapshot();
  assert.equal(snapshot.lastStructuralProgressMonotonic, alternatedAt);
  assert.equal(snapshot.duplicateCheckpointCount, 6);
  // A fresh turn content renews again.
  tick();
  runTurn("genuinely fresh turn");
  snapshot = instance.snapshot();
  assert.ok(snapshot.lastStructuralProgressMonotonic > alternatedAt);
  assert.equal(snapshot.duplicateCheckpointsSinceNovel, 0);
});

test("repeated turn cycles inside a repeated agent stay duplicates end to end", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  const agentCycle = (): void => {
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, { type: "turn_start" });
    consume(instance, 1, assistant("same message"));
    consume(instance, 1, { type: "turn_end" });
    consume(instance, 1, { type: "agent_end", willRetry: true });
  };
  agentCycle();
  const firstAt = instance.snapshot().lastStructuralProgressMonotonic;
  tick();
  agentCycle();
  const snapshot = instance.snapshot();
  // The repeated agent_end consumes the same agent summary identity, so the
  // whole repeated cycle is duplicates with no lease renewal.
  assert.equal(snapshot.lastStructuralProgressMonotonic, firstAt);
  assert.equal(snapshot.duplicateCheckpointCount, 3);
});

test("the watchdog surface identifies the stalest active tool", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "old", toolName: "read" });
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "new", toolName: "bash" });
  // The newer tool keeps producing novel updates; the older tool is silent.
  for (let index = 1; index <= 3; index += 1) {
    tick();
    consume(instance, 1, { type: "tool_execution_update", toolCallId: "new", toolName: "bash", partialResult: { n: index } });
    const snapshot = instance.snapshot();
    assert.equal(snapshot.activeToolCount, 2);
    assert.equal(snapshot.activeToolName, "read", "a newer updating tool must not mask an older silent tool");
  }
  const snapshot = instance.snapshot();
  assert.ok(snapshot.activeToolIdleSeconds! >= 0.3);
  assert.ok(snapshot.activeToolLastNovelUpdateMonotonic !== undefined);
  // When the silent older tool ends, the fresh tool becomes the surface.
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "old", toolName: "read" });
  const after = instance.snapshot();
  assert.equal(after.activeToolName, "bash");
  assert.ok(after.activeToolIdleSeconds! < snapshot.activeToolIdleSeconds!);
});

test("idle-age ties identify the most recently started active tool", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "a", toolName: "read" });
  tick();
  // Move the first tool's novel-update clock to 1100, then start the second
  // tool at the same monotonic instant: both idle ages tie and the more
  // recently started tool is identified.
  consume(instance, 1, { type: "tool_execution_update", toolCallId: "a", toolName: "read", partialResult: { n: 1 } });
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "b", toolName: "bash" });
  const snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolName, "bash");
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "b", toolName: "bash" });
  assert.equal(instance.snapshot().activeToolName, "read");
});

test("checkpoint novelty starts fresh per attempt with a new random key", () => {
  // Two monitor instances (two attempts) each treat the same payload as
  // novel: the HMAC key and digest index are per-attempt and random.
  for (const text of ["first payload", "second payload"]) {
    const firstBuilt = monitor();
    const first = firstBuilt.monitor;
    first.acceptPrompt(1);
    consume(first, 1, { type: "agent_start" });
    const secondBuilt = monitor();
    const second = secondBuilt.monitor;
    second.acceptPrompt(1);
    consume(second, 1, { type: "agent_start" });
    const beforeFirst = first.snapshot();
    const beforeSecond = second.snapshot();
    firstBuilt.tick();
    secondBuilt.tick();
    consume(first, 1, assistant(text));
    consume(second, 1, assistant(text));
    assert.ok(first.snapshot().lastStructuralProgressMonotonic > beforeFirst.lastStructuralProgressMonotonic);
    assert.ok(second.snapshot().lastStructuralProgressMonotonic > beforeSecond.lastStructuralProgressMonotonic);
  }
});

test("near-8MiB escapable strings digest in bounded chunks without full serialization", () => {
  // Instrument JSON.stringify: the largest string ever encoded in one call
  // must stay a fixed chunk, proving a near-protocol-limit string is never
  // serialized as one allocation before the byte cap stops traversal.
  const payloads = [
    "x".repeat(8 * 1024 * 1024 - 512),
    "\"".repeat(8 * 1024 * 1024 - 512),
    "\\".repeat(8 * 1024 * 1024 - 512),
    "€".repeat(8 * 1024 * 1024 - 512),
  ];
  const originalStringify = JSON.stringify;
  let maxEncodedLength = 0;
  try {
    JSON.stringify = ((...args: Parameters<typeof originalStringify>) => {
      const value = args[0];
      if (typeof value === "string") maxEncodedLength = Math.max(maxEncodedLength, value.length + 2);
      return originalStringify(...args);
    }) as typeof JSON.stringify;
    for (const payload of payloads) {
      const result = boundedDigest(randomBytes(32), payload);
      assert.equal(result.ok, false, "an over-cap string fails closed");
      assert.ok(maxEncodedLength <= 4200, `largest single encode was ${maxEncodedLength}`);
    }
  } finally {
    JSON.stringify = originalStringify;
  }
  // A bounded string still digests deterministically and identically for
  // equal inputs, in any number of chunks.
  const key = randomBytes(32);
  const short = "ok-string";
  const multiChunk = `${"a".repeat(5000)}${"b".repeat(5000)}`;
  for (const value of [short, multiChunk, ""]) {
    const first = boundedDigest(key, value);
    const second = boundedDigest(key, value);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.digest, second.digest);
  }
});

test("very wide objects fail closed before sorting or materializing the full key set", () => {
  const wide = Object.fromEntries(Array.from({ length: 25_000 }, (_, index) => [`k${index}`, index]));
  const withinBudget = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, index]));
  // Instrument Object.keys: no object may ever hand its full key array to a
  // sort or any other consumer before the node cap fails the traversal.
  const originalKeys = Object.keys;
  let maxKeysLength = 0;
  try {
    Object.keys = ((...args: Parameters<typeof originalKeys>) => {
      const result = originalKeys(...args);
      if (args[0] !== null && typeof args[0] === "object") {
        maxKeysLength = Math.max(maxKeysLength, result.length);
      }
      return result;
    }) as typeof Object.keys;
    const over = boundedDigest(randomBytes(32), wide);
    assert.equal(over.ok, false, "a wider-than-node-budget object fails closed");
    const under = boundedDigest(randomBytes(32), withinBudget);
    assert.equal(under.ok, true, "an in-budget object still digests");
    assert.ok(maxKeysLength <= 100, `largest Object.keys result was ${maxKeysLength}`);
  } finally {
    Object.keys = originalKeys;
  }
  // Key-order independence survives the bounded enumeration: the same pairs
  // in a different insertion order digest identically.
  const key = randomBytes(32);
  const shuffled = Object.fromEntries(Object.entries(withinBudget).reverse());
  const forward = boundedDigest(key, withinBudget);
  const backward = boundedDigest(key, shuffled);
  assert.equal(forward.ok, true);
  assert.equal(backward.ok, true);
  assert.equal(forward.digest, backward.digest);
});

test("huge keys at exact chunk boundaries never stringify as one complete token", () => {
  const pair = "\uD834\uDD1E"; // one surrogate pair, two code units
  const keys = [
    // Escapable: quotes and backslashes force per-unit JSON escaping.
    `"\\`.repeat(DIGEST_STRING_CHUNK_UNITS * 3 + 1),
    // Control characters expand to the fixed six-character escape.
    "\u0001".repeat(DIGEST_STRING_CHUNK_UNITS * 2),
    // Multibyte BMP characters.
    "\u20AC".repeat(DIGEST_STRING_CHUNK_UNITS * 3),
    // A surrogate pair straddling the first chunk boundary exactly.
    `${"a".repeat(DIGEST_STRING_CHUNK_UNITS - 1)}${pair}${"a".repeat(DIGEST_STRING_CHUNK_UNITS * 2)}`,
    // A pair straddling the second boundary, after one whole chunk.
    `${"b".repeat(DIGEST_STRING_CHUNK_UNITS)}${pair}${"b".repeat(DIGEST_STRING_CHUNK_UNITS)}`,
    // Lengths exactly at the chunk size and one pair past it.
    pair.repeat(DIGEST_STRING_CHUNK_UNITS / 2),
    pair.repeat(DIGEST_STRING_CHUNK_UNITS / 2 + 1),
  ];
  // Instrument JSON.stringify: neither the encoded argument nor the fed
  // token may exceed one fixed chunk allocation.
  const originalStringify = JSON.stringify;
  let maxArgumentLength = 0;
  let maxResultLength = 0;
  try {
    JSON.stringify = ((...args: Parameters<typeof originalStringify>) => {
      const result = originalStringify(...args);
      if (typeof args[0] === "string") {
        maxArgumentLength = Math.max(maxArgumentLength, args[0].length);
        maxResultLength = Math.max(maxResultLength, result.length);
      }
      return result;
    }) as typeof JSON.stringify;
    for (const keyName of keys) {
      const result = boundedDigest(randomBytes(32), { [keyName]: "v" });
      assert.equal(result.ok, true, `key of length ${keyName.length} stays under the byte cap`);
      assert.ok(
        maxArgumentLength <= DIGEST_STRING_CHUNK_UNITS + 1,
        `largest stringify argument was ${maxArgumentLength}`,
      );
      assert.ok(
        maxResultLength <= 6 * (DIGEST_STRING_CHUNK_UNITS + 1) + 2,
        `largest stringify token was ${maxResultLength}`,
      );
    }
  } finally {
    JSON.stringify = originalStringify;
  }
});

test("surrogate-boundary strings and keys digest deterministically across repeats", () => {
  const key = randomBytes(32);
  const pair = "\uD834\uDD1E";
  const strings = [
    `${"a".repeat(DIGEST_STRING_CHUNK_UNITS - 1)}${pair}${"a".repeat(DIGEST_STRING_CHUNK_UNITS)}`,
    `${pair}${"a".repeat(DIGEST_STRING_CHUNK_UNITS - 1)}${pair}`,
    pair.repeat(3000),
    "plain",
    "",
  ];
  for (const value of strings) {
    const first = boundedDigest(key, value);
    const second = boundedDigest(key, value);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.digest, second.digest);
  }
  // Distinct pair placements at boundaries stay distinct identities.
  const firstBoundary = boundedDigest(key, strings[0]);
  const secondBoundary = boundedDigest(key, strings[1]);
  assert.equal(firstBoundary.ok, true);
  assert.equal(secondBoundary.ok, true);
  assert.notEqual(firstBoundary.digest, secondBoundary.digest);
  // Surrogate-boundary keys keep key-order independence and repeat runs
  // digest identically.
  const forward: Record<string, unknown> = {};
  const backward: Record<string, unknown> = {};
  for (let index = 0; index < 40; index += 1) {
    forward[`${pair}${"k".repeat(DIGEST_STRING_CHUNK_UNITS - 1)}${index}`] = index;
  }
  for (let index = 39; index >= 0; index -= 1) {
    backward[`${pair}${"k".repeat(DIGEST_STRING_CHUNK_UNITS - 1)}${index}`] = index;
  }
  const forwardDigest = boundedDigest(key, forward);
  const backwardDigest = boundedDigest(key, backward);
  assert.equal(forwardDigest.ok, true);
  assert.equal(backwardDigest.ok, true);
  assert.equal(forwardDigest.digest, backwardDigest.digest);
  const repeatedForward = boundedDigest(key, forward);
  assert.equal(repeatedForward.ok, true);
  assert.equal(repeatedForward.digest, forwardDigest.digest, "a repeated run digests identically");
});

test("over-cap content arrays earn no credit and never run the full normalization", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, assistant("baseline"));
  const baseline = instance.snapshot();
  // A very large but under-8-MiB content array of small non-text items.
  // The array carries an own map shadow that records any full mapping.
  const content = Array.from({ length: 30_000 }, (_, index) => ({ type: "marker", n: index })) as unknown[];
  let normalizedItems = 0;
  (content as unknown as { map: (callback: (item: unknown) => unknown) => unknown[] }).map = (callback) => {
    normalizedItems = content.length;
    const mapped: unknown[] = [];
    for (const item of content) mapped.push(callback(item));
    return mapped;
  };
  const originalStringify = JSON.stringify;
  let maxEncodedLength = 0;
  try {
    JSON.stringify = ((...args: Parameters<typeof originalStringify>) => {
      if (typeof args[0] === "string") maxEncodedLength = Math.max(maxEncodedLength, args[0].length);
      return originalStringify(...args);
    }) as typeof JSON.stringify;
    tick();
    consume(instance, 1, {
      type: "message_end",
      message: { role: "assistant", stopReason: "stop", content },
    });
  } finally {
    JSON.stringify = originalStringify;
  }
  const snapshot = instance.snapshot();
  assert.equal(normalizedItems, 0, "the over-cap array is never fully mapped");
  assert.equal(maxEncodedLength, 0, "no digest token is produced for over-cap content");
  assert.equal(snapshot.lastStructuralProgressMonotonic, baseline.lastStructuralProgressMonotonic, "no structural credit");
  assert.equal(snapshot.structuralProgressCount, baseline.structuralProgressCount, "no structural count");
  assert.equal(snapshot.duplicateCheckpointCount, baseline.duplicateCheckpointCount, "no duplicate credit");
  // A later bounded message still renews the progress lease normally.
  tick();
  consume(instance, 1, assistant("still digests"));
  const after = instance.snapshot();
  assert.ok(after.lastStructuralProgressMonotonic > baseline.lastStructuralProgressMonotonic);
  assert.equal(after.duplicateCheckpointCount, baseline.duplicateCheckpointCount);
});

test("tool start arguments are digested once at start and never retained raw", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  // Counting accessors observe every read of the raw args value: digestion
  // at start reads them exactly once, and the end must reuse only the
  // stored digest instead of re-reading or retaining the object.
  let reads = 0;
  const args = {
    get path() {
      reads += 1;
      return "PRIVATE-ARGS";
    },
  };
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName: "read", args });
  assert.equal(reads, 1, "args are read exactly once for the start digest");
  const before = instance.snapshot();
  tick();
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "t", toolName: "read", result: { ok: true } });
  assert.equal(reads, 1, "the end reuses the stored digest, never the raw args");
  const snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolCount, 0);
  assert.ok(snapshot.lastStructuralProgressMonotonic > before.lastStructuralProgressMonotonic);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-ARGS|[0-9a-f]{64}/);
  // A second identical call under a fresh id keeps the same digest identity:
  // the semantic duplicate is detected without any args retention.
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "t2", toolName: "read", args: { path: "PRIVATE-ARGS" } });
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "t2", toolName: "read", result: { ok: true } });
  assert.equal(instance.snapshot().duplicateCheckpointCount, 1);
});

test("an active tool with unavailable args digestion earns no structural novelty at end", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  const baseline = instance.snapshot();
  tick();
  consume(instance, 1, {
    type: "tool_execution_start",
    toolCallId: "t",
    toolName: "bash",
    args: { huge: "x".repeat(8 * 1024 * 1024 - 512) },
  });
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "t", toolName: "bash", result: { ok: true } });
  const snapshot = instance.snapshot();
  // The over-budget args digest is unavailable, so the completed tool earns
  // no structural novelty and no duplicate count; the tool is still removed.
  assert.equal(snapshot.activeToolCount, 0);
  assert.equal(snapshot.lastStructuralProgressMonotonic, baseline.lastStructuralProgressMonotonic);
  assert.equal(snapshot.duplicateCheckpointCount, 0);
});

test("64 maximum-length tool-call ids stay accepted and the 65th start keeps the cap", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  // Every id is exactly 200 code units, the fixed protocol maximum.
  const id = (index: number) => "i".repeat(197) + String(index).padStart(3, "0");
  assert.equal(id(0).length, 200);
  assert.equal(id(64).length, 200);
  for (let index = 0; index < 64; index += 1) {
    consume(instance, 1, { type: "tool_execution_start", toolCallId: id(index), toolName: "bash", args: { n: index } });
  }
  const capped = instance.snapshot();
  assert.equal(capped.activeToolCount, 64);
  assert.equal(capped.toolExecutionCount, 64);
  assert.equal(capped.errors.length, 0);
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolCallId: id(64), toolName: "bash", args: {} });
  const snapshot = instance.snapshot();
  assert.equal(instance.classifyRound(1), "invalid_stream");
  assert.ok(snapshot.errors.includes("too_many_active_tools"));
  assert.equal(snapshot.activeToolCount, 64, "the rejected start is never inserted");
  assert.equal(snapshot.toolExecutionCount, 64, "the rejected start earns no tool count");
  assert.equal(snapshot.lastActivityMonotonic, capped.lastActivityMonotonic, "no activity credit");
  assert.equal(snapshot.lastStructuralProgressMonotonic, capped.lastStructuralProgressMonotonic, "no progress credit");
});

test("the 65th concurrent unique tool start is a bounded stream error before any credit", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  for (let index = 1; index <= 64; index += 1) {
    consume(instance, 1, { type: "tool_execution_start", toolCallId: `t${index}`, toolName: "bash", args: { n: index } });
  }
  const capped = instance.snapshot();
  assert.equal(capped.activeToolCount, 64);
  assert.equal(capped.toolExecutionCount, 64);
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "t65", toolName: "bash", args: {} });
  const snapshot = instance.snapshot();
  assert.equal(instance.classifyRound(1), "invalid_stream");
  assert.ok(snapshot.errors.includes("too_many_active_tools"));
  assert.equal(snapshot.activeToolCount, 64, "the rejected start is never inserted");
  assert.equal(snapshot.toolExecutionCount, 64, "the rejected start earns no tool count");
  assert.equal(snapshot.lastActivityMonotonic, capped.lastActivityMonotonic, "no activity credit");
  assert.equal(snapshot.lastStructuralProgressMonotonic, capped.lastStructuralProgressMonotonic, "no progress credit");
});

test("ended and updating tools correlate by id and by anonymous name within the active cap", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  for (const id of ["a", "b", "c"]) {
    consume(instance, 1, { type: "tool_execution_start", toolCallId: id, toolName: "bash", args: { id } });
  }
  // Ending the middle tool leaves the others correlated and updatable.
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "b", toolName: "bash", result: { ok: true } });
  tick();
  const before = instance.snapshot();
  consume(instance, 1, { type: "tool_execution_update", toolCallId: "a", toolName: "bash", partialResult: { n: 2 } });
  const snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolCount, 2);
  assert.ok(snapshot.lastActivityMonotonic > before.lastActivityMonotonic);
  // Anonymous updates correlate with the most recent anonymous start.
  consume(instance, 1, { type: "tool_execution_start", toolName: "read", args: { p: 1 } });
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolName: "read", partialResult: { n: 3 } });
  assert.equal(instance.snapshot().activeToolCount, 3);
});

test("an anonymous unallowlisted update or end cannot touch an anonymous allowlisted active tool", () => {
  for (const unmatched of [
    { type: "tool_execution_update", toolName: "/home/gc/SECRET-fake-tool", partialResult: { n: 1 } },
    { type: "tool_execution_end", toolName: "sk-SECRET-KEY", result: { ok: true } },
  ] as const) {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    // Anonymous allowlisted start: no toolCallId, ingress-allowlisted name.
    consume(instance, 1, { type: "tool_execution_start", toolName: "bash", args: { p: 1 } });
    const before = instance.snapshot();
    tick();
    consume(instance, 1, { ...unmatched });
    const snapshot = instance.snapshot();
    // `unknown` is a literal bucket, never a wildcard: the event matches
    // no allowlisted active tool, so it follows the unmatched-event path.
    assert.equal(instance.classifyRound(1), "invalid_stream", unmatched.type);
    const expectedError = unmatched.type === "tool_execution_update"
      ? "tool_execution_update_without_start"
      : "tool_execution_end_without_start";
    assert.ok(snapshot.errors.includes(expectedError), unmatched.type);
    assert.equal(snapshot.activeToolCount, 1, `the allowlisted tool stays active (${unmatched.type})`);
    assert.equal(snapshot.activeToolName, "bash", unmatched.type);
    assert.equal(snapshot.toolExecutionCount, 1, `no tool count credit (${unmatched.type})`);
    assert.equal(snapshot.lastActivityMonotonic, before.lastActivityMonotonic, `no activity credit (${unmatched.type})`);
    assert.equal(snapshot.activeToolLastNovelUpdateMonotonic, before.activeToolLastNovelUpdateMonotonic, `no tool novelty renewal (${unmatched.type})`);
    assert.equal(snapshot.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic, `no structural credit (${unmatched.type})`);
    assert.equal(snapshot.lastEvent, "tool_execution_start", `the unmatched event earns no event surface (${unmatched.type})`);
    assert.doesNotMatch(JSON.stringify(snapshot), /SECRET/);
  }
});

test("anonymous events match the literal unknown bucket and the stalest anonymous tool surfaces", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  // Anonymous tools: silent read (oldest), an unallowlisted name stored as
  // the fixed unknown label, and bash (newest).
  consume(instance, 1, { type: "tool_execution_start", toolName: "read", args: {} });
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolName: "totally-fake-tool", args: {} });
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolName: "bash", args: {} });
  // An anonymous allowlisted update renews only the bash-named tool, and
  // an anonymous unallowlisted update renews only the literal unknown
  // bucket: neither touches the silent read tool.
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolName: "bash", partialResult: { n: 1 } });
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolName: "another-fake-tool", partialResult: { n: 2 } });
  assert.equal(instance.classifyRound(1), "running");
  let snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolCount, 3);
  assert.equal(snapshot.activeToolName, "read", "the silent anonymous read tool is the stalest surface");
  // Ending the silent read tool by an anonymous same-name event leaves the
  // renewed unknown bucket and the renewed bash tool; bash renewed earlier,
  // so bash becomes the stalest surface until it updates again.
  tick();
  consume(instance, 1, { type: "tool_execution_end", toolName: "read", result: { ok: true } });
  snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolCount, 2);
  assert.equal(snapshot.activeToolName, "bash");
  // Two anonymous bash tools: an anonymous update renews only the newest
  // one, so the older bash tool becomes the stalest and its idle age grows
  // toward the active_tool_idle lease.
  tick();
  consume(instance, 1, { type: "tool_execution_start", toolName: "bash", args: {} });
  tick();
  consume(instance, 1, { type: "tool_execution_update", toolName: "bash", partialResult: { n: 3 } });
  snapshot = instance.snapshot();
  assert.equal(snapshot.activeToolCount, 3);
  assert.equal(snapshot.activeToolName, "bash", "the older silent bash tool surfaces");
  const idleSeconds = snapshot.activeToolIdleSeconds!;
  assert.ok(idleSeconds > 0);
  tick();
  tick();
  const later = instance.snapshot();
  assert.equal(later.activeToolName, "bash");
  assert.ok(later.activeToolIdleSeconds! > idleSeconds, "the silent tool's idle age keeps growing");
});

test("attempt finalization clears tool keys and digests so later ends earn nothing", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: { p: 1 } });
  const before = instance.snapshot();
  instance.clearEphemeralState();
  tick();
  consume(instance, 1, { type: "tool_execution_end", toolCallId: "t", toolName: "bash", result: { ok: true } });
  const snapshot = instance.snapshot();
  // The args digest was dropped with the key, so the end earns no novelty.
  assert.equal(snapshot.activeToolCount, 0, "the tool is still removed from active state");
  assert.equal(snapshot.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic);
  assert.equal(snapshot.duplicateCheckpointCount, 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /digest|hmac|[0-9a-f]{64}/i);
});

test("tool execution update and end events are also rejected in the recovery round", () => {
  for (const event of [
    { type: "tool_execution_update", toolCallId: "t", toolName: "bash", partialResult: { n: 1 } },
    { type: "tool_execution_end", toolCallId: "t", toolName: "bash", result: { ok: true } },
  ]) {
    const { monitor: instance } = monitor();
    instance.acceptPrompt(1);
    // A round-1 tool left active: its update in round 2 must still be a
    // fixed stream error before any tool clock renewal.
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: {} });
    consume(instance, 1, { type: "agent_end", willRetry: false });
    consume(instance, 1, { type: "agent_settled" });
    instance.acceptPrompt(2);
    consume(instance, 2, { type: "agent_start" });
    const before = instance.snapshot();
    consume(instance, 2, event);
    const snapshot = instance.snapshot();
    assert.equal(instance.classifyRound(2), "invalid_stream", event.type);
    assert.ok(snapshot.errors.includes("tool_execution_in_recovery_round"), event.type);
    assert.equal(snapshot.toolExecutionCount, 1);
    assert.equal(snapshot.activeToolCount, 1);
    assert.equal(snapshot.activeToolLastNovelUpdateMonotonic, before.activeToolLastNovelUpdateMonotonic, event.type);
    assert.equal(snapshot.lastActivityMonotonic, before.lastActivityMonotonic, event.type);
    assert.equal(snapshot.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic, event.type);
  }
});

test("message_update toolcall events are rejected in the recovery round for all three subtypes", () => {
  const recoveryToolcallEvents = [
    { type: "toolcall_start" },
    { type: "toolcall_delta", delta: "{}" },
    { type: "toolcall_delta", delta: "" },
    { type: "toolcall_end" },
  ] as const;
  for (const assistantMessageEvent of recoveryToolcallEvents) {
    const { monitor: instance } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, { type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: {} });
    consume(instance, 1, { type: "tool_execution_end", toolCallId: "r1", toolName: "read", result: { ok: true } });
    consume(instance, 1, { type: "agent_end", willRetry: false });
    consume(instance, 1, { type: "agent_settled" });
    instance.acceptPrompt(2);
    consume(instance, 2, { type: "agent_start" });
    const before = instance.snapshot();
    consume(instance, 2, { type: "message_update", assistantMessageEvent });
    const snapshot = instance.snapshot();
    assert.equal(instance.classifyRound(2), "invalid_stream", assistantMessageEvent.type);
    assert.ok(snapshot.errors.includes("tool_execution_in_recovery_round"), assistantMessageEvent.type);
    // The rejection runs before delta filtering and every mutation: no
    // activity renewal, no phase or event-surface change, and the
    // cumulative round-1 tool count stays preserved.
    assert.equal(snapshot.toolExecutionCount, 1, assistantMessageEvent.type);
    assert.equal(snapshot.lastActivityMonotonic, before.lastActivityMonotonic, assistantMessageEvent.type);
    assert.equal(snapshot.lastEvent, before.lastEvent, assistantMessageEvent.type);
    assert.equal(snapshot.phase, before.phase, assistantMessageEvent.type);
    assert.equal(snapshot.activityEventCount, before.activityEventCount, assistantMessageEvent.type);
    assert.equal(snapshot.structuralProgressCount, before.structuralProgressCount, assistantMessageEvent.type);
  }
  // Control: a non-toolcall stream event in round 2 stays a normal
  // accepted activity, proving the rejection is subtype-specific.
  const control = monitor();
  control.monitor.acceptPrompt(1);
  settle(control.monitor, 1);
  control.monitor.acceptPrompt(2);
  consume(control.monitor, 2, { type: "agent_start" });
  const beforeControl = control.monitor.snapshot();
  control.tick();
  consume(control.monitor, 2, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "fine" } });
  assert.equal(control.monitor.classifyRound(2), "running");
  assert.ok(control.monitor.snapshot().lastActivityMonotonic > beforeControl.lastActivityMonotonic);
});

test("live tool names round-trip only through the fixed runtime allowlist", () => {
  const allowlisted = [
    "read", "bash", "edit", "write",
    "web_search", "fetch_contents",
    "ctx_execute_file", "ctx_batch_execute", "ctx_search",
    "codegraph_explore", "codegraph_search", "codegraph_files",
    "codegraph_callers", "codegraph_callees", "codegraph_impact",
    "codegraph_node", "codegraph_status",
  ];
  for (const name of allowlisted) {
    const { monitor: instance } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName: name, args: {} });
    const snapshot = instance.snapshot();
    assert.equal(snapshot.activeToolName, name, name);
    assert.equal(snapshot.lastEventDetail, name, name);
    consume(instance, 1, { type: "tool_execution_end", toolCallId: "t", toolName: name, result: { ok: true } });
  }
});

test("seeded path, credential, and provider-body tool names map to unknown at ingress", () => {
  const seededNames = [
    "/home/gc/SECRET-FULL-PATH",
    "sk-PROVIDER-KEY-4f2a",
    "401 unauthorized: PRIVATE provider body",
    "",
    `${"x".repeat(500)}`,
    "read ",
    "BASH",
  ];
  for (const toolName of seededNames) {
    const { monitor: instance } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, { type: "tool_execution_start", toolCallId: "t", toolName, args: { p: 1 } });
    const snapshot = instance.snapshot();
    assert.equal(snapshot.activeToolName, "unknown", toolName);
    assert.equal(snapshot.lastEventDetail, "unknown", toolName);
    assert.doesNotMatch(JSON.stringify(snapshot), /SECRET|PROVIDER|401|home\/gc/, toolName);
    consume(instance, 1, { type: "tool_execution_end", toolCallId: "t", toolName, result: { ok: true } });
  }
});

test("a no-ID update or end never matches an ID-backed tool of the same name", () => {
  for (const unmatched of [
    { type: "tool_execution_update", toolName: "bash", partialResult: { n: 1 } },
    { type: "tool_execution_end", toolName: "bash", result: { ok: true } },
  ] as const) {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    // ID-backed start: the active tool exists only under its id: key.
    consume(instance, 1, { type: "tool_execution_start", toolCallId: "call-9", toolName: "bash", args: { p: 1 } });
    const before = instance.snapshot();
    tick();
    consume(instance, 1, { ...unmatched });
    const snapshot = instance.snapshot();
    // An ID-backed tool must never match a no-ID event: the same sanitized
    // name alone is not identity, so the event follows the unmatched path.
    const expectedError = unmatched.type === "tool_execution_update"
      ? "tool_execution_update_without_start"
      : "tool_execution_end_without_start";
    assert.ok(snapshot.errors.includes(expectedError), unmatched.type);
    assert.equal(instance.classifyRound(1), "invalid_stream", unmatched.type);
    // No activity, tool, or structural credit, and the tool stays active.
    assert.equal(snapshot.activeToolCount, 1, unmatched.type);
    assert.equal(snapshot.activeToolName, "bash", unmatched.type);
    assert.equal(snapshot.toolExecutionCount, 1, unmatched.type);
    assert.equal(snapshot.activityEventCount, before.activityEventCount, unmatched.type);
    assert.equal(snapshot.lastActivityMonotonic, before.lastActivityMonotonic, unmatched.type);
    assert.equal(snapshot.activeToolLastNovelUpdateMonotonic, before.activeToolLastNovelUpdateMonotonic, unmatched.type);
    assert.equal(snapshot.lastStructuralProgressMonotonic, before.lastStructuralProgressMonotonic, unmatched.type);
    assert.equal(snapshot.structuralProgressCount, before.structuralProgressCount, unmatched.type);
    assert.equal(snapshot.lastEvent, "tool_execution_start", unmatched.type);
    assert.equal(snapshot.duplicateCheckpointCount, 0, unmatched.type);
  }
});

test("mixed same-name candidates correlate only through the newest anonymous tool", () => {
  // Part one: an anonymous update renews only the anonymous candidate, so
  // the ID-backed tool stays the stalest surface after the renewal. Under
  // the old name-only correlation the update renewed the ID-backed tool and
  // the silent anonymous tool stayed the surface.
  {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, { type: "tool_execution_start", toolName: "bash", args: { n: 1 } });
    for (let index = 0; index < 10; index += 1) tick();
    consume(instance, 1, { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { n: 2 } });
    for (let index = 0; index < 5; index += 1) tick();
    consume(instance, 1, { type: "tool_execution_update", toolName: "bash", partialResult: { n: 3 } });
    const snapshot = instance.snapshot();
    assert.equal(instance.classifyRound(1), "running");
    assert.equal(snapshot.activeToolCount, 2);
    // The anonymous tool renewed at 1500ms of fake time; the ID-backed tool
    // last renewed at its 1000ms start. The surface idle is the ID-backed
    // tool's 0.5s, proving the update matched the anonymous candidate.
    assert.ok(snapshot.activeToolIdleSeconds !== undefined && snapshot.activeToolIdleSeconds <= 1.0,
      `the update must renew the anonymous candidate, got ${snapshot.activeToolIdleSeconds}s`);
  }
  // Part two: with an ID-backed tool as the newest same-name candidate, a
  // no-ID end removes the newest anonymous tool, never the ID-backed one.
  {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    consume(instance, 1, { type: "tool_execution_start", toolName: "bash", args: { n: 1 } });
    for (let index = 0; index < 3; index += 1) tick();
    consume(instance, 1, { type: "tool_execution_start", toolName: "bash", args: { n: 2 } });
    for (let index = 0; index < 3; index += 1) tick();
    consume(instance, 1, { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { n: 3 } });
    tick();
    consume(instance, 1, { type: "tool_execution_end", toolName: "bash", result: { ok: true } });
    assert.equal(instance.classifyRound(1), "running");
    assert.equal(instance.snapshot().activeToolCount, 2);
    // The exact-id end still works, proving the ID-backed tool survived the
    // anonymous end. Under the old name-only correlation it was already
    // removed and this end became the unmatched error path.
    consume(instance, 1, { type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { ok: true } });
    assert.equal(instance.classifyRound(1), "running");
    const afterIdEnd = instance.snapshot();
    assert.equal(afterIdEnd.activeToolCount, 1);
    // The remaining tool must be the older anonymous one: its idle age keeps
    // growing from the first start, proving the no-ID end removed the newer
    // anonymous candidate and not the oldest one.
    for (let index = 0; index < 5; index += 1) tick();
    const snapshot = instance.snapshot();
    assert.ok(snapshot.activeToolIdleSeconds !== undefined && snapshot.activeToolIdleSeconds >= 1.0,
      `the older anonymous tool must remain, got ${snapshot.activeToolIdleSeconds}s`);
    consume(instance, 1, { type: "tool_execution_end", toolName: "bash", result: { ok: true } });
    assert.equal(instance.snapshot().activeToolCount, 0);
    assert.equal(instance.classifyRound(1), "running");
  }
});

test("turn summaries are duplicate-insensitive to repeated copies of one message", () => {
  for (const [firstCopies, secondCopies] of [[1, 1], [1, 2], [1, 70], [2, 70], [70, 1], [70, 70]]) {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    const runTurn = (copies: number): void => {
      consume(instance, 1, { type: "turn_start" });
      for (let index = 0; index < copies; index += 1) consume(instance, 1, assistant("same message"));
      consume(instance, 1, { type: "turn_end" });
    };
    runTurn(firstCopies);
    const firstAt = instance.snapshot().lastStructuralProgressMonotonic;
    tick();
    runTurn(secondCopies);
    const snapshot = instance.snapshot();
    // Only the first canonical enclosing identity may be novel: any
    // duplicate multiplicity leaves the turn identity unchanged, so the
    // repeated turn renews nothing.
    assert.equal(snapshot.lastStructuralProgressMonotonic, firstAt, `${firstCopies} then ${secondCopies} copies`);
    // All copies after the first, in both turns, are duplicates, plus one
    // duplicate turn_end.
    assert.equal(snapshot.duplicateCheckpointCount, firstCopies + secondCopies, `${firstCopies} then ${secondCopies} copies`);
    // Prompt acceptance, the first message, and the first turn_end renew.
    assert.equal(snapshot.structuralProgressCount, 3, `${firstCopies} then ${secondCopies} copies`);
    assert.equal(snapshot.duplicateCheckpointsSinceNovel, secondCopies + 1, `${firstCopies} then ${secondCopies} copies`);
  }
});

test("retry-agent summaries are duplicate-insensitive to repeated copies of one message", () => {
  for (const [firstCopies, secondCopies] of [[1, 1], [1, 70], [70, 1], [3, 5]]) {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    const agentCycle = (copies: number): void => {
      consume(instance, 1, { type: "agent_start" });
      consume(instance, 1, { type: "turn_start" });
      for (let index = 0; index < copies; index += 1) consume(instance, 1, assistant("same retry message"));
      consume(instance, 1, { type: "turn_end" });
      consume(instance, 1, { type: "agent_end", willRetry: true });
    };
    agentCycle(firstCopies);
    const firstAt = instance.snapshot().lastStructuralProgressMonotonic;
    tick();
    agentCycle(secondCopies);
    const snapshot = instance.snapshot();
    assert.equal(snapshot.lastStructuralProgressMonotonic, firstAt, `${firstCopies} then ${secondCopies} copies`);
    // All copies after the first, in both cycles, are duplicates, plus one
    // duplicate turn_end and one duplicate agent_end.
    assert.equal(snapshot.duplicateCheckpointCount, firstCopies + secondCopies + 1, `${firstCopies} then ${secondCopies} copies`);
    // Prompt acceptance, message, turn_end, and agent_end renew once each.
    assert.equal(snapshot.structuralProgressCount, 4, `${firstCopies} then ${secondCopies} copies`);
  }
});

test("genuinely different turn content still changes the enclosing summary identity", () => {
  for (const [firstCopies, secondCopies] of [[1, 1], [70, 1], [1, 70], [70, 70]]) {
    const { monitor: instance, tick } = monitor();
    instance.acceptPrompt(1);
    consume(instance, 1, { type: "agent_start" });
    const runTurn = (copies: number, text: string): void => {
      consume(instance, 1, { type: "turn_start" });
      for (let index = 0; index < copies; index += 1) consume(instance, 1, assistant(text));
      consume(instance, 1, { type: "turn_end" });
    };
    runTurn(firstCopies, "message alpha");
    const firstAt = instance.snapshot().lastStructuralProgressMonotonic;
    tick();
    runTurn(secondCopies, "message beta");
    const snapshot = instance.snapshot();
    assert.ok(snapshot.lastStructuralProgressMonotonic > firstAt, `${firstCopies} then ${secondCopies} copies`);
    // Only the repeated copies inside each turn are duplicates: the distinct
    // beta message and its changed turn identity both stay novel.
    assert.equal(snapshot.duplicateCheckpointCount, firstCopies + secondCopies - 2, `${firstCopies} then ${secondCopies} copies`);
    // Prompt acceptance plus both turns' message and turn_end renew.
    assert.equal(snapshot.structuralProgressCount, 5, `${firstCopies} then ${secondCopies} copies`);
  }
});

test("summary identity accumulators saturate at the fixed distinct cap", () => {
  const { monitor: instance, tick } = monitor();
  instance.acceptPrompt(1);
  consume(instance, 1, { type: "agent_start" });
  const runTurn = (texts: readonly string[]): void => {
    consume(instance, 1, { type: "turn_start" });
    for (const text of texts) consume(instance, 1, assistant(text));
    consume(instance, 1, { type: "turn_end" });
  };
  const capped = Array.from({ length: 64 }, (_, index) => `cap message ${index}`);
  runTurn(capped);
  const afterFirst = instance.snapshot();
  tick();
  // The second turn keeps the exact 64-distinct identity: cap message 63
  // arrives last again, the one index-evicted copy re-enters before it, and
  // every earlier copy is already a duplicate in the bounded novelty index.
  // The overflow message is novel individually but is never admitted to the
  // saturated summary, so the enclosing turn_end stays an exact duplicate.
  runTurn([...capped.slice(1, 63), capped[0]!, capped[63]!, "overflow message"]);
  const snapshot = instance.snapshot();
  // 63 duplicate messages (c1..c62 plus the repeated c63) and one duplicate
  // turn_end: the saturated identity repeated exactly instead of overflowing.
  assert.equal(snapshot.duplicateCheckpointCount, 64);
  // The genuinely novel re-entry and overflow message still earn their own
  // checkpoint credit even though the enclosing summary is saturated.
  assert.ok(snapshot.lastStructuralProgressMonotonic > afterFirst.lastStructuralProgressMonotonic);
  assert.equal(snapshot.structuralProgressCount, afterFirst.structuralProgressCount + 2);
});
