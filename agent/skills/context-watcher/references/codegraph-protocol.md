# CodeGraph Runtime Reference

This reference expands the graph-first rules in `../SKILL.md`. Load it for code review, codebase exploration, graph setup/indexing, stale graph handling, project paths, trace, impact, or graph fallback details.

CodeGraph is a Context Watcher capability.

## Mandatory graph-first scope

Use CodeGraph before grep/find/manual file reading for structural code questions:

- Codebase exploration.
- Code review.
- Blast-radius analysis.
- Caller/callee lookup.
- Test discovery and coverage-oriented investigation.
- Architecture review.
- Refactor analysis.
- Impact of changed files or symbols.
- Cross-language and framework route tracing when indexed edges exist.

Use Context Mode/RTK instead for string literals, error messages, config values, non-code files, generated or unindexed files, logs, test output, and raw data processing.

## Project path and index health

CodeGraph stores a local SQLite graph under each repository's `.codegraph/` directory. MCP tools discover the nearest initialized project from the session root, workspace roots, or the optional `projectPath` parameter.

Start graph work with:

1. Identify the active repo/worktree path.
2. If project health is unknown, run read-only `codegraph status <repo>` through Context Mode, or use `codegraph_status` with `projectPath` when the live MCP server exposes it.
3. If status says the repo is not initialized, ask before `codegraph init <repo> --index` unless the user explicitly requested setup/indexing.
4. List the live `codegraph` MCP tools before relying on optional relationship/status tools. CodeGraph defines 10 MCP tool capabilities, but the visible tool list is intentionally gated by the server's active/default project: fewer than 500 indexed files exposes only the 5 core tools. Later per-call `projectPath` values do not change `tools/list`.
5. For worktrees, multi-repo tasks, or repos outside the session root, pass `projectPath` on every CodeGraph MCP call.
6. If CodeGraph remains unavailable or uninitialized and setup is not authorized, follow the fallback protocol and state that graph results are degraded.

Read-only setup checks:

```text
codegraph --version
codegraph status <repo>
codegraph files -p <repo> --format flat
codegraph query -p <repo> <symbol-or-term>
codegraph context -p <repo> "<task>" --no-code
codegraph callers -p <repo> <symbol>
codegraph callees -p <repo> <symbol>
codegraph impact -p <repo> <symbol>
codegraph affected -p <repo> [files...] --quiet
```

Local index mutations, only when authorized:

```text
codegraph init <repo> --index
codegraph index <repo>
codegraph sync <repo>
codegraph uninit <repo>
```

Keep `.codegraph/` ignored before or immediately after initializing a repo. Prefer `.git/info/exclude` for local-only practice indexes. Treat `uninit` as destructive local deletion.

CLI path rule: `status`, `init`, `index`, `sync`, `uninit`, and `unlock` accept a positional repo path. `files`, `query`, `context`, `callers`, `callees`, `impact`, and `affected` use `-p/--path`. The CLI symbol search command is `query`; the MCP symbol search tool is `codegraph_search`.

Practical CLI notes: `codegraph files` has no positional repo argument; use `-p <repo>`. `codegraph query --json` returns `{ node, score }` entries; useful node fields include `name`, `kind`, `filePath`, `startLine`, and `signature`. CLI `callers`, `callees`, and `impact` remain available even when MCP optional tools are hidden. After authorized `index` or `sync`, `codegraph status <repo>` is the authoritative health/count check. `codegraph serve --no-watch` disables auto-sync and should be reserved for slow or problematic filesystems.

`codegraph install`, `codegraph uninstall`, `codegraph uninit`, and `codegraph unlock` mutate local configuration or graph state. Do not run them without exact authorization, except `install --print-config <agent>` is read-only. Use `unlock` only when status, index, or sync reports a stale lock.

## MCP function and parameter usage

Use live MCP schemas as the source of truth. If signatures are unclear, list or describe the `codegraph` server tools before guessing. In Pi's MCP gateway, live names may be prefixed as `codegraph_codegraph_context`; use the exact listed tool name.

MCP tool gating is expected behavior, not automatically a Pi configuration error. CodeGraph's `tools/list` is based on the active/default project supplied to `codegraph serve --mcp` or `--path`, not on a later tool-call `projectPath`. With fewer than 500 indexed files, the server lists only the 5 core tools. With 500 or more indexed files, it can list all 10 unless `CODEGRAPH_MCP_TOOLS` allowlists fewer tools. Use CLI fallback for optional tools that are hidden by gating.

