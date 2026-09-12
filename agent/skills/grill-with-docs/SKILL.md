---
name: grill-with-docs
description: "Guide a plan and domain decision session using the project's language, code, and documented decisions. Use to stress-test a plan or clarify terminology; documentation writes require an explicit request."
---

# Grill With Docs

## Review-only boundary

Challenge the requested plan and domain decisions without changing repository files by default. Do not create or update `CONTEXT.md`, `CONTEXT-MAP.md`, or ADRs unless the user explicitly requests those repository changes. Agreement on a term or decision during conversation is not authorization to write it.

This is a grilling and planning skill, not an implementation workflow. Keep source unchanged and do not automatically hand off to implementation.

## Bounded conversation

Ask one material question at a time and wait for feedback. Include a recommended answer and its reason. Prefer code/docs evidence when the repository can answer a question; use CodeGraph first for source exploration.

Focus on decisions needed for the requested plan, including dependencies between those decisions. Stop when those decisions are resolved or remaining uncertainties are explicit. Do not exhaust every possible design branch.

## Domain grounding

Read existing domain documentation and relevant ADRs before questioning terminology or decisions:

- A single-context repo usually has root `CONTEXT.md` and `docs/adr/`.
- A root `CONTEXT-MAP.md` points to multiple contexts. Read the relevant context's `CONTEXT.md` and `docs/adr/`, plus system-wide ADRs in root `docs/adr/`.
- If the topic's context is unclear, ask. Missing documentation is not permission to create it.

Use [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md) for glossary and context-map conventions when needed. Read [ADR-FORMAT.md](ADR-FORMAT.md) when evaluating or recording an ADR-worthy decision.

## Challenge the plan

- **Check vocabulary against the glossary.** If "cancellation" means X in the glossary but Y in the plan, surface the conflict.
- **Sharpen fuzzy language.** Propose one canonical term. For example, distinguish **Customer** from **User** instead of overloading "account."
- **Test concrete scenarios.** Use relevant edge cases to clarify relationships and distinctions between domain concepts.
- **Compare claims with code.** If code cancels entire Orders but the plan assumes partial cancellation, identify the discrepancy and ask which behaviour is intended.

Keep these questions tied to material plan decisions. Do not ask the user to rediscover facts available in code or docs.

## Documentation when authorized

If the user explicitly requests documentation changes, record resolved terms and decisions within that scope as the session progresses. Do not ask for repeated approval for already-authorized writes. A request to update a glossary does not authorize unrelated ADRs or source changes.

- Keep `CONTEXT.md` a domain glossary only, using [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md). Exclude implementation details, specs, scratch notes, and implementation decisions.
- Create files lazily, only when authorized content is ready. Create `CONTEXT.md` at the first resolved term, and `docs/adr/` at the first authorized ADR. Do not create placeholders.
- Follow an existing context map. If an authorized documentation task requires multiple contexts, use the map conventions in the format reference; clarify uncertain context ownership before writing.

## Offer ADRs sparingly

Offer an ADR only when all three are true:

1. **Hard to reverse**: changing the decision later has meaningful cost.
2. **Surprising without context**: a future reader would wonder why.
3. **The result of a real trade-off**: genuine alternatives existed and there were specific reasons to choose one.

If any condition is missing, skip the ADR. An offer or conversational agreement is not permission to create it; require explicit instruction to record it. Use [ADR-FORMAT.md](ADR-FORMAT.md) for an authorized write.

## Completion

Summarize resolved plan decisions, canonical terms, and remaining uncertainties. In review-only mode, leave proposed documentation changes in chat. If writes were authorized, report changed paths and check glossary format, context-map links, and ADR numbering as applicable. Stop at the requested planning deliverable, not implementation.

## Maintenance

For local overlays and future updates, read the [Matt Pocock update process](../../../docs/skills/mattpocock-skills-update-process.md).
