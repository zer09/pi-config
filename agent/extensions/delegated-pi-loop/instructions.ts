import type { ResolvedRole, RoleFamily } from "./routing.ts";
import { BLOCKED_REASON_CODES, FAILED_REASON_CODES } from "./types.ts";

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
    "Run one fresh bounded isolated Pi delegate for one role. Routing and operational fallback are automatic. Returns a completed Markdown report; every other terminal state is a sanitized tool error. The parent remains sole orchestrator.",
  promptSnippet: "Run one fresh isolated delegated role",
} as const;

/** Parent-facing `delegate_model_catalog` registration metadata. */
export const DELEGATE_MODEL_CATALOG_TOOL = {
  name: "delegate_model_catalog",
  label: "Delegate Model Catalog",
  promptSnippet: "Resolve one exceptional delegate route",
} as const;

/** Catalog description takes the policy-owned limit so text and cap cannot drift. */
export function modelCatalogToolDescription(maxLimit: number): string {
  return `Search configured delegate routes for an explicitly requested one-run override. Returns compatible model, provider, and thinking combinations; read-only, maximum ${maxLimit}, and never runs a delegate.`;
}

/** Concise catalog guidance: lookup only, never the parent delegation workflow. */
export const MODEL_CATALOG_PROMPT_GUIDELINES: readonly string[] = [
  "delegate_model_catalog: Use only to resolve a partial or unknown model in an explicit user or project request for a one-run operational override; choose only a returned compatible combination.",
  "delegate_model_catalog: Lookup changes nothing. Automatic routing remains default; routingOverride stays exceptional and is never allowed for oracle.",
];

// ─────────────────────────────────────────────────────────────────────────────
// Parent tool parameter descriptions
// ─────────────────────────────────────────────────────────────────────────────

/** Static model-visible `delegate_run` parameter descriptions. */
export const DELEGATE_RUN_PARAMETER_DESCRIPTIONS = {
  prompt:
    "Self-contained neutral assignment: goal, governing documents and relevant evidence, scope, success checks, prohibitions, and required report.",
  cwd: "Delegate cwd; relative paths resolve from parent cwd.",
  availableSkills:
    "Approved skills visible to the child; full instructions load only if needed.",
} as const;

/** Model-visible `routingOverride` parameter descriptions. */
export const ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS = {
  provider: "Restrict this run to one provider.",
  model: "Use this configured model for this run.",
  thinking: "Thinking level for the model; requires model.",
  excludeProviders: "Exclude these providers from this run.",
  reason: "Why this explicit one-run override is required.",
} as const;

