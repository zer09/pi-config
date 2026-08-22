import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDelegateLabel,
  combinedSignal,
  DelegateManager,
  VERIFICATION_CONCURRENCY_CAP,
  type ActiveDelegate,
} from "./manager.ts";
import type { DelegateProgress, DelegateRole } from "./types.ts";

const EXCLUSIVE_ROLES: readonly DelegateRole[] = ["implementation", "remediation", "oracle"];
const OVERLAP_ERROR = /A verification delegate may overlap only other verification delegates/;
const CAP_ERROR = /At most 4 verification delegates may run concurrently; batch the remaining findings/;
const EXCLUSIVE_ERROR = /An implementation, remediation, or oracle delegate must run sequentially against every active delegate/;

test("verification delegates overlap other verification delegates up to the four cap", () => {
  assert.equal(VERIFICATION_CONCURRENCY_CAP, 4);
  const manager = new DelegateManager();
  // One, two, three, and four concurrent verifications all start cleanly.
  for (let index = 1; index <= 4; index += 1) {
    assert.equal(manager.begin(`v${index}`, "verification").id, index);
  }
  // The fifth concurrent verification is rejected with a bounded batching error.
  assert.throws(() => manager.begin("v5", "verification"), CAP_ERROR);
  assert.throws(() => manager.begin("v6", "verification"), CAP_ERROR);
  // Finishing one verification releases a slot for the next finding.
  manager.finish("v2");
  assert.equal(manager.begin("v5", "verification").id, 5);
  assert.throws(() => manager.begin("v6", "verification"), CAP_ERROR);
  // Draining all verifications resets the batch capacity completely.
  for (const id of ["v1", "v3", "v4", "v5"]) manager.finish(id);
  manager.begin("next-batch-1", "verification");
});

test("a single verification still runs alone without siblings", () => {
  const manager = new DelegateManager();
  manager.begin("v1", "verification");
  manager.finish("v1");
  manager.begin("v2", "verification");
});

test("verification blocks solution and review roles in both directions", () => {
  for (const role of ["solution-a", "solution-d", "review-a", "review-d"] as const) {
    const verificationFirst = new DelegateManager();
    verificationFirst.begin("v1", "verification");
    assert.throws(() => verificationFirst.begin("sibling", role), OVERLAP_ERROR);
    verificationFirst.finish("v1");
    verificationFirst.begin("sibling", role);
  }
  for (const role of ["solution-b", "solution-c", "review-b", "review-c"] as const) {
    const gateFirst = new DelegateManager();
    gateFirst.begin("gate", role);
    assert.throws(() => gateFirst.begin("v1", "verification"), OVERLAP_ERROR);
  }
});

test("verification blocks implementation, remediation, and oracle roles in both directions", () => {
  for (const role of EXCLUSIVE_ROLES) {
    const verificationFirst = new DelegateManager();
    verificationFirst.begin("v1", "verification");
    verificationFirst.begin("v2", "verification");
    assert.throws(() => verificationFirst.begin("mutator", role), EXCLUSIVE_ERROR);
  }
  for (const role of EXCLUSIVE_ROLES) {
    const exclusiveFirst = new DelegateManager();
    exclusiveFirst.begin("mutator", role);
    assert.throws(() => exclusiveFirst.begin("v1", "verification"), OVERLAP_ERROR);
  }
});

test("implementation, remediation, and oracle run exclusively against every active delegate", () => {
  for (const role of EXCLUSIVE_ROLES) {
    // An active exclusive delegate blocks any new delegate.
    const exclusiveFirst = new DelegateManager();
    exclusiveFirst.begin("mutator", role);
    assert.throws(() => exclusiveFirst.begin("review-a", "review-a"), EXCLUSIVE_ERROR);
    assert.throws(() => exclusiveFirst.begin("other", "implementation"), EXCLUSIVE_ERROR);
    exclusiveFirst.finish("mutator");
    exclusiveFirst.begin("review-a", "review-a");

    // Any active delegate blocks a new exclusive role.
    const blocked = new DelegateManager();
    blocked.begin("impl", "implementation");
    assert.throws(() => blocked.begin("rem", "remediation"), EXCLUSIVE_ERROR);
    blocked.finish("impl");
    blocked.begin("review-b", "review-b");
    assert.throws(() => blocked.begin("oracle", "oracle"), EXCLUSIVE_ERROR);
  }
});

test("solution and review concurrency is unchanged inside and across gates", () => {
  const manager = new DelegateManager();
  manager.begin("s1", "solution-a");
  manager.begin("s2", "solution-b");
  manager.begin("s3", "solution-c");
  manager.begin("s4", "solution-d");
  manager.begin("r1", "review-a");
  manager.begin("r2", "review-b");
  manager.begin("r3", "review-c");
  manager.begin("r4", "review-d");
  for (const id of ["s1", "s2", "s3", "s4"]) manager.finish(id);
  manager.begin("r5", "review-a");
});

