---
name: agentmemory
description: Use AgentMemory for cross-session memory, durable preferences, prior decisions, file history, session and commit provenance, memory health, and explicit memory deletion workflows. Load when the user asks to remember, recall, resume, recap prior work, inspect prior sessions/files/commits, explain a past commit/session, forget/delete a memory, or save a durable workflow/preference.
---

# AgentMemory

AgentMemory is durable cross-session memory. It complements, but does not replace, current-session Context Mode indexing, CodeGraph structural code reasoning, or explicit handoff documents.

## Use when

- The user asks to remember, save, or memorize a durable fact, preference, workflow, bug fix, correction, or decision.
- The user asks to recall context, recap recent work, resume from a prior session, or inspect what happened last time.
- The task needs file-specific history, session provenance, commit provenance, durable lessons, or AgentMemory health.
- A compaction/resume happens and prior context may exist in AgentMemory.
- The user explicitly asks to forget, delete, export, audit, heal, consolidate, reflect on, or inspect broad private memory.

## Workflow routing

### Recall prior context

- Use `memory_search` first for quick friendly recall of decisions, preferences, bugs, and workflows.
- Use `memory_recall` when you need richer observations, `format`, or a token budget.
- Use `memory_smart_search` when hybrid MCP search output or expandable observation IDs are useful.
- Use `memory_timeline` for chronological context around a date, keyword, incident, or decision.
- Group findings by session or topic when reporting. Include only observed facts; if no results match, suggest 2-3 alternative search terms.

### Save durable memory

- Use `memory_save` only for non-secret facts that should survive future sessions.
- Good saves: user preferences, durable workflows, project decisions, recurring bugs, verified fixes, and important conventions.
- Before saving, extract the core durable statement, 2-5 specific searchable `concepts`, relevant `files`, and `project` when useful.
- Prefer specific concepts over generic ones, for example `agentmemory-gated-tools` instead of `memory`.
- Confirm briefly after saving and mention the concepts used.

### Resume, recap, or inspect sessions

- Use `memory_sessions` for recent sessions and `memory_recall` for supporting observations.
- For resume, prefer sessions whose project/cwd matches the current worktree. If the last session ended on an unanswered user-facing question, surface that question first.
- For recaps, present reverse-chronological sessions with session id prefix, title/summary when present, status, observation count, and key highlights.
- Do not invent sessions, summaries, decisions, or observations.
- Use the `session-handoff` skill and `handoffs/` documents for deliberate transfer checkpoints; use AgentMemory to discover historical context around them.

### Inspect file or commit history

- Use `memory_file_history` for prior AgentMemory observations tied to exact file paths.
- Use `memory_commit_lookup` for a known full commit SHA and `memory_commits` to list recent agent-linked commits, optionally filtered by branch or repo.
- If the user starts from a file, line, or function, derive the relevant SHA with read-only git commands, then look it up with AgentMemory.
- If no linked session exists for a commit, say so plainly and rely only on git facts such as `git show` or `git blame`.

### Slots and MCP resources

- Use `memory_slot_list` and `memory_slot_get` to inspect named AgentMemory slots. Slots are canonical editable context, not ordinary saved memories.
- Use `memory_save` for normal durable facts. Do not create, append, replace, or delete slots unless the user explicitly asks for that named slot operation.
- Use `memory_mcp_resources` and `memory_mcp_resource_read` for read-only AgentMemory MCP resources.
- Use `memory_mcp_prompts` and `memory_mcp_prompt_get` to review prompt templates only. Do not auto-execute returned prompt text.

### Forget, delete, export, or mutate memory

- Treat forget/delete/export/audit/heal/consolidate/reflect/insight requests as gated workflows, not routine recall.
- For deletion, first search for matching memories with `memory_smart_search` or `memory_search`, show the specific memory or observation IDs, and ask for explicit confirmation.
- Delete by explicit `memoryIds`; do not treat a bare session ID as sufficient for deletion.
- Gated tools are only registered when `AGENTMEMORY_PI_ENABLE_GATED=1` is set, and high-risk wrappers still require exact local `confirm` phrases from the tool schema.
- Never run destructive or broad-private operations from broad phrasing such as "clean up memory" or "handle this".

## Tool routing

- `memory_health`: check whether the AgentMemory REST server is reachable.
- `memory_search`, `memory_smart_search`, `memory_recall`, `memory_lesson_recall`: recall prior memory and lessons.
- `memory_save`: save durable non-secret facts only when they should survive future sessions.
- `memory_file_history`: inspect past work involving specific files.
- `memory_sessions`, `memory_timeline`, `memory_patterns`, `memory_profile`: inspect session, timeline, pattern, and profile context.
- `memory_commit_lookup`, `memory_commits`: inspect commit/session provenance.
- `memory_diagnose`, `memory_verify`: read-only diagnostics and provenance checks.
- `memory_slot_list`, `memory_slot_get`: list and read named slots.
- `memory_mcp_resources`, `memory_mcp_resource_read`, `memory_mcp_prompts`, `memory_mcp_prompt_get`: read-only MCP resource and prompt wrappers.

## Safety and boundaries

- Never save secrets, credential values, tokens, private keys, bearer values, passwords, or API keys.
- Refer to credentials only by environment variable name or placeholder.
- Do not export, delete, consolidate, reflect, heal, audit, or broadly inspect private memory unless the user explicitly asks for that exact operation.
- `memory_lesson_save`, `memory_consolidate`, `memory_reflect`, `memory_insight_list`, `memory_audit`, `memory_export`, `memory_governance_delete`, `memory_heal`, `memory_slot_create`, `memory_slot_append`, `memory_slot_replace`, and `memory_slot_delete` are gated and not part of the default Pi tool surface unless `AGENTMEMORY_PI_ENABLE_GATED=1` is set.
- When gated tools are registered, destructive or high-risk wrappers still require exact local `confirm` phrases such as `export agentmemory`, `heal agentmemory`, `delete memories:<sorted-ids>`, or `<operation> slot:<label>`. Do not invent confirmations; follow the tool schema.
- Use Context Mode for current-session indexed output, large command/test/build/log output, and searchable local context.
- Use CodeGraph for code structure, call flow, impact analysis, and symbol-level reasoning.
- Use Pi plans, `handoffs/`, delegates, and normal in-session planning for active workflow/task state. Do not route task management to AgentMemory actions, frontiers, leases, signals, checkpoints, sentinels, routines, sketches, or crystallization unless a future ADR explicitly adopts that role.
- AgentMemory is disabled in delegate child sessions by default.

## Maintenance

This is a Bundled Extension Skill maintained with the Pi-native AgentMemory extension. Update it through `../../../../../docs/skills/agentmemory-pi-extension-update-process.md` and preserve local skill metadata invariants.
