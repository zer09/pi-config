# Lean context-mode Pi extension

This is a small Pi extension wrapper around upstream [`context-mode`](https://github.com/mksglu/context-mode). It exposes only three Pi tools:

- `ctx_execute_file`
- `ctx_batch_execute`
- `ctx_search`

It is for large-output workflows: noisy tests/builds, logs, large JSON/CSV, generated reports, and multi-command investigations. Use normal Pi `read`, CodeGraph, `bash`, and edit tools for targeted source inspection and exact code edits.

## How it works

The wrapper lazy-loads upstream `context-mode` as an internal backend:

1. Sets `CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS=1` before import.
2. Imports upstream `server.bundle.mjs`.
3. Reads `REGISTERED_CTX_TOOLS`.
4. Calls only the selected upstream handlers directly.
5. Wraps calls with `withProjectDirOverride({ projectDir })`.

It never calls upstream MCP `tools/list`, and it does not register upstream's full tool schema.

## Storage

By default the wrapper sets:

- `PI_CONFIG_DIR=~/.pi` when unset
- `CONTEXT_MODE_DIR=~/.pi/context-mode` when unset
- `CONTEXT_MODE_PROJECT_DIR=<resolved project dir>`

`~/.pi/context-mode` is a shared storage root. Upstream context-mode uses project-scoped DB names under that root, so `ctx_search` searches the active project unless context-mode behavior changes upstream.

Project resolution prefers explicit `PI_WORKSPACE_DIR`/`PI_PROJECT_DIR`, then the active Pi extension context (`ctx.cwd`), then process `PWD`/cwd. The extension context must win over npm's process directory so tests, prefixed npm scripts, and embedded execution stay scoped to the actual Pi workspace.

## Backend resolution

The wrapper resolves the upstream backend in this order:

1. `CONTEXT_MODE_ROOT/server.bundle.mjs`
2. installed npm dependency `context-mode` from this package

Run `npm install` in this directory after creating or updating the package. To test against a local context-mode clone, set `CONTEXT_MODE_ROOT=/path/to/context-mode` explicitly.

## Safety notes

`ctx_batch_execute` is deny-list guarded for obvious destructive or hosted-service mutation commands, including `rtk git push`-style prefixed commands. `ctx_execute_file` blocks obvious secret/key/config paths before delegating to upstream context-mode's own deny policies.

This is not a sandbox boundary. It is a lean wrapper around a powerful local tool; use it for diagnostic/read-heavy workflows.

## Development

```bash
npm install
npm test
npm run check
npm run fuzz
```

Manual Pi trial:

```bash
pi -e /home/gc/.pi/agent/extensions/context-mode
```

Check that only the three lean `ctx_*` tools are loaded and that Ctrl+O expands/collapses tool results.
