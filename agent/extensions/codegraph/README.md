# Pi CodeGraph Extension

Native Pi tools for CodeGraph using the public `@colbymchenry/codegraph` library API. This avoids MCP and does not depend on CodeGraph private/deep imports.

## Tools

- `codegraph_explore` — primary source-code understanding tool for indexed projects.
- `codegraph_node` — read one indexed symbol or one indexed source file with line numbers and graph context.
- `codegraph_search` — locate indexed symbols.
- `codegraph_callers` / `codegraph_callees` — inspect call relationships.
- `codegraph_impact` — estimate refactor blast radius.
- `codegraph_status` — inspect initialization, staleness, pending changes, and extension sync state.

## Configuration

- `CODEGRAPH_PI_SYNC_TTL_MS=10000` by default. Set `0` to sync whenever pending changes exist; set `-1` to disable automatic sync.
- `CODEGRAPH_PI_AUTO_INIT=confirm` by default. Options: `confirm`, `always`, `never`.

The extension refuses to initialize unsafe roots such as `$HOME`, filesystem roots, or parents of `$HOME`.

## Install/update

Run from this directory:

```bash
npm install
```

Then reload Pi with `/reload` or restart Pi.
