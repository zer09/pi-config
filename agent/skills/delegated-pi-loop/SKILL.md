---
name: delegated-pi-loop
description: "Orchestrate implementation, independent review, finding verification, and focused remediation with fresh bounded Pi or Claude Code processes and safe multi-provider fallback. Use when the user asks to delegate coding or review, use Z.AI, AgentRouter, SeekAI, GoRouter, or Claude/Opus as a delegate, verify findings separately, or iterate remediation and independent review until no findings remain."
---

# Delegated Pi Loop

Act as the sole orchestrator. Spawn fresh Pi or Claude Code CLI processes for sharply separated roles while preserving the user's working tree and authorization boundaries.

Read `references/prompt-contracts.md` before the first spawn. Use project-specific execution guides and role templates when they exist; they override generic prompt skeletons in the reference.

## Role defaults

| Role                                     | Provider/model                                                                      |        Thinking | Mutation                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | --------------: | ------------------------- |
| Implementation or focused remediation    | `zai/glm-5.3`                                                                       |           `max` | Narrowly allowed          |
| Small-task implementation or remediation | GoRouter Opus 4.8 Thinking → AgentRouter Opus 4.8 → SeekAI DeepSeek V4 Flash → Luna |         `xhigh` | Narrowly allowed          |
| Independent implementation review A      | GoRouter Opus 5 Thinking                                                            |          `high` | Prohibited                |
| Independent implementation review B      | AgentRouter Opus 5 → AgentRouter GPT-5.6 Sol                                        |          `high` | Prohibited                |
| Finding verification                     | `openai-codex/gpt-5.6-sol`                                                          |        `medium` | Prohibited                |
| Explicit Z.AI alternative for any role   | `zai/glm-5.3`                                                                       |           `max` | Follows the assigned role |
| Explicit Claude alternative for any role | Claude Code `claude-opus-5`                                                         | `medium` effort | Follows the assigned role |

Default implementation and remediation to Z.AI GLM 5.3/max. Z.AI can serve any assigned role, but review or verification requires explicit user or project selection. The assigned role, not the backend, controls mutation permissions. Use the GoRouter-first small-task chain only after the orchestrator records that the task is narrow, follows an established pattern, has no material ambiguity or architecture, security, concurrency, schema, migration, or cross-system concern, and should finish in a few turns. If any criterion is uncertain, use GLM 5.3/max. Run both default high-thinking independent reviewers concurrently. Reviewer B may fall back from AgentRouter Opus 5 to AgentRouter GPT-5.6 Sol before tool execution. Keep OpenAI Codex Sol/medium for finding verification unless the user or project selects another backend. For Claude Code, pin `claude-opus-5` instead of the moving `opus` alias. Any explicitly requested model or reasoning level overrides these defaults.

## Non-negotiable execution rules

- Run spawned Pi or Claude Code processes with direct `bash`, never Context Mode.
- Omit the bash tool timeout, but run every child through `scripts/run_delegate.py`. Defaults are a 45-minute wall deadline, 50 MiB output limit, 5-minute Pi event-idle warning, and 10-minute Pi event-idle termination.
- Treat supervisor states other than `completed` as failures. Preserve its private temporary report, stderr, status, and chain-attempt paths for diagnosis.
- Use `scripts/run_delegate_chain.py` only for documented ordered Pi routes. It may skip an uncatalogued route or start the next fresh route after provider unavailability or an event-idle stall, but only before any tool execution and within one shared 45-minute deadline.
- For Pi, including Z.AI GLM, use `--mode json --no-session --approve` with the supervisor's `pi-json` protocol. The supervisor parses activity privately, discards raw events after final extraction, and never replays thinking or tool payloads.
- For Claude Code, use `--print --no-session-persistence` with role-appropriate non-interactive permissions and require the structured terminal-result marker.
- Clear inherited `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` before every delegate. Also clear `AI_AGENT` and `PI_CODING_AGENT` before Claude delegates.
- Pin the default implementation/remediation route as `--provider zai --model glm-5.3 --thinking max`. Z.AI can serve any assigned role, but review or verification requires explicit selection. The assigned role controls mutation permissions.
- Keep the current session as the only orchestrator. Tell every delegate to execute its assigned role directly and never spawn another Pi, Claude Code, or subagent session.
- Run mutating delegates and finding verifiers sequentially. Launch the two default read-only independent reviewers concurrently. Never run more than one mutating delegate at a time on a shared working tree.
- Do not edit the tree while a mutating delegate is running.
- Do not stage, unstage, stash, reset, clean, commit, push, or mutate a hosted service unless the user separately authorized that exact operation.
- Never place credentials, tokens, cookies, private paths, or other secrets in delegate prompts or reports.

## Workflow

### 1. Establish the contract

1. Read global and project context files.
2. Read the project's implementation plan, architecture decisions, execution guide, review templates, verification template, remediation template, and existing review ledger as applicable.
3. Identify the exact project root, baseline, current working-tree scope, prohibited paths, release gates, and authorization state.
4. Inspect existing dirty and staged changes without altering them.
5. Capture the read-only tree fingerprint described in the reference.

If the project defines role prompts such as implementation, independent review, finding verification, or focused remediation, instantiate those prompts rather than replacing their process with an improvised one.

### 2. Delegate implementation

When implementation is requested:

