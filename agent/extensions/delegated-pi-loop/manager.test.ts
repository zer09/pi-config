import assert from "node:assert/strict";
import test from "node:test";
import { combinedSignal, DelegateManager, VERIFICATION_CONCURRENCY_CAP } from "./manager.ts";
import type { DelegateRole } from "./types.ts";

const EXCLUSIVE_ROLES: readonly DelegateRole[] = ["implementation", "remediation", "oracle"];
const OVERLAP_ERROR = /A verification delegate may overlap only other verification delegates/;
const CAP_ERROR = /At most 4 verification delegates may run concurrently; batch the remaining findings/;
const EXCLUSIVE_ERROR = /An implementation, remediation, or oracle delegate must run sequentially against every active delegate/;

test("verification delegates overlap other verification delegates up to the four cap", () => {
  assert.equal(VERIFICATION_CONCURRENCY_CAP, 4);
  const manager = new DelegateManager();
  // One, two, three, and four concurrent verifications all start cleanly.
  for (let index = 1; index <= 4; index += 1) {
    manager.begin(`v${index}`, "verification");
  }
  // The fifth concurrent verification is rejected with a bounded batching error.
  assert.throws(() => manager.begin("v5", "verification"), CAP_ERROR);
  assert.throws(() => manager.begin("v6", "verification"), CAP_ERROR);
  // Finishing one verification releases a slot for the next finding.
  manager.finish("v2");
  manager.begin("v5", "verification");
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

test("abortAll aborts concurrent verification siblings", () => {
  const manager = new DelegateManager();
  const signals = ["v1", "v2", "v3", "v4"].map((id) => manager.begin(id, "verification"));
  manager.abortAll();
  for (const signal of signals) assert.equal(signal.aborted, true);
  // The cleared manager accepts a fresh verification batch again.
  manager.begin("fresh", "verification");
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
