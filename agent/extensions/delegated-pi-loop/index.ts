import { realpath } from "node:fs/promises";
import path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { activeDelegateLabel, combinedSignal, DelegateManager } from "./manager.ts";
import { renderDelegateCall, renderDelegateResult } from "./render.ts";
import { allowedDelegateSkillNames, buildDelegateResourceSelection, loadDelegateResources } from "./resources.ts";
import { delegateToolResultPatch, finalizeDelegateRun } from "./result.ts";
import { runDelegate } from "./runner.ts";
import { DELEGATE_ROLES } from "./types.ts";
import type {
  DelegateProgress,
  DelegateRole,
  DelegateToolParams,
  ExtensionAPI,
  RoutingOverride,
  ToolResult,
} from "./types.ts";

const RoutingOverrideParameters = Type.Object({
  provider: Type.Optional(Type.String({
    minLength: 1,
    description: "Pin or filter providers for this one run.",
  })),
  model: Type.Optional(Type.String({
    minLength: 1,
    description: "Run this configured model for this one run.",
  })),
  thinking: Type.Optional(Type.String({
    minLength: 1,
    description: "Thinking level for the overridden model.",
  })),
  excludeProviders: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    description: "Providers to exclude for this one run.",
  })),
  reason: Type.String({
    minLength: 1,
    description: "Mandatory non-empty justification for this exceptional routing change.",
  }),
});

function delegateParameters(allowedSkillNames: readonly string[]) {
  return Type.Object({
    role: StringEnum(DELEGATE_ROLES, {
      description: "Assigned isolated role. Use solution A/B/C/D/E/F and review A/B/C/D/E concurrently for their required gates.",
    }),
    prompt: Type.String({
      minLength: 1,
      description: "Complete neutral role assignment, governing documents, scope, success checks, and prohibitions.",
    }),
    routingOverride: Type.Optional(RoutingOverrideParameters),
    cwd: Type.Optional(Type.String({
      description: "Delegate working directory. Relative paths resolve from the parent Pi working directory.",
    })),
    availableSkills: Type.Optional(Type.Array(
      StringEnum(allowedSkillNames),
      {
        description: "Pre-approved skills to make discoverable to this delegate. The delegate loads full skill instructions only when its task requires them.",
      },
    )),
  });
}

function partialResult(delegateId: number, progress: DelegateProgress): ToolResult {
  return {
    content: [{
      type: "text",
      text: `${progress.label}: ${progress.state}; last=${progress.lastEvent}; at=${progress.lastEventAt}`,
    }],
    details: { delegateId, progress },
  };
}

function finalResult(delegateId: number, result: ToolResult): ToolResult {
  return {
    ...result,
    details: { ...result.details, delegateId },
  };
}

