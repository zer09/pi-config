# ADR 0019: Implement delegated tasks in small reviewed increments

## Status

Accepted (2026-09-08). Extends ADR 0011 and ADR 0012. Replaces the canonical one-implementation-per-task wording with one implementation delegate per increment. Instruction ownership, parent/child separation, failure handling under ADR 0013, and runtime behavior remain unchanged.

## Context

The parent previously assigned one finalized task contract to one implementation delegate. The implementation contract required scope discipline but did not require small edit-and-check steps or simple code. A large contract could therefore produce one large implementation before the parent inspected it.

Small tool edits alone do not create a parent inspection boundary. The assignment itself must be small. The existing manager already permits sequential fresh implementation runs while preventing overlapping delegates during implementation.

## Decision

### Parent assigns one increment at a time

An increment is the smallest practical, independently reviewable change, including its code, regression tests, and acceptance checks. Each increment leaves the tree in a working state. A broad increment must be divided further; one large feature described as a single behavior is not a sufficient boundary.

The parent divides a large finalized task contract into ordered increments. Before each run, it inspects the current tree and assigns only the current increment. The assignment includes relevant overall invariants, concise parent-verified prior evidence, and explicit exclusions for later work. A narrow contract can use one increment.

Simple, mechanical, low-risk tasks remain parent-direct. Dividing a non-trivial task does not reclassify its increments as independent parent-direct tasks. Solution and oracle gates are not repeated merely because another increment starts; new architectural uncertainty still requires investigation.

### Child uses small edit-and-check steps

The implementation child inspects the current tree and verifies the supplied prior-work summary. It makes a small coherent edit, runs the narrowest relevant check, and continues only within the assigned increment. It uses the simplest repository-compatible change and existing patterns, without speculative abstractions or unrelated cleanup.

An assignment that is too broad or needs out-of-scope changes is reported as `BLOCKED` with the existing `assignment_conflict` reason. The child does not silently widen scope or implement later increments.

The child stops when the increment's acceptance checks pass. Implementation `COMPLETED` means only the assigned increment is finished, with no known unresolved in-scope regression. It does not mean the overall task is complete. The existing terminal grammar and all other role contracts remain unchanged.

### Parent reviews before advancing

The parent inspects each increment's diff and check evidence, then runs the existing full review gate. Intermediate review covers the current increment, integration with accepted prior work, and overall invariants. Explicitly excluded future increments are deferred scope, not defects.

Verification receives only findings, and remediation receives only verification-confirmed fixes. After remediation, the full review gate repeats until no blocking findings remain. The parent assigns the next increment only after the current increment's checks and review gate pass. A required non-completed role stops automatic advancement under the existing failure policy.

On the final increment, reviewers assess the accumulated diff against the entire finalized task contract. The parent also runs overall acceptance checks. This final scope prevents intermediate exclusions from hiding unfinished task requirements or integration defects.

### Instructions change; runtime does not

All model-visible wording remains in `instructions.ts`. Parent guidelines remain tool-scoped; only the implementation role contract receives child editing instructions. The generated reference sections remain synchronized through `docsync.ts`.

No tool schema, task identifier, increment state, numeric edit limit, or programmatic review gate is added. Routing, concurrency, child resources, supervision, renewable liveness, fallback, report recovery, report parsing, and diagnostics remain unchanged. Operational fallback retains the same assigned increment and never advances to the next one.

## Consequences

- The intended agent behavior changes, potentially producing more sequential implementation and review calls.
- Each increment supplies a parent inspection boundary before more work accumulates.
- More fresh runs and review gates increase latency and cost.
- File counts and line counts do not define manageable scope. Required coupled changes can remain together.
- Static tests prove instruction content, registration, and documentation synchronization, not model compliance or code simplicity.
- Runtime still accepts a structurally valid completion report without independently proving scope compliance or acceptance results. Parent inspection remains necessary.
- No delegation policy is added to `agent/AGENTS.md`, and historical ADR rationale is preserved.

## Validation

- Instruction tests cover current-increment scope, simplicity, edit/check steps, completion boundaries, and blocked scope expansion.
- Parent tests cover decomposition, prior evidence, per-increment review, final integrated review, and stopped advancement after non-completed roles.
- Existing tests preserve 15 tool-attributed guidelines under the 7,000-character budget, dynamic role lists, child isolation, and terminal grammar.
- Generated and manual documentation describe the same workflow.
- The extension suite, strict TypeScript, documentation synchronization, and whitespace checks must pass.
- Context-cost attribution is measured locally. A live behavioral evaluation requires separate authorization.
