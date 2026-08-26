import { roleIsExclusive } from "./routes.ts";
import type { ResolvedRole } from "./routing.ts";
import type { DelegateProgress, DelegateState, InterruptionSource } from "./types.ts";

interface ActiveRun {
  readonly delegateId: number;
  readonly role: ResolvedRole;
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
  readonly role: string;
  readonly state: DelegateState | "starting" | "stopping";
  /** Route key ("provider/model:thinking") or an explicit placeholder before the first progress event. */
  readonly route: string;
  /** Monitor phase or "starting" before the first progress event. */
  readonly phase: string;
  /** Report round; a delegate without progress is still on its initial round 1. */
  readonly reportRound: 1 | 2;
  readonly elapsedSeconds: number;
}

/** Choice label for the /delegate:list picker: id, role, state, route, phase, round, elapsed. */
export function activeDelegateLabel(delegate: ActiveDelegate): string {
  return `#${delegate.id}  ${delegate.role}  ${delegate.state}  ${delegate.route}  phase=${delegate.phase}  round ${delegate.reportRound}/2  ${elapsedText(delegate.elapsedSeconds)}`;
}

function elapsedText(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = String(totalSeconds % 60).padStart(2, "0");
  return `${String(minutes).padStart(2, "0")}:${remainder}`;
}

export type StopDelegateResult =
  | { readonly status: "stopping" | "already_stopping"; readonly delegate: ActiveDelegate }
  | { readonly status: "not_found" };

/** Maximum verification delegates that may overlap; the parent batches findings beyond this cap. */
export const VERIFICATION_CONCURRENCY_CAP = 4;

export class DelegateManager {
  private readonly active = new Map<string, ActiveRun>();
  private nextDelegateId = 1;

  begin(toolCallId: string, role: ResolvedRole): DelegateHandle {
    // Admission requires a registry-resolved role, so classification is
    // family-owned and an unknown role can never reach the manager.
    const activeRoles = [...this.active.values()].map((run) => run.role);

    // Verification overlaps only sibling verifications: it never starts next
    // to a solution, review, implementation, remediation, or oracle role, and
    // those roles likewise never start next to an active verification.
    if (role.family === "verification") {
      if (activeRoles.some((active) => active.family !== "verification")) {
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
      if (activeRoles.some((active) => active.family === "verification")) {
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
    run.controller.abort("delegate_stop" satisfies InterruptionSource);
    return { status: "stopping", delegate: { ...delegate, state: "stopping" } };
  }

  finish(toolCallId: string): void {
    this.active.delete(toolCallId);
  }

  abortAll(source: InterruptionSource = "unknown"): void {
    for (const run of this.active.values()) run.controller.abort(source);
    this.active.clear();
  }

  private describe(run: ActiveRun): ActiveDelegate {
    const elapsedSeconds = run.progress?.elapsedSeconds
      ?? Math.round((performance.now() - run.startedAt) / 100) / 10;
    return {
      id: run.delegateId,
      role: run.role.id,
      state: run.controller.signal.aborted ? "stopping" : (run.progress?.state ?? "starting"),
      // A delegate that has not reported progress yet is still selecting its
      // route and sits in the monitor's initial phase at report round 1.
      route: run.progress?.route ?? "selecting route",
      phase: run.progress?.phase ?? "starting",
      reportRound: run.progress?.reportRound ?? 1,
      elapsedSeconds,
    };
  }
}

export interface CombinedSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

/** Maps arbitrary AbortSignal reasons to the fixed privacy-safe enum. */
export function interruptionSource(reason: unknown): InterruptionSource {
  return reason === "delegate_stop"
    || reason === "session_shutdown"
    || reason === "tool_call_abort"
    || reason === "unknown"
    ? reason
    : "unknown";
}

/**
 * Combines the upstream tool-call signal and manager-owned stop signal.
 * The first abort wins, and dispose removes both listeners on normal finish.
 */
export function combinedSignal(first: AbortSignal | undefined, second: AbortSignal): CombinedSignal {
  const controller = new AbortController();
  const abort = (source: InterruptionSource) => {
    if (!controller.signal.aborted) controller.abort(source);
  };
  const firstAbort = () => abort("tool_call_abort");
  const secondAbort = () => abort(interruptionSource(second.reason));
  if (first?.aborted) firstAbort();
  else first?.addEventListener("abort", firstAbort, { once: true });
  if (!controller.signal.aborted) {
    if (second.aborted) secondAbort();
    else second.addEventListener("abort", secondAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      first?.removeEventListener("abort", firstAbort);
      second.removeEventListener("abort", secondAbort);
    },
  };
}
