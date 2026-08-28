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

Every section marked with `<!-- pi-delegated-instructions:begin:... -->` / `<!-- pi-delegated-instructions:end:... -->` comments below is rendered mechanically from the canonical exports in `instructions.ts` (plus the shipped routing snapshot for the routing-derived role lists) by `agent/extensions/delegated-pi-loop/docsync.ts`. Regenerate them after any instruction change:

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
- **Description:** Run one fresh bounded isolated Pi delegate for one role. Routing and operational fallback are automatic. Returns a completed Markdown report; every other terminal state is a sanitized tool error. The parent remains sole orchestrator.
- **Prompt snippet:** Run one fresh isolated delegated role
<!-- pi-delegated-instructions:end:delegate-run-tool -->

### Tool arguments

<!-- pi-delegated-instructions:begin:delegate-run-parameters -->
- **`role`:** Choose one configured role. Gate members and sequencing are listed in delegate_run guidelines.
- **`prompt`:** Self-contained neutral assignment: goal, governing documents and relevant evidence, scope, success checks, prohibitions, and required report.
- **`cwd`:** Delegate cwd; relative paths resolve from parent cwd.
- **`availableSkills`:** Approved skills visible to the child; full instructions load only if needed.
- **`routingOverride.provider`:** Restrict this run to one provider.
- **`routingOverride.model`:** Use this configured model for this run.
- **`routingOverride.thinking`:** Thinking level for the model; requires model.
- **`routingOverride.excludeProviders`:** Exclude these providers from this run.
- **`routingOverride.reason`:** Why this explicit one-run override is required.
<!-- pi-delegated-instructions:end:delegate-run-parameters -->

Available roles are no longer a compile-time list: they derive from the version-2 `assignments` object in `agent/extensions/delegated-pi-loop/routing.json`. The ordered `solution` and `review` arrays derive lettered role ids (`solution-a`..`solution-z`, `review-a`..`review-z`, zero-based slots, at most 26 per family); `implementation`, `remediation`, `verification`, and `oracle` are singleton assignments of exactly one profile each. The role enum and dynamic guidance are generated from the same validated snapshot at registration, and runtime validation resolves every role through the normalized registry, so resizing a gate is a `routing.json` edit alone.

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

These instructions are injected by `delegate_run` through `promptGuidelines`, generated by `delegateRunPromptGuidelines` in `instructions.ts`. Every flat Pi guideline names its tool. The solution and review lines list the roles from the current routing snapshot and regenerate automatically when `routing.json` changes.

<!-- pi-delegated-instructions:begin:delegate-run-guidelines -->
1. delegate_run [Ownership]: Use for repository implementation unless the user explicitly opts out. Parent may directly make only trivial no-behavior edits. Parent directly owns all planning and research deliverables, including repository artifacts classified by purpose. Pure planning or research runs no implementation, review, or remediation; later approval starts this workflow.

2. delegate_run [Role scope]: Never use implementation or remediation for research or plans. Implementation executes one parent-finalized contract for code, configuration, operational behavior, or accompanying docs. Remediation executes only verification-confirmed fixes.

3. delegate_run [Fast path]: If an accepted solution contract exists, skip solution and oracle. For a small task with an accepted plan or obvious established pattern, parent finalizes the contract, skips solution and oracle, and runs exactly one implementation.

4. delegate_run [Investigation]: If root cause, architecture, or approach needs investigation, run solution-a, solution-b, solution-c, solution-d, solution-e, and solution-f concurrently with the same neutral assignment and wait for every role. They gather evidence and options; parent verifies, synthesizes, and solely authors the final deliverable and contract.

5. delegate_run [Gate failure]: Any required non-completed solution or review role leaves automatic gate advancement incomplete. Report the failed role(s), preserve completed evidence, and follow the user's next instruction. Never label failures completed or passed.

6. delegate_run [Partial evidence]: If the user directs continuation from a partial solution gate, require at least one completed report and synthesize only from completed reports plus parent-verified repository evidence. Findings from completed reviews remain binding unless the user explicitly directs otherwise.

