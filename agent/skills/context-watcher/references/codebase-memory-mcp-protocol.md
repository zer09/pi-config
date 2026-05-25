# codebase-memory-mcp protocol

This reference expands the graph-first rules in `../SKILL.md`. Load it for code review, codebase exploration, graph indexing, stale graph, project selection, Cypher, trace, or graph fallback details.

## Mandatory graph-first scope

Use codebase-memory-mcp before grep/find/manual file reading for structural code questions:

- Codebase exploration.
- Code review.
- Blast-radius analysis.
- Caller/callee lookup.
- Test discovery and coverage-oriented investigation.
- Architecture review.
- Refactor analysis.
- Impact of changed files.
- Cross-service route/channel tracing when indexed edges exist.

Use Context Mode/RTK instead for string literals, error messages, config values, non-code files, generated or unindexed files, and raw data processing.

## Project selection and index health

Start every graph session with:

1. `codebase_memory_mcp_list_projects`.
2. Match the active repository or worktree root to a project by `root_path`.
3. If a project matches, call `codebase_memory_mcp_index_status(project=...)`; if none matches, skip status and treat the project as missing.
4. Rebuild with `codebase_memory_mcp_index_repository(repo_path=<active repository or worktree root>, mode="full", persistence=false)` when the project is missing, status is empty/stale/incomplete/failed, the branch/worktree state changed, code was edited and graph accuracy matters, or deep/semantic graph accuracy is required. Then repeat project selection and status checks.
5. If needed, `codebase_memory_mcp_get_graph_schema(project=...)`.
6. If broad orientation is needed, `codebase_memory_mcp_get_architecture(project=...)`.

If needed indexing fails or the project remains missing, empty, stale, or incomplete, follow the fallback protocol and state that graph results are degraded.

Index modes:

- `full`: default rebuild mode when graph freshness or deep/semantic accuracy matters.
- `fast`: structure only; use for quick degraded routing when full indexing is not appropriate.
- `moderate`: structure plus semantic support; use when semantic search is needed but full indexing is not justified.
- `cross-repo-intelligence`: create cross-repo route/channel edges after target projects are already indexed.

Set `persistence=false` by default. Use `persistence=true` only when the user wants a shared `.codebase-memory/graph.db.zst` artifact.

## MCP function and parameter usage

Use the MCP tool schemas as the source of truth. If signatures are unclear, list or describe the `codebase-memory-mcp` tools before guessing.

Core tools:

- Bootstrap/status: `codebase_memory_mcp_list_projects`, `codebase_memory_mcp_index_status`, `codebase_memory_mcp_index_repository`.
- Orientation/schema: `codebase_memory_mcp_get_architecture`, `codebase_memory_mcp_get_graph_schema`.
- Discovery: `codebase_memory_mcp_search_graph`, `codebase_memory_mcp_search_code`.
- Source: `codebase_memory_mcp_get_code_snippet`.
- Relationships: `codebase_memory_mcp_trace_path`, `codebase_memory_mcp_query_graph`.
- Change impact: `codebase_memory_mcp_detect_changes`.
- Memory/traces: `codebase_memory_mcp_manage_adr`, `codebase_memory_mcp_ingest_traces`.
- Cleanup: `codebase_memory_mcp_delete_project`.

Parameter gotchas:

- Most query tools require `project`. Get it from `list_projects`; do not guess.
- `get_code_snippet` is not a search tool. Search first, then pass the exact `qualified_name`.
- `search_graph(query=...)` takes precedence over `name_pattern`; use one primary search mode at a time.
- `semantic_query` must be an array of keyword strings and returns `semantic_results` separately from `results`.
- `search_graph` supports `limit` and `offset`; use pagination when `has_more` is true.
- `query_graph` supports `max_rows`; keep rows bounded.
- `detect_changes` defaults may assume `main`; pass `base_branch` or `since` when needed.
- `search_code(mode="full")` can return a lot of source; prefer `compact` or `files` first.

## Exploration workflow

