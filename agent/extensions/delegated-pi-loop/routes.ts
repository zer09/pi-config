import type { DelegateBackend, DelegateRole, PiRoute, ThinkingLevel } from "./types.ts";

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

// The oracle uses exactly the five D-eligible providers in the same canonical
// order. Cursor, AgentRouter, SeekAI, and every other provider are excluded.
const ORACLE_ELIGIBLE_PROVIDERS: readonly string[] = D_ELIGIBLE_PROVIDERS;
export const ORACLE_MODEL = "gpt-5.6-sol";
const ORACLE_THINKING: ThinkingLevel = "high";

export interface RoutesOptions {
  /** Parent session's currently selected provider from native extension context. */
  readonly parentProvider?: string;
  /** Injected randomness so tests pin the D and oracle primary without flakiness. */
  readonly random?: () => number;
}

function eligiblePrimary(eligible: readonly string[], options: RoutesOptions): string {
  const inherited = options.parentProvider !== undefined && eligible.includes(options.parentProvider)
    ? options.parentProvider
    : undefined;
  if (inherited !== undefined) return inherited;
  // Clamp keeps a misbehaving random source inside the eligible set.
  const value = options.random?.() ?? Math.random();
  const index = Math.max(0, Math.min(eligible.length - 1, Math.floor(value * eligible.length)));
  return eligible[index]!;
}

/**
 * Shared ordered chain for inherited-or-random provider roles: the primary is
 * the inherited parent provider when it is eligible, otherwise one random
 * eligible provider; the remaining providers follow in canonical order.
 * Selection happens once per call, so one delegate_run invocation yields
 * exactly one random draw.
 */
function eligibleProviderChain(
  model: string,
  thinking: ThinkingLevel,
  eligible: readonly string[],
  options: RoutesOptions,
): readonly PiRoute[] {
  const primary = eligiblePrimary(eligible, options);
  const remaining = eligible.filter((provider) => provider !== primary);
  const route = (provider: string): PiRoute => ({ kind: "pi", provider, model, thinking });
  return [route(primary), ...remaining.map(route)];
}

function dRoutes(options: RoutesOptions): readonly PiRoute[] {
  return eligibleProviderChain(D_MODEL, D_THINKING, D_ELIGIBLE_PROVIDERS, options);
}

function oracleRoutes(options: RoutesOptions): readonly PiRoute[] {
  return eligibleProviderChain(ORACLE_MODEL, ORACLE_THINKING, ORACLE_ELIGIBLE_PROVIDERS, options);
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

export function routesFor(
  role: DelegateRole,
  backend: DelegateBackend,
  options: RoutesOptions = {},
): readonly PiRoute[] {
  // The oracle must never silently replace Sol with another backend, so its
  // backend check precedes the explicit-backend overrides.
  if (role === "oracle") {
    if (backend !== "default") {
      throw new Error(`The oracle role requires default Pi routing; backend=${backend} must not replace ${ORACLE_MODEL}`);
    }
    return oracleRoutes(options);
  }
  if (backend === "zai") return [IMPLEMENTATION_ROUTE];

  if (role === "solution-a" || role === "review-a") return A_ROUTES;
  if (role === "solution-b" || role === "review-b") return B_ROUTES;
  if (role === "solution-c" || role === "review-c") return C_ROUTES;
  if (role === "solution-d" || role === "review-d") return dRoutes(options);
  if (role === "verification") return [VERIFICATION_ROUTE];
  return [IMPLEMENTATION_ROUTE];
}

export function routeKey(route: PiRoute): string {
  return `${route.provider}/${route.model}:${route.thinking}`;
}

export function roleIsReadOnly(role: DelegateRole): boolean {
  return role.startsWith("solution-") || role.startsWith("review-") || role === "verification" || role === "oracle";
}

export function roleIsExclusive(role: DelegateRole): boolean {
  // Verification is not exclusive: DelegateManager gives it its own bounded
  // rule (verification-only overlap, capped concurrency) instead.
  return role === "implementation" || role === "remediation" || role === "oracle";
}

export function roleLabel(role: DelegateRole, backend: DelegateBackend): string {
  const suffix = backend === "default" ? "" : `-${backend}`;
  return `${role}${suffix}`;
}

/**
 * Pre-spawn oracle guard, enforced before any artifact or child process:
 * - main-Sol skip: detection is model-id based, so gpt-5.6-sol on any parent
 *   provider skips the oracle instead of reviewing itself;
 * - backend: only default Pi routing may serve the oracle, so explicit Z.AI
 *   cannot silently replace Sol.
 * Returning undefined means the run may proceed; the thrown message stays
 * bounded and model-visible so no fabricated oracle report is produced.
 */
export function oracleGuard(
  role: DelegateRole,
  backend: DelegateBackend,
  parentModelId: string | undefined,
): Error | undefined {
  if (role !== "oracle") return undefined;
  if (parentModelId === ORACLE_MODEL) {
    return new Error(
      `Skip the oracle role: the parent session already runs ${ORACLE_MODEL}; finalize the solution contract directly`,
    );
  }
  if (backend !== "default") {
    return new Error(`The oracle role requires default Pi routing; backend=${backend} must not replace ${ORACLE_MODEL}`);
  }
  return undefined;
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

  if (role === "oracle") {
    return `This is the read-only advisory solution oracle. Do not edit files, mutate Git, write to hosted services, implement, or start delegates.
Review the supplied draft solution contract against the neutral problem, governing documents, and verified evidence.
Report exactly one verdict, VALID or REVISE, with correctness analysis, missing invariants and risks, better alternatives where material, exact path:line evidence, validation changes, and limits.
The verdict is advisory, not the final authority: the parent verifies oracle claims and owns the final contract.`;
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
