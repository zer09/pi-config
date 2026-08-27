import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDelegateLabel,
  combinedSignal,
  DelegateManager,
  VERIFICATION_CONCURRENCY_CAP,
  type ActiveDelegate,
} from "./manager.ts";
import type { DelegateProgress } from "./types.ts";

import type { ResolvedRole } from "./routing.ts";

/** Test fixture: build a registry-style resolved role from a known role id. */
function role(id: string): ResolvedRole {
  const family = id.replace(/-[a-z]$/, "") as ResolvedRole["family"];
  const slot = /-[a-z]$/.test(id) ? id.charCodeAt(id.length - 1) - "a".charCodeAt(0) : undefined;
  return slot === undefined ? { id, family, profile: `${family}-profile` } : { id, family, profile: `${family}-profile`, slot };
}


const EXCLUSIVE_ROLES: readonly ResolvedRole[] = [role("implementation"), role("remediation"), role("oracle")];
const OVERLAP_ERROR = /A verification delegate may overlap only other verification delegates/;
const CAP_ERROR = /At most 4 verification delegates may run concurrently; batch the remaining findings/;
const EXCLUSIVE_ERROR = /An implementation, remediation, or oracle delegate must run sequentially against every active delegate/;

test("verification delegates overlap other verification delegates up to the four cap", () => {
  assert.equal(VERIFICATION_CONCURRENCY_CAP, 4);
  const manager = new DelegateManager();
  // One, two, three, and four concurrent verifications all start cleanly.
  for (let index = 1; index <= 4; index += 1) {
    assert.equal(manager.begin(`v${index}`, role("verification")).id, index);
  }
  // The fifth concurrent verification is rejected with a bounded batching error.
  assert.throws(() => manager.begin("v5", role("verification")), CAP_ERROR);
  assert.throws(() => manager.begin("v6", role("verification")), CAP_ERROR);
  // Finishing one verification releases a slot for the next finding.
  manager.finish("v2");
  assert.equal(manager.begin("v5", role("verification")).id, 5);
  assert.throws(() => manager.begin("v6", role("verification")), CAP_ERROR);
  // Draining all verifications resets the batch capacity completely.
  for (const id of ["v1", "v3", "v4", "v5"]) manager.finish(id);
  manager.begin("next-batch-1", role("verification"));
});

test("a single verification still runs alone without siblings", () => {
  const manager = new DelegateManager();
  manager.begin("v1", role("verification"));
  manager.finish("v1");
  manager.begin("v2", role("verification"));
});

test("verification blocks solution and review roles in both directions", () => {
  for (const roleId of ["solution-a", "solution-d", "solution-e", "solution-f", "review-a", "review-d", "review-e"] as const) {
    const verificationFirst = new DelegateManager();
    verificationFirst.begin("v1", role("verification"));
    assert.throws(() => verificationFirst.begin("sibling", role(roleId)), OVERLAP_ERROR);
    verificationFirst.finish("v1");
    verificationFirst.begin("sibling", role(roleId));
  }
  for (const roleId of ["solution-b", "solution-c", "review-b", "review-c"] as const) {
    const gateFirst = new DelegateManager();
    gateFirst.begin("gate", role(roleId));
    assert.throws(() => gateFirst.begin("v1", role("verification")), OVERLAP_ERROR);
  }
});

test("verification blocks implementation, remediation, and oracle roles in both directions", () => {
  for (const exclusive of EXCLUSIVE_ROLES) {
    const verificationFirst = new DelegateManager();
    verificationFirst.begin("v1", role("verification"));
    verificationFirst.begin("v2", role("verification"));
    assert.throws(() => verificationFirst.begin("mutator", exclusive), EXCLUSIVE_ERROR);
  }
  for (const exclusive of EXCLUSIVE_ROLES) {
    const exclusiveFirst = new DelegateManager();
    exclusiveFirst.begin("mutator", exclusive);
    assert.throws(() => exclusiveFirst.begin("v1", role("verification")), OVERLAP_ERROR);
  }
});

test("implementation, remediation, and oracle run exclusively against every active delegate", () => {
  for (const exclusive of EXCLUSIVE_ROLES) {
    // An active exclusive delegate blocks any new delegate.
    const exclusiveFirst = new DelegateManager();
    exclusiveFirst.begin("mutator", exclusive);
    assert.throws(() => exclusiveFirst.begin("review-a", role("review-a")), EXCLUSIVE_ERROR);
    assert.throws(() => exclusiveFirst.begin("other", role("implementation")), EXCLUSIVE_ERROR);
    exclusiveFirst.finish("mutator");
    exclusiveFirst.begin("review-a", role("review-a"));

    // Any active delegate blocks a new exclusive role.
    const blocked = new DelegateManager();
    blocked.begin("impl", role("implementation"));
    assert.throws(() => blocked.begin("rem", role("remediation")), EXCLUSIVE_ERROR);
    blocked.finish("impl");
    blocked.begin("review-b", role("review-b"));
    assert.throws(() => blocked.begin("oracle", role("oracle")), EXCLUSIVE_ERROR);
  }
});

