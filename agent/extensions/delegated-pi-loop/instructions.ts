import type { ResolvedRole, RoleFamily } from "./routing.ts";

/**
 * Canonical module for every model-visible delegation instruction.
 *
 * This file owns instruction text and instruction builders only: parent tool
 * metadata, the parent workflow guidelines, the child role-family contracts,
 * the base child assignment prompt with its terminal-result contract, the
 * fixed restart note, and the report-recovery prompt. Enforcement stays in
 * the machine-policy modules: routing validation and selection in
 * `routing.ts`, concurrency in `manager.ts`, process lifecycle in
 * `runner.ts`/`supervisor.ts`, RPC protocol state in `protocol.ts`, report
 * parsing in `monitor.ts`, and resource isolation in `resources.ts`.
 *
 * Semantic types come from their owning modules: role families and resolved
 * roles derive from the validated routing registry in `routing.ts`, so no
 * instruction-side duplicate of the family policy exists here. The reference
 * document `docs/delegated-pi-loop-agent-instructions.md` renders its
 * model-visible sections from these exports through `docsync.ts`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Parent tool metadata
// ─────────────────────────────────────────────────────────────────────────────

/** Parent-facing `delegate_run` registration metadata. */
export const DELEGATE_RUN_TOOL = {
  name: "delegate_run",
  label: "Delegate Run",
  description:
    "Run one fresh bounded Pi RPC delegate in an isolated role. Routing, including model, thinking, and provider fallback after operational failures, is automatic from the extension-owned routing configuration. Streams the last sanitized child event and its UTC receipt time. A completed run returns the delegate's Markdown report; any other state returns a compact sanitized failure status and is marked as a tool error. The parent remains the sole orchestrator.",
  promptSnippet: "Run one fresh bounded delegate with role-specific routing and live event status",
} as const;

/** Parent-facing `delegate_model_catalog` registration metadata. */
export const DELEGATE_MODEL_CATALOG_TOOL = {
  name: "delegate_model_catalog",
  label: "Delegate Model Catalog",
  promptSnippet:
    "Look up configured delegate models, providers, and thinking levels before an exceptional routing override",
} as const;

/** Catalog description takes the policy-owned limit so text and cap cannot drift. */
export function modelCatalogToolDescription(maxLimit: number): string {
  return `Search the validated delegate routing model catalog (models, compatible providers, supported thinking levels, defaults) before an explicitly requested one-run routing substitution. Read-only lookup bounded by a limit of ${maxLimit}; it never invokes pi --list-models and never runs a delegate.`;
}

/** Concise catalog guidance: lookup only, never the parent delegation workflow. */
export const MODEL_CATALOG_PROMPT_GUIDELINES: readonly string[] = [
  "Before delegate_run, call delegate_model_catalog only when an explicit user or project operational request names a partial or unknown model for a one-run routing substitution; choose only a returned model, provider, and supported thinking-level combination.",
  "Keep routing overrides exceptional: allowed only for an explicit user or project operational request, never for the oracle role, and never as a routine substitute for the automatic config-driven routing; delegate_model_catalog itself changes nothing.",
];

// ─────────────────────────────────────────────────────────────────────────────
// Parent tool parameter descriptions
// ─────────────────────────────────────────────────────────────────────────────

/** Static model-visible `delegate_run` parameter descriptions. */
export const DELEGATE_RUN_PARAMETER_DESCRIPTIONS = {
  prompt:
    "Complete neutral role assignment, governing documents, scope, success checks, and prohibitions.",
  cwd: "Delegate working directory. Relative paths resolve from the parent Pi working directory.",
  availableSkills:
    "Pre-approved skills to make discoverable to this delegate. The delegate loads full skill instructions only when its task requires them.",
} as const;

/** Model-visible `routingOverride` parameter descriptions. */
export const ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS = {
  provider: "Pin or filter providers for this one run.",
  model: "Run this configured model for this one run.",
  thinking: "Thinking level for the overridden model.",
  excludeProviders: "Providers to exclude for this one run.",
  reason: "Mandatory non-empty justification for this exceptional routing change.",
} as const;

