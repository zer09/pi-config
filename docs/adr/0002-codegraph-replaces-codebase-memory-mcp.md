# ADR 0002: CodeGraph replaces codebase-memory-mcp

## Status

Accepted. Runtime skill packaging superseded by ADR 0003; CodeGraph remains the active graph-first provider.

## Context

Pi previously used `codebase-memory-mcp` as the graph-first code exploration layer in Context Watcher, reader delegates, and local skill guidance. That setup required project-name lookup, `root_path` matching, explicit project status checks, and custom guidance for codebase-memory-specific ADR, trace ingestion, Cypher, and persistence behaviors.

CodeGraph is now installed locally and provides a per-repository `.codegraph/` SQLite index, a `codegraph serve --mcp` server, and MCP tools for task context, symbol search, traces, source exploration, and optional callers/callees, impact analysis, indexed files, and status depending on the live server tool exposure. CodeGraph defines 10 MCP tool capabilities, but `tools/list` is gated by the server's active/default project size: fewer than 500 indexed files exposes only the 5 core tools, and per-call `projectPath` does not change that already-listed MCP surface. Its MCP tools accept `projectPath`, which fits Pi worktree and multi-repo workflows better than a separate project registry.

The migration plan is recorded in `handoffs/2026-05-30-codegraph-replacement-plan.md`.

## Decision

Replace active `codebase-memory-mcp` usage with CodeGraph as Pi's structural code graph provider.

Implementation policy:

- Configure Pi MCP with `codegraph` using `codegraph serve --mcp` and a workspace/root path appropriate for the active task; the server launch path controls MCP tool gating.
- Remove the active `codebase-memory-mcp` MCP server entry and runtime skill.
- Add CodeGraph runtime guidance and a detailed routing reference under Context Watcher; ADR 0003 supersedes the earlier standalone Local Skill packaging.
- Update Context Watcher, reader delegates, and global agent rules so structural code exploration, review, caller/callee lookup, tracing, and refactor impact analysis use CodeGraph first.
- Use `projectPath` for worktrees, multi-repo tasks, and repos outside the active session root.
- Treat `codegraph init`, `codegraph index`, `codegraph sync`, and `codegraph uninit` as local index mutations. Run them only when setup/indexing/deletion is explicitly authorized or directly requested.
- Keep `.codegraph/` ignored in git before initializing indexes.
- Keep the legacy `.codebase-memory/` ignore temporarily so old local graph data is not accidentally committed while cleanup remains optional.
- Do not invent replacements for codebase-memory-specific ADR memory, trace ingestion, Cypher, persistent graph artifacts, or project deletion APIs. Use CodeGraph tools where they apply and explicit fallback routes otherwise.

## Consequences

- Structural code work now routes through CodeGraph MCP core tools such as `codegraph_context`, `codegraph_trace`, `codegraph_search`, `codegraph_node`, and `codegraph_explore`, with optional tools such as `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, and `codegraph_status` when exposed by the live server. Hidden optional MCP tools are expected when the active/default project has fewer than 500 indexed files; use CLI equivalents through Context Mode/RTK.
- Each repository or worktree needs its own `.codegraph/` index when graph accuracy matters.
- Pi must be restarted or MCP metadata must be refreshed after config changes before the `codegraph` server appears in MCP tool lists.
- Existing `.codebase-memory/` data may remain local and ignored until explicitly removed.
- ADR and skill-maintenance docs must treat CodeGraph, not codebase-memory, as the retained graph-first capability owned by Context Watcher.

## Validation

Required validation for this migration:

1. Parse `agent/mcp.json`.
2. Validate the `codegraph` and `context-watcher` skills with `quick_validate.py`.
3. Scan active rules, skills, delegate prompts, and MCP config for stale active `codebase-memory` references.
4. Verify `docs/skills/installed-skills-trim-verdict.md` and custom skill update docs name CodeGraph as the retained graph-first local skill.
5. After Pi restart or MCP refresh, list the `codegraph` MCP server and run read-only `codegraph status <repo>` or exposed `codegraph_status` on an initialized repository.
