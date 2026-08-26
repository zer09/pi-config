# Delegated Pi Loop: Agent Instructions and Runtime Usage

The installed extension is named **`delegated-pi-loop`**. Its entry point is:

`agent/extensions/delegated-pi-loop/index.ts`

Every model-visible delegation instruction is centralized in one canonical TypeScript module:

`agent/extensions/delegated-pi-loop/instructions.ts`

It provides the `delegate_run` tool, the read-only `delegate_model_catalog` lookup tool, and two interactive commands. Three instruction layers affect delegation:

1. Parent-facing `delegate_run` tool metadata, parameter descriptions, and workflow guidelines. This layer is tool-scoped: Pi includes it only while `delegate_run` is active, so the parent receives the complete delegation workflow exactly once.
2. The generated child assignment prompt with its role-family contract, attempt budget, generic recursion prohibition, and terminal-result contract.
3. The fixed report-recovery prompt for RPC round 2.

`agent/AGENTS.md` carries no delegation policy. The former detailed `## Delegated work` section was removed when instruction centralization landed, so the global context file no longer duplicates the tool-scoped workflow. This also saves child context: delegated children load `AGENTS.md` as a normal context file but no longer pay for parent orchestration policy they must not follow.

Runtime code separately enforces routing, concurrency, isolation, deadlines, report validation, and cleanup. Enforcement never lives in `instructions.ts`: routing validation and selection stay in `routing.ts`, concurrency in `manager.ts`, process lifecycle in `runner.ts`/`supervisor.ts`, RPC protocol state in `protocol.ts`, report parsing in `monitor.ts`, and resource isolation in `resources.ts`.

## Generated-section synchronization

Every section marked with `<!-- pi-delegated-instructions:begin:... -->` / `<!-- pi-delegated-instructions:end:... -->` comments below is rendered mechanically from the canonical exports in `instructions.ts` (plus the shipped routing snapshot for the count-aware parts) by `agent/extensions/delegated-pi-loop/docsync.ts`. Regenerate them after any instruction change:

```bash
cd ~/.pi/agent/extensions/delegated-pi-loop
npm run render:instructions-doc
```

`docsync.test.ts` fails when the checked-in content drifts from the canonical exports for the shipped routing snapshot. The surrounding runtime explanation is manually authored. This marker mechanism manages only these fixed, named sections; it is not a general-purpose Markdown template language.

## 1. Where the parent receives delegation instructions

Pi adds a custom tool's `promptSnippet` to **Available tools** and its `promptGuidelines` to **Guidelines** while the tool is active. See:

- Pi behavior: `/home/gc/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` (custom tools)
- Tool registration: `agent/extensions/delegated-pi-loop/index.ts` consumes `DELEGATE_RUN_TOOL` and `delegateRunPromptGuidelines` from `instructions.ts`

Because the policy is tool-scoped, tool-scoped prompt content is absent when `delegate_run` is inactive, and `delegate_model_catalog` receives only its own concise lookup guidance, never the delegation workflow. Delegated children register neither tool and receive none of the parent tool guidelines.

### Tool metadata

<!-- pi-delegated-instructions:begin:delegate-run-tool -->
- **Name:** `delegate_run`
- **Label:** Delegate Run
- **Description:** Run one fresh bounded Pi RPC delegate in an isolated role. Routing, including model, thinking, and provider fallback after operational failures, is automatic from the extension-owned routing configuration. Streams the last sanitized child event and its UTC receipt time. A completed run returns the delegate's Markdown report; any other state returns a compact sanitized failure status and is marked as a tool error. The parent remains the sole orchestrator.
- **Prompt snippet:** Run one fresh bounded delegate with role-specific routing and live event status
<!-- pi-delegated-instructions:end:delegate-run-tool -->

### Tool arguments