/** Role description names the configured gate roles from the routing snapshot. */
export function delegateRunRoleDescription(
  solutionRoleIds: readonly string[],
  reviewRoleIds: readonly string[],
): string {
  return `Assigned isolated role. Use the configured solution roles (${solutionRoleIds.join(", ")}) and review roles (${reviewRoleIds.join(", ")}) concurrently for their required gates.`;
}

/** Catalog parameter descriptions take the policy-owned limits. */
export function modelCatalogParameterDescriptions(limits: {
  readonly default: number;
  readonly max: number;
}): {
  readonly query: string;
  readonly provider: string;
  readonly thinking: string;
  readonly limit: string;
} {
  return {
    query: "Case-insensitive substring of a configured delegate model id.",
    provider: "Exact configured provider id to filter routes.",
    thinking: "Configured thinking level; keeps only routes that support it.",
    limit: `Maximum matches to return; default ${limits.default}, at most ${limits.max}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent workflow guidelines
// ─────────────────────────────────────────────────────────────────────────────

/** English count words for generated guidance; indexed families cap at 26 roles. */
const COUNT_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
  "twenty-one", "twenty-two", "twenty-three", "twenty-four", "twenty-five", "twenty-six",
] as const;

function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/** "a" / "a and b" / "a, b, and c" for dynamically named role gates. */
function joinRoleIds(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  if (ids.length === 1) return ids[0]!;
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  return `${ids.slice(0, -1).join(", ")}, and ${ids.at(-1)!}`;
}

/**
 * Parent-facing delegate_run guidance. The count-aware lines name every
 * configured solution and review role and its count, so resizing a gate in
 * routing.json regenerates the guidance without synchronized edits.
 */
export function delegateRunPromptGuidelines(
  solutionRoleIds: readonly string[],
  reviewRoleIds: readonly string[],
): readonly string[] {
  return [
    "Use delegate_run automatically for repository implementation changes unless the user explicitly opts out. The parent may directly make only a truly trivial edit with no behavior change or create and revise the plan and research deliverables defined below; the parent never manually implements a non-trivial or small implementation task.",
    "The parent owns planning and research deliverables: directly formulate, draft, edit, and save every plan, design note, investigation report, and research note, including repository artifacts such as PLAN.md. Those artifact writes are an explicit exception to automatic delegation even when they change repository files, and plan and research artifacts are distinguished by purpose, not only by file extension or location.",
    "Never call an implementation or remediation delegate to research, explore, formulate, draft, edit, save, or revise a plan or research deliverable. An implementation delegate executes only a parent-finalized implementation contract that changes product code, configuration, operational behavior, or implementation documentation such as README updates, ADRs, changelogs, policy files, and documentation accompanying code; a remediation delegate corrects only verification-confirmed findings in such implementation work.",
    "A pure planning or research request runs no implementation delegate, implementation review gate, or remediation; if the user later approves implementation, that later request follows the existing implementation delegation and review workflow.",
    "A small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and the oracle role and still runs exactly one implementation delegate.",
    `When no accepted solution contract exists and the root cause, architecture, or approach requires investigation, call delegate_run for ${joinRoleIds(solutionRoleIds)} concurrently with the same neutral assignment; all ${countWord(solutionRoleIds.length)} must complete before synthesis. Solution delegates may gather evidence and propose options, but the parent verifies the evidence, synthesizes conclusions, and remains sole author and owner of the final plan or research deliverable.`,
    "When one or more solution investigators of a solution gate fail operationally or end non-completed, the gate stays blocked by default; only the user may explicitly waive the named failed solution roles for that one current solution gate, and after that explicit waiver continue synthesis using only the completed solution reports plus parent-verified repository evidence instead of retrying or stopping solely because the waived investigators failed.",
    "At least one solution delegate must have completed: the user cannot waive the entire evidence set and synthesize from zero completed investigator reports. A solution waiver is one-shot and gate-scoped: it changes no later solution gates, role schema, routing, or concurrency; state which solution roles were waived and that the solution gate proceeded under user waiver, and never label a waived failure as completed or passed. A waiver does not fabricate or dismiss evidence, resolve uncertainties, authorize implementation, replace parent evidence verification, skip the advisory oracle when otherwise required, or weaken implementation, review, verification, or remediation rules.",
    "Do not infer a solution waiver from a generic request to continue, commit, or skip retries; precise user wording that names the failed solution role for the current gate, such as solution C may be waived for this gate, authorizes only that named waiver.",
    "After a required solution gate, call delegate_run for exactly one fresh read-only oracle review of the draft solution contract, and only when the parent session's current model is not one of the configured Oracle profile models; when it is, skip the oracle and finalize the solution contract directly.",
    "Give the oracle role the neutral problem, governing documents, verified evidence, the draft solution contract, constraints, and unresolved uncertainties; do not give it raw investigator reports or the parent's synthesis rationale.",
    "Treat the oracle as advisory, not the final authority: the oracle critiques the parent draft but never authors or saves the final plan. Verify its VALID or REVISE analysis like any other evidence, revise the draft contract when warranted, finalize it, and run no automatic oracle loop; a non-completed oracle run blocks implementation.",
    "The parent Pi agent must verify investigator evidence and finalize the solution contract before calling delegate_run for implementation.",
    "Call delegate_run for only one implementation, remediation, or oracle role at a time, and do not edit the working tree while that delegate runs.",
    `After inspecting the implementation delegate's diff and evidence, call delegate_run for ${joinRoleIds(reviewRoleIds)} concurrently with the same neutral review scope; all ${countWord(reviewRoleIds.length)} must complete.`,
    "When one or more reviewers of a review gate fail operationally or end non-completed, the gate stays blocked by default; only the user may explicitly waive the named failed reviewer roles for that one current gate, and after that explicit waiver continue with the completed review reports instead of retrying or stopping solely because the waived reviewers failed.",
    "A reviewer waiver is one-shot and gate-scoped: it changes no later gates, role schema, routing, or concurrency; state which reviewers were waived and that the gate completed under user waiver, and never label a waived failure as a reviewer pass. A waiver does not dismiss findings from completed reviewers or waive finding verification, remediation, or other safety rules.",
    "Do not infer a reviewer waiver from a generic request to continue, commit, or skip retries; precise user wording that names the failed reviewer for the current gate, such as C may be waived for this gate, authorizes only that named waiver.",
    "Process blocking review findings through fresh delegate_run verification roles: consolidate exact duplicate findings first, give each verification exactly one finding without sibling verification reports, and overlap verification only with other verification delegates.",
    `Run independent finding verifications concurrently in batches of at most four and keep dependent findings sequential; wait for every verification in the current batch before remediation, because a non-completed verification leaves its finding unresolved without erasing completed sibling reports. Send only verification-confirmed findings to one focused remediation role, then run a fresh ${countWord(reviewRoleIds.length)}-reviewer gate until no blocking findings remain.`,
    "Delegate routing, including model, thinking, and provider fallback after operational failures, is automatic from the extension-owned routing configuration; pass routingOverride only when the user or project explicitly requests an operational route change for that one run, never for the oracle role, and know that routingOverride never changes role permissions or concurrency.",
    "Treat every delegate_run state other than completed as a failed delegation reported as a tool error with sanitized status fields, and do not retry outside the tool's bounded operational route fallback without user-authorized diagnosis.",
    "Do not stage, commit, push, deploy, or mutate hosted services because a delegate completed; those transitions require separate explicit authorization.",
    "Use availableSkills to make only task-relevant pre-approved skills discoverable to a delegate; selection does not force full skill loading, and the delegate decides which selected skills it actually needs.",
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Child role-family contracts
// ─────────────────────────────────────────────────────────────────────────────

/** Family-owned child contracts, typed over the routing-owned family union. */
const ROLE_FAMILY_CONTRACTS: Readonly<Record<RoleFamily, string>> = {
  solution: `This is an independent read-only solution investigation. Do not edit files, mutate Git, or write to hosted services.
Report these sections: Problem interpretation; Root cause and relevant execution flow; Recommended solution; Alternatives and tradeoffs; Validation plan; Uncertainties and limits.
Support every material claim with exact path:line evidence. Distinguish observed facts from assumptions.`,

  review: `This is an independent read-only implementation review. Do not edit files, mutate Git, or write to hosted services.
Remain neutral. Do not infer expected findings. Report a verdict, structured findings, gate evidence, and deferred scope or limits.
Each finding must include severity, location, evidence, reproduction or interleaving, impact, required contract, and suggested validation.`,

  oracle: `This is the read-only advisory solution oracle. Do not edit files, mutate Git, write to hosted services, implement, or start delegates.
Review the supplied draft solution contract against the neutral problem, governing documents, and verified evidence.
Report exactly one verdict, VALID or REVISE, with correctness analysis, missing invariants and risks, better alternatives where material, exact path:line evidence, validation changes, and limits.
The verdict is advisory, not the final authority: the parent verifies oracle claims and owns the final contract.`,

  verification: `This is read-only finding verification. Do not edit files, fix the defect, broaden the review, mutate Git, or write to hosted services.
Classify the supplied finding as REPRODUCED, PARTIALLY REPRODUCED, NOT REPRODUCED, ALREADY FIXED, DUPLICATE, or ARCHITECTURE AMBIGUITY.
Report evidence, the exact remediation contract when applicable, and limits.`,

  remediation: `Implement only the focused remediation contract. Add the failing regression first or alongside the smallest correct fix.
Do not perform broad review, unrelated cleanup, Git transitions, hosted-service writes, or recursive delegation.
Report changed paths, implementation summary, exact checks and results, and remaining risks.`,

  implementation: `Implement only the assigned solution contract. Preserve user-owned changes and stated invariants.
Do not perform independent approval, unrelated cleanup, Git transitions, hosted-service writes, or recursive delegation.
Report changed paths, implementation summary, exact checks and results, and remaining risks.`,
};

/**
 * The contract text for one role family. The map is typed over the
 * routing-owned `RoleFamily` union, so every supported family has a contract
 * at compile time; an unrecognized runtime family value still fails closed
 * here instead of falling through to an implementation contract.
 */
export function roleFamilyContract(family: RoleFamily): string {
  // The widened lookup keeps the miss check honest at runtime even though
  // the typed record above is exhaustive at compile time.
  const contract: string | undefined = (ROLE_FAMILY_CONTRACTS as Record<string, string | undefined>)[family];
  if (contract === undefined) {
    throw new Error(`no role contract for family "${String(family)}"`);
  }
  return contract;
}

// ─────────────────────────────────────────────────────────────────────────────
// Base child assignment prompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one short generic child instruction prohibiting recursive or subagent
 * invocation. It deliberately names no parent tool: it protects against a
 * shell-spawned recursive Pi while keeping parent orchestration policy out
 * of child context.
 */
export const CHILD_RECURSION_PROHIBITION =
  "Execute this assigned role yourself. Do not spawn or orchestrate another Pi instance, Claude Code session, or subagent.";

/** Fixed child assignment rules shared by every role. */
export const CHILD_ASSIGNMENT_RULES = `Read all required context and project instructions before acting. More-specific project instructions win.
The working tree may contain user-owned changes. Do not reset, clean, stash, overwrite, or revert them.
Do not stage, commit, push, or mutate hosted services unless the assigned task explicitly authorizes that exact action.
Never expose credentials, tokens, cookies, or private keys in your report.`;

/** Fixed attempt-budget instructions for every child assignment. */
export const CHILD_ATTEMPT_BUDGET =
  "Allow at most two materially equivalent attempts for each required proof or gate. Stop after ten minutes without new evidence on one requirement. Do not repeat an action without new evidence. If a required result remains unavailable, stop unrelated work and report BLOCKED.";

/** Fixed terminal-result instructions for every child assignment. */
export const CHILD_TERMINAL_RESULT_INSTRUCTIONS = `End your final response with exactly one of these lines:

DELEGATE_RESULT: COMPLETED
DELEGATE_RESULT: BLOCKED
DELEGATE_RESULT: FAILED

A BLOCKED or FAILED result must carry exactly one reason line directly above the marker, containing one exact code and nothing else:

DELEGATE_REASON: <code>

Allowed BLOCKED codes: evidence_inaccessible (required evidence could not be accessed), user_decision_required (a user decision is required first), assignment_conflict (the assignment conflicts with itself or project rules), policy_restriction (a policy rule prevents the assigned work), budget_exhausted (the attempt budget ran out), external_dependency (an external dependency is unavailable), finding_reported (a finding was reported; reviews with findings must use COMPLETED instead).
Allowed FAILED codes: execution_failure (execution of the assigned work failed), verification_failure (a required verification failed), internal_inconsistency (the result contradicts itself), policy_violation (a policy rule was violated during execution).
Use only the exact code on the reason line: no prose, paths, or details. COMPLETED carries no reason line. Reviews with findings must use COMPLETED, never BLOCKED with finding_reported.

The marker must be the final non-whitespace line and must not appear earlier. The reason line must sit directly above the marker and appear exactly once. COMPLETED means this assigned role finished; a review may report required fixes and still use COMPLETED. After BLOCKED or FAILED, do not start another attempt or unrelated task.`;

/**
 * Fixed sanitized restart note appended to the next route attempt's private
 * prompt after an operational failure on an attempt that had already executed
 * tools or accepted report recovery. It is deliberately generic: it never
 * carries provider errors, raw output, tool payloads, reports, paths, or
 * credentials.
 */
export const RESTART_AFTER_WORK_NOTE =
  "Restart note: a previous route attempt for this same assignment may already have changed the working tree. Treat the current state of the working tree as authoritative: inspect the existing work before acting, build on it, and do not repeat an irreversible operation.";

/** Inputs for the shared child prompt composition; placeholders stay literal. */
export interface ComposedDelegatePromptInput {
  readonly taskHeading: string;
  readonly cwdSentence: string;
  readonly roleContractText: string;
  readonly assignedTask: string;
  /** Inserted after the assigned task; `undefined` omits the whole block. */
  readonly restartNote: string | undefined;
}

/**
 * Composes the base child assignment prompt from the canonical text blocks.
 * `buildDelegatePrompt` fills the inputs from a resolved role, and the
 * documentation renderer fills them with placeholders, so the documented
 * template and the spawned prompt share one composition.
 */
export function composeDelegatePrompt(input: ComposedDelegatePromptInput): string {
  const restart = input.restartNote === undefined ? "" : `\n${input.restartNote}\n`;
  return `${input.taskHeading}

${input.cwdSentence}

${CHILD_RECURSION_PROHIBITION}
${CHILD_ASSIGNMENT_RULES}

## Role contract

${input.roleContractText}

## Attempt budget

${CHILD_ATTEMPT_BUDGET}

## Assigned task

${input.assignedTask.trim()}
${restart}
## Terminal result

${CHILD_TERMINAL_RESULT_INSTRUCTIONS}
`;
}

export interface DelegatePromptOptions {
  /**
   * Append the fixed sanitized restart note. Callers always rebuild the
   * prompt from the original assignment, so the note is present at most once
   * and never stacks across repeated restarts.
   */
  readonly restartAfterWork?: boolean;
}

/** Builds the private child assignment prompt for one resolved registry role. */
export function buildDelegatePrompt(
  role: ResolvedRole,
  cwd: string,
  assignedPrompt: string,
  options: DelegatePromptOptions = {},
): string {
  return composeDelegatePrompt({
    taskHeading: `# Task: ${role.id}`,
    cwdSentence: `You are a fresh delegated CLI agent working directly in ${JSON.stringify(cwd)}.`,
    roleContractText: roleFamilyContract(role.family),
    assignedTask: assignedPrompt,
    restartNote: options.restartAfterWork === true ? RESTART_AFTER_WORK_NOTE : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Report recovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one fixed recovery prompt sent as RPC round 2 when round 1 settles
 * without a report or with an invalid terminal structure.
 */
export const REPORT_RECOVERY_PROMPT = `Your previous response did not satisfy the required final-report protocol.

Do not repeat the assigned task, investigation, tool calls, edits, or other work.
Return one complete, self-contained final report using only the evidence already
available in this session.

Follow the original terminal-result instructions exactly. Include exactly one
valid DELEGATE_RESULT line as the final non-whitespace line, and do not quote or
discuss that marker elsewhere. If the result is BLOCKED or FAILED, put exactly
one DELEGATE_REASON line directly above the marker with one exact allowed code
and no prose, paths, or details: BLOCKED allows evidence_inaccessible,
user_decision_required, assignment_conflict, policy_restriction,
budget_exhausted, external_dependency, finding_reported; FAILED allows
execution_failure, verification_failure, internal_inconsistency,
policy_violation. COMPLETED takes no reason line; reviews with findings must
use COMPLETED.`;
