---
name: delegated-pi-loop
description: "Orchestrate implementation, independent review, finding verification, and focused remediation by spawning fresh Pi processes on one shared working tree. Use when the user asks to delegate coding or review to another model, run an independent implementation review, verify review findings separately, or iterate implementation and review until no findings remain."
---

# Delegated Pi Loop

Act as the sole orchestrator. Spawn fresh Pi processes for sharply separated roles while preserving the user's working tree and authorization boundaries.

Read `references/prompt-contracts.md` before the first spawn. Use project-specific execution guides and role templates when they exist; they override generic prompt skeletons in the reference.

## Role defaults

| Role | Provider/model | Thinking | Mutation |
|---|---|---:|---|
| Implementation or focused remediation | `openai-codex/gpt-5.6-luna` | `max` | Narrowly allowed |
| Independent implementation review | `openai-codex/gpt-5.6-sol` | `high` | Prohibited |
| Finding verification | `openai-codex/gpt-5.6-sol` | `high` | Prohibited |

Use a model or reasoning level explicitly requested by the user or required by a more specific project workflow instead of these defaults.

## Non-negotiable execution rules

- Run spawned Pi processes with direct `bash`, never Context Mode.
- Do not set a timeout on the tool call that runs a delegate.
- Use `--print --no-session --approve` so each delegate is fresh, ephemeral, and loads trusted project resources for that run.
- Keep the current session as the only orchestrator. Tell every delegate to execute its assigned role directly and never spawn another Pi instance.
- Run delegates sequentially by default. Never run more than one mutating delegate at a time on a shared working tree.
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
2. Give Luna one narrow mutation scope with explicit invariants, exact findings or objective, success criteria, required tests, required documentation updates, and prohibitions.
3. State that existing user changes belong to the user and must not be reverted.
4. Require the delegate to report changed paths and exact checks run.
5. Spawn Luna/max using the implementation command in the reference and wait for completion.
6. Inspect the resulting diff and validation evidence before proceeding.

Do not ask an implementation delegate to perform its own independent approval.

### 3. Obtain an independent review

1. Create a fresh review prompt from the project's review template.
2. Include the exact tree/base to review, governing documents, scope exclusions, required gates, finding format, and verdict format.
3. Do not include prior remediation reasoning, expected findings, leading hints, or the parent session's conclusions.
4. Explicitly prohibit edits, Git mutations, hosted-service writes, and recursive delegation.
5. Spawn a fresh Sol/high process and wait for completion.
6. Preserve the complete review output in a temporary handoff.
7. Recompute the tree fingerprint. If the reviewer changed tracked, staged, or relevant untracked state, stop, inspect the mutation, and treat the review as invalid until resolved.

A passing test suite is evidence, not independent approval. Approval comes only from the fresh reviewer verdict required by the project workflow.

### 4. Process every blocking finding

For each blocking finding:

1. Preserve its complete text, including severity, location, evidence, reproduction or interleaving, impact, and required contract.
2. Spawn a separate fresh Sol/high verification-only delegate using the project's verification template.
3. Require one classification: `REPRODUCED`, `PARTIALLY REPRODUCED`, `NOT REPRODUCED`, `ALREADY FIXED`, `DUPLICATE`, or `ARCHITECTURE AMBIGUITY`, unless the project defines another taxonomy.
4. Do not let the verifier edit files, fix the defect, perform a broad review, or recursively delegate.
5. If the result is `ARCHITECTURE AMBIGUITY`, stop and ask the user rather than silently choosing policy.
6. If the finding is not reproduced, preserve the evidence and follow the project's disposition rules; do not implement a speculative fix.
7. If reproduced or partially reproduced, create a focused remediation prompt containing the complete finding and complete verification report.
8. Spawn one Luna/max mutating delegate to add the failing regression first or alongside the smallest correct fix, update required review documentation, and run targeted gates.

Group findings into one remediation only when they are tightly coupled and one coherent fix is narrower and safer than separate edits. Otherwise remediate serially.

### 5. Review again

After remediation:

1. Inspect the diff and targeted gates.
2. Spawn a completely fresh independent reviewer using the same neutral review contract.
3. Repeat verification, remediation, and fresh review until the reviewer reports no blocking findings.

Do not reuse or continue a reviewer, verifier, or implementer session. Do not substitute parent-session analysis for a required verification delegate.

### 6. Complete local gates and stop at authorization boundaries

After a no-findings verdict:

1. Run the project-prescribed local or clean-tree gates.
2. Confirm temporary prompt/report files are outside tracked paths.
3. Report the final verdict, changed paths, exact checks, dirty/staged state, and remaining release steps.
4. Stop before staging, committing, pushing, opening a PR, merging, deploying, or other persistent transitions unless already authorized.

## Failure handling

- If a delegate fails or returns incomplete output, preserve its output and diagnose before retrying with a fresh process.
- If a read-only delegate mutates state, stop; do not silently revert user work.
- If instructions conflict, follow the most specific applicable instruction and surface material ambiguity.
- If the same finding recurs, investigate the causal gap and strengthen the next verification/remediation handoff rather than steering the reviewer toward a pass.

## Maintenance

Update this custom local skill through `docs/skills/delegated-pi-loop-update-process.md`. Preserve fresh-session isolation, role separation, the single-mutator rule, direct non-Context-Mode spawning without a timeout, and explicit Git/hosted-service authorization gates.