test("solution and review concurrency is unchanged inside and across gates", () => {
  const manager = new DelegateManager();
  // Derived high-slot roles follow the same family concurrency rules.
  manager.begin("sz", role("solution-z"));
  manager.begin("rz", role("review-z"));
  manager.finish("sz");
  manager.finish("rz");
  manager.begin("s1", role("solution-a"));
  manager.begin("s2", role("solution-b"));
  manager.begin("s3", role("solution-c"));
  manager.begin("s4", role("solution-d"));
  manager.begin("s5", role("solution-e"));
  manager.begin("s6", role("solution-f"));
  manager.begin("r1", role("review-a"));
  manager.begin("r2", role("review-b"));
  manager.begin("r3", role("review-c"));
  manager.begin("r4", role("review-d"));
  manager.begin("r5", role("review-e"));
  for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"]) manager.finish(id);
  manager.begin("r6", role("review-a"));
  manager.begin("r7", role("review-b"));
  manager.begin("r8", role("review-e"));
});

// A temporary sixth reviewer may reuse a non-exclusive role: permanent
// review-e already occupies the five-member default gate.
test("a temporary sixth reviewer reuses an existing non-exclusive review role", () => {
  const manager = new DelegateManager();
  manager.begin("r1", role("review-a"));
  manager.begin("r2", role("review-b"));
  manager.begin("r3", role("review-c"));
  manager.begin("r4", role("review-d"));
  manager.begin("r5", role("review-e"));
  // The temporary sixth reviewer reuses review-a under a distinct
  // assignment; duplicate non-exclusive review roles overlap by design.
  const extra = manager.begin("r6-extra", role("review-a"));
  assert.equal(extra.id, 6);
  // Verification and exclusive roles still refuse to overlap the duplicate.
  assert.throws(() => manager.begin("v1", role("verification")), OVERLAP_ERROR);
  assert.throws(() => manager.begin("mutator", role("implementation")), EXCLUSIVE_ERROR);
  manager.finish("r6-extra");
  // The reuse leaves no residue: a later gate still starts the plain roles.
  manager.begin("r6", role("review-d"));
});

test("assigns monotonic numeric IDs without reusing completed IDs", () => {
  const manager = new DelegateManager();
  const first = manager.begin("tool-a", role("review-a"));
  const second = manager.begin("tool-b", role("review-b"));
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  manager.finish("tool-a");
  const third = manager.begin("tool-c", role("review-c"));
  assert.equal(third.id, 3);
  assert.deepEqual(manager.listActive().map((delegate) => delegate.id), [2, 3]);
});

test("stops only the selected delegate and retains it until cleanup finishes", () => {
  const manager = new DelegateManager();
  const first = manager.begin("tool-a", role("review-a"));
  const second = manager.begin("tool-b", role("review-b"));

  const stopped = manager.stop(first.id);
  assert.equal(stopped.status, "stopping");
  assert.equal(first.signal.aborted, true);
  assert.equal(first.signal.reason, "delegate_stop");
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
    activityIdleSeconds: 0,
    elapsedSeconds: 12.3,
    toolExecutionCount: 0,
    activityWarningCount: 0,
    progressWarningCount: 0,
    restartAfterWorkCount: 0,
    reportNudgeCount: 0,
    reportRound: 1,
    activityEventCount: 0,
    structuralProgressCount: 0,
    duplicateCheckpointCount: 0,
    ...overrides,
  };
}

test("active delegate progress supplies list state and elapsed time", () => {
  const manager = new DelegateManager();
  const handle = manager.begin("tool-a", role("review-a"));
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
  manager.begin("tool-a", role("solution-b"));
  const [delegate] = manager.listActive();
  assert.equal(delegate.state, "starting");
  assert.equal(delegate.route, "selecting route");
  assert.equal(delegate.phase, "starting");
  assert.equal(delegate.reportRound, 1);
  assert.equal(typeof delegate.elapsedSeconds, "number");
});

test("list choice labels render every field for starting and active-progress delegates", () => {
  const manager = new DelegateManager();
  manager.begin("starting-tool", role("solution-b"));
  manager.begin("active-tool", role("review-a"));
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
  const handles = ["v1", "v2", "v3", "v4"].map((id) => manager.begin(id, role("verification")));
  manager.abortAll("session_shutdown");
  for (const handle of handles) {
    assert.equal(handle.signal.aborted, true);
    assert.equal(handle.signal.reason, "session_shutdown");
  }
  // The cleared manager accepts a fresh verification batch without reusing IDs.
  assert.equal(manager.begin("fresh", role("verification")).id, 5);
});

test("combinedSignal records the first fixed interruption source and disposes listeners", () => {
  const first = new AbortController();
  const second = new AbortController();
  const combined = combinedSignal(first.signal, second.signal);
  assert.equal(combined.signal.aborted, false);
  second.abort("delegate_stop");
  assert.equal(combined.signal.aborted, true);
  assert.equal(combined.signal.reason, "delegate_stop");
  first.abort("PRIVATE arbitrary reason");
  assert.equal(combined.signal.reason, "delegate_stop", "first abort must win");
  combined.dispose();

  const upstream = new AbortController();
  upstream.abort("PRIVATE arbitrary reason");
  const toolAbort = combinedSignal(upstream.signal, new AbortController().signal);
  assert.equal(toolAbort.signal.reason, "tool_call_abort");
  toolAbort.dispose();
});