1. Create a temporary prompt outside the tracked project tree.
2. Give the selected implementation delegate one narrow mutation scope with explicit invariants, exact findings or objective, success criteria, required tests, required documentation updates, and prohibitions.
3. State that existing user changes belong to the user and must not be reverted.
4. Define attempt/time budgets and require the final `DELEGATE_RESULT` marker from the reference. Require changed paths and exact checks run.
5. Spawn Z.AI GLM 5.3/max by default. Use the ordered small-task chain only when the recorded classification satisfies every role-default criterion. Use Claude Opus 5/medium when explicitly selected. Wait for completion.
6. Inspect the resulting diff and validation evidence before proceeding.

Do not ask an implementation delegate to perform its own independent approval.

### 3. Obtain an independent review

1. Create a fresh review prompt from the project's review template.
2. Include the exact tree/base to review, governing documents, scope exclusions, required gates, attempt/time budgets, finding format, verdict format, and final `DELEGATE_RESULT` marker.
3. Do not include prior remediation reasoning, expected findings, leading hints, or the parent session's conclusions.
4. Explicitly prohibit edits, Git mutations, hosted-service writes, and recursive delegation.
5. By default, launch two direct bash calls in one parallel tool batch: GoRouter Opus 5 Thinking/high and the AgentRouter Opus 5/high → AgentRouter GPT-5.6 Sol/high chain. When the user or project assigns Z.AI or Claude Code to a review role, preserve the same neutral read-only contract. An explicit backend selection does not silently reduce a required two-reviewer gate. Wait for every reviewer required by the selected gate.
6. Preserve both complete review outputs in separate temporary handoffs. Do not show either reviewer the other review.
7. Recompute the tree fingerprint after both finish. If either reviewer changed tracked, staged, or relevant untracked state, stop, inspect the mutation, and treat that review as invalid until resolved.
8. The review gate completes only when both reviewers complete. Process every blocking finding from either report; one no-findings verdict does not override the other report.

A passing test suite is evidence, not independent approval. Approval comes only from the fresh reviewer verdict required by the project workflow.

### 4. Process every blocking finding

For each blocking finding:

1. Preserve its complete text, including severity, location, evidence, reproduction or interleaving, impact, and required contract.
2. Give the verifier bounded attempts per required proof and require immediate `BLOCKED` reporting when its budget cannot establish the result. Spawn a separate fresh verification-only delegate using the project's template: Pi Sol/medium by default, Z.AI GLM 5.3/max when explicitly selected, or Claude Opus 5/medium when explicitly selected.
3. Require one classification: `REPRODUCED`, `PARTIALLY REPRODUCED`, `NOT REPRODUCED`, `ALREADY FIXED`, `DUPLICATE`, or `ARCHITECTURE AMBIGUITY`, unless the project defines another taxonomy.
4. Do not let the verifier edit files, fix the defect, perform a broad review, or recursively delegate.
5. If the result is `ARCHITECTURE AMBIGUITY`, stop and ask the user rather than silently choosing policy.
6. If the finding is not reproduced, preserve the evidence and follow the project's disposition rules; do not implement a speculative fix.
7. If reproduced or partially reproduced, create a focused remediation prompt containing the complete finding and complete verification report.
8. Spawn Z.AI GLM 5.3/max by default. Use the ordered small-task chain only when the focused remediation independently satisfies every small-task criterion. Use Claude Opus 5/medium when explicitly selected. Add the failing regression first or alongside the smallest correct fix. Update required review documentation and run targeted gates.

Group findings into one remediation only when they are tightly coupled and one coherent fix is narrower and safer than separate edits. Otherwise remediate serially.

### 5. Review again

After remediation:

1. Inspect the diff and targeted gates.
2. Spawn a completely fresh concurrent independent-review pair using the same neutral review contract and isolated outputs.
3. Repeat verification, remediation, and fresh paired review until both reviewers report no blocking findings.

Do not reuse, resume, or continue a reviewer, verifier, or implementer session in either backend. Do not substitute parent-session analysis for a required verification delegate.

### 6. Complete local gates and stop at authorization boundaries

After a no-findings verdict:

1. Run the project-prescribed local or clean-tree gates.
2. Confirm temporary prompt/report files are outside tracked paths.
3. Report each selected model/effort, supervisor state and elapsed time, final verdict, changed paths, exact checks, dirty/staged state, and remaining release steps.
4. Stop before staging, committing, pushing, opening a PR, merging, deploying, or other persistent transitions unless already authorized.

## Failure handling

- Automatic failover is limited to a documented route chain when the route is absent from Pi's available catalog, reports provider unavailability, or stalls before any tool starts. Each route gets one fresh attempt. Do not cycle routes.
- After any tool starts, or if a delegate blocks, fails, times out, exceeds output, returns a terminal result, or produces another invalid outcome, preserve artifacts and diagnose before any user-authorized fresh retry.
- If either default reviewer does not complete, the paired review gate is incomplete. Do not treat the surviving report as full independent approval.
- If a read-only delegate mutates state, stop; do not silently revert user work.
- If instructions conflict, follow the most specific applicable instruction and surface material ambiguity.
- If the same finding recurs, investigate the causal gap and strengthen the next verification/remediation handoff rather than steering the reviewer toward a pass.

## Maintenance

Update this custom local skill through `docs/skills/delegated-pi-loop-update-process.md`. Preserve fresh-session isolation, private Pi JSON activity monitoring, bounded pre-tool route failover, event-idle and wall deadlines, structured terminal results, process-group cleanup, role separation, the single-mutator rule, the concurrent read-only reviewer pair, Z.AI any-role availability with assigned-role mutation limits, default GLM 5.3/max implementation, guarded GoRouter-first small-task routing, explicit Claude Opus 5/medium selection, and Git/hosted-service authorization gates.
