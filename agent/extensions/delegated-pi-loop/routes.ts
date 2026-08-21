import type {
  ClaudeRoute,
  DelegateBackend,
  DelegateRole,
  DelegateRoute,
  PiRoute,
  ThinkingLevel,
} from "./types.ts";

const A_ROUTES: readonly PiRoute[] = [
  { kind: "pi", provider: "opencode-go", model: "muse-spark-1.2-contributor", thinking: "xhigh" },
  { kind: "pi", provider: "agentrouter", model: "gpt-5.6-sol", thinking: "max" },
  { kind: "pi", provider: "tabitoken", model: "claude-opus-5-thinking", thinking: "max" },
  { kind: "pi", provider: "seekai", model: "claude-opus-5", thinking: "max" },
  { kind: "pi", provider: "gorouter", model: "claude-opus-5-thinking", thinking: "high" },
];

const B_ROUTES: readonly PiRoute[] = [
  { kind: "pi", provider: "opencode-go", model: "deepseek-v4-flash", thinking: "max" },
  { kind: "pi", provider: "seekai", model: "deepseek-v4-flash", thinking: "max" },
  { kind: "pi", provider: "agentrouter", model: "claude-opus-5", thinking: "max" },
  { kind: "pi", provider: "tabitoken", model: "claude-opus-5-thinking", thinking: "max" },
  { kind: "pi", provider: "gorouter", model: "claude-opus-5-thinking", thinking: "high" },
];

const C_ROUTES: readonly PiRoute[] = [
  { kind: "pi", provider: "opencode-go", model: "hy3", thinking: "high" },
  { kind: "pi", provider: "agentrouter", model: "claude-opus-5", thinking: "max" },
  { kind: "pi", provider: "tabitoken", model: "claude-opus-5-thinking", thinking: "max" },
  { kind: "pi", provider: "seekai", model: "claude-opus-5", thinking: "max" },
  { kind: "pi", provider: "gorouter", model: "claude-opus-5-thinking", thinking: "high" },
];

// D-eligible providers in stable canonical order. Cursor is excluded by
// definition: only these five OpenAI Codex providers may serve D.
const D_ELIGIBLE_PROVIDERS: readonly string[] = [
  "openai-codex",
  "openai-codex-zahlo",
  "openai-codex-cgpt1",
  "openai-codex-cgpt2",
  "openai-codex-cgpt3",
];
const D_MODEL = "gpt-5.5";
const D_THINKING: ThinkingLevel = "medium";

export interface RoutesOptions {
  /** Parent session's currently selected provider from native extension context. */
  readonly parentProvider?: string;
  /** Injected randomness so tests pin the D primary without flakiness. */
  readonly random?: () => number;
}

function dRoute(provider: string): PiRoute {
  return { kind: "pi", provider, model: D_MODEL, thinking: D_THINKING };
}

/**
 * D's ordered chain: the primary is the inherited parent provider when it is
 * eligible, otherwise one random eligible provider; the other four follow in
 * canonical order. Selection happens once per call, so one delegate_run
 * invocation yields exactly one random draw.
 */
function dRoutes(options: RoutesOptions): readonly PiRoute[] {
  const eligible = D_ELIGIBLE_PROVIDERS;
  const inherited = options.parentProvider !== undefined && eligible.includes(options.parentProvider)
    ? options.parentProvider
    : undefined;
  let primary = inherited;
  if (primary === undefined) {
    // Clamp keeps a misbehaving random source inside the eligible set.
    const value = options.random?.() ?? Math.random();
    const index = Math.max(0, Math.min(eligible.length - 1, Math.floor(value * eligible.length)));
    primary = eligible[index]!;
  }
  const remaining = eligible.filter((provider) => provider !== primary);
  return [dRoute(primary), ...remaining.map(dRoute)];
}

const IMPLEMENTATION_ROUTE: PiRoute = {
  kind: "pi",
  provider: "zai",
  model: "glm-5.3",
  thinking: "max",
};

const VERIFICATION_ROUTE: PiRoute = {
  kind: "pi",
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  thinking: "high",
};

const CLAUDE_ROUTE: ClaudeRoute = {
  kind: "claude",
  model: "claude-opus-5",
  effort: "medium",
};