<!-- pi-delegated-instructions:begin:delegate-run-parameters -->
- **`role`:** Assigned isolated role. Use the configured solution roles (solution-a, solution-b, solution-c, solution-d, solution-e, solution-f) and review roles (review-a, review-b, review-c, review-d, review-e) concurrently for their required gates.
- **`prompt`:** Complete neutral role assignment, governing documents, scope, success checks, and prohibitions.
- **`cwd`:** Delegate working directory. Relative paths resolve from the parent Pi working directory.
- **`availableSkills`:** Pre-approved skills to make discoverable to this delegate. The delegate loads full skill instructions only when its task requires them.
- **`routingOverride.provider`:** Pin or filter providers for this one run.
- **`routingOverride.model`:** Run this configured model for this one run.
- **`routingOverride.thinking`:** Thinking level for the overridden model.
- **`routingOverride.excludeProviders`:** Providers to exclude for this one run.
- **`routingOverride.reason`:** Mandatory non-empty justification for this exceptional routing change.
<!-- pi-delegated-instructions:end:delegate-run-parameters -->

Available roles are no longer a compile-time list: they derive from the version-2 `assignments` object in `agent/extensions/delegated-pi-loop/routing.json`. The ordered `solution` and `review` arrays derive lettered role ids (`solution-a`..`solution-z`, `review-a`..`review-z`, zero-based slots, at most 26 per family); `implementation`, `remediation`, `verification`, and `oracle` are singleton assignments of exactly one profile each. The role enum and the count-aware guidance are generated from the same validated snapshot at registration, and runtime validation resolves every role through the normalized registry, so resizing a gate is a `routing.json` edit alone.

The current shipped snapshot derives:

- `solution-a`
- `solution-b`
- `solution-c`
- `solution-d`
- `solution-e`
- `solution-f`
- `review-a`
- `review-b`
- `review-c`
- `review-d`
- `review-e`
- `implementation`
- `remediation`
- `verification`
- `oracle`

## 2. Complete parent-facing workflow instructions

These instructions are injected by `delegate_run` through `promptGuidelines`, generated by `delegateRunPromptGuidelines` in `instructions.ts`. The solution-gate and review-gate lines are count-aware: they name and count the roles configured in the current routing snapshot, so the six-investigator and five-reviewer wording below reflects the shipped snapshot and regenerates automatically when `routing.json` changes.

<!-- pi-delegated-instructions:begin:delegate-run-guidelines -->
1. Use delegate_run automatically for repository implementation changes unless the user explicitly opts out. The parent may directly make only a truly trivial edit with no behavior change or create and revise the plan and research deliverables defined below; the parent never manually implements a non-trivial or small implementation task.

2. The parent owns planning and research deliverables: directly formulate, draft, edit, and save every plan, design note, investigation report, and research note, including repository artifacts such as PLAN.md. Those artifact writes are an explicit exception to automatic delegation even when they change repository files, and plan and research artifacts are distinguished by purpose, not only by file extension or location.

3. Never call an implementation or remediation delegate to research, explore, formulate, draft, edit, save, or revise a plan or research deliverable. An implementation delegate executes only a parent-finalized implementation contract that changes product code, configuration, operational behavior, or implementation documentation such as README updates, ADRs, changelogs, policy files, and documentation accompanying code; a remediation delegate corrects only verification-confirmed findings in such implementation work.

4. A pure planning or research request runs no implementation delegate, implementation review gate, or remediation; if the user later approves implementation, that later request follows the existing implementation delegation and review workflow.

5. A small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and the oracle role and still runs exactly one implementation delegate.

6. When no accepted solution contract exists and the root cause, architecture, or approach requires investigation, call delegate_run for solution-a, solution-b, solution-c, solution-d, solution-e, and solution-f concurrently with the same neutral assignment; all six must complete before synthesis. Solution delegates may gather evidence and propose options, but the parent verifies the evidence, synthesizes conclusions, and remains sole author and owner of the final plan or research deliverable.

7. When one or more solution investigators of a solution gate fail operationally or end non-completed, the gate stays blocked by default; only the user may explicitly waive the named failed solution roles for that one current solution gate, and after that explicit waiver continue synthesis using only the completed solution reports plus parent-verified repository evidence instead of retrying or stopping solely because the waived investigators failed.

8. At least one solution delegate must have completed: the user cannot waive the entire evidence set and synthesize from zero completed investigator reports. A solution waiver is one-shot and gate-scoped: it changes no later solution gates, role schema, routing, or concurrency; state which solution roles were waived and that the solution gate proceeded under user waiver, and never label a waived failure as completed or passed. A waiver does not fabricate or dismiss evidence, resolve uncertainties, authorize implementation, replace parent evidence verification, skip the advisory oracle when otherwise required, or weaken implementation, review, verification, or remediation rules.

