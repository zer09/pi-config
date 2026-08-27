import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLiveness, type LivenessAges, type LivenessThresholds } from "./liveness.ts";

const THRESHOLDS: LivenessThresholds = {
  activityWarningMs: 5 * 60 * 1000,
  activityIdleMs: 10 * 60 * 1000,
  progressWarningMs: 30 * 60 * 1000,
  progressStallMs: 45 * 60 * 1000,
};

function ages(overrides: Partial<LivenessAges> = {}): LivenessAges {
  return {
    rpcIdleMs: 0,
    activityIdleMs: 0,
    progressIdleMs: 0,
    activeToolIdleMs: undefined,
    duplicateCheckpointsSinceNovel: 0,
    ...overrides,
  };
}

test("fresh clocks keep the delegate running regardless of elapsed time", () => {
  assert.deepEqual(evaluateLiveness(ages(), THRESHOLDS), { action: "run" });
  // Ages below every warning threshold keep running; elapsed time is not
  // an input at all, so nothing in the model can see total runtime.
  assert.deepEqual(
    evaluateLiveness(ages({ rpcIdleMs: 4 * 60 * 1000, activityIdleMs: 4 * 60 * 1000 }), THRESHOLDS),
    { action: "run" },
  );
});

test("a silent active tool stalls with active_tool_idle before rpc or activity causes", () => {
  const decision = evaluateLiveness(
    ages({
      activeToolIdleMs: 10 * 60 * 1000,
      rpcIdleMs: 0,
      activityIdleMs: 10 * 60 * 1000,
      progressIdleMs: 10 * 60 * 1000,
    }),
    THRESHOLDS,
  );
  assert.deepEqual(decision, { action: "stall", cause: "active_tool_idle" });
});

test("rpc silence outranks an idle activity clock", () => {
  const decision = evaluateLiveness(
    ages({
      rpcIdleMs: 10 * 60 * 1000,
      activityIdleMs: 10 * 60 * 1000,
      progressIdleMs: 10 * 60 * 1000,
    }),
    THRESHOLDS,
  );
  assert.deepEqual(decision, { action: "stall", cause: "rpc_silent" });
});

test("valid RPC without accepted task activity stalls as activity_idle", () => {
  const decision = evaluateLiveness(
    ages({
      rpcIdleMs: 1 * 60 * 1000,
      activityIdleMs: 10 * 60 * 1000,
      progressIdleMs: 10 * 60 * 1000,
    }),
    THRESHOLDS,
  );
  assert.deepEqual(decision, { action: "stall", cause: "activity_idle" });
});

test("a progress lease expiry without duplicates stalls as progress_stagnation", () => {
  const decision = evaluateLiveness(
    ages({
      rpcIdleMs: 0,
      activityIdleMs: 0,
      progressIdleMs: 45 * 60 * 1000,
    }),
    THRESHOLDS,
  );
  assert.deepEqual(decision, { action: "stall", cause: "progress_stagnation" });
});

test("duplicate checkpoints since the last novel checkpoint classify as repeated_cycle", () => {
  const decision = evaluateLiveness(
    ages({
      progressIdleMs: 45 * 60 * 1000,
      duplicateCheckpointsSinceNovel: 1,
    }),
    THRESHOLDS,
  );
  assert.deepEqual(decision, { action: "stall", cause: "repeated_cycle" });
});

test("infinite fresh activity never renews structural progress and stagnates", () => {
  // Thinking deltas keep the activity clock fresh forever while the
  // structural clock ages past the full lease.
  const decision = evaluateLiveness(
    ages({
      rpcIdleMs: 0,
      activityIdleMs: 0,
      progressIdleMs: 45 * 60 * 1000,
    }),
    THRESHOLDS,
  );
  assert.deepEqual(decision, { action: "stall", cause: "progress_stagnation" });
});

