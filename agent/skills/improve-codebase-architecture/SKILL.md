---
name: improve-codebase-architecture
description: "Assess codebase architecture and explore deepening candidates grounded in domain language and ADRs. Use for architecture reviews, refactoring opportunity assessment, or exploring a selected candidate, not automatic refactoring or documentation writes."
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones, improving testability and AI-navigability.

## Read-only boundary

An architecture review ends with candidates and questions. Do not edit source, `CONTEXT.md`, `CONTEXT-MAP.md`, ADRs, or reports in the repository without explicit user instruction for those repository changes.

Choosing a candidate authorizes exploration, not implementation or documentation writes. Design grilling remains read-only unless the user explicitly requests those changes. Agreement on a term or design does not authorize a write. Do not automatically hand off to implementation.

## Glossary

Use [LANGUAGE.md](LANGUAGE.md) for architecture terms and the project's `CONTEXT.md` for domain terms. Keep **module**, **interface**, and **seam** distinct; do not substitute "component," "service," "API," or "boundary."

- **Module**: anything with an interface and an implementation, from a function to a package or slice.
- **Interface**: everything a caller must know, including types, invariants, errors, ordering, and config.
- **Implementation**: the code inside.
- **Depth**: leverage at the interface. **Deep** means much behaviour behind a small interface; **shallow** means the interface is nearly as complex as the implementation.
- **Seam**: where an interface lives; a place behaviour can change without editing in place.
- **Adapter**: a concrete thing satisfying an interface at a seam.
- **Leverage**: what callers get from depth.
- **Locality**: what maintainers get from depth; change, bugs, and knowledge concentrate in one place.

Apply the **deletion test**: if deleting a module makes complexity vanish, it was a pass-through. If complexity reappears across callers, it was earning its keep. The **interface is the test surface**. **One adapter means a hypothetical seam; two adapters mean a real seam.**

## Explore the requested area

Start with the named module, subsystem, or pain point. Otherwise, inspect a useful span of recent Git history through Context Mode and prioritize recurring hot spots. Widen only when history has no clear concentration.

Read the domain glossary, any context map, and relevant ADRs first. Use CodeGraph first for source flows and relationships. Explore directly; delegate only if the user or project workflow explicitly requests delegation.

Look for evidence of shallow modules, understanding split across small modules, tightly-coupled modules leaking across seams, or tests that miss caller behaviour. Apply the deletion test to suspected pass-throughs. Domain language names useful seams; ADRs record decisions not to re-litigate without evidence.

## Present candidates and pause

Present a numbered list. Each candidate includes:

- **Files**: the involved files/modules, with source locations.
- **Problem**: the architectural friction and its evidence.
- **Solution**: what would change, in plain English.
- **Benefits**: locality, leverage, and how tests would improve.

Use domain names such as "Order intake module," not incidental identifiers or "Order service." Surface an **ADR conflict** only when concrete friction warrants revisiting it. Label the conflict with the ADR identifier and the reason to reopen it.

If the user requests a visual report, use [HTML-REPORT.md](HTML-REPORT.md) to write it in the OS temp directory and summarize the recommendation in chat. Otherwise, keep the review in chat. Repository reports require explicit repository-change instruction.

Do not propose interfaces yet. Ask: "Which of these would you like to explore?" **Stop here until the user chooses a candidate.**

## Explore a chosen candidate

Ask one material design question at a time with a recommendation. Prefer code/docs evidence to questions the repository can answer. Discuss constraints, dependencies, the deepened module, seam placement, and surviving tests. Use [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md) only when alternative interfaces would help the selected exploration.

Keep proposed terms and decisions in the conversation unless documentation writes are explicitly requested:

- For an authorized new or clarified domain term, use [CONTEXT-FORMAT.md](../grill-with-docs/CONTEXT-FORMAT.md). Keep `CONTEXT.md` glossary-only and create it lazily when there is a resolved term to record.
- If rejection has a durable, non-obvious reason, sparingly offer: "Want me to record this as an ADR so future architecture reviews don't re-suggest it?" Apply the three-part test in [ADR-FORMAT.md](../grill-with-docs/ADR-FORMAT.md). Skip ephemeral and self-evident reasons; create an ADR only on explicit instruction.

## Completion

The initial review is complete at the candidate pause. Selected-candidate exploration ends when the decisions needed for the requested design are resolved or remaining uncertainties are explicit. Summarize decisions, open questions, and any authorized documentation changes. Do not continue into implementation without an explicit request.

## Maintenance

For local overlays and future updates, read the [Matt Pocock update process](../../../docs/skills/mattpocock-skills-update-process.md).