9. Do not infer a solution waiver from a generic request to continue, commit, or skip retries; precise user wording that names the failed solution role for the current gate, such as solution C may be waived for this gate, authorizes only that named waiver.

10. After a required solution gate, call delegate_run for exactly one fresh read-only oracle review of the draft solution contract, and only when the parent session's current model is not one of the configured Oracle profile models; when it is, skip the oracle and finalize the solution contract directly.

11. Give the oracle role the neutral problem, governing documents, verified evidence, the draft solution contract, constraints, and unresolved uncertainties; do not give it raw investigator reports or the parent's synthesis rationale.

12. Treat the oracle as advisory, not the final authority: the oracle critiques the parent draft but never authors or saves the final plan. Verify its VALID or REVISE analysis like any other evidence, revise the draft contract when warranted, finalize it, and run no automatic oracle loop; a non-completed oracle run blocks implementation.

13. The parent Pi agent must verify investigator evidence and finalize the solution contract before calling delegate_run for implementation.

14. Call delegate_run for only one implementation, remediation, or oracle role at a time, and do not edit the working tree while that delegate runs.

15. After inspecting the implementation delegate's diff and evidence, call delegate_run for review-a, review-b, review-c, review-d, and review-e concurrently with the same neutral review scope; all five must complete.

16. When one or more reviewers of a review gate fail operationally or end non-completed, the gate stays blocked by default; only the user may explicitly waive the named failed reviewer roles for that one current gate, and after that explicit waiver continue with the completed review reports instead of retrying or stopping solely because the waived reviewers failed.

17. A reviewer waiver is one-shot and gate-scoped: it changes no later gates, role schema, routing, or concurrency; state which reviewers were waived and that the gate completed under user waiver, and never label a waived failure as a reviewer pass. A waiver does not dismiss findings from completed reviewers or waive finding verification, remediation, or other safety rules.

18. Do not infer a reviewer waiver from a generic request to continue, commit, or skip retries; precise user wording that names the failed reviewer for the current gate, such as C may be waived for this gate, authorizes only that named waiver.

19. Process blocking review findings through fresh delegate_run verification roles: consolidate exact duplicate findings first, give each verification exactly one finding without sibling verification reports, and overlap verification only with other verification delegates.

20. Run independent finding verifications concurrently in batches of at most four and keep dependent findings sequential; wait for every verification in the current batch before remediation, because a non-completed verification leaves its finding unresolved without erasing completed sibling reports. Send only verification-confirmed findings to one focused remediation role, then run a fresh five-reviewer gate until no blocking findings remain.

21. Delegate routing, including model, thinking, and provider fallback after operational failures, is automatic from the extension-owned routing configuration; pass routingOverride only when the user or project explicitly requests an operational route change for that one run, never for the oracle role, and know that routingOverride never changes role permissions or concurrency.

22. Treat every delegate_run state other than completed as a failed delegation reported as a tool error with sanitized status fields, and do not retry outside the tool's bounded operational route fallback without user-authorized diagnosis.

23. Do not stage, commit, push, deploy, or mutate hosted services because a delegate completed; those transitions require separate explicit authorization.

24. Use availableSkills to make only task-relevant pre-approved skills discoverable to a delegate; selection does not force full skill loading, and the delegate decides which selected skills it actually needs.
<!-- pi-delegated-instructions:end:delegate-run-guidelines -->

### Removed `AGENTS.md` duplication

The parent previously also received a condensed copy of this workflow through the `## Delegated work` section of `agent/AGENTS.md`. That section is gone: the parent receives the delegation workflow exactly once through the active tool's guidelines, and `agent/AGENTS.md` no longer restates trigger rules, gate sizes, waiver semantics, oracle behavior, review behavior, verification batching, routing-override policy, `availableSkills` semantics, or authorization boundaries for delegation.

## 3. Decision flow for the parent

### Read-only research or planning

Do not use an implementation delegate or run implementation reviews.

The parent may:

- Research directly.
- Run all configured solution roles if independent investigation is necessary.
- Verify the evidence itself.
- Write and revise the final plan or research artifact itself.

### Small implementation with an accepted or obvious solution