7. delegate_run [Oracle]: After a required solution gate, parent verifies evidence and drafts the contract, then runs one fresh read-only oracle unless the parent model is in the configured Oracle model set. Give only the neutral problem, governing documents, verified evidence, draft contract, constraints, and unresolved uncertainties; exclude raw solution reports and parent synthesis rationale.

8. delegate_run [Oracle decision]: Oracle is advisory and returns VALID or REVISE; it never authors or saves the final plan. Parent verifies its claims, revises if warranted, finalizes the contract, and never loops automatically. A non-completed oracle stops automatic advancement; report it and follow the user's next instruction.

9. delegate_run [Execution]: After finalizing the contract, run one implementation delegate. Run only one implementation, remediation, or oracle at a time, and do not edit the working tree while it runs. After a non-completed implementation, inspect the current tree before any user-directed continuation.

10. delegate_run [Review]: Inspect the implementation diff and evidence, then run review-a, review-b, review-c, review-d, and review-e concurrently with the same neutral scope; wait for every role before automatic advancement.

11. delegate_run [Findings]: Consolidate exact duplicate blocking findings. Give each fresh verification exactly one finding and no sibling reports. Run independent verifications in batches of at most four, dependent findings sequentially, and overlap only verification with verification. Wait for the full batch; a non-completed verification leaves that finding unresolved without erasing completed siblings.

12. delegate_run [Remediation]: Send only verification-confirmed findings to one focused remediation, then repeat the full review gate until no blocking findings remain.

13. delegate_run [Routing]: Routing and operational fallback are automatic. Use delegate_model_catalog and routingOverride only for an explicit user or project one-run operational route request; never override oracle or change permissions or concurrency.

14. delegate_run [Failure and authority]: Treat every non-completed state as a failed tool-error delegation and report it. Do not retry automatically beyond bounded fallback. Follow the user's ordinary next instruction; continue, resume, or retry requires no special syntax. Delegate completion never authorizes staging, committing, pushing, deploying, or hosted-service mutation; each requires separate explicit authorization.

15. delegate_run [Skills]: Pass only task-relevant pre-approved availableSkills. Selection exposes skills but never forces full loading.
<!-- pi-delegated-instructions:end:delegate-run-guidelines -->

### Removed `AGENTS.md` duplication

The parent previously also received a condensed copy of this workflow through the `## Delegated work` section of `agent/AGENTS.md`. That section is gone: the parent receives delegation-specific workflow rules exactly once through the active tool's guidelines. `agent/AGENTS.md` retains only the general user-controlled instruction-precedence mechanism; delegated workflows never request or require its syntax. It does not restate delegation triggers, gate sizes, oracle behavior, review behavior, verification batching, routing policy, skills, or authorization boundaries.

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
2. Wait for every configured solution role before automatic advancement. If a role fails, report it and follow the user's ordinary next instruction without requesting special syntax.
3. Verify the cited evidence from completed roles.
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

Fresh delegated CLI agent working directly in "<cwd>".

Do this role yourself. Do not start or orchestrate another agent process or subagent.
Follow applicable project instructions; more specific wins.
Preserve user changes; never reset, clean, stash, overwrite, or revert.
Do not stage, commit, push, deploy, or write hosted services unless this assignment explicitly authorizes that action.
Never expose credentials, tokens, cookies, or private keys.

## Role

<role-specific contract>

## Assignment

<parent-supplied prompt>

## Attempt limits

For each required proof or gate, make at most two materially equivalent attempts. Repeat only when new evidence justifies it. If a required result remains unavailable, stop unrelated work and report BLOCKED.

## Final protocol

End with exactly one form and no text after it:

DELEGATE_RESULT: COMPLETED

or

DELEGATE_REASON: <blocked-code>
DELEGATE_RESULT: BLOCKED

or

DELEGATE_REASON: <failed-code>
DELEGATE_RESULT: FAILED

BLOCKED codes: evidence_inaccessible, user_decision_required, assignment_conflict, policy_restriction, budget_exhausted, external_dependency, finding_reported.
FAILED codes: execution_failure, verification_failure, internal_inconsistency, policy_violation.

