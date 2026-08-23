import type { DelegateRole } from "./types.ts";

export function routeKey(route: { readonly provider: string; readonly model: string; readonly thinking: string }): string {
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

export function roleLabel(role: DelegateRole): string {
  return role;
}

/**
 * Fixed sanitized restart note appended to the next route attempt's private
 * prompt after an operational failure on an attempt that had already executed
 * tools or accepted report recovery. It is deliberately generic: it never
 * carries provider errors, raw output, tool payloads, reports, paths, or
 * credentials.
 */
export const RESTART_AFTER_WORK_NOTE =
  "Restart note: a previous route attempt for this same assignment may already have changed the working tree. Treat the current state of the working tree as authoritative: inspect the existing work before acting, build on it, and do not repeat an irreversible operation.";

/**
 * Pre-spawn oracle guard, enforced before any artifact or child process:
 * main-model skip detection is model-id based against every model
 * reachable through the configured Oracle profile (all tiers), so the exact
 * model on any parent provider skips the oracle instead of reviewing
 * itself. Returning undefined means the run may proceed; the thrown message
 * stays bounded and model-visible so no fabricated oracle report is
 * produced.
 */
export function oracleGuard(
  role: DelegateRole,
  parentModelId: string | undefined,
  configuredOracleModelIds: ReadonlySet<string>,
): Error | undefined {
  if (role !== "oracle") return undefined;
  if (parentModelId !== undefined && configuredOracleModelIds.has(parentModelId)) {
    return new Error(
      `Skip the oracle role: the parent session already runs ${parentModelId}; finalize the solution contract directly`,
    );
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

export interface DelegatePromptOptions {
  /**
   * Append the fixed sanitized restart note. Callers always rebuild the
   * prompt from the original assignment, so the note is present at most once
   * and never stacks across repeated restarts.
   */
  readonly restartAfterWork?: boolean;
}

export function buildDelegatePrompt(
  role: DelegateRole,
  cwd: string,
  assignedPrompt: string,
  options: DelegatePromptOptions = {},
): string {
  const restart = options.restartAfterWork === true ? `\n${RESTART_AFTER_WORK_NOTE}\n` : "";
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
${restart}
## Terminal result

End your final response with exactly one of these lines:

DELEGATE_RESULT: COMPLETED
DELEGATE_RESULT: BLOCKED
DELEGATE_RESULT: FAILED

The marker must be the final non-whitespace line and must not appear earlier. COMPLETED means this assigned role finished; a review may report required fixes and still use COMPLETED. After BLOCKED or FAILED, do not start another attempt or unrelated task.
`;
}
