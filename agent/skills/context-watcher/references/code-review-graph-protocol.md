# Code Review Graph protocol

This reference expands the graph-first rules in `../SKILL.md`. Load it for code review, codebase exploration, graph build/update, stale graph, graph daemon, or graph fallback details.

## Supported languages

Use Code Review Graph first for supported codebases:

```text
Python, TypeScript, JavaScript, Vue, Go, Rust, Java, C#, Ruby,
Kotlin, Swift, PHP, Solidity, C/C++
```

If the repository language is unsupported, fall back to Context Mode plus RTK-based exploration.

## Mandatory graph-first scope

Use Code Review Graph before grep/find/manual file reading for:

- Codebase exploration.
- Code review.
- Blast-radius analysis.
- Caller/callee lookup.
- Test discovery.
- Architecture review.
- Refactor analysis.
- Impact radius of changed files.

An unavailable, empty, stale, or incomplete graph is not automatically a reason to abandon graph-first. Build or update the graph when authorized and useful, then retry the graph query.

## Initial graph build

Use Context Mode for graph CLI output:

```text
ctx_execute({ language: "shell", code: "code-review-graph build" })
```

Or use the Code Review Graph MCP tools when available:

- `code_review_graph_build_or_update_graph_tool`
- `code_review_graph_list_graph_stats_tool`
- `code_review_graph_query_graph_tool`
- `code_review_graph_semantic_search_nodes_tool`
- `code_review_graph_get_review_context_tool`
- `code_review_graph_get_impact_radius_tool`
- `code_review_graph_detect_changes_tool`

## Graph-first exploration

Typical sequence:

1. Check graph stats for the repo root.
2. If graph is missing or empty and build/update is authorized, build or update it.
3. Query graph for relevant files, functions, callers, callees, communities, or flows.
4. Read only the narrow set of files needed for editing or verification.
5. Use Context Mode/RTK fallback only if graph remains insufficient.

## Code review workflow

For review tasks:

1. Detect changed files.
2. Use graph impact radius for changed files.
3. Get compact review context.
4. Inspect high-risk callers/callees and affected flows.
5. Read only affected files or focused snippets.
6. Validate claims with code, tests, or graph evidence.

## Continuous updates

- If files changed during the session, update the graph before relying on stale relationships.
- Re-check graph stats periodically during long work.
- Do not rebuild before every query if a daemon or fresh graph is already available.

## Ignore configuration

Keep generated, vendored, dependency, cache, build, and runtime artifact directories out of the graph where possible. Examples:

```text
node_modules/
dist/
build/
coverage/
__pycache__/
.pytest_cache/
.venv/
```

Do not ignore source files just to reduce graph size unless the user explicitly accepts that coverage loss.

## Fallback conditions

Fallback to Context Mode plus RTK when:

- The language is unsupported.
- Building/updating is not authorized.
- Building would be wasteful for a one-off check.
- The graph remains insufficient after build/update.
- Code Review Graph tooling is unavailable and cannot be repaired quickly.

When falling back, state or log why graph-first could not continue.

## Worktrees and daemon

For worktree-specific graph rules, including story-grouped roots and daemon watch behavior, see `worktree-graph-protocol.md`.
