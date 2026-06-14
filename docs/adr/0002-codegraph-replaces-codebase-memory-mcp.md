# ADR 0002: CodeGraph replaces codebase-memory-mcp

## Status

Accepted. Runtime skill packaging was later superseded by ADR 0003 and then by the old pasted-skills re-setup; CodeGraph remains the active graph-first provider through native Pi tooling and global/project guidance.

## Context

Pi previously used `codebase-memory-mcp` as the graph-first code exploration layer in Context Watcher, reader delegates, and local skill guidance. That setup required project-name lookup, `root_path` matching, explicit project status checks, and custom guidance for codebase-memory-specific ADR, trace ingestion, Cypher, and persistence behaviors.

CodeGraph is now installed locally and provides a per-repository `.codegraph/` SQLite index, a `codegraph serve --mcp` server, and MCP tools for primary source/flow exploration, symbol search, one-symbol source, callers/callees, impact analysis, indexed files, and status. As of CodeGraph v0.9.9, `codegraph_explore` is the primary MCP tool for architecture, bug, source survey, and flow/path questions; current visible tools are `codegraph_explore`, `codegraph_search`, `codegraph_node`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, and `codegraph_status`, unless `CODEGRAPH_MCP_TOOLS` or stale MCP metadata narrows the list. Its MCP tools accept `projectPath`, which fits Pi worktree and multi-repo workflows better than a separate project registry.

The migration plan is recorded in `handoffs/2026-05-30-codegraph-replacement-plan.md`.

## Decision

Replace active `codebase-memory-mcp` usage with CodeGraph as Pi's structural code graph provider.

Implementation policy:

- Configure Pi MCP with `codegraph` using `codegraph serve --mcp`; pass `projectPath` for worktrees, multi-repo tasks, and repos outside the active session root.
- Remove the active `codebase-memory-mcp` MCP server entry and runtime skill.
- Historically, CodeGraph runtime guidance moved under Context Watcher; ADR 0003 and the old pasted-skills re-setup later superseded that packaging.
- Keep reader delegates and global/project agent rules aligned so structural code exploration, review, caller/callee lookup, flow/path exploration, and refactor impact analysis use CodeGraph first.
- Treat `codegraph init`, `codegraph index`, `codegraph sync`, and `codegraph uninit` as local index mutations. Run them only when setup/indexing/sync/freshness/deletion is explicitly authorized or directly requested. `codegraph init` builds the initial index by default in v0.9.9; do not use the deprecated `--index` flag in new guidance.
- Keep `.codegraph/` ignored in git before initializing indexes.
- Keep the legacy `.codebase-memory/` ignore temporarily so old local graph data is not accidentally committed while cleanup remains optional.
- Do not invent replacements for codebase-memory-specific ADR memory, trace ingestion, Cypher, persistent graph artifacts, or project deletion APIs. Use CodeGraph tools where they apply and explicit fallback routes otherwise.

## Consequences

- Structural code work now routes first through `codegraph_explore` for architecture, bug, source survey, and flow/path questions; use `codegraph_search`, `codegraph_node`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, and `codegraph_status` for focused lookups when exposed by the live server. If MCP metadata is stale or an allowlist hides tools, use CLI equivalents through Context Mode/RTK where available.
- Each repository or worktree needs its own `.codegraph/` index when graph accuracy matters.
- Pi must be restarted or MCP metadata must be refreshed after config changes before the `codegraph` server appears in MCP tool lists.
- Existing `.codebase-memory/` data may remain local and ignored until explicitly removed.
- ADR and skill-maintenance docs must treat CodeGraph, not codebase-memory, as the retained graph-first capability. It is no longer owned by a runtime `context-watcher` skill.

## Validation

Required validation for this migration:

1. Parse `agent/mcp.json`.
2. Verify the CodeGraph MCP server/tool list. If a future runtime skill restores CodeGraph guidance, validate that skill with `quick_validate.py`.
3. Scan active rules, skills, delegate prompts, and MCP config for stale active `codebase-memory` references.
4. Verify `docs/skills/installed-skills-trim-verdict.md` and custom skill update docs name CodeGraph as the retained graph-first capability, not an installed Local Skill.
5. After Pi restart or MCP refresh, list the `codegraph` MCP server and run read-only `codegraph status <repo>` or exposed `codegraph_status` on an initialized repository.
