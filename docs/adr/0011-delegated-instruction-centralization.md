# ADR 0011: Centralize delegated instructions in one canonical tool-scoped module

## Status

Accepted (2026-08-26). Extends ADR 0007 through ADR 0010: every supervision, routing, privacy, resource-isolation, and concurrency decision stands; only the ownership and delivery of model-visible instruction text changes.

## Context

Model-visible delegation instructions were spread across four places:

- the `delegate_run` and `delegate_model_catalog` tool metadata, parameter descriptions, and the count-aware workflow guidelines in `index.ts`;
- the role-family contracts, base child prompt, and restart note in `routes.ts`;
- the report-recovery prompt in `protocol.ts`;
- a detailed `## Delegated work` section in `agent/AGENTS.md` that duplicated the workflow in condensed form.

The duplication had a context cost and a drift risk. Every parent session paid for the delegation workflow twice: once through the always-loaded `AGENTS.md` context file and once through the active `delegate_run` tool guidelines. Every delegated child also paid for the `AGENTS.md` copy, because delegated children keep context-file discovery enabled, even though a child must never follow parent orchestration policy. Editing a gate, waiver, or oracle rule required synchronized edits in two prose locations plus the builder, and the reference document `docs/delegated-pi-loop-agent-instructions.md` restated every instruction with fragile `path:line` citations.

## Decision

### One canonical instruction module

All model-visible delegation instruction text and instruction builders live in `agent/extensions/delegated-pi-loop/instructions.ts`: parent tool metadata and parameter descriptions, the parent workflow guidelines (`delegateRunPromptGuidelines`), the role-family child contracts (`roleFamilyContract`, typed over the routing-owned `RoleFamily` union), the base child assignment prompt with its attempt budget, generic recursion prohibition, and terminal-result contract (`buildDelegatePrompt`/`composeDelegatePrompt`), the fixed restart note (`RESTART_AFTER_WORK_NOTE`), and the report-recovery prompt (`REPORT_RECOVERY_PROMPT`).

Instruction text moves; enforcement does not. Routing validation and selection stay in `routing.ts`, concurrency in `manager.ts`, process lifecycle in `runner.ts` and `supervisor.ts`, RPC protocol state in `protocol.ts`, report parsing in `monitor.ts`, and resource isolation in `resources.ts`. Runtime modules import the centralized text and builders. Semantic role-family policy stays in the machine-policy modules: the family union and normalized registry derive from `routing.ts`, the instruction builders consume those types, and an unrecognized runtime family value fails closed at the contract boundary.

### Tool-scoped parent policy

The parent receives the complete delegation workflow exactly once, through the active `delegate_run` tool's `promptGuidelines`. `delegate_model_catalog` receives only its own concise lookup guidance. Tool-scoped prompt content is absent when the tool is inactive. The detailed `## Delegated work` section is removed from `agent/AGENTS.md`, and delegation policy must not be reintroduced there.

### Child context stays orchestration-free

The delegated-child branch of the extension registers neither tool and returns before routing or resource loading, so no parent tool guideline enters child context. The child assignment prompt carries one short generic recursion prohibition that never names or explains `delegate_run`; it protects against a shell-spawned recursive Pi while keeping parent orchestration policy out of child context. Because children load `AGENTS.md` as a context file, removing the duplicated section also removes parent orchestration policy from every delegated child's context.

### Mechanically synchronized reference document

The model-visible sections of `docs/delegated-pi-loop-agent-instructions.md` are generated from the canonical exports and the shipped routing snapshot by `docsync.ts`, regenerated in place by `npm run render:instructions-doc`, and checked by `docsync.test.ts`. The mechanism manages only fixed, named sections marked with `pi-delegated-instructions` comments; it is not a general-purpose Markdown template language. The surrounding runtime explanation remains manually authored and cites stable exported symbol names rather than `path:line` ranges for moved prompt content.

## Consequences

- Editing any delegation instruction is now a single edit in `instructions.ts` plus one regeneration command; the checked-in reference document cannot silently drift.
- Every parent session saves the duplicated `AGENTS.md` delegation section (measured locally with `tiktoken` `o200k_base`: `agent/AGENTS.md` drops from 3,571 to 2,507 tokens), and every delegated child saves the same section from its context-file block. The tool metadata, schema, and guidelines are byte-identical, so the active-tool surface is unchanged.
- A session that never activates `delegate_run` no longer carries any delegation policy at all.
- Rendered prompt semantics are preserved exactly: the refactor was verified by a 144-combination byte-parity check of `buildDelegatePrompt` against the previous implementation, a byte-exact check of the recovery prompt, and the full extension suite.