1. Finalize the narrow implementation contract.
2. Run exactly one `implementation` delegate.
3. Inspect the resulting diff and evidence.
4. Run all configured review roles concurrently.
5. Verify blocking findings.
6. Run one remediation delegate if findings are confirmed.
7. Repeat the full review gate until no blocking findings remain.

### Complex or uncertain implementation

1. Run all configured solution roles concurrently with the same neutral assignment.
2. Wait for every configured solution role.
3. Verify their cited evidence.
4. Synthesize a draft solution contract.
5. Run one oracle unless the parent model is an oracle-profile model.
6. Verify the oracle's claims.
7. Finalize the contract.
8. Run one implementation delegate.
9. Inspect the implementation.
10. Run all configured review roles concurrently.
11. Verify blocking findings in batches of four.
12. Run focused remediation.
13. Repeat the full review gate.

## 4. Exact generated child prompt

The extension converts the parent's `prompt` argument into a private `prompt.md`:

- Composed by `buildDelegatePrompt` and `composeDelegatePrompt` in `instructions.ts`
- Written in `agent/extensions/delegated-pi-loop/runner.ts` (`runDelegate`)
- Sent as RPC prompt round 1 in `agent/extensions/delegated-pi-loop/supervisor.ts` (`supervisePi`)

The common template (generated below) carries the one short generic recursion prohibition and never names or explains `delegate_run`; parent orchestration policy stays out of child context.

<!-- pi-delegated-instructions:begin:child-prompt-template -->
```text
# Task: <role>

You are a fresh delegated CLI agent working directly in "<cwd>".

Execute this assigned role yourself. Do not spawn or orchestrate another Pi instance, Claude Code session, or subagent.
Read all required context and project instructions before acting. More-specific project instructions win.
The working tree may contain user-owned changes. Do not reset, clean, stash, overwrite, or revert them.
Do not stage, commit, push, or mutate hosted services unless the assigned task explicitly authorizes that exact action.
Never expose credentials, tokens, cookies, or private keys in your report.

## Role contract

<role-specific contract>

## Attempt budget

Allow at most two materially equivalent attempts for each required proof or gate. Stop after ten minutes without new evidence on one requirement. Do not repeat an action without new evidence. If a required result remains unavailable, stop unrelated work and report BLOCKED.

## Assigned task

<parent-supplied prompt>

## Terminal result

End your final response with exactly one of these lines:

DELEGATE_RESULT: COMPLETED
DELEGATE_RESULT: BLOCKED
DELEGATE_RESULT: FAILED

A BLOCKED or FAILED result must carry exactly one reason line directly above the marker, containing one exact code and nothing else:

DELEGATE_REASON: <code>

Allowed BLOCKED codes: evidence_inaccessible (required evidence could not be accessed), user_decision_required (a user decision is required first), assignment_conflict (the assignment conflicts with itself or project rules), policy_restriction (a policy rule prevents the assigned work), budget_exhausted (the attempt budget ran out), external_dependency (an external dependency is unavailable), finding_reported (a finding was reported; reviews with findings must use COMPLETED instead).
Allowed FAILED codes: execution_failure (execution of the assigned work failed), verification_failure (a required verification failed), internal_inconsistency (the result contradicts itself), policy_violation (a policy rule was violated during execution).
Use only the exact code on the reason line: no prose, paths, or details. COMPLETED carries no reason line. Reviews with findings must use COMPLETED, never BLOCKED with finding_reported.

The marker must be the final non-whitespace line and must not appear earlier. The reason line must sit directly above the marker and appear exactly once. COMPLETED means this assigned role finished; a review may report required fixes and still use COMPLETED. After BLOCKED or FAILED, do not start another attempt or unrelated task.

```
<!-- pi-delegated-instructions:end:child-prompt-template -->

## 5. Role-specific child contracts

Generated from `roleFamilyContract` in `instructions.ts`, typed over the routing-owned `RoleFamily` union; an unknown runtime family fails closed at that boundary.

<!-- pi-delegated-instructions:begin:role-family-contracts -->
### solution

```text
This is an independent read-only solution investigation. Do not edit files, mutate Git, or write to hosted services.
Report these sections: Problem interpretation; Root cause and relevant execution flow; Recommended solution; Alternatives and tradeoffs; Validation plan; Uncertainties and limits.
Support every material claim with exact path:line evidence. Distinguish observed facts from assumptions.
```

