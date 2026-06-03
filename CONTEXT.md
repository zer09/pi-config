# Pi Agent Config

This repository captures the user's local Pi agent configuration, skill set, and maintenance rules so future agents can behave consistently across sessions.

## Language

**Pi Config**:
The repo-owned configuration for the user's Pi coding agent environment.
_Avoid_: dotfiles, random local settings

**Local Skill**:
A skill installed for this Pi environment and maintained as part of the Pi Config.
_Avoid_: global skill, temporary skill

**Bundled Extension Skill**:
A Local Skill packaged inside a Pi extension and discovered at runtime rather than installed under the main skills directory.
_Avoid_: extension-only skill, exempt skill

**Custom Local Skill**:
A Local Skill whose source of truth is this Pi Config rather than an Upstream Skill.
_Avoid_: one-off skill, orphan skill

**Upstream Skill**:
A skill source maintained outside this repo and adapted into a Local Skill.
_Avoid_: original copy, vendor file

**Skill Maintenance Doc**:
A central document that explains how to refresh a Local Skill from its Upstream Skill or maintain a Custom Local Skill.
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
The command-routing and context-management layer that keeps shell output, searches, graph-first structural code exploration, and large files token-efficient.
_Avoid_: wrapper, logger

**CodeGraph Capability**:
The graph-first structural code exploration capability governed by Context Watcher.

**Retired Local Skill**:
A former Local Skill that is no longer installed as runtime instructions but may remain documented for history or reinstall guidance.
_Avoid_: disabled skill, hidden skill

**Reader Delegate**:
A child Pi agent launched for one bounded investigation task with an isolated context window and a compact result returned to the parent.
_Avoid_: background worker, autonomous swarm

**Writer Delegate**:
A child Pi agent launched for one bounded implementation task with an isolated context window and a compact result returned to the parent.
_Avoid_: unconstrained delegate, broad mutation scope

**Delegates Extension**:
The repo-owned Pi extension that registers the reader and writer delegates, discovers user-level delegate definitions, and runs scoped child Pi processes.
_Avoid_: orchestrator

**Pi-native AgentMemory Extension**:
The repo-owned Pi extension that exposes AgentMemory through local safety gates and a curated memory tool surface.
_Avoid_: generic AgentMemory MCP server, full upstream tool surface

**Pi Task Workflow**:
The Pi Config's primary way of tracking agent work across plans, handoffs, and session context.
_Avoid_: AgentMemory actions, workflow state database

**Curated Tool Surface**:
An intentionally selected set of tools exposed to Pi by default because they fit local safety and workflow policy.
_Avoid_: all tools, upstream default surface

**AgentMemory MCP Resource**:
A read-only AgentMemory MCP URI that returns structured memory context such as status, project profile, recent sessions, latest memories, or graph stats.
_Avoid_: tool, generic endpoint

**AgentMemory MCP Prompt**:
An AgentMemory prompt template returned for agent review and never automatically injected or executed by the Pi-native AgentMemory Extension.
_Avoid_: auto-run prompt, hidden instruction

**AgentMemory Slot**:
A named, size-limited AgentMemory memory unit for canonical editable context, scoped to a project or globally.
_Avoid_: ordinary saved memory, observation

**Gated Memory Tool**:
An AgentMemory tool withheld from the default Pi surface until a configured opt-in and exact user intent justify the operation.
_Avoid_: default tool, casual write

**Exact Confirmation Field**:
A local-only wrapper parameter that must match a deterministic confirmation phrase before Pi forwards a destructive or high-risk AgentMemory request.
_Avoid_: generic confirm flag, implicit consent

**AgentMemory Diagnostic**:
A read-only AgentMemory signal that explains memory health, policy drift, or recall-followup behavior.
_Avoid_: repair action, hidden health check

**AgentMemory Export**:
A file-writing AgentMemory operation that materializes private memory content outside the normal recall surface.
_Avoid_: read-only recall, casual backup

**AgentMemory Team/Mesh Sharing**:
An AgentMemory collaboration mode that shares memory or synchronization state across agents or team members.
_Avoid_: local recall, single-agent memory

**AgentMemory Vision/Image Memory**:
An optional AgentMemory capability for storing or searching image-derived memory with image embeddings.
_Avoid_: normal text recall, default memory search

## Relationships

