import { roleIsExclusive } from "./routes.ts";
import type { DelegateProgress, DelegateRole, DelegateState } from "./types.ts";

interface ActiveRun {
  readonly delegateId: number;
  readonly role: DelegateRole;
  readonly controller: AbortController;
  readonly startedAt: number;
  progress?: DelegateProgress;
}

export interface DelegateHandle {
  readonly id: number;
  readonly signal: AbortSignal;
}

export interface ActiveDelegate {
  readonly id: number;
  readonly role: DelegateRole;
  readonly state: DelegateState | "starting" | "stopping";
  readonly elapsedSeconds: number;
}

export type StopDelegateResult =
  | { readonly status: "stopping" | "already_stopping"; readonly delegate: ActiveDelegate }
  | { readonly status: "not_found" };

/** Maximum verification delegates that may overlap; the parent batches findings beyond this cap. */
export const VERIFICATION_CONCURRENCY_CAP = 4;

export class DelegateManager {
  private readonly active = new Map<string, ActiveRun>();
  private nextDelegateId = 1;

  begin(toolCallId: string, role: DelegateRole): DelegateHandle {
    const activeRoles = [...this.active.values()].map((run) => run.role);

    // Verification overlaps only sibling verifications: it never starts next
    // to a solution, review, implementation, remediation, or oracle role, and
    // those roles likewise never start next to an active verification.
    if (role === "verification") {
      if (activeRoles.some((active) => active !== "verification")) {
        throw new Error("A verification delegate may overlap only other verification delegates");
      }
      if (activeRoles.length >= VERIFICATION_CONCURRENCY_CAP) {
        throw new Error(
          `At most ${VERIFICATION_CONCURRENCY_CAP} verification delegates may run concurrently; batch the remaining findings after the current batch completes`,
        );
      }
    } else if (roleIsExclusive(role)) {
      if (activeRoles.length > 0) {
        throw new Error("An implementation, remediation, or oracle delegate must run sequentially against every active delegate");
      }
    } else {
      // Solution and review roles keep their existing concurrency, but an
      // active exclusive or verification role still blocks them.
      if (activeRoles.some(roleIsExclusive)) {
        throw new Error("An implementation, remediation, or oracle delegate must run sequentially against every active delegate");
      }
      if (activeRoles.some((active) => active === "verification")) {
        throw new Error("A verification delegate may overlap only other verification delegates");
      }
    }

    const controller = new AbortController();
    const delegateId = this.nextDelegateId++;
    this.active.set(toolCallId, {
      delegateId,
      role,
      controller,
      startedAt: performance.now(),
    });
    return { id: delegateId, signal: controller.signal };
  }

  update(toolCallId: string, progress: DelegateProgress): void {
    const run = this.active.get(toolCallId);
    if (run) run.progress = progress;
  }

  idFor(toolCallId: string | undefined): number | undefined {
    if (!toolCallId) return undefined;
    return this.active.get(toolCallId)?.delegateId;
  }

  listActive(): readonly ActiveDelegate[] {
    return [...this.active.values()]
      .sort((left, right) => left.delegateId - right.delegateId)
      .map((run) => this.describe(run));
  }

  stop(delegateId: number): StopDelegateResult {
    const run = [...this.active.values()].find((candidate) => candidate.delegateId === delegateId);
    if (!run) return { status: "not_found" };
    const delegate = this.describe(run);
    if (run.controller.signal.aborted) return { status: "already_stopping", delegate };
    run.controller.abort();
    return { status: "stopping", delegate: { ...delegate, state: "stopping" } };
  }

  finish(toolCallId: string): void {
    this.active.delete(toolCallId);
  }

  abortAll(): void {
    for (const run of this.active.values()) run.controller.abort();
    this.active.clear();
  }

  private describe(run: ActiveRun): ActiveDelegate {
    const elapsedSeconds = run.progress?.elapsedSeconds
      ?? Math.round((performance.now() - run.startedAt) / 100) / 10;
    return {
      id: run.delegateId,
      role: run.role,
      state: run.controller.signal.aborted ? "stopping" : (run.progress?.state ?? "starting"),
      elapsedSeconds,
    };
  }
}

export function combinedSignal(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second;
  return AbortSignal.any([first, second]);
}
