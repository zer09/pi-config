# Pi CodeGraph Extension

Native Pi tools for CodeGraph. The extension opens and synchronizes projects through the public `@colbymchenry/codegraph` SDK, then runs the package's full upstream Explore handler in-process. It does not start an MCP server or spawn the CodeGraph CLI.

## Tools

- `codegraph_explore` — primary source-code understanding tool for indexed projects.
- `codegraph_node` — read one indexed symbol or one indexed source file with line numbers and graph context.
- `codegraph_search` — locate indexed symbols.
- `codegraph_files` — list/discover indexed source files without reading contents.
- `codegraph_callers` / `codegraph_callees` — inspect call relationships.
- `codegraph_impact` — estimate refactor blast radius.
- `codegraph_status` — inspect initialization, staleness, pending changes, and extension sync state.

## Behavior

- `codegraph_explore` returns upstream line-numbered source with adaptive source windows and graph-derived context such as relationships or blast radius when useful.
- Explore retrieval uses identifiers, text, and indexed graph relationships; the calling agent reasons over the returned source for causal or behavioral answers.
- Explore accepts an optional `maxFiles` cap (1–20). When omitted, CodeGraph chooses a project-size-adaptive default.
- If the pinned upstream truncation marker cuts through CodeGraph's final unmatched triple-backtick source fence, the adapter closes that fence and replaces the inaccurate completeness notice with an explicit partial-source warning. The same bytes inside a larger Markdown fence and near-miss marker formats remain unchanged.
- Pi's outer emergency cap counts LF, CRLF, and lone-CR lines and tracks backtick and tilde Markdown fences. If truncation removes a normal closing fence, Pi closes it with the matching delimiter before its notice. If an extreme delimiter would amplify output, Pi omits that active block from the retained prefix instead.
- Private module, handler, accessor, sparse-array, and result-shape drift fail with versioned compatibility guidance; there is no reduced retrieval fallback.
- Every queried project root installs an in-process SDK watcher with a 2s quiet-period debounce before its initial catch-up reconciliation, then drains any events observed during that catch-up before serving the query.
- Query tools run a full reconciliation at most every 10s as a watcher-independent safety net. When the watcher reports pending files, a query waits up to 10s for the watcher's debounce/sync pipeline (including mid-sync follow-up events) instead of racing it; interrupted reference work still triggers direct reconciliation.
- Up to four recently used roots are watched concurrently; older roots remain cached and are caught up before their next query. This keeps root repositories, nested subrepos, and indexed worktrees independent without accumulating watchers for every historical worktree.
- `getChangedFiles()` is status-only diagnostics; it no longer gates freshness because clean checkout/pull transitions can be invisible to Git status.
- An explicit nested repository or worktree without its own `.codegraph` cannot silently borrow an ancestor index. Git-root discovery is used only to detect that boundary: an explicit subdirectory in the same working tree still uses its nearest index, or remains the requested initialization root when none exists.
- Sync also heals unresolved references left by an interrupted index, even when no source files changed.
- Status reports watcher health, the last full-index completeness state, pending changes, and pending reference resolution.
- Safe uninitialized roots always require confirmation before initialization.
- Confirmed full reindexes stop the SDK watcher and wait for watcher/query index work to become idle before recreating the database, matching CodeGraph CLI rebuild behavior without racing the old SQLite handle.
- Cached graph handles are reopened when the on-disk database is replaced.

The extension refuses to initialize unsafe roots such as `$HOME`, filesystem roots, or parents of `$HOME`.

## Tool examples

### `codegraph_explore`

- Understand an area: `query: "How does GraphManager ensureReady initialize and sync a project?", maxFiles: 5`
- Trace a flow with exact names: `query: "GraphManager.ensureReady initializeGraph ensureCurrentIndex ensureFresh"`
- Survey related files/symbols: `query: "tools/register-tools.ts ToolDefinition registerFilesTool"`
- Query another project from the current Pi session: `query: "SessionStoreManager SessionClient afterCommit", projectPath: "/home/gc/development/wi"`

Use a concise question and include exact symbol/file names when known. Split unrelated flows into separate Explore calls. There is no `includeCode` mode: Explore always returns source; use `codegraph_search` when locations alone are sufficient.

### `codegraph_node`

- Read one indexed source file: `file: "agent/extensions/codegraph/tools/node-tool.ts", offset: 1, limit: 80`
- Inspect one symbol with source/trail: `symbol: "registerNodeTool", includeCode: true`
- Inspect one symbol disambiguated by file: `symbol: "registerNodeTool", file: "agent/extensions/codegraph/tools/node-tool.ts", includeCode: true`
- Show a file's indexed structure only: `file: "agent/extensions/codegraph/tools/files-tool.ts", symbolsOnly: true`

### `codegraph_search`

- Locate a symbol by name: `query: "registerFilesTool", kind: "function", limit: 10`
- Search without a kind filter: `query: "GraphManager", limit: 20`

### `codegraph_files`

- Browse indexed tool modules: `path: "agent/extensions/codegraph/tools", format: "flat"`
- List tests from the index: `pattern: "**/*.test.ts", format: "flat"`
- Find TypeScript files whose path contains `tool`: `language: "typescript", query: "tool", format: "flat"`
- Check extraction-error files: `errorsOnly: true, format: "flat"`

Use `codegraph_files` for indexed-file discovery only; use `codegraph_node` to read one indexed source file or symbol.

### `codegraph_callers` / `codegraph_callees`

- Find call sites before a refactor: `symbol: "ensureReady", file: "agent/extensions/codegraph/graph-manager.ts", limit: 20`
- Get a terse callee list: `symbol: "ensureReady", file: "agent/extensions/codegraph/graph-manager.ts", limit: 20`

### `codegraph_impact`

- Estimate deeper blast radius: `symbol: "ensureReady", file: "agent/extensions/codegraph/graph-manager.ts", depth: 3, limit: 80`

### `codegraph_status`

- Check the current project: no parameters required.
- Check another indexed project: `projectPath: "/home/gc/development/codegraph"`

## Install/update

Current pinned SDK and CLI target: `1.4.1`.

Version 1.4.1 advances the internal schema from 7 to 8 without changing extraction version 24. The active index therefore does not require a full reindex; `codegraph status` should report `builtWithVersion: 1.4.0`, current extraction 24, complete state, and `reindexRecommended: false` until the next normal index write records the newer package version.

Run from this directory:

```bash
npm install
```

To bump CodeGraph itself, pin the target version explicitly:

```bash
npm install --save-exact @colbymchenry/codegraph@<version>
```

### Explore compatibility check

Full Explore currently lives in CodeGraph's platform-specific MCP module rather than its root public SDK. `upstream-explore.ts` isolates that private import and calls `ToolHandler.executeReadTool()` against the graph already selected by `GraphManager`.

For every CodeGraph version change:

1. Confirm the matching `@colbymchenry/codegraph-<platform>-<arch>` package still contains `lib/dist/mcp/tools.js`.
2. Confirm it exports a constructible `ToolHandler` with `executeReadTool()`.
3. Run `npm test` to exercise the real platform handler and compare its output with the pinned CLI handler.
4. Run an isolated Pi loader smoke test with `pi --no-extensions -e ./index.ts --list-models`.
5. Run a cross-project Explore where Pi's cwd differs from `projectPath`.

Do not add a silent `buildContext()` fallback. A compatibility failure must remain explicit so agents never unknowingly receive reduced retrieval.

Then reload Pi with `/reload` or restart Pi.