- A **Local Skill** may be derived from an **Upstream Skill**.
- A **Bundled Extension Skill** is still a **Local Skill** for maintenance metadata and inventory purposes.
- A **Bundled Extension Skill** may incorporate selected workflow triggers from multiple upstream skills without installing each upstream skill separately.
- A **Custom Local Skill** is updated from the Pi Config source of truth instead of an Upstream Skill.
- A **Skill Maintenance Doc** records how to update one or more **Local Skills** from their **Upstream Skills** or maintain **Custom Local Skills**.
- A **Local Skill Update Invariant** constrains every skill update; upstream content is input, not final truth.
- A **Runtime Reference** belongs to a **Local Skill** and supports task execution.
- A **Retired Local Skill** may remain documented in a **Skill Maintenance Doc** without remaining installed as a **Local Skill**.
- The **External Hosted Service Mutation Gate** applies whenever a task would modify GitHub, Linear, Figma, NotebookLM, Firebase, cloud services, or similar remote systems.
- **Context Watcher** governs read-only shell work, graph-first structural code exploration, and large-output processing across the **Pi Config**.
- **Context Watcher** owns the **CodeGraph Capability** instead of delegating it to a separate **Local Skill**.
- The **Delegates Extension** launches **reader and writer delegates** with Context Watcher-aware prompt boundaries and no recursive delegation.
- The **Pi-native AgentMemory Extension** exposes a **Curated Tool Surface** instead of the full upstream AgentMemory tool surface.
- The **Pi-native AgentMemory Extension** should expose **AgentMemory MCP Resources** and **AgentMemory MCP Prompts** through curated Pi tools rather than a generic MCP server.
- The **Pi Task Workflow** remains the default owner of task/workflow state; AgentMemory workflow-state tools require a separate ADR before adoption.
- An **AgentMemory Export** remains not exposed until an export-root and privacy policy is written.
- **AgentMemory Team/Mesh Sharing** remains disabled unless an active multi-agent or team workflow needs it.
- **AgentMemory Vision/Image Memory** remains disabled unless a screenshot/image memory use case and storage/privacy policy exist.
- An **AgentMemory Slot** is read by default but written only through a **Gated Memory Tool**.
- A **Gated Memory Tool** should have a real default-off opt-in path rather than documentation-only gating.
- A destructive or high-risk **Gated Memory Tool** should require an **Exact Confirmation Field** before forwarding to upstream AgentMemory.
- An **AgentMemory Diagnostic** should surface through existing health or diagnose workflows before adding a separate default tool.

## Example dialogue

> **User:** "Install this OpenAI skill and make it easy to update later."
> **Agent:** "I will create or update the **Local Skill**, preserve the **Upstream Skill** source in a **Skill Maintenance Doc**, and keep runtime details in **Runtime References** only when the skill needs them."

## Flagged ambiguities

- "update process" is used as **Skill Maintenance Doc** in this repo.
- "update the skill" means sync from upstream, then reapply **Local Skill Update Invariants** before validation.
- "custom skill" means **Custom Local Skill** when it has no Upstream Skill source.
- "extension-bundled skill" means **Bundled Extension Skill** and is not exempt from **Local Skill** maintenance metadata.
- "curated" means **Curated Tool Surface**, not `AGENTMEMORY_TOOLS=all` or generic MCP exposure.
- "MCP prompt" means **AgentMemory MCP Prompt** when discussing AgentMemory config, and is returned for review rather than automatic injection or execution.
- "update memory" means saving a superseding normal memory with `memory_save` unless the user explicitly names an **AgentMemory Slot** or asks for a slot write.
- "slot write" means a **Gated Memory Tool** operation and requires exact intent such as creating, appending, replacing, or deleting a named slot.
- "confirm" means an **Exact Confirmation Field** when used for high-risk AgentMemory wrappers, not a loose boolean.
- "diagnostic" means **AgentMemory Diagnostic** when discussing AgentMemory config, and is read-only unless a separate gated repair action is explicitly requested.
- "workflow manager" means **Pi Task Workflow** by default, not AgentMemory actions/frontier/leases/sentinels/checkpoints.
- "export" means **AgentMemory Export** when discussing AgentMemory config, and is not exposed until export-root, scope, confirmation, and privacy rules are defined.
- "team" or "mesh" means **AgentMemory Team/Mesh Sharing** when discussing AgentMemory config, and is disabled unless an active collaboration setup needs it.
- "vision" or "image embeddings" means **AgentMemory Vision/Image Memory** when discussing AgentMemory config, and is disabled unless image storage, provider, and privacy rules are defined.
- "reference" means **Runtime Reference** when it lives inside a skill, not long-lived maintenance guidance.