### review

```text
This is an independent read-only implementation review. Do not edit files, mutate Git, or write to hosted services.
Remain neutral. Do not infer expected findings. Report a verdict, structured findings, gate evidence, and deferred scope or limits.
Each finding must include severity, location, evidence, reproduction or interleaving, impact, required contract, and suggested validation.
```

### implementation

```text
Implement only the assigned solution contract. Preserve user-owned changes and stated invariants.
Do not perform independent approval, unrelated cleanup, Git transitions, hosted-service writes, or recursive delegation.
Report changed paths, implementation summary, exact checks and results, and remaining risks.
```

### remediation

```text
Implement only the focused remediation contract. Add the failing regression first or alongside the smallest correct fix.
Do not perform broad review, unrelated cleanup, Git transitions, hosted-service writes, or recursive delegation.
Report changed paths, implementation summary, exact checks and results, and remaining risks.
```

### verification

```text
This is read-only finding verification. Do not edit files, fix the defect, broaden the review, mutate Git, or write to hosted services.
Classify the supplied finding as REPRODUCED, PARTIALLY REPRODUCED, NOT REPRODUCED, ALREADY FIXED, DUPLICATE, or ARCHITECTURE AMBIGUITY.
Report evidence, the exact remediation contract when applicable, and limits.
```

### oracle

```text
This is the read-only advisory solution oracle. Do not edit files, mutate Git, write to hosted services, implement, or start delegates.
Review the supplied draft solution contract against the neutral problem, governing documents, and verified evidence.
Report exactly one verdict, VALID or REVISE, with correctness analysis, missing invariants and risks, better alternatives where material, exact path:line evidence, validation changes, and limits.
The verdict is advisory, not the final authority: the parent verifies oracle claims and owns the final contract.
```
<!-- pi-delegated-instructions:end:role-family-contracts -->

A review that discovers problems still reports:

`DELEGATE_RESULT: COMPLETED`

The result means that the review completed, not that the implementation passed. Each verification invocation should receive exactly one finding.

## 6. Restart-after-work instruction

If one route fails operationally after executing tools or accepting report recovery, the next route gets this additional instruction (generated from `RESTART_AFTER_WORK_NOTE` in `instructions.ts`):

<!-- pi-delegated-instructions:begin:restart-note -->
```text
Restart note: a previous route attempt for this same assignment may already have changed the working tree. Treat the current state of the working tree as authoritative: inspect the existing work before acting, build on it, and do not repeat an irreversible operation.
```
<!-- pi-delegated-instructions:end:restart-note -->

The extension reconstructs the prompt from the original assignment, so this note appears at most once. See the restart handling in `agent/extensions/delegated-pi-loop/runner.ts` (`runDelegate`).

## 7. Report-recovery prompt

If round 1 settles without a report or has an invalid terminal marker, the extension sends one recovery prompt (generated from `REPORT_RECOVERY_PROMPT` in `instructions.ts`) in the same child session.

<!-- pi-delegated-instructions:begin:report-recovery-prompt -->
```text
Your previous response did not satisfy the required final-report protocol.

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
use COMPLETED.
```
<!-- pi-delegated-instructions:end:report-recovery-prompt -->

It is sent only when:

- Round 1 is `missing_report` or `invalid_result`.
- No recovery has already occurred.
- The child is still running.
- The run is not cancelled.
- The output and work limits remain available.

See `evaluateRound` in `agent/extensions/delegated-pi-loop/supervisor.ts`.

## 8. What the child loads

The runtime child starts with broad discovery disabled:

- `--no-extensions`
- `--no-skills`
- `--no-prompt-templates`
- `--no-themes`

Context files remain enabled. Applicable global and project `AGENTS.md` or `CLAUDE.md` instructions are therefore still loaded, but since the delegation-policy removal they no longer include any parent orchestration policy.

The child receives exactly these extensions, in order:

1. `delegated-pi-loop/index.ts`
2. `openai-codex-aliases/index.ts`
3. `web-search/index.ts`
4. `context-mode/src/index.ts`
5. `codegraph/index.ts`

Source:

- `agent/extensions/delegated-pi-loop/resources.ts`
- `agent/extensions/delegated-pi-loop/resources.json`