1. Verify project and index status.
2. Use `get_architecture` or `get_graph_schema` for first-pass orientation.
3. Use `search_graph(query=...)` for natural-language discovery.
4. Use `search_graph(name_pattern=...)` for known names.
5. Use `search_graph(semantic_query=[...])` only when the index supports it and vocabulary mismatch matters.
6. Use `get_code_snippet` only for focused source evidence.
7. Use native `read` only for files you intend to edit.

Example compact discovery args:

```json
{"project":"my-project","query":"update cloud client settings","limit":10}
```

Example semantic args:

```json
{"project":"my-project","semantic_query":["send","pubsub","publish"],"limit":10}
```

## Code review workflow

For review tasks:

1. Use `detect_changes(project=..., since=... or base_branch=...)` to map changed files to impacted symbols.
2. Use `trace_path` on changed or high-risk symbols with `direction="both"`, bounded `depth`, and `risk_labels=true`.
3. Use `query_graph` for fan-in/fan-out, HTTP/async edges, or custom aggregations.
4. Read only focused snippets or affected files needed for evidence.
5. Run focused tests through Context Mode/RTK.
6. Draft comments unless the user explicitly asks to post them.

## Trace and impact workflow

Use `trace_path` after discovering an exact name:

```json
{"project":"my-project","function_name":"OrderHandler","direction":"both","depth":3,"mode":"calls","risk_labels":true,"include_tests":false}
```

Use data flow when tracking parameter propagation:

```json
{"project":"my-project","function_name":"HandleOrder","mode":"data_flow","parameter_name":"orderId","direction":"outbound","depth":4}
```

Use cross-service tracing only when route/channel edges exist in the schema:

```json
{"project":"my-project","function_name":"PublishOrder","mode":"cross_service","direction":"both","depth":4}
```

## Cypher workflow

Inspect the schema first, then write Cypher against labels and edge types that exist in the project.

Common one-line query shape for MCP JSON:

```json
{"project":"my-project","query":"MATCH (f:Function)-[:CALLS]->(g) RETURN f.name AS caller, g.name AS callee LIMIT 20","max_rows":20}
```

Fan-out:

```cypher
MATCH (f:Function)-[:CALLS]->(g)
RETURN f.qualified_name AS function, count(g) AS fan_out
ORDER BY fan_out DESC
LIMIT 20
```

Fan-in:

```cypher
MATCH (caller)-[:CALLS]->(f:Function)
RETURN f.qualified_name AS function, count(caller) AS fan_in
ORDER BY fan_in DESC
LIMIT 20
```

Cross-service edges, when present:

```cypher
MATCH (a)-[r:HTTP_CALLS|ASYNC_CALLS|CROSS_HTTP_CALLS|CROSS_ASYNC_CALLS]->(b)
RETURN a.qualified_name, type(r), b.qualified_name, r.url_path, r.callee
LIMIT 20
```

## Local memory mutation rules

Treat these as deliberate local memory or artifact mutations:

- `index_repository`: writes or updates local graph memory.
- `index_repository(persistence=true)`: writes a shareable `.codebase-memory/graph.db.zst` artifact.
- `manage_adr(mode="update")`: writes persistent architecture memory.
- `ingest_traces`: writes runtime trace relationships into the graph.
- `delete_project`: deletes local graph memory.

Do not use `delete_project` unless the user explicitly asks for that local deletion. Use ADR updates only for durable architecture decisions, not temporary notes or raw investigation logs.

## Fallback conditions

Fallback to Context Mode plus RTK when:

- codebase-memory-mcp is unavailable and cannot be repaired quickly.
- The project is not indexed and indexing is not authorized or would be wasteful.
- The question is about literals, config, errors, docs, generated files, or non-code files.
- The graph schema lacks the needed labels or edge types.
- Graph results remain insufficient after appropriate indexing or query adjustment.

When falling back, state or log why graph-first could not continue.

## Worktrees

For worktree-specific graph rules, including story-grouped roots, project selection, indexing, and cleanup, see `worktree-graph-protocol.md`.
