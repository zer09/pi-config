import { realpath } from "node:fs/promises";
import path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { combinedSignal, DelegateManager } from "./manager.ts";
import { renderDelegateCall, renderDelegateResult } from "./render.ts";
import { delegateToolResultPatch, finalizeDelegateRun } from "./result.ts";
import { runDelegate } from "./runner.ts";
import { DELEGATE_BACKENDS, DELEGATE_ROLES } from "./types.ts";
import type {
  DelegateBackend,
  DelegateProgress,
  DelegateRole,
  DelegateToolParams,
  ExtensionAPI,
  ToolResult,
} from "./types.ts";

const DelegateParameters = Type.Object({
  role: StringEnum(DELEGATE_ROLES, {
    description: "Assigned isolated role. Use matching A/B/C/D roles concurrently for required four-member gates.",
  }),
  prompt: Type.String({
    minLength: 1,
    description: "Complete neutral role assignment, governing documents, scope, success checks, and prohibitions.",
  }),
  backend: Type.Optional(StringEnum(DELEGATE_BACKENDS, {
    description: "Use default routing unless the user or project explicitly selected Z.AI or Claude Code.",
    default: "default",
  })),
  cwd: Type.Optional(Type.String({
    description: "Delegate working directory. Relative paths resolve from the parent Pi working directory.",
  })),
});

function partialResult(progress: DelegateProgress): ToolResult {
  return {
    content: [{
      type: "text",
      text: `${progress.label}: ${progress.state}; last=${progress.lastEvent}; at=${progress.lastEventAt}`,
    }],
    details: { progress },
  };
}

export default function delegatedPiLoopExtension(pi: ExtensionAPI): void {
  // Child delegates inherit all parent extensions. Suppress the tool in children
  // and let the child kill its own process group if the parent disappears.
  if (process.env.PI_DELEGATED_CHILD === "1") {
    let watchdog: NodeJS.Timeout | undefined;
    pi.on("session_start", () => {
      const parentPid = Number(process.env.PI_DELEGATE_PARENT_PID);
      if (!Number.isSafeInteger(parentPid) || parentPid <= 1) return;
      watchdog = setInterval(() => {
        try {
          process.kill(parentPid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
          try {
            if (process.platform === "win32") process.kill(process.pid, "SIGTERM");
            else process.kill(-process.pid, "SIGTERM");
          } catch {
            process.kill(process.pid, "SIGTERM");
          }
        }
      }, 1000);
      watchdog.unref();
    });
    pi.on("session_shutdown", () => {
      if (watchdog) clearInterval(watchdog);
    });
    return;
  }

  const manager = new DelegateManager();

  pi.on("session_shutdown", () => {
    manager.abortAll();
  });

  // Native tool-result lifecycle: unsuccessful delegate_run results are marked
  // as Pi tool errors while their Markdown content and renderer details stay
  // intact, so diagnostics never need to reach the model.
  pi.on("tool_result", (...args: unknown[]) => {
    const event = args[0] as { toolName: string; details?: unknown };
    return delegateToolResultPatch(event);
  });

  pi.registerTool<DelegateToolParams>({
    name: "delegate_run",
    label: "Delegate Run",
    description: "Run one fresh bounded Pi or Claude Code delegate in an isolated role. Default investigation and review roles use ordered provider fallback before any tool executes. Streams the last sanitized child event and its UTC receipt time. A completed run returns the delegate's Markdown report; any other state returns a compact sanitized failure status and is marked as a tool error. The parent remains the sole orchestrator.",
    promptSnippet: "Run one fresh bounded delegate with role-specific routing and live event status",
    promptGuidelines: [
      "Use delegate_run automatically for repository changes unless the user explicitly opts out; only a truly trivial edit, such as one typo with no behavior change, may be implemented directly by the parent.",
      "A small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and still runs exactly one implementation delegate.",
      "When no accepted solution contract exists and the root cause, architecture, or approach requires investigation, call delegate_run for solution-a, solution-b, solution-c, and solution-d concurrently with the same neutral assignment; all four must complete before synthesis.",
      "The parent Pi agent must verify investigator evidence and finalize the solution contract before calling delegate_run for implementation.",
      "Call delegate_run for only one implementation or remediation role at a time, and do not edit the working tree while that delegate runs.",
      "After inspecting the implementation delegate's diff and evidence, call delegate_run for review-a, review-b, review-c, and review-d concurrently with the same neutral review scope; all four must complete.",
      "Process each blocking review finding through a fresh delegate_run verification role, send only verification-confirmed findings to one focused remediation role, then run a fresh four-reviewer gate until no blocking findings remain.",
      "Use delegate_run backend=default unless the user or project explicitly selects Z.AI or Claude Code for the assigned role; backend selection never changes role mutation permissions.",
      "Treat every delegate_run state other than completed as a failed delegation reported as a tool error with sanitized status fields, and do not retry outside the tool's bounded pre-tool route fallback without user-authorized diagnosis.",
      "Do not stage, commit, push, deploy, or mutate hosted services because a delegate completed; those transitions require separate explicit authorization.",
    ],
    parameters: DelegateParameters as unknown as Record<string, unknown>,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const role = params.role as DelegateRole;
      const backend = (params.backend ?? "default") as DelegateBackend;
      const candidateCwd = params.cwd ? path.resolve(ctx.cwd, params.cwd) : ctx.cwd;
      const cwd = await realpath(candidateCwd);
      const managerSignal = manager.begin(toolCallId, role);
      const runSignal = combinedSignal(signal, managerSignal);

      try {
        const result = await runDelegate({
          role,
          backend,
          prompt: params.prompt,
          cwd,
          // D inherits the parent's selected provider through native
          // extension context, never by inspecting the environment.
          parentProvider: ctx.model?.provider,
          signal: runSignal,
          onProgress: (progress) => {
            onUpdate?.(partialResult(progress));
          },
        });
        // Terminal finalization: persist the compact failure diagnostic for
        // unsuccessful runs (path travels only in details for the TUI
        // renderer), assemble the raw-Markdown ToolResult, then remove the
        // temporary supervision artifacts for every terminal outcome.
        return await finalizeDelegateRun(result);
      } finally {
        manager.finish(toolCallId);
      }
    },

    renderCall: renderDelegateCall,
    renderResult: renderDelegateResult,
  });
}
