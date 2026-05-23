---
name: codebase-memory-mcp
description: Pi-safe guide for using the codebase-memory-mcp knowledge graph MCP. Use when exploring a codebase, understanding architecture, finding functions/classes/routes/variables, locating implementations, tracing callers/callees/data flow/cross-service edges, running Cypher graph queries, detecting impact of changes, finding dead code or high fan-in/fan-out symbols, managing code architecture ADRs, indexing repositories, or deciding when graph search should replace or fall back to grep/glob/file search.
---

# Codebase Memory MCP

Use `codebase-memory-mcp` as the local code knowledge graph for structural code discovery. It is best for symbols, relationships, architecture, call paths, data flow, cross-service links, and impact analysis.

## Core routing rules

- Obey Context Watcher first. Use Context Mode for shell, tests, logs, builds, git reads, and large output.
- Use codebase-memory graph tools before grep/glob for structural code questions.
- Use native `read` before editing source files, then native `edit` or `write`. Do not edit through the graph tools.
- Use grep/search fallbacks for string literals, error messages, config values, generated or unindexed files, non-code files, or insufficient graph results.
- Keep hosted-service mutation gates from Context Watcher. Codebase-memory is local, but its write-like tools still need deliberate use.

In Pi, call the MCP server named `codebase-memory-mcp`. Tool names are exposed with the `codebase_memory_mcp_` prefix, for example `codebase_memory_mcp_search_graph`. In clients exposing shorter names, map them to `search_graph`, `trace_path`, and so on.

## Start every graph session

1. Call `codebase_memory_mcp_list_projects`.
2. Pick the project whose `root_path` matches the active repository. Use that exact `name` as `project`.
3. Call `codebase_memory_mcp_index_status` for the selected project.
4. If the project is missing or stale enough to affect the task, call `codebase_memory_mcp_index_repository` on the repo path.
   - Use `mode="fast"` for quick structure-only indexing.
   - Use `mode="moderate"` or `mode="full"` when semantic search is needed.
   - Use `persistence=false` by default. Set `persistence=true` only when the user wants a shared `.codebase-memory/graph.db.zst` artifact.
5. Call `get_architecture` or `get_graph_schema` before broad exploration.

Most query tools require `project`. Do not omit it.

## Tool selection

| Need | Tool | Notes |
|---|---|---|
| List indexed repos | `list_projects` | Start here to discover project names. |
| Check index state | `index_status` | Use before relying on graph data. |
| Index repo | `index_repository` | Local graph write. Re-index after meaningful code changes. |
| Architecture overview | `get_architecture` | Use for orientation before file-by-file reading. |
| Node and edge schema | `get_graph_schema` | Use before Cypher or unfamiliar repositories. |
| Natural-language symbol discovery | `search_graph(query=...)` | BM25, camelCase-aware, structurally boosted. |
| Regex symbol discovery | `search_graph(name_pattern=...)` | Leave `query` unset; `query` takes precedence over `name_pattern`. |
| Vocabulary-bridging search | `search_graph(semantic_query=[...])` | Requires moderate/full index; read `semantic_results`. |
| Read one symbol source | `get_code_snippet` | Search first, then pass the exact `qualified_name`. |
| Text pattern in code | `search_code` | Prefer `mode="compact"` or `mode="files"`; `mode="full"` can be verbose. |
| Callers, callees, data flow | `trace_path` | Use after discovering an exact symbol name. |
| Custom multi-hop analysis | `query_graph` | Use Cypher for aggregations and edge inspection. |
| Git diff impact | `detect_changes` | Set `base_branch` or `since` explicitly when `main` is not the base. |
| ADR read/update | `manage_adr` | `get` and `sections` are read-like; `update` writes architectural memory. |
| Runtime trace enrichment | `ingest_traces` | Use only with provided/safe trace data. |
| Delete an index | `delete_project` | Destructive local operation; require exact user request. |

## Common workflows

### Orient in a repository

1. `list_projects`
2. `index_status(project=...)`
3. `get_architecture(project=...)`
4. `get_graph_schema(project=...)`
5. Use `search_graph` for target symbols, then `get_code_snippet` for exact source.

### Find an implementation

1. Try natural-language search:

```json
{"project":"my-project","query":"update cloud client settings","limit":10}
```

2. If names are known, use regex search without `query`:

