# Fallback and troubleshooting

This reference expands the fallback rules in `../SKILL.md`. Load it when Context Mode, RTK, or codebase-memory-mcp is unavailable, failing, stale, or producing unexpected output.

## Fallback principle

Fallbacks must be explicit. Do not silently bypass Context Mode, RTK, codebase-memory-mcp, GitHub routing, or hosted-service mutation gates.

When fallback occurs, record or summarize:

- The intended route.
- What failed.
- The fallback route used.
- Whether the result is complete or degraded.

## Context Mode fallback flow

```text
ctx_execute({ language: "shell", code: "rtk <command>" })
|
+-- SUCCESS -> use compressed result
|
+-- FAILURE
    |
    +-- Try same command inside Context Mode without RTK if RTK caused failure
    |
    +-- If Context Mode itself is unavailable and the command is safe,
        use direct execution with RTK compression when possible
    |
    +-- Log or summarize the reason and continue only if safe
```

Direct fallback must still obey:

- External hosted service mutation gate.
- Direct Bash whitelist.
- Secret protection.
- Large-output protection as much as possible.

## When fallback triggers

Common triggers:

1. Context Mode MCP server unreachable.
2. Sandbox timeout.
3. Hook misconfiguration.
4. SQLite lock.
5. RTK binary not found in sandbox PATH.
6. codebase-memory-mcp unavailable or not connected.
7. codebase-memory project missing, stale, empty, corrupt, or insufficient for the task.
8. Required graph labels or edge types absent from the schema.

## Suggested fallback log format

```text
[ISO-8601 timestamp] [FALLBACK] route="ctx_execute rtk <command>"
[ISO-8601 timestamp] [ERROR] reason="timeout / MCP connection lost / RTK not found / ..."
[ISO-8601 timestamp] [RESULT] fallback="<route>" exit_code=0 degraded=false
```

If writing a log file, use native file tools only when appropriate. Do not expose secrets in logs.

## Troubleshooting RTK commands not compressing output

1. Check whether `rtk` is installed and on PATH.
2. Run a short help/version command through Context Mode.
3. Verify shell aliases are not required for RTK to work.
4. If RTK is unavailable, keep the command in Context Mode and summarize the failure.

## Troubleshooting Context Mode tools not routing

1. Prefer the MCP Context Mode tools directly.
2. Run diagnostics with `ctx_doctor` when asked or when repeated routing failures occur.
3. If a command may produce large output, avoid direct Bash even while troubleshooting.
4. Use `ctx_search` to recover previously indexed state after compaction.

## Troubleshooting codebase-memory-mcp not connecting

1. Verify the MCP server list includes `codebase-memory-mcp`.
2. If the server metadata is stale, restart Pi or reconnect the MCP server before trusting cached tool lists.
3. Verify the installed command resolves with a short version/help check through Context Mode when shell inspection is needed.
4. List tools from the `codebase-memory-mcp` server and confirm the expected graph tools are present.
5. Retry the graph query after reconnecting.
6. Fall back to Context Mode/RTK only if graph tooling remains unavailable or the task is not structural code work.

## Troubleshooting project selection

1. Call `codebase_memory_mcp_list_projects`.
2. Match the active repository or worktree to a project by `root_path`.
3. If a project matches, call `codebase_memory_mcp_index_status(project=...)`; if none matches, skip status and treat the project as missing.
4. Rebuild with `codebase_memory_mcp_index_repository(repo_path=..., mode="full", persistence=false)` only when indexing is authorized and useful, graph accuracy matters, and the project is missing or status is empty, stale, incomplete, or failed.
5. After needed indexing, list and match projects again, then rerun `codebase_memory_mcp_index_status(project=...)`; if no project matches or status remains empty, stale, incomplete, or failed, report a degraded graph fallback.
6. Do not guess `project` from the folder name.

## Troubleshooting stale graph

- Call `codebase_memory_mcp_index_status(project=...)`.
- Re-index with `mode="full"` only when indexing is authorized and useful after file edits, branch changes, worktree creation, or empty/stale/incomplete/failed status when changed relationships matter.
- Re-run the query after indexing.
- State when graph results may be stale.

## Troubleshooting graph query misses

- Inspect schema with `codebase_memory_mcp_get_graph_schema(project=...)`.
- Use `search_graph(query=...)` for natural-language symbol discovery.
- Use `search_graph(name_pattern=...)` for known names; omit `query` because it takes precedence.
- Use `semantic_query` as an array of keywords only when the index supports semantic search.
- Use `search_code(mode="compact" or "files")` for code text patterns.
- Use Context Mode/RTK grep/search for literals, config, docs, generated files, or non-code files.

## Troubleshooting Cypher

- Inspect labels and edge types with `get_graph_schema` first.
- Keep `max_rows` bounded.
- Start with simple one-hop patterns before aggregations.
- If a property appears blank or missing, query another property or use `get_code_snippet` for focused evidence.
- Use `query_graph` for edge rows; degree filters in `search_graph` find nodes, not edge details.

## Troubleshooting RTK not found inside Context Mode

- Check PATH inside the sandbox.
- Use the same command without RTK inside Context Mode if needed.
- Do not jump directly to raw Bash for large output.

## Troubleshooting repeated fallback errors

Review local fallback logs with Context Mode, not raw `tail`, when output may be long. Common repairs include:

- Restarting or upgrading Context Mode.
- Reinstalling RTK hooks.
- Restarting Pi to refresh MCP server metadata.
- Re-indexing the codebase-memory project when indexing is authorized and useful.
- Checking for SQLite locks.

## Troubleshooting uv not found for local tooling

This project prefers `uv` for Python. If `uv` is missing:

1. Verify whether the command actually requires project Python tooling.
2. Use the `uv` skill instructions for installation or alternatives.
3. Do not substitute direct Python execution in docs or scripts unless the project explicitly permits it.
