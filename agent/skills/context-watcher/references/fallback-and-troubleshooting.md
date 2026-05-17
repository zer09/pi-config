# Fallback and troubleshooting

This reference expands the fallback rules in `../SKILL.md`. Load it when Context Mode, RTK, or Code Review Graph is unavailable, failing, stale, or producing unexpected output.

## Fallback principle

Fallbacks must be explicit. Do not silently bypass Context Mode, RTK, Graph, GitHub routing, or hosted-service mutation gates.

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
6. Graph database missing, stale, empty, or corrupt.
7. Code Review Graph daemon unavailable.

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

## Troubleshooting Code Review Graph not connecting

1. Check graph stats for the repo root.
2. If missing/empty and authorized, build or update the graph.
3. If daemon-backed work is useful, start the daemon and add the containing root.
4. Retry the graph query.
5. Fall back to Context Mode/RTK only if graph remains insufficient.

## Troubleshooting stale graph

- Update the graph after file edits or branch changes.
- Re-run the query after update.
- State when graph results may be stale.

## Troubleshooting semantic search

- Use exact symbol names or domain terms.
- Try structural queries such as callers, callees, impact radius, or review context.
- Build embeddings only when semantic search is required and authorized.

## Troubleshooting RTK not found inside Context Mode

- Check PATH inside the sandbox.
- Use the same command without RTK inside Context Mode if needed.
- Do not jump directly to raw Bash for large output.

## Troubleshooting repeated fallback errors

Review local fallback logs with Context Mode, not raw `tail`, when output may be long. Common repairs include:

- Restarting or upgrading Context Mode.
- Reinstalling RTK hooks.
- Rebuilding the graph.
- Checking for SQLite locks.

## Troubleshooting uv not found for graph tooling

This project prefers `uv` for Python. If `uv` is missing:

1. Verify whether the command actually requires project Python tooling.
2. Use the `uv` skill instructions for installation or alternatives.
3. Do not substitute direct Python execution in docs or scripts unless the project explicitly permits it.