test("warnings fire only below every stall threshold, activity before progress", () => {
  assert.deepEqual(
    evaluateLiveness(ages({ activityIdleMs: 5 * 60 * 1000 }), THRESHOLDS),
    { action: "warn", kind: "activity" },
  );
  assert.deepEqual(
    evaluateLiveness(
      ages({ activityIdleMs: 4 * 60 * 1000, progressIdleMs: 30 * 60 * 1000 }),
      THRESHOLDS,
    ),
    { action: "warn", kind: "progress" },
  );
  // Both leases are in warning range but below every stall: one activity
  // warning wins because it is the stronger near-term risk.
  assert.deepEqual(
    evaluateLiveness(
      ages({ activityIdleMs: 6 * 60 * 1000, progressIdleMs: 35 * 60 * 1000 }),
      THRESHOLDS,
    ),
    { action: "warn", kind: "activity" },
  );
});

test("boundaries are inclusive: exactly-at-threshold ages act", () => {
  assert.deepEqual(
    evaluateLiveness(ages({ activeToolIdleMs: 10 * 60 * 1000 }), THRESHOLDS),
    { action: "stall", cause: "active_tool_idle" },
  );
  assert.deepEqual(
    evaluateLiveness(ages({ rpcIdleMs: 10 * 60 * 1000 }), THRESHOLDS),
    { action: "stall", cause: "rpc_silent" },
  );
  assert.deepEqual(
    evaluateLiveness(ages({ activityIdleMs: 10 * 60 * 1000 }), THRESHOLDS),
    { action: "stall", cause: "activity_idle" },
  );
  assert.deepEqual(
    evaluateLiveness(ages({ progressIdleMs: 45 * 60 * 1000 }), THRESHOLDS),
    { action: "stall", cause: "progress_stagnation" },
  );
});

test("a novel checkpoint one millisecond before the warning keeps running", () => {
  assert.deepEqual(
    evaluateLiveness(ages({ progressIdleMs: 30 * 60 * 1000 - 1 }), THRESHOLDS),
    { action: "run" },
  );
  assert.deepEqual(
    evaluateLiveness(ages({ activityIdleMs: 5 * 60 * 1000 - 1 }), THRESHOLDS),
    { action: "run" },
  );
  // One millisecond below the stall thresholds the delegate still runs and
  // only warns; the stall itself stays inclusive at the exact threshold.
  assert.deepEqual(
    evaluateLiveness(ages({ activityIdleMs: 10 * 60 * 1000 - 1 }), THRESHOLDS),
    { action: "warn", kind: "activity" },
  );
  assert.deepEqual(
    evaluateLiveness(ages({ progressIdleMs: 45 * 60 * 1000 - 1 }), THRESHOLDS),
    { action: "warn", kind: "progress" },
  );
});

test("without an active tool the model falls back to the communication leases", () => {
  // No active tool: the tool idle input stays undefined and the stale
  // activity clock alone drives the stop, proving the active-tool branch is
  // a fallback-free addition rather than a required input.
  const decision = evaluateLiveness(
    ages({ activeToolIdleMs: undefined, rpcIdleMs: 60_000, activityIdleMs: 10 * 60 * 1000 }),
    THRESHOLDS,
  );
  assert.deepEqual(decision, { action: "stall", cause: "activity_idle" });
  assert.deepEqual(
    evaluateLiveness(ages({ activeToolIdleMs: undefined, progressIdleMs: 30 * 60 * 1000 }), THRESHOLDS),
    { action: "warn", kind: "progress" },
  );
});

test("an exhausted active tool lease wins over every other expired lease", () => {
  const decision = evaluateLiveness(
    ages({
      activeToolIdleMs: 10 * 60 * 1000,
      rpcIdleMs: 10 * 60 * 1000,
      activityIdleMs: 10 * 60 * 1000,
      progressIdleMs: 45 * 60 * 1000,
      duplicateCheckpointsSinceNovel: 3,
    }),
    THRESHOLDS,
  );
  assert.deepEqual(decision, { action: "stall", cause: "active_tool_idle" });
});