Use one matching code with no prose, path, or details. DELEGATE_RESULT appears once as the final nonblank line; DELEGATE_REASON appears once directly above it. COMPLETED has no reason. COMPLETED means this role finished even when a review found defects; reviews with findings use COMPLETED. After BLOCKED or FAILED, stop.

```
<!-- pi-delegated-instructions:end:child-prompt-template -->

## 5. Role-specific child contracts

Generated from `roleFamilyContract` in `instructions.ts`, typed over the routing-owned `RoleFamily` union; an unknown runtime family fails closed at that boundary.

<!-- pi-delegated-instructions:begin:role-family-contracts -->
### solution

```text
Independent read-only solution investigation. Do not edit files or change Git or hosted state.
Report: problem interpretation; root cause and execution flow; recommended solution; alternatives and tradeoffs; validation plan; uncertainties and limits.
Support each material claim with exact path:line evidence. Separate facts from assumptions.
```

### review

```text
Independent neutral read-only implementation review. Do not edit files or change Git or hosted state; do not infer expected findings.
Report: verdict; structured findings; gate evidence; deferred scope and limits.
Each finding: severity; location; evidence; reproduction or interleaving; impact; required contract; suggested validation.
```

### implementation

```text
Implement only the assigned contract; preserve user-owned changes and stated invariants.
Do not independently approve, perform unrelated cleanup, make Git or hosted transitions, or delegate.
Report: changed paths; implementation summary; exact checks and results; remaining risks.
```

### remediation

```text
Implement only the focused remediation contract. Add the failing regression before or with the smallest correct fix.
Do not broaden review, perform unrelated cleanup, make Git or hosted transitions, or delegate.
Report: changed paths; implementation summary; exact checks and results; remaining risks.
```

### verification

```text
Read-only verification of one supplied finding. Do not edit, fix, broaden review, or change Git or hosted state.
Classify: REPRODUCED, PARTIALLY REPRODUCED, NOT REPRODUCED, ALREADY FIXED, DUPLICATE, or ARCHITECTURE AMBIGUITY.
Report evidence, the exact remediation contract when applicable, and limits.
```

### oracle

```text
Read-only advisory solution oracle. Do not edit, implement, delegate, or change Git or hosted state.
Review the draft contract against the neutral problem, governing documents, and verified evidence.
Report exactly one verdict, VALID or REVISE, plus correctness analysis, missing invariants and risks, material alternatives, exact path:line evidence, validation changes, and limits. Parent verifies claims and owns the final contract.
```
<!-- pi-delegated-instructions:end:role-family-contracts -->

A review that discovers problems still reports:

`DELEGATE_RESULT: COMPLETED`

The result means that the review completed, not that the implementation passed. Each verification invocation should receive exactly one finding.

## 6. Restart-after-work instruction

If one route fails operationally after executing tools or accepting report recovery, the next route gets this additional instruction (generated from `RESTART_AFTER_WORK_NOTE` in `instructions.ts`):

<!-- pi-delegated-instructions:begin:restart-note -->
```text
Restart: a prior route attempt may have changed the tree. Inspect current work first; treat it as authoritative, continue from it, and do not repeat irreversible actions.
```
<!-- pi-delegated-instructions:end:restart-note -->

The extension reconstructs the prompt from the original assignment, so this note appears at most once. See the restart handling in `agent/extensions/delegated-pi-loop/runner.ts` (`runDelegate`).

## 7. Report-recovery prompt

If round 1 settles without a report or has an invalid terminal marker, the extension sends one recovery prompt (generated from `REPORT_RECOVERY_PROMPT` in `instructions.ts`) in the same child session.

<!-- pi-delegated-instructions:begin:report-recovery-prompt -->
```text
The previous response lacked a valid final report.

Do not repeat work or call tools. Using only existing session evidence, return one complete self-contained report.