/** Role description stays compact because the schema enum owns exact role ids. */
export function delegateRunRoleDescription(): string {
  return "Choose one configured role. Gate members and sequencing are listed in delegate_run guidelines.";
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
    query: "Case-insensitive configured model-id substring.",
    provider: "Exact provider-id filter.",
    thinking: "Thinking-level filter.",
    limit: `Maximum matches: default ${limits.default}, maximum ${limits.max}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent workflow guidelines
// ─────────────────────────────────────────────────────────────────────────────

/** "a" / "a and b" / "a, b, and c" for dynamically named role gates. */
function joinRoleIds(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  if (ids.length === 1) return ids[0]!;
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  return `${ids.slice(0, -1).join(", ")}, and ${ids.at(-1)!}`;
}

/**
 * Parent-facing delegate_run guidance. Every flat Pi guideline names its tool;
 * the two gate lines derive exact role ids from the routing snapshot.
 */
export function delegateRunPromptGuidelines(
  solutionRoleIds: readonly string[],
  reviewRoleIds: readonly string[],
): readonly string[] {
  return [
    "delegate_run [Ownership]: Use for repository implementation unless the user explicitly opts out. Parent may directly make only trivial no-behavior edits. Parent directly owns all planning and research deliverables, including repository artifacts classified by purpose. Pure planning or research runs no implementation, review, or remediation; later approval starts this workflow.",
    "delegate_run [Role scope]: Never use implementation or remediation for research or plans. Implementation executes one parent-finalized contract for code, configuration, operational behavior, or accompanying docs. Remediation executes only verification-confirmed fixes.",
    "delegate_run [Fast path]: If an accepted solution contract exists, skip solution and oracle. For a small task with an accepted plan or obvious established pattern, parent finalizes the contract, skips solution and oracle, and runs exactly one implementation.",
    `delegate_run [Investigation]: If root cause, architecture, or approach needs investigation, run ${joinRoleIds(solutionRoleIds)} concurrently with the same neutral assignment and wait for every role. They gather evidence and options; parent verifies, synthesizes, and solely authors the final deliverable and contract.`,
    "delegate_run [Gate failure]: Any required non-completed solution or review role blocks its gate. Continue only under an applicable OVERRIDE: directive naming the failed role(s) and current gate. Record the override and never label failures completed or passed; generic continue, commit, or skip-retry wording waives nothing.",
    "delegate_run [Partial evidence]: Without a broader OVERRIDE:, solution synthesis requires at least one completed report and uses only completed reports plus parent-verified repository evidence. Findings from completed reviews remain binding and follow verification and remediation unless an OVERRIDE: explicitly waives them.",
    "delegate_run [Oracle]: After a required solution gate, parent verifies evidence and drafts the contract, then runs one fresh read-only oracle unless the parent model is in the configured Oracle model set. Give only the neutral problem, governing documents, verified evidence, draft contract, constraints, and unresolved uncertainties; exclude raw solution reports and parent synthesis rationale.",
    "delegate_run [Oracle decision]: Oracle is advisory and returns VALID or REVISE; it never authors or saves the final plan. Parent verifies its claims, revises if warranted, finalizes the contract, and never loops automatically. A non-completed oracle blocks implementation.",
    "delegate_run [Execution]: After finalizing the contract, run exactly one implementation delegate. Run only one implementation, remediation, or oracle at a time, and do not edit the working tree while it runs.",
    `delegate_run [Review]: Inspect the implementation diff and evidence, then run ${joinRoleIds(reviewRoleIds)} concurrently with the same neutral scope; wait for every role unless an applicable OVERRIDE: says otherwise.`,
    "delegate_run [Findings]: Consolidate exact duplicate blocking findings. Give each fresh verification exactly one finding and no sibling reports. Run independent verifications in batches of at most four, dependent findings sequentially, and overlap only verification with verification. Wait for the full batch; a non-completed verification leaves that finding unresolved without erasing completed siblings.",
    "delegate_run [Remediation]: Send only verification-confirmed findings to one focused remediation, then repeat the full review gate until no blocking findings remain.",
    "delegate_run [Routing]: Routing and operational fallback are automatic. Use delegate_model_catalog and routingOverride only for an explicit user or project one-run operational route request; never override oracle or change permissions or concurrency.",
    "delegate_run [Failure and authority]: Treat every non-completed state as a failed tool-error delegation; do not retry beyond bounded fallback without user-authorized diagnosis. Delegate completion never authorizes staging, committing, pushing, deploying, or hosted-service mutation; each requires separate explicit authorization.",
    "delegate_run [Skills]: Pass only task-relevant pre-approved availableSkills. Selection exposes skills but never forces full loading.",
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Child role-family contracts
// ─────────────────────────────────────────────────────────────────────────────

/** Family-owned child contracts, typed over the routing-owned family union. */
const ROLE_FAMILY_CONTRACTS: Readonly<Record<RoleFamily, string>> = {
  solution: `Independent read-only solution investigation. Do not edit files or change Git or hosted state.
Report: problem interpretation; root cause and execution flow; recommended solution; alternatives and tradeoffs; validation plan; uncertainties and limits.
Support each material claim with exact path:line evidence. Separate facts from assumptions.`,

  review: `Independent neutral read-only implementation review. Do not edit files or change Git or hosted state; do not infer expected findings.
Report: verdict; structured findings; gate evidence; deferred scope and limits.
Each finding: severity; location; evidence; reproduction or interleaving; impact; required contract; suggested validation.`,

  oracle: `Read-only advisory solution oracle. Do not edit, implement, delegate, or change Git or hosted state.
Review the draft contract against the neutral problem, governing documents, and verified evidence.
Report exactly one verdict, VALID or REVISE, plus correctness analysis, missing invariants and risks, material alternatives, exact path:line evidence, validation changes, and limits. Parent verifies claims and owns the final contract.`,

  verification: `Read-only verification of one supplied finding. Do not edit, fix, broaden review, or change Git or hosted state.
Classify: REPRODUCED, PARTIALLY REPRODUCED, NOT REPRODUCED, ALREADY FIXED, DUPLICATE, or ARCHITECTURE AMBIGUITY.
Report evidence, the exact remediation contract when applicable, and limits.`,

  remediation: `Implement only the focused remediation contract. Add the failing regression before or with the smallest correct fix.
Do not broaden review, perform unrelated cleanup, make Git or hosted transitions, or delegate.
Report: changed paths; implementation summary; exact checks and results; remaining risks.`,

  implementation: `Implement only the assigned contract; preserve user-owned changes and stated invariants.
Do not independently approve, perform unrelated cleanup, make Git or hosted transitions, or delegate.
Report: changed paths; implementation summary; exact checks and results; remaining risks.`,
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
  "Do this role yourself. Do not start or orchestrate another agent process or subagent.";

/** Fixed child assignment rules shared by every role. */
export const CHILD_ASSIGNMENT_RULES = `Follow applicable project instructions; more specific wins.
Preserve user changes; never reset, clean, stash, overwrite, or revert.
Do not stage, commit, push, deploy, or write hosted services unless this assignment explicitly authorizes that action.
Never expose credentials, tokens, cookies, or private keys.`;

/** Fixed semantic attempt-budget instructions; the supervisor owns wall-clock limits. */
export const CHILD_ATTEMPT_BUDGET =
  "For each required proof or gate, make at most two materially equivalent attempts. Repeat only when new evidence justifies it. If a required result remains unavailable, stop unrelated work and report BLOCKED.";

const BLOCKED_REASON_CODE_LIST = BLOCKED_REASON_CODES.join(", ");
const FAILED_REASON_CODE_LIST = FAILED_REASON_CODES.join(", ");

/** Fixed terminal-result instructions for every child assignment. */
export const CHILD_TERMINAL_RESULT_INSTRUCTIONS = `End with exactly one form and no text after it:

DELEGATE_RESULT: COMPLETED

or

DELEGATE_REASON: <blocked-code>
DELEGATE_RESULT: BLOCKED

or

DELEGATE_REASON: <failed-code>
DELEGATE_RESULT: FAILED

BLOCKED codes: ${BLOCKED_REASON_CODE_LIST}.
FAILED codes: ${FAILED_REASON_CODE_LIST}.

Use one matching code with no prose, path, or details. DELEGATE_RESULT appears once as the final nonblank line; DELEGATE_REASON appears once directly above it. COMPLETED has no reason. COMPLETED means this role finished even when a review found defects; reviews with findings use COMPLETED. After BLOCKED or FAILED, stop.`;

/**
 * Fixed sanitized restart note appended to the next route attempt's private
 * prompt after an operational failure on an attempt that had already executed
 * tools or accepted report recovery. It is deliberately generic: it never
 * carries provider errors, raw output, tool payloads, reports, paths, or
 * credentials.
 */
export const RESTART_AFTER_WORK_NOTE =
  "Restart: a prior route attempt may have changed the tree. Inspect current work first; treat it as authoritative, continue from it, and do not repeat irreversible actions.";

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
  const restart = input.restartNote === undefined ? "" : `\n\n${input.restartNote}`;
  return `${input.taskHeading}

${input.cwdSentence}

${CHILD_RECURSION_PROHIBITION}
${CHILD_ASSIGNMENT_RULES}

## Role

${input.roleContractText}

## Assignment

${input.assignedTask.trim()}${restart}

## Attempt limits

${CHILD_ATTEMPT_BUDGET}

## Final protocol

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
    cwdSentence: `Fresh delegated CLI agent working directly in ${JSON.stringify(cwd)}.`,
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
export const REPORT_RECOVERY_PROMPT = `The previous response lacked a valid final report.

Do not repeat work or call tools. Using only existing session evidence, return one complete self-contained report.

Follow the original Final protocol. Include exactly one DELEGATE_RESULT line as the final nonblank line; for BLOCKED or FAILED, put one valid DELEGATE_REASON line directly above it; COMPLETED has none. Do not quote or discuss either marker.`;
