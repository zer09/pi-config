# ADR 0001: Curated Pi-native AgentMemory extension

## Status

Accepted.

## Context

This repository consumes upstream AgentMemory through a Pi-native AgentMemory extension at `agent/extensions/agentmemory/`. The extension wraps the upstream AgentMemory server with Pi-native tool definitions, safety gates, status hooks, and a bundled Pi skill.

Pi needs AgentMemory for cross-session memory, prior decisions, file history, commit/session provenance, and durable user preferences. Upstream AgentMemory exposes a large MCP surface, including read-only search tools, durable write tools, broad export/audit tools, destructive deletion, consolidation/reflection workflows, team/mesh coordination, slot editing, file compression, and optional provider features.

Importing the entire upstream MCP surface into Pi by default would make normal coding sessions noisier and riskier. Some upstream tools are useful as a source of truth, but they are not all appropriate as active default Pi tools.

This Pi-native AgentMemory extension also has safety and runtime requirements that must survive upstream syncs:

- delegate child sessions must not register AgentMemory tools, hooks, or bundled skills
- headless sessions must not crash when UI status is unavailable
- bearer credentials must not be sent over non-loopback plaintext HTTP when HTTPS enforcement is enabled
- durable memory writes must reject obvious secret-looking content
- AgentMemory status text must remain stable unless intentionally changed and covered by tests or docs
- the AgentMemory skill should be bundled with the extension instead of copied into global `agent/skills/`

## Decision

Use this Pi-native AgentMemory extension with a curated, typed, stable subset of AgentMemory tools. The extension may call upstream AgentMemory REST and MCP bridge endpoints, but it must not dynamically register every upstream MCP tool.

The extension owns:

```text
agent/extensions/agentmemory/index.ts
agent/extensions/agentmemory/security.ts
agent/extensions/agentmemory/tool-policy.json
agent/extensions/agentmemory/skills/agentmemory/SKILL.md
agent/extensions/agentmemory/docs/agentmemory-upgrade-process.md
```

The bundled AgentMemory skill is exposed through Pi `resources_discover` and remains part of the extension package.

`src/mcp/tools-registry.ts` in upstream AgentMemory is the MCP schema source of truth. `tool-policy.json` in this extension is the local source of truth for whether an upstream tool is default, gated, or not exposed.

## Tool policy

### Default local tools

Default tools are bounded and routine for Pi coding sessions. They are mostly read-only. The one default durable write path is `memory_save`, guarded against secret-looking content.

This Pi-native extension also provides Pi-local helpers:

```text
memory_health
memory_search
```

Default upstream-backed tools:

```text
memory_recall
memory_save
memory_file_history
memory_patterns
memory_sessions
memory_smart_search
memory_timeline
memory_profile
memory_commit_lookup
memory_commits
memory_diagnose
memory_verify
memory_lesson_recall
```

### Gated tools

These are useful but must not be routine defaults. They require `AGENTMEMORY_PI_ENABLE_GATED=1`, and destructive or broad-private operations still require exact user intent.

```text
memory_export
memory_consolidate
memory_audit
memory_governance_delete
memory_heal
memory_lesson_save
memory_reflect
memory_insight_list
```

Reasons:

- broad private export or audit can expose large amounts of memory data
- deletion is destructive
- heal/consolidate/reflect mutate or synthesize memory subsystem state
- lesson-save is an additional durable write path beyond guarded `memory_save`

### Not exposed by default

Do not expose tools that rewrite local files, export to local files, assume team/mesh workflows, mutate task/coordination state not adopted by Pi, require optional providers, or overlap with Pi handoffs, plans, Context Mode, or CodeGraph.

Examples:

```text
memory_compress_file
memory_obsidian_export
memory_team_*
memory_mesh_sync
memory_action_*
memory_slot_*
memory_graph_query
memory_relations
```

## Consequences

Positive:

- Pi gets a useful AgentMemory surface without importing all upstream tools into every session.
- Tool names and schemas remain stable even when the AgentMemory server is temporarily offline.
- Safety gates are encoded locally and checked during upgrades.
- Upstream syncs can be reviewed with a repeatable checker instead of copied blindly.
- The bundled AgentMemory skill travels with the extension and stays aligned with the local tool policy.

Tradeoffs:

- New upstream tools require manual classification before they can be used in Pi.
- Some upstream workflows remain unavailable until intentionally adopted.
- This Pi-native extension can diverge from upstream `integrations/pi/`, so upgrades need explicit review.
- The checker and policy file must be maintained as upstream AgentMemory evolves.

## Upgrade rule

Future upgrades must follow:

```text
agent/extensions/agentmemory/docs/agentmemory-upgrade-process.md
```

This ADR records the architecture rationale; the upgrade process records the operational checklist.
