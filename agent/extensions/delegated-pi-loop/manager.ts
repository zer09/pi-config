import { roleIsExclusive } from "./routes.ts";
import type { DelegateProgress, DelegateRole, ExtensionContext } from "./types.ts";

interface ActiveRun {
  readonly id: string;
  readonly role: DelegateRole;
  readonly controller: AbortController;
  progress: DelegateProgress;
}

function eventText(progress: DelegateProgress): string {
  return progress.lastEventDetail
    ? `${progress.lastEvent} (${progress.lastEventDetail})`
    : progress.lastEvent;
}

function formatAge(progress: DelegateProgress): string {
  const timestamp = Date.parse(progress.lastEventAt);
  if (!Number.isFinite(timestamp)) return progress.lastEventAt;
  const ageSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return `${progress.lastEventAt} · ${ageSeconds}s ago`;
}

export class DelegateManager {
  private readonly active = new Map<string, ActiveRun>();

  begin(id: string, role: DelegateRole, progress: DelegateProgress, ctx: ExtensionContext): AbortSignal {
    const exclusiveActive = [...this.active.values()].some((run) => roleIsExclusive(run.role));
    if (exclusiveActive || (roleIsExclusive(role) && this.active.size > 0)) {
      throw new Error("An implementation, remediation, or verification delegate must run sequentially");
    }
    const controller = new AbortController();
    this.active.set(id, { id, role, controller, progress });
    this.renderWidget(ctx);
    return controller.signal;
  }

  update(id: string, progress: DelegateProgress, ctx: ExtensionContext): void {
    const run = this.active.get(id);
    if (!run) return;
    run.progress = progress;
    this.renderWidget(ctx);
  }

  finish(id: string, ctx: ExtensionContext): void {
    this.active.delete(id);
    this.renderWidget(ctx);
  }

  abortAll(): void {
    for (const run of this.active.values()) run.controller.abort();
    this.active.clear();
  }

  private renderWidget(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || !ctx.ui) return;
    if (this.active.size === 0) {
      ctx.ui.setWidget("delegated-pi-loop", undefined);
      return;
    }

    const lines = [`Delegates: ${this.active.size} running`];
    for (const run of this.active.values()) {
      const progress = run.progress;
      lines.push(
        `${progress.label} | ${progress.route ?? "selecting route"} | ${progress.phase}`,
        `  last: ${eventText(progress)}`,
        `  at: ${formatAge(progress)}`,
      );
    }
    ctx.ui.setWidget("delegated-pi-loop", lines, { placement: "belowEditor" });
  }
}

export function combinedSignal(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second;
  return AbortSignal.any([first, second]);
}