export function routesFor(
  role: DelegateRole,
  backend: DelegateBackend,
  options: RoutesOptions = {},
): readonly DelegateRoute[] {
  if (backend === "zai") return [IMPLEMENTATION_ROUTE];
  if (backend === "claude") return [CLAUDE_ROUTE];

  if (role === "solution-a" || role === "review-a") return A_ROUTES;
  if (role === "solution-b" || role === "review-b") return B_ROUTES;
  if (role === "solution-c" || role === "review-c") return C_ROUTES;
  if (role === "solution-d" || role === "review-d") return dRoutes(options);
  if (role === "verification") return [VERIFICATION_ROUTE];
  return [IMPLEMENTATION_ROUTE];
}

export function routeKey(route: DelegateRoute): string {
  if (route.kind === "claude") return `claude-code/${route.model}:${route.effort}`;
  return `${route.provider}/${route.model}:${route.thinking}`;
}

export function roleIsReadOnly(role: DelegateRole): boolean {
  return role.startsWith("solution-") || role.startsWith("review-") || role === "verification";
}

export function roleIsExclusive(role: DelegateRole): boolean {
  return role === "implementation" || role === "remediation" || role === "verification";
}

export function roleLabel(role: DelegateRole, backend: DelegateBackend): string {
  const suffix = backend === "default" ? "" : `-${backend}`;
  return `${role}${suffix}`;
}

function roleContract(role: DelegateRole): string {
  if (role.startsWith("solution-")) {
    return `This is an independent read-only solution investigation. Do not edit files, mutate Git, or write to hosted services.
Report these sections: Problem interpretation; Root cause and relevant execution flow; Recommended solution; Alternatives and tradeoffs; Validation plan; Uncertainties and limits.
Support every material claim with exact path:line evidence. Distinguish observed facts from assumptions.`;
  }

  if (role.startsWith("review-")) {
    return `This is an independent read-only implementation review. Do not edit files, mutate Git, or write to hosted services.
Remain neutral. Do not infer expected findings. Report a verdict, structured findings, gate evidence, and deferred scope or limits.
Each finding must include severity, location, evidence, reproduction or interleaving, impact, required contract, and suggested validation.`;
  }

  if (role === "verification") {
    return `This is read-only finding verification. Do not edit files, fix the defect, broaden the review, mutate Git, or write to hosted services.
Classify the supplied finding as REPRODUCED, PARTIALLY REPRODUCED, NOT REPRODUCED, ALREADY FIXED, DUPLICATE, or ARCHITECTURE AMBIGUITY.
Report evidence, the exact remediation contract when applicable, and limits.`;
  }

  if (role === "remediation") {
    return `Implement only the focused remediation contract. Add the failing regression first or alongside the smallest correct fix.
Do not perform broad review, unrelated cleanup, Git transitions, hosted-service writes, or recursive delegation.
Report changed paths, implementation summary, exact checks and results, and remaining risks.`;
  }

  return `Implement only the assigned solution contract. Preserve user-owned changes and stated invariants.
Do not perform independent approval, unrelated cleanup, Git transitions, hosted-service writes, or recursive delegation.
Report changed paths, implementation summary, exact checks and results, and remaining risks.`;
}

export function buildDelegatePrompt(role: DelegateRole, cwd: string, assignedPrompt: string): string {
  return `# Task: ${role}

You are a fresh delegated CLI agent working directly in ${JSON.stringify(cwd)}.

Execute this assigned role yourself. Do not spawn or orchestrate another Pi instance, Claude Code session, or subagent.
Read all required context and project instructions before acting. More-specific project instructions win.
The working tree may contain user-owned changes. Do not reset, clean, stash, overwrite, or revert them.
Do not stage, commit, push, or mutate hosted services unless the assigned task explicitly authorizes that exact action.
Never expose credentials, tokens, cookies, or private keys in your report.

## Role contract

${roleContract(role)}

## Attempt budget

Allow at most two materially equivalent attempts for each required proof or gate. Stop after ten minutes without new evidence on one requirement. Do not repeat an action without new evidence. If a required result remains unavailable, stop unrelated work and report BLOCKED.

## Assigned task

${assignedPrompt.trim()}

## Terminal result

End your final response with exactly one of these lines:

DELEGATE_RESULT: COMPLETED
DELEGATE_RESULT: BLOCKED
DELEGATE_RESULT: FAILED

The marker must be the final non-whitespace line and must not appear earlier. COMPLETED means this assigned role finished; a review may report required fixes and still use COMPLETED. After BLOCKED or FAILED, do not start another attempt or unrelated task.
`;
}
