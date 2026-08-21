import { roleIsExclusive } from "./routes.ts";
import type { DelegateRole } from "./types.ts";

interface ActiveRun {
  readonly id: string;
  readonly role: DelegateRole;
  readonly controller: AbortController;
}

export class DelegateManager {
  private readonly active = new Map<string, ActiveRun>();

  begin(id: string, role: DelegateRole): AbortSignal {
    const exclusiveActive = [...this.active.values()].some((run) => roleIsExclusive(run.role));
    if (exclusiveActive || (roleIsExclusive(role) && this.active.size > 0)) {
      throw new Error("An implementation, remediation, or verification delegate must run sequentially");
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
