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

## MCP function and parameter usage

Use the MCP server documentation as the source of truth for current tool signatures. When a parameter or tool name is unclear, call `code_review_graph_get_docs_section_tool(section_name="commands")` before guessing.

Default usage:

- Use `code_review_graph_get_minimal_context_tool` or `code_review_graph_get_architecture_overview_tool(detail_level="minimal")` for broad first-pass orientation.
- Use `detail_level="minimal"` for first-pass calls on high-volume tools that support it. Escalate only after narrowing scope and needing examples or source context.
- Keep community queries bounded by default. Use `include_member_names`, `include_members`, or larger `members_sample_limit` only after selecting a specific community.
- Do not use `code_review_graph_cross_repo_search_tool` for repo-scoped analysis unless the user explicitly asks to search unrelated registered repositories.
- Treat `code_review_graph_apply_refactor_tool` as a local file mutation path. Its `dry_run` default is `false`; set `dry_run: true` for previews unless file edits are in scope, then review the diff before committing.

## Initial graph build

Use Context Mode for graph CLI output:

```text
ctx_execute({ language: "shell", code: "code-review-graph build" })
```

Prefer Code Review Graph MCP tools when available.

Primary MCP tools by workflow:

- Build/status: `code_review_graph_build_or_update_graph_tool`, `code_review_graph_run_postprocess_tool`, `code_review_graph_list_graph_stats_tool`.
- Query/review: `code_review_graph_get_minimal_context_tool`, `code_review_graph_detect_changes_tool`, `code_review_graph_query_graph_tool`, `code_review_graph_semantic_search_nodes_tool`, `code_review_graph_embed_graph_tool`, `code_review_graph_get_review_context_tool`. Use `detail_level: "minimal"` for first-pass calls where supported.
- Impact/flows: `code_review_graph_get_impact_radius_tool`, `code_review_graph_list_flows_tool`, `code_review_graph_get_flow_tool`, `code_review_graph_get_affected_flows_tool`. Use `detail_level: "minimal"` for first-pass impact radius and flow lists.
- Architecture/communities: `code_review_graph_get_architecture_overview_tool`, `code_review_graph_list_communities_tool`, `code_review_graph_get_community_tool`, `code_review_graph_get_hub_nodes_tool`, `code_review_graph_get_bridge_nodes_tool`, `code_review_graph_get_knowledge_gaps_tool`, `code_review_graph_get_surprising_connections_tool`, `code_review_graph_get_suggested_questions_tool`, `code_review_graph_traverse_graph_tool`. Use architecture and community lists with `detail_level: "minimal"`, then drill into one community with bounded defaults.
- Docs/wiki/refactor: `code_review_graph_get_docs_section_tool`, `code_review_graph_generate_wiki_tool`, `code_review_graph_get_wiki_page_tool`, `code_review_graph_refactor_tool`, `code_review_graph_apply_refactor_tool`.
- Registry/cross-repo: `code_review_graph_list_repos_tool`, `code_review_graph_cross_repo_search_tool`. Do not use cross-repo search for normal repo-scoped analysis.

## Graph-first exploration

Typical sequence:

1. Check graph stats for the repo root.
2. If graph is missing or empty and build/update is authorized, build or update it.
3. For broad orientation, call `code_review_graph_get_minimal_context_tool` or `code_review_graph_get_architecture_overview_tool` with `detail_level: "minimal"`.
4. Query graph for relevant files, functions, callers, callees, communities, or flows. Keep high-volume tools on `detail_level: "minimal"` until a focused evidence pass is needed.
5. Read only the narrow set of files needed for editing or verification.
6. Use Context Mode/RTK fallback only if graph remains insufficient.

## Code review workflow

For review tasks:

1. Detect changed files with `code_review_graph_detect_changes_tool` and `detail_level: "minimal"`.
2. Use graph impact radius for changed files with `detail_level: "minimal"`.
3. Get compact review context; keep `include_source: false` for triage and enable source snippets only after narrowing scope.
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