The loop extension detects `PI_DELEGATED_CHILD=1`, returns before any routing or resource loading, and registers neither `delegate_run` nor `delegate_model_catalog` in the child. This prevents recursive delegation and keeps every parent tool guideline out of child context. The child branch only installs a parent-process watchdog. See the child branch at the top of `agent/extensions/delegated-pi-loop/index.ts`.

### Approved optional skills

Current approved skills are:

- `figma`
- `figma-create-design-system-rules`
- `figma-implement-design`
- `firebase-ai-logic-basics`
- `firebase-app-hosting-basics`
- `firebase-auth-basics`
- `firebase-basics`
- `firebase-data-connect`
- `firebase-firestore`
- `firebase-hosting-basics`
- `firebase-security-rules-auditor`
- `gh-cli`
- `linear-cli`
- `mysql`
- `notion`
- `postgres`
- `pp-posthog`
- `ruff`
- `ty`
- `uv`

Excluded skills are listed in `agent/extensions/delegated-pi-loop/resources.json`. Unknown or excluded names fail closed before a child starts.

## 9. Current routing

Routing comes exclusively from:

`agent/extensions/delegated-pi-loop/routing.json`

It does not use the parent's enabled-model settings. A missing or invalid routing file fails closed, and a version-1 document is rejected with one migration error. See `agent/extensions/delegated-pi-loop/routing.ts`.

The file is schema version 2: profiles of ordered model tiers plus an `assignments` object mapping the six role families. Solution and review assignments are ordered profile arrays (deriving the lettered role ids); implementation, remediation, verification, and oracle are one profile string each. The shipped snapshot assigns `solution` to `gate-a`..`gate-f`, `review` to `gate-a`..`gate-d` plus `gate-g`, both `implementation` and `remediation` to `implementation`, `verification` to `verification`, and `oracle` to `oracle`. The oracle self-review model set derives from every tier of the assigned oracle profile; there is no separately duplicated model list.

| Role | Primary configured route |
|---|---|
| `solution-a`, `review-a` | `opencode-go/muse-spark-1.2-contributor:xhigh` |
| `solution-b`, `review-b` | `opencode-go/deepseek-v4-flash:max` |
| `solution-c`, `review-c` | `opencode-go/hy3:high` |
| `solution-d`, `review-d` | `gpt-5.5:high` through the configured OpenAI Codex provider pool |
| `solution-e` | `gpt-5.6-sol:high` through the OpenAI Codex provider pool |
| `solution-f` | `zai/glm-5.3:max` |
| `review-e` | `zai/glm-5.3:max`, then `gpt-5.6-sol:high` provider pool |
| `oracle` | `gpt-5.6-sol:high` provider pool |
| `implementation`, `remediation` | `zai/glm-5.3:max` |
| `verification` | `openai-codex/gpt-5.6-sol:high` |

For multi-provider pools, the extension randomly selects one primary provider. It then appends the remaining providers in stable configuration order. See `selectRoutes` in `agent/extensions/delegated-pi-loop/routing.ts`.

The oracle rejects all routing overrides. If the parent already runs any model reachable through the oracle profile (`gpt-5.6-sol` in the shipped snapshot), the oracle is skipped before creating artifacts or spawning a process.

### Model catalog lookup

Before an explicitly requested one-run routing substitution, the parent can call the read-only `delegate_model_catalog` tool. Its metadata, parameter descriptions, and concise guidelines are generated below from `DELEGATE_MODEL_CATALOG_TOOL`, `modelCatalogToolDescription`, and `MODEL_CATALOG_PROMPT_GUIDELINES` in `instructions.ts`.

<!-- pi-delegated-instructions:begin:model-catalog-tool -->
- **Name:** `delegate_model_catalog`
- **Label:** Delegate Model Catalog
- **Description:** Search the validated delegate routing model catalog (models, compatible providers, supported thinking levels, defaults) before an explicitly requested one-run routing substitution. Read-only lookup bounded by a limit of 20; it never invokes pi --list-models and never runs a delegate.
- **Prompt snippet:** Look up configured delegate models, providers, and thinking levels before an exceptional routing override
- **`query`:** Case-insensitive substring of a configured delegate model id.
- **`provider`:** Exact configured provider id to filter routes.
- **`thinking`:** Configured thinking level; keeps only routes that support it.
- **`limit`:** Maximum matches to return; default 10, at most 20.

