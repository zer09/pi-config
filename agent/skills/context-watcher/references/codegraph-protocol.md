# CodeGraph protocol

This reference expands the graph-first rules in `../SKILL.md`. Load it for code review, codebase exploration, graph setup/indexing, stale graph handling, project paths, trace, impact, or graph fallback details.

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
2. If project health is unknown, call `codegraph_status` with `projectPath` or run read-only `codegraph status <repo>` through Context Mode.
3. If status says the repo is not initialized, ask before `codegraph init -i <repo>` unless the user explicitly requested setup/indexing.
4. For worktrees, multi-repo tasks, or repos outside the session root, pass `projectPath` on every CodeGraph MCP call.
5. If CodeGraph remains unavailable or uninitialized and setup is not authorized, follow the fallback protocol and state that graph results are degraded.

Read-only setup checks:

```text
codegraph --version
codegraph status <repo>
```

Local index mutations, only when authorized:

```text
codegraph init -i <repo>
codegraph index <repo>
codegraph sync <repo>
codegraph uninit <repo>
```

Keep `.codegraph/` ignored before initializing a repo. Treat `uninit` as destructive local deletion.

## MCP function and parameter usage

Use live MCP schemas as the source of truth. If signatures are unclear, list or describe the `codegraph` server tools before guessing.

Core tools:

- Bootstrap/status: `codegraph_status`.
- Orientation/task context: `codegraph_context`.
- Discovery: `codegraph_search`.
- Source: `codegraph_node`, `codegraph_explore`.
- Relationships: `codegraph_trace`, `codegraph_callers`, `codegraph_callees`.
- Change impact: `codegraph_impact`.
- File layout: `codegraph_files`.

Parameter guidance:

- Use `projectPath` for explicit repository/worktree routing.
- Use `codegraph_context` for broad architecture, onboarding, bug, and "how does this work" tasks.
- Use `codegraph_trace` first for path and flow questions.
- Use `codegraph_search` when a symbol name is known or likely.
- Use `codegraph_node` only for one exact symbol.
- Use `codegraph_explore` for related source across several symbols/files.
- Use `codegraph_impact` before refactors or edits to public/high fan-in symbols.

Example status args:

```json
{"projectPath":"<repo-absolute-path>"}
```

Example context args:

```json
{"task":"Explain how webhook retries work","projectPath":"<repo-absolute-path>"}
```

Example search args:

```json
{"query":"WebhookRetry","projectPath":"<repo-absolute-path>"}
```

## Exploration workflow

1. Check status if project health is unknown.
2. Use `codegraph_context` for first-pass orientation.
3. Use `codegraph_search` for known symbol names.
4. Use `codegraph_explore` for a source survey of related results.
5. Use native `read` only for files you intend to edit or files named in a stale banner.

Avoid repeated `codegraph_node` calls. One `codegraph_context` or `codegraph_explore` call usually returns better agent context.

## Code review workflow

For review tasks:

1. Use Context Mode/RTK to inspect diff summary, changed files, tests, lint, and build output.
2. Use `codegraph_context` for the changed feature area or bug description.
3. Use `codegraph_search` for changed public symbols when names are known.
4. Use `codegraph_impact` for changed handlers, exported APIs, public methods, shared utilities, and high fan-in symbols.
5. Use `codegraph_callers`/`codegraph_callees` for direct dependency questions.
6. Use `codegraph_trace` for request, event, async job, data, or control-flow paths.
7. Use one `codegraph_explore` for source evidence across surfaced symbols.
8. Draft comments unless the user explicitly asks to post them.

CodeGraph complements tests and lint; it does not replace validation.

## Trace and impact workflow

For flow questions:

```json
{"from":"incoming webhook route","to":"retry scheduling","projectPath":"<repo-absolute-path>"}
```

For known symbols:

```text
codegraph_search -> codegraph_callers -> codegraph_callees -> codegraph_impact -> codegraph_explore
```

Use `impact` before edits to understand callers, downstream callees, route handlers, tests, and cross-language edges when indexed.

## Staleness handling

CodeGraph MCP starts a watcher and performs catch-up sync, but results can lag recent edits.

- If a response includes a stale-file banner, read only the listed files for exact current content.
- If `codegraph_status` shows pending sync files and graph accuracy matters, wait for sync or ask before running a local sync/index command.
- Results for files not named stale should be treated as graph evidence.
- Do not run broad grep solely to verify unstale CodeGraph results.

## Fallback conditions

Fallback to Context Mode plus RTK when:

- CodeGraph MCP is unavailable and cannot be reconnected quickly.
- The project is not initialized and setup is not authorized or would be wasteful.
- The question is about literals, config, errors, docs, generated files, non-code files, logs, or data files.
- The graph lacks the needed runtime/dynamic information.
- Graph results remain insufficient after choosing the right CodeGraph tool.

When falling back, state or log why graph-first could not continue.

## Worktrees

For worktree-specific graph rules, including story-grouped roots, project paths, indexing, and cleanup, see `worktree-graph-protocol.md`.
