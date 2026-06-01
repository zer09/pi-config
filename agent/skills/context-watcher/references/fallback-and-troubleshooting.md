# Fallback and troubleshooting

This reference expands the fallback rules in `../SKILL.md`. Load it when Context Mode, RTK, or CodeGraph is unavailable, failing, stale, or producing unexpected output.

## Fallback principle

Fallbacks must be explicit. Do not silently bypass Context Mode, RTK, CodeGraph, GitHub routing, or hosted-service mutation gates.

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
6. CodeGraph MCP unavailable or not connected.
7. CodeGraph project uninitialized, stale, missing, or insufficient for the task.
8. Required CodeGraph relationships are absent or dynamic behavior is not statically visible.

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
3. Use `ctx_stats` for runtime/session evidence and `ctx_insight` only when the user wants the local analytics dashboard.
4. If a command may produce large output, avoid direct Bash even while troubleshooting.
5. Use `ctx_search` to recover previously indexed state after compaction.

## Troubleshooting CodeGraph not connecting

1. Verify the MCP server list includes `codegraph`.
2. If server metadata is stale, restart Pi or reconnect the MCP server before trusting cached tool lists.
3. Verify the installed command resolves with `codegraph --version` through Context Mode when shell inspection is needed.
4. List tools from the `codegraph` server and confirm the expected core tools are present. If optional tools are absent, do not assume a broken Pi configuration: CodeGraph intentionally gates `tools/list` by the server's active/default project size. Fewer than 500 indexed files exposes only the 5 core tools, and a later per-call `projectPath` does not change that list. Also check whether `CODEGRAPH_MCP_TOOLS` is set, because it can allowlist fewer visible tools.
5. Retry the graph query after reconnecting.
6. Fall back to Context Mode/RTK only if graph tooling remains unavailable or the task is not structural code work.

## Troubleshooting project path selection

1. Identify the active repository or worktree path.
2. Run read-only `codegraph status <repo>` or call `codegraph_status` with `projectPath` when that MCP tool is exposed.
3. If status says the project is not initialized, ask before `codegraph init <repo> --index` unless setup/indexing was explicitly requested.
4. Pass `projectPath` for worktrees, multi-repo tasks, and repos outside the session root.
5. If CodeGraph still cannot find the right project, report a degraded graph fallback. Do not guess based on folder names alone.

## Troubleshooting stale graph

- Run read-only `codegraph status <repo>` or call `codegraph_status` when that MCP tool is exposed.
- If a stale banner names files, read only those files for exact current content.
- If pending sync matters for graph accuracy, wait for sync or ask before running `codegraph sync` or `codegraph index`.
- State when graph results may be stale.

## Troubleshooting graph query misses

- Use `codegraph_context` for architecture, feature-area, or bug questions.
- Use `codegraph_trace` for flow/path questions.
- Use `codegraph_search` only when a symbol name or likely name is known.
- Use `codegraph_explore` for source across several related symbols.
- Use Context Mode/RTK grep/search for literals, config, docs, generated files, or non-code files.

## Troubleshooting RTK not found inside Context Mode

- Check PATH inside the sandbox.
- Use the same command without RTK inside Context Mode if needed.
- Do not jump directly to raw Bash for large output.

## Troubleshooting repeated fallback errors

Review local fallback logs with Context Mode, not raw `tail`, when output may be long. Common repairs include:

- Restarting or upgrading Context Mode.
- Reinstalling RTK hooks.
- Restarting Pi to refresh MCP server metadata.
- Initializing or syncing CodeGraph only when setup/indexing is authorized.
- Checking for SQLite locks.

## Troubleshooting uv not found for local tooling

This project prefers `uv` for Python. If `uv` is missing:

1. Verify whether the command actually requires project Python tooling.
2. Use the `uv` skill instructions for installation or alternatives.
3. Do not substitute direct Python execution in docs or scripts unless the project explicitly permits it.
