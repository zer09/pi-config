# Pi CodeGraph Extension

Native Pi tools for CodeGraph using the public `@colbymchenry/codegraph` library API. This avoids MCP and does not depend on CodeGraph private/deep imports.

## Tools

- `codegraph_explore` — primary source-code understanding tool for indexed projects.
- `codegraph_node` — read one indexed symbol or one indexed source file with line numbers and graph context.
- `codegraph_search` — locate indexed symbols.
- `codegraph_files` — list/discover indexed source files without reading contents.
- `codegraph_callers` / `codegraph_callees` — inspect call relationships.
- `codegraph_impact` — estimate refactor blast radius.
- `codegraph_status` — inspect initialization, staleness, pending changes, and extension sync state.

## Behavior

- Query-time sync uses a fixed 10s TTL between extension-triggered syncs.
- Sync also heals unresolved references left by an interrupted index, even when no source files changed.
- Status reports the last full-index completeness state and pending reference resolution.
- Safe uninitialized roots always require confirmation before initialization.
- Confirmed full reindexes recreate the CodeGraph database before indexing, matching CodeGraph CLI behavior.
- Cached graph handles are reopened when the on-disk database is replaced.

The extension refuses to initialize unsafe roots such as `$HOME`, filesystem roots, or parents of `$HOME`.

## Tool examples

### `codegraph_explore`

- Understand an area: `query: "how does GraphManager ensureReady sync and initialize?", maxNodes: 30`
- Trace a flow: `query: "ensureReady initializeGraph ensureFresh"`
- Survey related files/symbols: `query: "tools/register-tools.ts ToolDefinition registerFilesTool"`

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

Run from this directory:

```bash
npm install
```

To bump CodeGraph itself, pin the target version explicitly:

```bash
npm install --save-exact @colbymchenry/codegraph@<version>
```

Then reload Pi with `/reload` or restart Pi.