Follow the original Final protocol. Include exactly one DELEGATE_RESULT line as the final nonblank line; for BLOCKED or FAILED, put one valid DELEGATE_REASON line directly above it; COMPLETED has none. Do not quote or discuss either marker.
```
<!-- pi-delegated-instructions:end:report-recovery-prompt -->

It is sent only when:

- Round 1 is `missing_report` or `invalid_result`.
- No recovery has already occurred.
- The child is still running.
- The run is not cancelled.
- The cumulative output stays under the 50 MiB cap.
- No liveness termination has begun.

Round 2 starts a distinct bounded reporting phase: the RPC and accepted-activity clocks restart, while output bytes, retry counters, duplicate-checkpoint counters, and tool counts stay cumulative. A silent recovery round stops after its fixed five-minute idle lease with the `report_recovery_idle` stall cause.

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
| `solution-c`, `review-c` | `zai/glm-5.3-flash:high`, then `opencode-go/hy3:high` |
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
- **Description:** Search configured delegate routes for an explicitly requested one-run override. Returns compatible model, provider, and thinking combinations; read-only, maximum 20, and never runs a delegate.
- **Prompt snippet:** Resolve one exceptional delegate route
- **`query`:** Case-insensitive configured model-id substring.
- **`provider`:** Exact provider-id filter.
- **`thinking`:** Thinking-level filter.
- **`limit`:** Maximum matches: default 10, maximum 20.

Guidelines:

1. delegate_model_catalog: Use only to resolve a partial or unknown model in an explicit user or project request for a one-run operational override; choose only a returned compatible combination.

2. delegate_model_catalog: Lookup changes nothing. Automatic routing remains default; routingOverride stays exceptional and is never allowed for oracle.
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
| Activity warning (no accepted task activity) | 5 minutes |
| Activity-idle termination | 10 minutes |
| Structural-progress warning (no novel checkpoint) | 15 minutes |
| Renewable structural-progress lease | 45 minutes between novel checkpoints |
| Report-recovery idle lease | 5 minutes |
| Output limit | 50 MiB per route attempt |
| Catalog preflight cap | 15 seconds, independent per route |
| Graceful termination | 5 seconds |
| Cleanup allowance | 10 seconds |

Source: the limit constants at the top of `agent/extensions/delegated-pi-loop/supervisor.ts`.

There is deliberately no total runtime ceiling: total elapsed time never terminates a delegate. The supervisor's 100 ms ticker evaluates a pure reducer (`evaluateLiveness` in `liveness.ts`) over three independent monotonic clocks from the monitor:

1. **Valid RPC health**: renewed by every protocol record that passed framing and correlation; proves communication only.
2. **Accepted activity**: renewed by valid lifecycle transitions, nonempty deltas, novel tool updates, and retry or compaction transitions; empty deltas, unchanged queue state, and identical accumulated tool updates never renew it.
3. **Novel structural progress**: renewed only by completed checkpoints not seen before in the attempt (authoritative `message_end`, `turn_end`, `tool_execution_end`, final `agent_end`, `agent_settled`, prompt acceptance); streaming deltas and generic tool output never renew it.

Checkpoint novelty is compared through per-attempt in-memory HMAC digests over a bounded 64-entry index; keys and digests are never persisted, rendered, or returned. When the renewable 45-minute progress lease expires, the fixed `stallCause` distinguishes `repeated_cycle` (exact duplicate checkpoints were observed) from `progress_stagnation`. The complete fixed stall-cause enum is `rpc_silent`, `activity_idle`, `active_tool_idle`, `progress_stagnation`, `repeated_cycle`, and `report_recovery_idle`.

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

Fallback has no remaining-work-time predicate: every operational failure, including `stalled` with any stall cause, advances to the next route after positive cleanup proof, regardless of total elapsed time.

These outcomes are terminal and do not trigger route fallback:

- Completed
- Intentional BLOCKED
- Intentional FAILED
- Cancellation
- Cleanup proof failure
- Route-chain exhaustion, reported as `routes_unavailable`

The only remaining `timed_out` outcome is the fixed 15-second catalog preflight cap (`deadlineCause: "catalog_preflight"`), which is itself fallback-eligible.

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