Guidelines:

1. Before delegate_run, call delegate_model_catalog only when an explicit user or project operational request names a partial or unknown model for a one-run routing substitution; choose only a returned model, provider, and supported thinking-level combination.

2. Keep routing overrides exceptional: allowed only for an explicit user or project operational request, never for the oracle role, and never as a routine substitute for the automatic config-driven routing; delegate_model_catalog itself changes nothing.
<!-- pi-delegated-instructions:end:model-catalog-tool -->

Each returned match carries the model and only its compatible configured routes (provider, supported thinking levels, default thinking); filters that remove every route omit the model, disabled providers never appear, and a zero-match result never dumps the catalog. Truncation is flagged when `totalMatches` exceeds the returned matches. The tool never invokes `pi --list-models`, never runs a delegate, and never enumerates combinations in the `delegate_run` schema; routing overrides stay exceptional and are never valid for the oracle role.

## 10. Machine-enforced concurrency

The instructions tell the parent what to do, but `DelegateManager` also enforces these boundaries:

- `implementation`, `remediation`, and `oracle` are exclusive.
- They cannot overlap any active delegate.
- Verification may overlap only other verification delegates.
- At most four verification delegates may overlap.
- Solution and review delegates may overlap each other.
- Solution and review delegates cannot overlap an exclusive or verification delegate.

Source: `agent/extensions/delegated-pi-loop/manager.ts`.

Important distinction:

- Concurrency, recursion suppression, routing, resource isolation, deadlines, and report parsing are machine-enforced.
- Role read-only requirements and the parent's "do not edit while implementation runs" requirement are model instructions. The extension does not disable write tools by role.

## 11. Child process and report lifecycle

Each route attempt starts Pi approximately as:

`pi [resource flags] --mode rpc --no-session --approve --provider <provider> --model <model> --thinking <level>`

Source: `agent/extensions/delegated-pi-loop/supervisor.ts`.

Key limits:

| Limit | Value |
|---|---:|
| Total productive-work budget across all routes | 45 minutes |
| Idle warning | 5 minutes |
| Idle termination | 10 minutes |
| Output limit | 50 MiB |
| Catalog preflight cap | 15 seconds |
| Graceful termination | 5 seconds |
| Cleanup allowance | 10 seconds |

Source: the limit constants at the top of `agent/extensions/delegated-pi-loop/supervisor.ts`.

Operational states eligible for automatic fallback are:

- `provider_failed`
- `stalled`
- `output_limit`
- `prompt_rejected`
- `invalid_result`
- `invalid_stream`
- `missing_report`
- `child_failed`
- `spawn_failed`

Source: `OPERATIONAL_FAILURE_STATES` in `agent/extensions/delegated-pi-loop/runner.ts`.

These outcomes are terminal and do not trigger route fallback:

- Completed
- Intentional BLOCKED
- Intentional FAILED
- Cancellation
- Work deadline
- Cleanup proof failure

## 12. Terminal report validation

The extension accepts a report only when:

- Exactly one `DELEGATE_RESULT` marker exists.
- It is the final non-whitespace line.
- Its value is `COMPLETED`, `BLOCKED`, or `FAILED`.
- `COMPLETED` has no `DELEGATE_REASON`.
- `BLOCKED` or `FAILED` has exactly one allowed reason directly above the result.
- A reason cannot be duplicated, misplaced, unknown, path-like, overlong, or malformed.

Source: `parseDelegateTerminal` in `agent/extensions/delegated-pi-loop/monitor.ts`.

The extension extracts the final assistant `message_end` text from the RPC stream. It classifies the run only after the child's agent lifecycle settles.

Every final state other than `completed` is returned to the parent as a Pi tool error, with sanitized diagnostics. The child's raw stderr and private supervision artifacts are not sent to the model.

## 13. Interactive commands

The extension registers:

| Command | Purpose |
|---|---|
| `/delegate:list` | Display active delegates and prefill a targeted stop command. |
| `/delegate:stop <id>` | Stop one active delegate by numeric ID. |

Source: `agent/extensions/delegated-pi-loop/index.ts`.

All active delegates are aborted during session shutdown.
