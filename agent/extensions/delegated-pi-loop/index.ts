import { realpath } from "node:fs/promises";
import path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { MODEL_CATALOG_DEFAULT_LIMIT, MODEL_CATALOG_MAX_LIMIT, modelCatalogToolResult, type ModelCatalogToolParams } from "./catalog.ts";
import {
  DELEGATE_MODEL_CATALOG_TOOL,
  DELEGATE_RUN_PARAMETER_DESCRIPTIONS,
  DELEGATE_RUN_TOOL,
  MODEL_CATALOG_PROMPT_GUIDELINES,
  ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS,
  delegateRunPromptGuidelines,
  delegateRunRoleDescription,
  modelCatalogParameterDescriptions,
  modelCatalogToolDescription,
} from "./instructions.ts";
import { activeDelegateLabel, combinedSignal, DelegateManager } from "./manager.ts";
import { renderDelegateCall, renderDelegateResult } from "./render.ts";
import { allowedDelegateSkillNames, buildDelegateResourceSelection, loadDelegateResources } from "./resources.ts";
import { delegateToolResultPatch, finalizeDelegateRun } from "./result.ts";
import { runDelegate } from "./runner.ts";
import { loadRoutingSnapshot, requireRole, roleIds, roleIdsInFamily } from "./routing.ts";
import type { RoutingConfig } from "./routing.ts";
import type {
  DelegateProgress,
  DelegateToolParams,
  ExtensionAPI,
  RoutingOverride,
  ToolResult,
} from "./types.ts";

const RoutingOverrideParameters = Type.Object({
  provider: Type.Optional(Type.String({
    minLength: 1,
    description: ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.provider,
  })),
  model: Type.Optional(Type.String({
    minLength: 1,
    description: ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.model,
  })),
  thinking: Type.Optional(Type.String({
    minLength: 1,
    description: ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.thinking,
  })),
  excludeProviders: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    description: ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.excludeProviders,
  })),
  reason: Type.String({
    minLength: 1,
    description: ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.reason,
  }),
});

function delegateParameters(allowedSkillNames: readonly string[], routing: RoutingConfig): unknown {
  return Type.Object({
    role: StringEnum(roleIds(routing), {
      description: delegateRunRoleDescription(),
    }),
    prompt: Type.String({
      minLength: 1,
      description: DELEGATE_RUN_PARAMETER_DESCRIPTIONS.prompt,
    }),
    routingOverride: Type.Optional(RoutingOverrideParameters),
    cwd: Type.Optional(Type.String({
      description: DELEGATE_RUN_PARAMETER_DESCRIPTIONS.cwd,
    })),
    availableSkills: Type.Optional(Type.Array(
      StringEnum(allowedSkillNames),
      {
        description: DELEGATE_RUN_PARAMETER_DESCRIPTIONS.availableSkills,
      },
    )),
  });
}

function modelCatalogParameters(thinkingLevels: readonly string[]): unknown {
  const descriptions = modelCatalogParameterDescriptions({
    default: MODEL_CATALOG_DEFAULT_LIMIT,
    max: MODEL_CATALOG_MAX_LIMIT,
  });
  return Type.Object({
    query: Type.String({
      minLength: 1,
      description: descriptions.query,
    }),
    provider: Type.Optional(Type.String({
      minLength: 1,
      description: descriptions.provider,
    })),
    thinking: Type.Optional(StringEnum(thinkingLevels, {
      description: descriptions.thinking,
    })),
    limit: Type.Optional(Type.Integer({
      minimum: 1,
      maximum: MODEL_CATALOG_MAX_LIMIT,
      description: descriptions.limit,
    })),
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
  // resource policy. It registers no tool, so no parent delegation
  // guideline ever enters child context, and it lets the child kill its
  // own process group if the parent disappears.
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
  // One validated routing snapshot backs both tools: the delegate_run role
  // enum, the dynamic role guidance, and the model catalog derive from it,
  // and the same instance flows into every execution so registration and
  // runtime never drift. Routing changes take effect after extension reload
  // or restart, which re-runs this factory and re-reads routing.json.
  const routingSnapshot = loadRoutingSnapshot();
  const solutionRoleIds = roleIdsInFamily(routingSnapshot, "solution");
  const reviewRoleIds = roleIdsInFamily(routingSnapshot, "review");
  const DelegateParameters = delegateParameters(allowedDelegateSkillNames(delegateResources), routingSnapshot);

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
    name: DELEGATE_RUN_TOOL.name,
    label: DELEGATE_RUN_TOOL.label,
    description: DELEGATE_RUN_TOOL.description,
    promptSnippet: DELEGATE_RUN_TOOL.promptSnippet,
    promptGuidelines: delegateRunPromptGuidelines(solutionRoleIds, reviewRoleIds),

    parameters: DelegateParameters as unknown as Record<string, unknown>,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Registry-owned runtime role validation before admission: the schema
      // enum comes from the same snapshot, but execution stays authoritative
      // and an unknown role can never fall through to a default contract.
      const role = requireRole(routingSnapshot, params.role);
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
          role: params.role,
          routingConfig: routingSnapshot,
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
        // Terminal finalization: persist the schema-8 run telemetry (the
        // compact failure diagnostic for unsuccessful runs, path travels only
        // in details for the TUI renderer, or one best-effort metadata-only
        // success record), assemble the raw-Markdown ToolResult, then remove
        // the temporary supervision artifacts for every terminal outcome.
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

  // Registered from the same validated routing snapshot as delegate_run, so
  // the searchable catalog can never drift from the routes actually used.
  // Delegated children never reach this registration: the child branch
  // above returns before any parent-only tool exists.
  pi.registerTool<ModelCatalogToolParams>({
    name: DELEGATE_MODEL_CATALOG_TOOL.name,
    label: DELEGATE_MODEL_CATALOG_TOOL.label,
    description: modelCatalogToolDescription(MODEL_CATALOG_MAX_LIMIT),
    promptSnippet: DELEGATE_MODEL_CATALOG_TOOL.promptSnippet,
    promptGuidelines: MODEL_CATALOG_PROMPT_GUIDELINES,
    parameters: modelCatalogParameters(routingSnapshot.thinkingLevels) as unknown as Record<string, unknown>,

    async execute(_toolCallId, params) {
      return modelCatalogToolResult(routingSnapshot, params);
    },
  });
}
