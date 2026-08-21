import { roleIsExclusive } from "./routes.ts";
import type { DelegateRole } from "./types.ts";

interface ActiveRun {
  readonly id: string;
  readonly role: DelegateRole;
  readonly controller: AbortController;
}

/** Maximum verification delegates that may overlap; the parent batches findings beyond this cap. */
export const VERIFICATION_CONCURRENCY_CAP = 4;

export class DelegateManager {
  private readonly active = new Map<string, ActiveRun>();

  begin(id: string, role: DelegateRole): AbortSignal {
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
    this.active.set(id, { id, role, controller });
    return controller.signal;
  }

  finish(id: string): void {
    this.active.delete(id);
  }

  abortAll(): void {
    for (const run of this.active.values()) run.controller.abort();
    this.active.clear();
  }
}

export function combinedSignal(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second;
  return AbortSignal.any([first, second]);
}
