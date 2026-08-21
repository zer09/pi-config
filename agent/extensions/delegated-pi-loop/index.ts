import { realpath } from "node:fs/promises";
import path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { truncateUtf8 } from "./artifacts.ts";
import { combinedSignal, DelegateManager } from "./manager.ts";
import { renderDelegateCall, renderDelegateResult } from "./render.ts";
import { DELEGATE_TOOL_OUTPUT_LIMIT, runDelegate } from "./runner.ts";
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
    description: "Assigned isolated role. Use matching A/B/C roles concurrently for required three-member gates.",
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

function initialProgress(role: DelegateRole): DelegateProgress {
  const now = new Date().toISOString();
  return {
    label: role,
    role,
    state: "catalog_check",
    protocol: "pi-json",
    attempt: 0,
    phase: "starting",
    lastEvent: "extension_start",
    lastEventAt: now,
    idleSeconds: 0,
    elapsedSeconds: 0,
    toolExecutionCount: 0,
    idleWarningCount: 0,
  };
}

function partialResult(progress: DelegateProgress): ToolResult {
  return {
    content: [{
      type: "text",
      text: `${progress.label}: ${progress.state}; last=${progress.lastEvent}; at=${progress.lastEventAt}`,
    }],
    details: { progress },
  };
}

function finalText(state: string, report: string, reportPath: string, statusPath: string): string {
  const body = report.trim() || `Delegate ended with state: ${state}`;
  const { text, truncatedBytes } = truncateUtf8(body, DELEGATE_TOOL_OUTPUT_LIMIT - 1024);
  const truncation = truncatedBytes > 0
    ? `\n\n[Report truncated by ${truncatedBytes} bytes. Full report: ${reportPath}]`
    : "";
  return `${text}${truncation}\n\nDelegate state: ${state}\nStatus: ${statusPath}`;
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

  pi.registerTool<DelegateToolParams>({
    name: "delegate_run",
    label: "Delegate Run",
    description: "Run one fresh bounded Pi or Claude Code delegate in an isolated role. Default investigation and review roles use ordered provider fallback before any tool executes. Streams the last sanitized child event and its UTC receipt time. The parent remains the sole orchestrator.",
    promptSnippet: "Run one fresh bounded delegate with role-specific routing and live event status",
    promptGuidelines: [
      "Use delegate_run only when the user or project requests delegated investigation, implementation, review, verification, or remediation.",
      "When no accepted solution contract exists, call delegate_run for solution-a, solution-b, and solution-c concurrently with the same neutral assignment; all three must complete before synthesis.",
      "The parent Pi agent must verify investigator evidence and finalize the solution contract before calling delegate_run for implementation.",
      "Call delegate_run for only one implementation or remediation role at a time, and do not edit the working tree while that delegate runs.",
      "After implementation or remediation, call delegate_run for review-a, review-b, and review-c concurrently with the same neutral review scope; all three must complete.",
      "Process each blocking review finding through a fresh delegate_run verification role before a focused remediation role, then run a fresh three-reviewer gate.",
      "Use delegate_run backend=default unless the user or project explicitly selects Z.AI or Claude Code for the assigned role; backend selection never changes role mutation permissions.",
      "Treat every delegate_run state other than completed as a failed delegation, preserve its artifact paths, and do not retry outside the tool's bounded pre-tool route fallback without user-authorized diagnosis.",
      "Do not stage, commit, push, deploy, or mutate hosted services because a delegate completed; those transitions require separate explicit authorization.",
    ],
    parameters: DelegateParameters as unknown as Record<string, unknown>,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const role = params.role as DelegateRole;
      const backend = (params.backend ?? "default") as DelegateBackend;
      const candidateCwd = params.cwd ? path.resolve(ctx.cwd, params.cwd) : ctx.cwd;
      const cwd = await realpath(candidateCwd);
      const starting = initialProgress(role);
      const managerSignal = manager.begin(toolCallId, role, starting, ctx);
      const runSignal = combinedSignal(signal, managerSignal);

      try {
        const result = await runDelegate({
          role,
          backend,
          prompt: params.prompt,
          cwd,
          signal: runSignal,
          onProgress: (progress) => {
            manager.update(toolCallId, progress, ctx);
            onUpdate?.(partialResult(progress));
          },
        });
        return {
          content: [{
            type: "text",
            text: finalText(result.state, result.report, result.reportPath, result.statusPath),
          }],
          details: {
            state: result.state,
            role: result.role,
            backend: result.backend,
            selectedRoute: result.selectedRoute,
            attempts: result.attempts,
            artifactDir: result.artifactDir,
            reportPath: result.reportPath,
            statusPath: result.statusPath,
            elapsedSeconds: result.elapsedSeconds,
            progress: result.progress,
          },
        };
      } finally {
        manager.finish(toolCallId, ctx);
      }
    },

    renderCall: renderDelegateCall,
    renderResult: renderDelegateResult,
  });
}