```json
{"project":"my-project","label":"Function","name_pattern":".*Update.*Settings.*","limit":10}
```

3. For vocabulary mismatch, use semantic search as an array:

```json
{"project":"my-project","semantic_query":["send","pubsub","publish"],"limit":10}
```

4. Read source only after a precise hit:

```json
{"project":"my-project","qualified_name":"my-project.pkg.orders.OrderHandler","include_neighbors":true}
```

### Trace impact and dependencies

1. Search first to identify the exact function or method.
2. Use `trace_path`:

```json
{"project":"my-project","function_name":"OrderHandler","direction":"both","depth":3,"mode":"calls","risk_labels":true,"include_tests":false}
```

3. For data propagation, switch mode and optionally scope a parameter:

```json
{"project":"my-project","function_name":"HandleOrder","mode":"data_flow","parameter_name":"orderId","direction":"outbound","depth":4}
```

4. For local git changes, use:

```json
{"project":"my-project","since":"HEAD~1","depth":2}
```

### Search literals or files

Use `search_code` before shell grep when the target is code text:

```json
{"project":"my-project","pattern":"FEATURE_FLAG","mode":"compact","path_filter":"^src/","limit":20}
```

Use Context Mode plus grep/rg instead when searching config files, shell scripts, markdown, lockfiles, binary assets, or when graph results are incomplete.

### Analyze cross-service behavior

1. Ensure each target project has a fresh index.
2. Run `index_repository` with `mode="cross-repo-intelligence"` and `target_projects` when cross-repo links are needed.
3. Use `trace_path(mode="cross_service")` or `query_graph` over `HTTP_CALLS`, `ASYNC_CALLS`, `CROSS_HTTP_CALLS`, or `CROSS_ASYNC_CALLS` if those edges exist in the schema.

## Cypher patterns

Inspect the schema first, then use labels and edge types that exist in the current project.

```cypher
MATCH (f:Function)-[:CALLS]->(g)
RETURN f.name AS caller, g.name AS callee
LIMIT 20
```

```cypher
MATCH (f:Function)-[:CALLS]->(g)
RETURN f.qualified_name AS function, count(g) AS fan_out
ORDER BY fan_out DESC
LIMIT 20
```

```cypher
MATCH (caller)-[:CALLS]->(f:Function)
RETURN f.qualified_name AS function, count(caller) AS fan_in
ORDER BY fan_in DESC
LIMIT 20
```

```cypher
MATCH (a)-[r:HTTP_CALLS|ASYNC_CALLS|CROSS_HTTP_CALLS|CROSS_ASYNC_CALLS]->(b)
RETURN a.qualified_name, type(r), b.qualified_name, r.url_path, r.callee
LIMIT 20
```

## Gotchas

- `project` is required by most tools. Get it from `list_projects`; do not guess from the folder name.
- `get_code_snippet` is not a search tool. Call `search_graph` first and pass the exact `qualified_name`.
- `search_graph(query=...)` ignores `name_pattern`. Use one search mode at a time unless intentionally combining semantic results.
- `semantic_query` must be an array of keyword strings. Read the `semantic_results` field, not only `results`.
- `trace_path` works best with exact names. If a short name is ambiguous, use a qualified name from `search_graph`.
- `detect_changes` defaults may assume `main`. Pass `base_branch` or `since` when the repository uses another base branch.
- `search_code(mode="full")` can return a lot of source. Prefer `compact` or `files` unless source context is needed.
- Degree filters in `search_graph` find nodes, not edge rows. Use `query_graph` to inspect actual relationships.
- Re-index after edits before relying on the graph for changed code.
- Do not use `delete_project`, `manage_adr(mode="update")`, `ingest_traces`, or persistent indexing casually. They mutate local memory or local artifacts.

## Validation checklist

Before relying on results, verify:

- The MCP server is connected and `list_projects` returns the target repo.
- `index_status` is ready for the selected project.
- The graph schema contains the labels and edge types used by queries.
- Exact source reads came from `get_code_snippet` after `search_graph`.
- Any grep/glob fallback is explicit and justified.

## Maintenance

`codebase-memory-mcp` is a Custom Local Skill. Update it through [`../../../docs/skills/custom-local-skills-update-process.md`](../../../docs/skills/custom-local-skills-update-process.md) and preserve [`../../../docs/skills/local-skill-update-invariants.md`](../../../docs/skills/local-skill-update-invariants.md).
