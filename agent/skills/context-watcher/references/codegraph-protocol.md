# CodeGraph Runtime Reference

This reference expands the graph-first rules in `../SKILL.md`. Load it for code review, codebase exploration, graph setup/indexing, stale graph handling, project paths, flow/path questions, impact, or graph fallback details.

CodeGraph is a Context Watcher capability. Its MCP server belongs to the same runtime posture as Context Mode for code work: when Context Watcher starts or uses Context Mode for structural code tasks, also verify that CodeGraph MCP is connected or reconnectable before treating graph-first as unavailable.

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
- Cross-language and framework flow/path exploration when indexed edges exist.

Use Context Mode/RTK instead for string literals, error messages, config values, non-code files, generated or unindexed files, logs, test output, and raw data processing.

## Project path and index health

CodeGraph stores a local SQLite graph under each repository's `.codegraph/` directory. MCP tools discover the nearest initialized project from the session root, workspace roots, or the optional `projectPath` parameter.

Start graph work with:

1. Identify the active repo/worktree path.
2. When Context Mode is started or used for code work, also list or reconnect the `codegraph` MCP server; CodeGraph MCP is part of Context Watcher's runtime, not a separate Local Skill.
3. If project health is unknown, run read-only `codegraph status <repo>` through Context Mode, or use `codegraph_status` with `projectPath` when the live MCP server exposes it.
4. If status says the repo is not initialized and graph accuracy matters, run `codegraph init <repo>` when setup/indexing/freshness is explicitly authorized; otherwise ask before initializing.
5. If status or an MCP banner says the graph is stale and graph accuracy matters, run `codegraph sync <repo>` or `codegraph index <repo>` when sync/index/freshness is explicitly authorized; otherwise read only stale-banner files for exact current content or ask before mutating the local index.
6. List the live `codegraph` MCP tools before relying on relationship/status tools. CodeGraph v0.9.9 normally exposes 8 MCP tools: `codegraph_explore`, `codegraph_search`, `codegraph_node`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, and `codegraph_status`. If fewer tools are visible, check server metadata freshness and `CODEGRAPH_MCP_TOOLS`.
7. For worktrees, multi-repo tasks, or repos outside the session root, pass `projectPath` on every CodeGraph MCP call.
8. If CodeGraph remains unavailable or uninitialized and setup is not authorized or fails, follow the fallback protocol and state that graph results are degraded.

Read-only setup checks:

```text
codegraph --version
codegraph status <repo>
codegraph files -p <repo> --format flat
codegraph query -p <repo> <symbol-or-term>
codegraph callers -p <repo> <symbol>
codegraph callees -p <repo> <symbol>
codegraph impact -p <repo> <symbol>
codegraph affected -p <repo> [files...] --quiet
```

Local index mutations, only when authorized:

```text
codegraph init <repo>
codegraph index <repo>
codegraph sync <repo>
codegraph uninit <repo>
```

In CodeGraph v0.9.9, `codegraph init` builds the initial index by default; the old `--index` flag is deprecated and should not appear in new guidance.

Keep `.codegraph/` ignored before or immediately after initializing a repo. Prefer `.git/info/exclude` for local-only practice indexes. Treat `uninit` as destructive local deletion.

CLI path rule: `status`, `init`, `index`, `sync`, `uninit`, and `unlock` accept a positional repo path. `files`, `query`, `callers`, `callees`, `impact`, and `affected` use `-p/--path`. The CLI symbol search command is `query`; the MCP symbol search tool is `codegraph_search`.

Practical CLI notes: `codegraph files` has no positional repo argument; use `-p <repo>`. `codegraph query --json` returns `{ node, score }` entries; useful node fields include `name`, `kind`, `filePath`, `startLine`, and `signature`. CLI `query`, `callers`, `callees`, `impact`, `files`, and `affected` remain useful when durable indexed output is preferable or when an MCP tool is hidden. After authorized `init`, `index`, or `sync`, `codegraph status <repo>` is the authoritative health/count check. `codegraph serve --no-watch` disables auto-sync and should be reserved for slow or problematic filesystems.

## MCP vs CLI routing

For overlapping read-only CodeGraph features, MCP and CLI use the same graph data. Use this shortcut:

```text
MCP for thinking: first-pass reasoning, ambiguity detection, immediate lookup, source, and flow.
CLI inside Context Mode for capturing: durable indexed output, batches, comparisons, and programmed analysis.
```

Prefer MCP when a symbol name may be ambiguous. MCP can surface aggregation notes, relationship maps, and source grouped by file that plain CLI output does not provide. After narrowing the exact symbol/file, CLI is safe for batching and indexing.

Use MCP-first tools for source and flows: `codegraph_explore` for most structural questions and `codegraph_node` for one exact symbol.

For CLI capture, default to plain output with ANSI stripped:

```text
| perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g'
```

