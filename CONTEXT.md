# Pi Agent Config

This repository captures the user's local Pi agent configuration, skill set, and maintenance rules so future agents can behave consistently across sessions.

## Language

**Pi Config**:
The repo-owned configuration for the user's Pi coding agent environment.
_Avoid_: dotfiles, random local settings

**Local Skill**:
A skill installed for this Pi environment and maintained as part of the Pi Config.
_Avoid_: global skill, temporary skill

**Upstream Skill**:
A skill source maintained outside this repo and adapted into a Local Skill.
_Avoid_: original copy, vendor file

**Skill Maintenance Doc**:
A central document that explains how to refresh a Local Skill from its Upstream Skill.
_Avoid_: update note, migration note

**Local Skill Update Invariant**:
A repo-owned rule that must be reapplied after syncing a Local Skill from upstream so local safety, routing, token footprint, and OpenAI skill compatibility are preserved.
_Avoid_: post-update cleanup, preference

**Runtime Reference**:
A bundled skill file that an agent reads during task execution for detailed commands, workflows, or troubleshooting.
_Avoid_: maintenance doc, changelog

**External Hosted Service Mutation Gate**:
The rule that remote service writes require explicit user instruction for the exact mutation.
_Avoid_: permission prompt, safety check

**Context Watcher**:
The command-routing and context-management layer that keeps shell output, searches, and large files token-efficient.
_Avoid_: wrapper, logger

## Relationships

- A **Local Skill** may be derived from an **Upstream Skill**.
- A **Skill Maintenance Doc** records how to update one or more **Local Skills** from their **Upstream Skills**.
- A **Local Skill Update Invariant** constrains every skill update; upstream content is input, not final truth.
- A **Runtime Reference** belongs to a **Local Skill** and supports task execution.
- The **External Hosted Service Mutation Gate** applies whenever a task would modify GitHub, Linear, Figma, NotebookLM, Firebase, cloud services, or similar remote systems.
- **Context Watcher** governs read-only shell work and large-output processing across the **Pi Config**.

## Example dialogue

> **User:** "Install this OpenAI skill and make it easy to update later."
> **Agent:** "I will create or update the **Local Skill**, preserve the **Upstream Skill** source in a **Skill Maintenance Doc**, and keep runtime details in **Runtime References** only when the skill needs them."

## Flagged ambiguities

- "update process" is used as **Skill Maintenance Doc** in this repo.
- "update the skill" means sync from upstream, then reapply **Local Skill Update Invariants** before validation.
- "reference" means **Runtime Reference** when it lives inside a skill, not long-lived maintenance guidance.
