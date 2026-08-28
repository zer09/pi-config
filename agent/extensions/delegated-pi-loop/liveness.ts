import type { StallCause } from "./types.ts";

/**
 * Pure renewable-liveness watchdog model.
 *
 * This module owns only the threshold decision: it maps bounded liveness
 * ages and counters to the next watchdog action. It never reads clocks,
 * processes, or timers; `supervisor.ts` feeds it ages from the monitor
 * snapshot and executes the decision. Keeping the decision pure makes the
 * watchdog ordering deterministic and independently testable.
 *
 * Three independent leases drive the model:
 *
 * 1. valid-RPC health (communication only);
 * 2. accepted task activity (syntactically valid work events);
 * 3. novel structural progress (completed checkpoints not seen before).
 *
 * Total delegate elapsed time is deliberately absent: it never appears in
 * any decision, so no combination of ages plus elapsed time can terminate a
 * delegate that keeps completing novel structural checkpoints.
 */

/** Bounded liveness ages in milliseconds, all measured from the same instant. */
export interface LivenessAges {
  /** Age of the most recent valid RPC record (communication only). */
  readonly rpcIdleMs: number;
  /** Age of the most recent accepted task activity. */
  readonly activityIdleMs: number;
  /** Age of the most recent novel structural checkpoint. */
  readonly progressIdleMs: number;
  /** Idle age of the stalest active tool's most recent novel update, if any tool is active. */
  readonly activeToolIdleMs: number | undefined;
  /** Duplicate checkpoints observed since the last novel checkpoint. */
  readonly duplicateCheckpointsSinceNovel: number;
}

/** Fixed watchdog thresholds in milliseconds. */
export interface LivenessThresholds {
  readonly activityWarningMs: number;
  readonly activityIdleMs: number;
  readonly progressWarningMs: number;
  readonly progressStallMs: number;
}

/** One watchdog decision for the current tick. */
export type LivenessDecision =
  | { readonly action: "run" }
  | { readonly action: "warn"; readonly kind: "activity" | "progress" }
  | { readonly action: "stall"; readonly cause: StallCause };

/**
 * Evaluates the fixed watchdog precedence:
 *
 * 1. any active tool without a novel update for the activity-idle interval;
 * 2. no valid RPC for the activity-idle interval;
 * 3. valid RPC without accepted task activity for the activity-idle interval;
 * 4. no novel structural progress for the progress-stall interval, split by
 *    observed duplicate checkpoints into `repeated_cycle` versus
 *    `progress_stagnation`;
 * 5. warning thresholds (activity first, then progress);
 * 6. otherwise keep running.
 *
 * A warning never wins over a stall condition, and an older activity age
 * always dominates because it implies the weaker liveness proof.
 */
export function evaluateLiveness(ages: LivenessAges, thresholds: LivenessThresholds): LivenessDecision {
  if (ages.activeToolIdleMs !== undefined && ages.activeToolIdleMs >= thresholds.activityIdleMs) {
    return { action: "stall", cause: "active_tool_idle" };
  }
  if (ages.rpcIdleMs >= thresholds.activityIdleMs) {
    return { action: "stall", cause: "rpc_silent" };
  }
  if (ages.activityIdleMs >= thresholds.activityIdleMs) {
    return { action: "stall", cause: "activity_idle" };
  }
  if (ages.progressIdleMs >= thresholds.progressStallMs) {
    return {
      action: "stall",
      cause: ages.duplicateCheckpointsSinceNovel > 0 ? "repeated_cycle" : "progress_stagnation",
    };
  }
  if (ages.activityIdleMs >= thresholds.activityWarningMs) {
    return { action: "warn", kind: "activity" };
  }
  if (ages.progressIdleMs >= thresholds.progressWarningMs) {
    return { action: "warn", kind: "progress" };
  }
  return { action: "run" };
}