Use `--json` only when code in `ctx_execute`/`ctx_batch_execute` will parse it and print a compact summary. Do not surface large raw JSON unless the user needs machine-readable output.

| Intent | MCP for thinking | CLI inside Context Mode for capture |
|---|---|---|
| Source, architecture, bug area, or flow survey | `codegraph_explore` | No exact CLI equivalent; combine `query`, `callers`, `callees`, and `impact` when capture is needed |
| Symbol search | `codegraph_search` | `codegraph query -p <repo> <term>` |
| One exact symbol body | `codegraph_node` | No exact CLI equivalent |
| Callers | `codegraph_callers` | `codegraph callers -p <repo> <symbol>` |
| Callees | `codegraph_callees` | `codegraph callees -p <repo> <symbol>` |
| Impact | `codegraph_impact` | `codegraph impact -p <repo> <symbol>` |
| File layout | `codegraph_files` | `codegraph files -p <repo> --format flat` |
| Index health | `codegraph_status` | `codegraph status <repo>` |

Use `ctx_batch_execute` for multiple CLI graph checks so each command output is indexed and searchable by `ctx_search`. Use `ctx_execute` for one focused CLI graph command when batching is unnecessary.

If a broad `codegraph_explore` query misses the intended area, narrow with `codegraph_search` or CLI `codegraph query`, then use `codegraph_explore`, `codegraph_node`, callers/callees, or impact for exact evidence.

Lifecycle/admin commands are outside this read-only routing rule: `init`, `index`, `sync`, `uninit`, `unlock`, `serve`, `install`, and `uninstall` remain explicit local configuration or graph-state operations.

`codegraph install`, `codegraph uninstall`, `codegraph uninit`, and `codegraph unlock` mutate local configuration or graph state. Do not run them without exact authorization, except `install --print-config <agent>` is read-only. Use `unlock` only when status, index, or sync reports a stale lock.

Current installer targets for `codegraph install --target <id>` and read-only `codegraph install --print-config <id>` are: `claude`, `cursor`, `codex`, `opencode`, `hermes`, `gemini`, `antigravity`, and `kiro`.

## Runtime configuration and troubleshooting knobs

Do not set environment overrides by default. Use them only for explicit troubleshooting or target-specific configuration.

| Variable | Use |
|---|---|
| `CODEGRAPH_MCP_TOOLS` | Comma-separated MCP tool allowlist; explains missing visible tools when set. |
| `CODEGRAPH_NO_DAEMON` | Disable shared daemon mode and run direct MCP mode. |
| `CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS` | Override daemon idle shutdown timeout. |
| `CODEGRAPH_MCP_DEBUG` | Emit extra MCP startup/debug details. |
| `CODEGRAPH_WATCH_DEBOUNCE_MS` | Tune file watcher debounce, default around 2000 ms. |
| `CODEGRAPH_NO_WATCH` | Disable file watching/auto-sync. |
| `CODEGRAPH_FORCE_WATCH` | Force watching when auto-detection would disable it. |
| `CODEGRAPH_ADAPTIVE_EXPLORE` | Disable adaptive explore sizing only for troubleshooting when set to `0` or `false`. |
| `CODEGRAPH_EXPLORE_LINENUMS` | Disable line numbers in explore output when set to `0`. |
| `CODEGRAPH_DEBUG` | Emit additional diagnostic logs for CodeGraph errors. |

## MCP function and parameter usage

Use live MCP schemas as the source of truth. If signatures are unclear, list or describe the `codegraph` server tools before guessing. In Pi's MCP gateway, live names may be prefixed as `codegraph_codegraph_explore`; use the exact listed tool name.

Current CodeGraph v0.9.9 MCP shapes, in columnar JSON. `tool` values are Pi MCP gateway names; prose may use shorthand names.

```json
{
  "v": 2,
  "kind": "codegraph_mcp_tools",
  "status": "current_when_verified_v0.9.9",
  "cols": ["tool", "required", "optional"],
  "rows": [
    ["codegraph_codegraph_explore", ["query"], ["maxFiles", "projectPath"]],
    ["codegraph_codegraph_search", ["query"], ["kind", "limit", "projectPath"]],
    ["codegraph_codegraph_node", ["symbol"], ["includeCode", "file", "line", "projectPath"]],
    ["codegraph_codegraph_callers", ["symbol"], ["limit", "projectPath"]],
    ["codegraph_codegraph_callees", ["symbol"], ["limit", "projectPath"]],
    ["codegraph_codegraph_impact", ["symbol"], ["depth", "projectPath"]],
    ["codegraph_codegraph_files", [], ["path", "pattern", "format", "includeMetadata", "maxDepth", "projectPath"]],
    ["codegraph_codegraph_status", [], ["projectPath"]]
  ]
}
```

Parameter guidance:

- Use `projectPath` for explicit repository/worktree routing.
- Use `codegraph_explore` first for architecture, onboarding, bug, "how does this work", "where is X", flow/path, and source survey questions. Its `query` can be a natural-language question or a bag of symbol/file names, and returned source is Read-equivalent.
- For flow/path questions, include the symbol names or code terms that span the flow in `codegraph_explore`; it can surface relationship paths and dynamic-dispatch hops when indexed.
- Use `codegraph_search` when a symbol name is known or likely.
- Use `codegraph_node` only for one exact symbol; pass `file` and/or `line` to disambiguate duplicate or overloaded symbols.
- Use `codegraph_callers`, `codegraph_callees`, and `codegraph_impact` for direct relationship and refactor planning evidence.
- Use `codegraph_files` for indexed file layout instead of filesystem scans.
- Use `codegraph_status` for index health, pending sync, backend, and counts.

Example explore args:

```json
{"query":"How do webhook retries get scheduled? WebhookRetry retry scheduling","projectPath":"<repo-absolute-path>"}
```

Example search args:

```json
{"query":"WebhookRetry","projectPath":"<repo-absolute-path>"}
```

## Exploration workflow

1. Check status if project health is unknown with CLI `codegraph status <repo>` or exposed `codegraph_status`.
2. If the repo is uninitialized or stale and graph accuracy matters, initialize, sync, or index when setup/indexing/freshness is explicitly authorized; otherwise ask before local index mutation.
3. Ensure the `codegraph` MCP server is listed or reconnectable when Context Mode is already being started for code work.
4. Use `codegraph_explore` first for first-pass code orientation, architecture, bug areas, source surveys, and flow/path questions.
5. Use `codegraph_search` for known symbol names and `codegraph_node` for one exact symbol only.
6. Use callers/callees/impact/files/status for focused relationship, file-layout, and health evidence.
7. Use CLI `codegraph affected -p <repo> --stdin --quiet` to map changed files to tests when planning validation; empty output means no tests were found by the graph, not that validation is unnecessary.
8. Use native `read` only for files you intend to edit or files named in a stale banner.

Avoid repeated `codegraph_node` calls. One `codegraph_explore` call usually returns better agent context.

## Code review workflow

For review tasks:

1. Use Context Mode/RTK to inspect diff summary, changed files, tests, lint, and build output.
2. Use `codegraph_explore` for the changed feature area, bug description, or flow/path question.
3. Use `codegraph_search` for changed public symbols when names are known.
4. Use `codegraph_impact`, `codegraph_callers`, or `codegraph_callees` for public/high fan-in symbols and unexpected relationship paths.
5. Use CLI equivalents through `ctx_batch_execute` when relationship output should be indexed or compared. Strip ANSI from plain CLI output.
6. Draft comments unless the user explicitly asks to post them.

CodeGraph complements tests and lint; it does not replace validation.

## Flow and impact workflow

For flow questions, use `codegraph_explore` and name the endpoints or important intermediate symbols:

```json
{"query":"incoming webhook route retry scheduling","projectPath":"<repo-absolute-path>"}
```

For known symbols:

```text
codegraph_search -> codegraph_explore -> optional codegraph_callers/codegraph_callees/codegraph_impact
```

Use `impact` before edits when exposed to understand callers, downstream callees, route handlers, tests, and cross-language edges when indexed. For refactor planning or review evidence, prefer CLI `codegraph impact -p <repo> <symbol>` through Context Mode so the result is indexed; use JSON only for programmed summaries. If relationship tools are unavailable, use CLI equivalents through Context Mode plus `codegraph_explore` results.

## Staleness handling

CodeGraph MCP starts a watcher and performs catch-up sync, but results can lag recent edits.

- If a response includes a stale-file banner, read only the listed files for exact current content.
- If `codegraph status <repo>` or exposed `codegraph_status` shows pending sync files and graph accuracy matters, run `codegraph sync <repo>` or `codegraph index <repo>` when sync/index/freshness is explicitly authorized; otherwise wait for sync or ask before mutating the local index.
- Results for files not named stale should be treated as graph evidence.
- Do not run broad grep solely to verify unstale CodeGraph results.

## Fallback conditions

Fallback to Context Mode plus RTK when:

- CodeGraph MCP is unavailable and cannot be reconnected quickly.
- The project is not initialized and setup is not authorized, or authorized setup fails.
- The graph is stale and sync/index/freshness is not authorized, or authorized refresh fails.
- A relationship/status tool is unavailable and the CLI equivalent through Context Mode plus `codegraph_explore` is insufficient.
- The question is about literals, config, errors, docs, generated files, non-code files, logs, or data files.
- The graph lacks the needed runtime/dynamic information.
- Graph results remain insufficient after choosing the right CodeGraph tool.

When falling back, state or log why graph-first could not continue.

## Worktrees

For worktree-specific graph rules, including story-grouped roots, project paths, indexing, and cleanup, see `worktree-graph-protocol.md`.