export default function delegatedPiLoopExtension(pi: ExtensionAPI): void {
  // Delegated children load this extension explicitly from the resource
  // policy for the parent watchdog and recursion suppression only. The
  // child branch below stays minimal and must never parse the parent
  // resource policy. It suppresses the tool in children and lets the child
  // kill its own process group if the parent disappears.
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

  // Parent-only: load and strictly validate the delegated child resource
  // policy before any tool, command, or handler is registered. A missing or
  // invalid policy fails closed here with a bounded startup error; there is
  // no broad-discovery fallback. `/reload` re-runs this load with the rest
  // of the extension runtime.
  const delegateResources = loadDelegateResources();
  const DelegateParameters = delegateParameters(allowedDelegateSkillNames(delegateResources));

  const manager = new DelegateManager();

  pi.registerCommand("delegate:list", {
    description: "Show active delegates and prefill a targeted stop command.",
    handler: async (_args, ctx) => {
      const active = manager.listActive();
      if (active.length === 0) {
        ctx.ui.notify("No active delegates.", "info");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Active delegate selection requires an interactive UI.", "warning");
        return;
      }

      const labels = active.map(activeDelegateLabel);
      const selected = await ctx.ui.select("Active delegates", labels);
      if (!selected) return;
      const selectedIndex = labels.indexOf(selected);
      const delegate = active[selectedIndex];
      if (delegate) ctx.ui.setEditorText(`/delegate:stop ${delegate.id}`);
    },
  });

  pi.registerCommand("delegate:stop", {
    description: "Stop one active delegate by its displayed numeric ID.",
    handler: (args, ctx) => {
      const value = args.trim();
      if (!/^[1-9]\d*$/.test(value)) {
        ctx.ui.notify("Usage: /delegate:stop <positive numeric id>", "error");
        return;
      }
      const delegateId = Number(value);
      if (!Number.isSafeInteger(delegateId)) {
        ctx.ui.notify("Delegate ID is outside the supported numeric range.", "error");
        return;
      }

      const stopped = manager.stop(delegateId);
      if (stopped.status === "not_found") {
        ctx.ui.notify(`Delegate #${delegateId} is no longer active.`, "warning");
      } else if (stopped.status === "already_stopping") {
        ctx.ui.notify(`Delegate #${delegateId} is already stopping.`, "warning");
      } else {
        ctx.ui.notify(`Stopping delegate #${delegateId} (${stopped.delegate.role})...`, "info");
      }
    },
  });

  pi.on("session_shutdown", () => {
    manager.abortAll("session_shutdown");
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
    description: "Run one fresh bounded Pi RPC delegate in an isolated role. Routing, including model, thinking, and provider fallback after operational failures, is automatic from the extension-owned routing configuration. Streams the last sanitized child event and its UTC receipt time. A completed run returns the delegate's Markdown report; any other state returns a compact sanitized failure status and is marked as a tool error. The parent remains the sole orchestrator.",
    promptSnippet: "Run one fresh bounded delegate with role-specific routing and live event status",
    promptGuidelines: [
      "Use delegate_run automatically for repository implementation changes unless the user explicitly opts out. The parent may directly make only a truly trivial edit with no behavior change or create and revise the plan and research deliverables defined below; the parent never manually implements a non-trivial or small implementation task.",
      "The parent owns planning and research deliverables: directly formulate, draft, edit, and save every plan, design note, investigation report, and research note, including repository artifacts such as PLAN.md. Those artifact writes are an explicit exception to automatic delegation even when they change repository files, and plan and research artifacts are distinguished by purpose, not only by file extension or location.",
      "Never call an implementation or remediation delegate to research, explore, formulate, draft, edit, save, or revise a plan or research deliverable. An implementation delegate executes only a parent-finalized implementation contract that changes product code, configuration, operational behavior, or implementation documentation such as README updates, ADRs, changelogs, policy files, and documentation accompanying code; a remediation delegate corrects only verification-confirmed findings in such implementation work.",
      "A pure planning or research request runs no implementation delegate, implementation review gate, or remediation; if the user later approves implementation, that later request follows the existing implementation delegation and review workflow.",
      "A small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and the oracle role and still runs exactly one implementation delegate.",
      "When no accepted solution contract exists and the root cause, architecture, or approach requires investigation, call delegate_run for solution-a, solution-b, solution-c, solution-d, solution-e, and solution-f concurrently with the same neutral assignment; all six must complete before synthesis. Solution delegates may gather evidence and propose options, but the parent verifies the evidence, synthesizes conclusions, and remains sole author and owner of the final plan or research deliverable.",
      "When one or more solution investigators of a solution gate fail operationally or end non-completed, the gate stays blocked by default; only the user may explicitly waive the named failed solution roles for that one current solution gate, and after that explicit waiver continue synthesis using only the completed solution reports plus parent-verified repository evidence instead of retrying or stopping solely because the waived investigators failed.",
      "At least one solution delegate must have completed: the user cannot waive the entire evidence set and synthesize from zero completed investigator reports. A solution waiver is one-shot and gate-scoped: it changes no later solution gates, role schema, routing, or concurrency; state which solution roles were waived and that the solution gate proceeded under user waiver, and never label a waived failure as completed or passed. A waiver does not fabricate or dismiss evidence, resolve uncertainties, authorize implementation, replace parent evidence verification, skip the advisory oracle when otherwise required, or weaken implementation, review, verification, or remediation rules.",
      "Do not infer a solution waiver from a generic request to continue, commit, or skip retries; precise user wording that names the failed solution role for the current gate, such as solution C may be waived for this gate, authorizes only that named waiver.",
      "After a required solution gate, call delegate_run for exactly one fresh read-only oracle review of the draft solution contract, and only when the parent session's current model is not one of the configured Oracle profile models; when it is, skip the oracle and finalize the solution contract directly.",
      "Give the oracle role the neutral problem, governing documents, verified evidence, the draft solution contract, constraints, and unresolved uncertainties; do not give it raw investigator reports or the parent's synthesis rationale.",
      "Treat the oracle as advisory, not the final authority: the oracle critiques the parent draft but never authors or saves the final plan. Verify its VALID or REVISE analysis like any other evidence, revise the draft contract when warranted, finalize it, and run no automatic oracle loop; a non-completed oracle run blocks implementation.",
      "The parent Pi agent must verify investigator evidence and finalize the solution contract before calling delegate_run for implementation.",
      "Call delegate_run for only one implementation, remediation, or oracle role at a time, and do not edit the working tree while that delegate runs.",
      "After inspecting the implementation delegate's diff and evidence, call delegate_run for review-a, review-b, review-c, review-d, and review-e concurrently with the same neutral review scope; all five must complete.",
      "When one or more reviewers of a review gate fail operationally or end non-completed, the gate stays blocked by default; only the user may explicitly waive the named failed reviewer roles for that one current gate, and after that explicit waiver continue with the completed review reports instead of retrying or stopping solely because the waived reviewers failed.",
      "A reviewer waiver is one-shot and gate-scoped: it changes no later gates, role schema, routing, or concurrency; state which reviewers were waived and that the gate completed under user waiver, and never label a waived failure as a reviewer pass. A waiver does not dismiss findings from completed reviewers or waive finding verification, remediation, or other safety rules.",
      "Do not infer a reviewer waiver from a generic request to continue, commit, or skip retries; precise user wording that names the failed reviewer for the current gate, such as C may be waived for this gate, authorizes only that named waiver.",
      "Process blocking review findings through fresh delegate_run verification roles: consolidate exact duplicate findings first, give each verification exactly one finding without sibling verification reports, and overlap verification only with other verification delegates.",
      "Run independent finding verifications concurrently in batches of at most four and keep dependent findings sequential; wait for every verification in the current batch before remediation, because a non-completed verification leaves its finding unresolved without erasing completed sibling reports. Send only verification-confirmed findings to one focused remediation role, then run a fresh five-reviewer gate until no blocking findings remain.",
      "Delegate routing, including model, thinking, and provider fallback after operational failures, is automatic from the extension-owned routing configuration; pass routingOverride only when the user or project explicitly requests an operational route change for that one run, never for the oracle role, and know that routingOverride never changes role permissions or concurrency.",
      "Treat every delegate_run state other than completed as a failed delegation reported as a tool error with sanitized status fields, and do not retry outside the tool's bounded operational route fallback without user-authorized diagnosis.",
      "Do not stage, commit, push, deploy, or mutate hosted services because a delegate completed; those transitions require separate explicit authorization.",
      "Use availableSkills to make only task-relevant pre-approved skills discoverable to a delegate; selection does not force full skill loading, and the delegate decides which selected skills it actually needs.",
    ],
    parameters: DelegateParameters as unknown as Record<string, unknown>,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const role = params.role as DelegateRole;
      const routingOverride = params.routingOverride as RoutingOverride | undefined;
      const candidateCwd = params.cwd ? path.resolve(ctx.cwd, params.cwd) : ctx.cwd;
      const cwd = await realpath(candidateCwd);
      // Resolve the complete child resource selection before manager
      // admission, private artifact creation, or any child spawn. An
      // unsupported skill name fails here with only that name; the exact
      // arrays built here then cover every attempt and recovery round.
      const resourceSelection = buildDelegateResourceSelection(delegateResources, params.availableSkills);
      const handle = manager.begin(toolCallId, role);
      const runSignal = combinedSignal(signal, handle.signal);

      try {
        const result = await runDelegate({
          role,
          routingOverride,
          prompt: params.prompt,
          cwd,
          resourceSelection,
          // The oracle main-model skip reads the parent model id through
          // native extension context, never by inspecting the environment;
          // delegate providers come from routing.json alone.
          parentModelId: ctx.model?.id,
          signal: runSignal.signal,
          onProgress: (progress) => {
            manager.update(toolCallId, progress);
            onUpdate?.(partialResult(handle.id, progress));
          },
        });
        // Terminal finalization: persist the compact failure diagnostic for
        // unsuccessful runs (path travels only in details for the TUI
        // renderer), assemble the raw-Markdown ToolResult, then remove the
        // temporary supervision artifacts for every terminal outcome.
        return finalResult(handle.id, await finalizeDelegateRun(result));
      } finally {
        runSignal.dispose();
        manager.finish(toolCallId);
      }
    },

    renderCall: (args, theme, context) => (
      renderDelegateCall(args, theme, context, manager.idFor(context.toolCallId))
    ),
    renderResult: renderDelegateResult,
  });
}
