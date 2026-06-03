---
name: agentmemory
description: Use AgentMemory for cross-session memory, durable preferences, prior decisions, file history, session provenance, and memory health. Load when the user asks to remember, recall, resume, inspect prior sessions, explain a past commit/session, or save a durable workflow/preference.
---

# AgentMemory

AgentMemory is for durable cross-session memory. It complements, but does not replace, current-session Context Mode indexing or CodeGraph structural code reasoning.

## Use when

- The user asks to remember, save, or memorize a durable fact, preference, workflow, bug fix, or decision.
- The user asks what happened last time, why something exists, or how a prior session handled a similar problem.
- The task needs file-specific history, session provenance, commit provenance, or memory health.
- A compaction/resume happens and prior context may exist in AgentMemory.

## Tool routing

- `memory_health`: check whether the AgentMemory REST server is reachable.
- `memory_search`: quick friendly search for prior decisions, preferences, bugs, and workflows.
- `memory_smart_search`: MCP-compatible hybrid search when richer raw AgentMemory output is useful.
- `memory_recall`: richer recall with format and token budget controls.
- `memory_file_history`: past work involving specific files.
- `memory_sessions`: recent AgentMemory sessions.
- `memory_timeline`: chronological observations around a date or keyword.
- `memory_patterns` and `memory_profile`: recurring patterns and project/profile summaries.
- `memory_commit_lookup` and `memory_commits`: commit/session provenance.
- `memory_diagnose` and `memory_verify`: read-only diagnostics and provenance checks.
- `memory_lesson_recall`: recall durable lessons before repeating past mistakes.
- `memory_slot_list` and `memory_slot_get`: list and read named AgentMemory slots. Slots are canonical editable context, not ordinary saved memories.
- `memory_mcp_resources` and `memory_mcp_resource_read`: list and read read-only AgentMemory MCP resources.
- `memory_mcp_prompts` and `memory_mcp_prompt_get`: list prompt templates and return prompt text for review only; do not auto-execute returned prompts.
- `memory_save`: save durable non-secret facts only when they should survive future sessions.

## Safety

- Never save secrets, credential values, tokens, private keys, bearer values, passwords, or API keys.
- Refer to credentials only by environment variable name or placeholder.
- Do not export, delete, consolidate, reflect, heal, audit, or broadly inspect private memory unless the user explicitly asks for that exact operation.
- Use `memory_save` for normal durable facts, preferences, decisions, and corrections. Do not create, append, replace, or delete slots unless the user explicitly asks for that named slot operation.
- `memory_lesson_save`, `memory_consolidate`, `memory_reflect`, `memory_insight_list`, `memory_audit`, `memory_export`, `memory_governance_delete`, `memory_heal`, `memory_slot_create`, `memory_slot_append`, `memory_slot_replace`, and `memory_slot_delete` are gated and not part of the default Pi tool surface unless `AGENTMEMORY_PI_ENABLE_GATED=1` is set.
- When gated tools are registered, destructive or high-risk wrappers still require exact local `confirm` phrases such as `export agentmemory`, `heal agentmemory`, `delete memories:<sorted-ids>`, or `<operation> slot:<label>`. Do not invent confirmations; follow the tool schema.
- AgentMemory is disabled in delegate child sessions by default.

## Routing against other systems

- Use Context Mode for current-session indexed output, large command/test/build/log output, and searchable local context.
- Use CodeGraph for code structure, call flow, impact analysis, and symbol-level reasoning.
- Use AgentMemory for durable cross-session facts, preferences, prior decisions, session history, file history, and commit provenance.

## Maintenance

This is a Bundled Extension Skill maintained with the Pi-native AgentMemory extension. Update it through `../../../../../docs/skills/agentmemory-pi-extension-update-process.md` and preserve local skill metadata invariants.