test("assigns monotonic numeric IDs without reusing completed IDs", () => {
  const manager = new DelegateManager();
  const first = manager.begin("tool-a", "review-a");
  const second = manager.begin("tool-b", "review-b");
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  manager.finish("tool-a");
  const third = manager.begin("tool-c", "review-c");
  assert.equal(third.id, 3);
  assert.deepEqual(manager.listActive().map((delegate) => delegate.id), [2, 3]);
});

test("stops only the selected delegate and retains it until cleanup finishes", () => {
  const manager = new DelegateManager();
  const first = manager.begin("tool-a", "review-a");
  const second = manager.begin("tool-b", "review-b");

  const stopped = manager.stop(first.id);
  assert.equal(stopped.status, "stopping");
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.deepEqual(manager.listActive().map(({ id, state }) => ({ id, state })), [
    { id: 1, state: "stopping" },
    { id: 2, state: "starting" },
  ]);
  assert.equal(manager.stop(first.id).status, "already_stopping");
  assert.equal(manager.stop(999).status, "not_found");

  manager.finish("tool-a");
  assert.deepEqual(manager.listActive().map((delegate) => delegate.id), [2]);
});

function progress(overrides: Partial<DelegateProgress> = {}): DelegateProgress {
  return {
    label: "review-a",
    role: "review-a",
    state: "running",
    protocol: "pi-rpc",
    route: "agentrouter/gpt-5.6-sol:max",
    attempt: 1,
    phase: "agent",
    lastEvent: "message_update",
    lastEventAt: "2026-08-22T00:00:00.000Z",
    idleSeconds: 0,
    elapsedSeconds: 12.3,
    toolExecutionCount: 0,
    idleWarningCount: 0,
    reportNudgeCount: 0,
    reportRound: 1,
    ...overrides,
  };
}

test("active delegate progress supplies list state and elapsed time", () => {
  const manager = new DelegateManager();
  const handle = manager.begin("tool-a", "review-a");
  manager.update("tool-a", progress({
    route: "provider/model:high",
    phase: "agent",
    reportRound: 2,
  }));
  assert.deepEqual(manager.listActive(), [{
    id: handle.id,
    role: "review-a",
    state: "running",
    route: "provider/model:high",
    phase: "agent",
    reportRound: 2,
    elapsedSeconds: 12.3,
  }]);
});

test("a starting delegate without progress carries explicit list placeholders", () => {
  const manager = new DelegateManager();
  manager.begin("tool-a", "solution-b");
  const [delegate] = manager.listActive();
  assert.equal(delegate.state, "starting");
  assert.equal(delegate.route, "selecting route");
  assert.equal(delegate.phase, "starting");
  assert.equal(delegate.reportRound, 1);
  assert.equal(typeof delegate.elapsedSeconds, "number");
});

test("list choice labels render every field for starting and active-progress delegates", () => {
  const manager = new DelegateManager();
  manager.begin("starting-tool", "solution-b");
  manager.begin("active-tool", "review-a");
  manager.update("active-tool", progress({
    state: "running",
    route: "agentrouter/gpt-5.6-sol:max",
    phase: "tool",
    reportRound: 2,
    elapsedSeconds: 250.9,
  }));
  assert.deepEqual(manager.listActive().map(activeDelegateLabel), [
    "#1  solution-b  starting  selecting route  phase=starting  round 1/2  00:00",
    "#2  review-a  running  agentrouter/gpt-5.6-sol:max  phase=tool  round 2/2  04:10",
  ]);
});

test("list choice labels format elapsed time, rounds, and stopping state exactly", () => {
  const stopping: ActiveDelegate = {
    id: 12,
    role: "verification",
    state: "stopping",
    route: "provider/model:medium",
    phase: "tool",
    reportRound: 1,
    elapsedSeconds: 3605.4,
  };
  assert.equal(
    activeDelegateLabel(stopping),
    "#12  verification  stopping  provider/model:medium  phase=tool  round 1/2  60:05",
  );
});

test("abortAll aborts concurrent verification siblings", () => {
  const manager = new DelegateManager();
  const handles = ["v1", "v2", "v3", "v4"].map((id) => manager.begin(id, "verification"));
  manager.abortAll();
  for (const handle of handles) assert.equal(handle.signal.aborted, true);
  // The cleared manager accepts a fresh verification batch without reusing IDs.
  assert.equal(manager.begin("fresh", "verification").id, 5);
});

test("combinedSignal forwards aborts from either source", () => {
  const first = new AbortController();
  const second = new AbortController();
  const signal = combinedSignal(first.signal, second.signal);
  assert.equal(signal.aborted, false);
  second.abort();
  assert.equal(signal.aborted, true);
  assert.equal(combinedSignal(undefined, second.signal).aborted, true);
});