Core tools that may be the only exposed MCP set in Pi:

- Orientation/task context: `codegraph_context`.
- Discovery: `codegraph_search`.
- Source: `codegraph_node`, `codegraph_explore`.
- Flow/path tracing: `codegraph_trace`.

Optional tools when exposed:

- Bootstrap/status: `codegraph_status`.
- Direct relationships: `codegraph_callers`, `codegraph_callees`.
- Change impact: `codegraph_impact`.
- File layout: `codegraph_files`.

Parameter guidance:

- Use `projectPath` for explicit repository/worktree routing.
- Use `codegraph_context` for broad architecture, onboarding, bug, and "how does this work" code tasks. Do not use it as a markdown/docs search tool.
- Use `codegraph_trace` first for path and flow questions. A no-path result can still be useful because it inlines endpoint bodies and nearby symbols.
- Use `codegraph_search` when a symbol name is known or likely.
- Use `codegraph_node` only for one exact symbol.
- Use `codegraph_explore` for related source across several symbols/files; pass a bag of symbol/file names, not a natural-language question.
- Use `codegraph_impact` before refactors or edits to public/high fan-in symbols when exposed; otherwise use CLI `codegraph impact -p <repo> <symbol>`.

Example context args:

```json
{"task":"Explain how webhook retries work","projectPath":"<repo-absolute-path>"}
```

Example search args:

```json
{"query":"WebhookRetry","projectPath":"<repo-absolute-path>"}
```

## Exploration workflow

1. Check status if project health is unknown with CLI `codegraph status <repo>` or exposed `codegraph_status`.
2. Use `codegraph_context` for first-pass code orientation.
3. Use `codegraph_search` for known symbol names.
4. Use `codegraph_explore` for a source survey of related results.
5. Use CLI `codegraph affected -p <repo> --stdin --quiet` to map changed files to tests when planning validation; empty output means no tests were found by the graph, not that validation is unnecessary.
6. Use native `read` only for files you intend to edit or files named in a stale banner.

Avoid repeated `codegraph_node` calls. One `codegraph_context` or `codegraph_explore` call usually returns better agent context.

## Code review workflow

For review tasks:

1. Use Context Mode/RTK to inspect diff summary, changed files, tests, lint, and build output.
2. Use `codegraph_context` for the changed feature area or bug description.
3. Use `codegraph_search` for changed public symbols when names are known.
4. Use `codegraph_trace` for request, event, async job, data, or control-flow paths.
5. Use one `codegraph_explore` for source evidence across surfaced symbols.
6. Use `codegraph_impact`, `codegraph_callers`, or `codegraph_callees` when the live server exposes them.
7. Draft comments unless the user explicitly asks to post them.

CodeGraph complements tests and lint; it does not replace validation.

## Trace and impact workflow

For flow questions:

```json
{"from":"incoming webhook route","to":"retry scheduling","projectPath":"<repo-absolute-path>"}
```

For known symbols:

```text
codegraph_search -> codegraph_trace -> codegraph_explore -> optional codegraph_callers/codegraph_callees/codegraph_impact
```

Use `impact` before edits when exposed to understand callers, downstream callees, route handlers, tests, and cross-language edges when indexed. If optional tools are not exposed, use core context, trace, and explore results plus targeted reads.

## Staleness handling

CodeGraph MCP starts a watcher and performs catch-up sync, but results can lag recent edits.

- If a response includes a stale-file banner, read only the listed files for exact current content.
- If `codegraph status <repo>` or exposed `codegraph_status` shows pending sync files and graph accuracy matters, wait for sync or ask before running a local sync/index command.
- Results for files not named stale should be treated as graph evidence.
- Do not run broad grep solely to verify unstale CodeGraph results.

## Fallback conditions

Fallback to Context Mode plus RTK when:

- CodeGraph MCP is unavailable and cannot be reconnected quickly.
- The project is not initialized and setup is not authorized or would be wasteful.
- An optional relationship/status tool is not exposed and the core tools are insufficient.
- The question is about literals, config, errors, docs, generated files, non-code files, logs, or data files.
- The graph lacks the needed runtime/dynamic information.
- Graph results remain insufficient after choosing the right CodeGraph tool.

When falling back, state or log why graph-first could not continue.

## Worktrees

For worktree-specific graph rules, including story-grouped roots, project paths, indexing, and cleanup, see `worktree-graph-protocol.md`.
