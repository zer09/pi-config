# Lean context-mode Pi extension

This is a small Pi extension wrapper around upstream [`context-mode`](https://github.com/mksglu/context-mode). It exposes only three Pi tools:

- `ctx_execute_file`
- `ctx_batch_execute`
- `ctx_search`

It is for large-output workflows: noisy tests/builds, logs, large JSON/CSV, generated reports, and multi-command investigations. Use normal Pi `read`, CodeGraph, `bash`, and edit tools for targeted source inspection and exact code edits.

## How it works

The wrapper loads upstream `context-mode` in a new owned subprocess for each call:

1. Sets `CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS=1` before import.
2. Imports upstream `server.bundle.mjs`.
3. Reads `REGISTERED_CTX_TOOLS`.
4. Calls only the selected upstream handlers directly.
5. Wraps calls with `withProjectDirOverride({ projectDir })`.

A backend thread runs inside the subprocess. The IPC owner remains responsive when indexing or search blocks the backend thread. Spawn interception starts in the thread before the upstream import. The owner creates async children in its main event loop and records each PID before acknowledging the launch. Thread termination cannot interrupt that ownership step. The Pi host's `child_process` exports are not patched. Worker stdin is closed, and worker logs do not enter the IPC protocol.

The bridge supports the ChildProcess interface used by pinned context-mode 1.0.169: PID, stdout/stderr data listeners, child error/exit/close events, and `unref`. It is not a general ChildProcess replacement. Output relay permits one chunk of at most 64 KiB per stream in flight. Upstream upgrades require another API-usage check.

It never calls upstream MCP `tools/list`, and it does not register upstream's full tool schema.

## Execution, progress, and cancellation

`ctx_batch_execute` and `ctx_execute_file` supply `timeout=300000` milliseconds when omitted. Explicit timeout values are preserved. Upstream applies the batch timeout as a shared execution budget with concurrency 1, or separately to each command with concurrency greater than 1. Execution timeouts exclude indexing and search. `ctx_search` has no new execution timeout.

Pi receives changed progress for backend phase transitions, observed subprocess output growth, and subprocess completion. Updates contain aggregate process counts and output byte counts, not commands, paths, or output text. Output growth is coalesced at 100 milliseconds. Silent work gets no periodic heartbeat. Productive long calls can use explicit larger execution timeouts without changing the delegate watchdog or route policy. Blocking indexing/search remains silent unless an observed process produces output or completes.

Cancellation stops the backend thread before command completion can schedule more queued work. On Unix, each worker starts as a private process-group leader. Synchronous probes and compilers inherit that group; observed async commands use separate groups recorded in the ownership ledger. The Pi host checks both the ledger and the worker group after every worker exit, including normal results, cancellation, and crashes. Cleanup failure is an error, not success or settled cancellation.

On IPC parent disconnect or forced thread shutdown, the worker cleans its async groups first, then kills its own fallback group as its final action. It never waits for cleanup of a group containing itself or signals the inherited Pi host group. Thread shutdown has a 500-millisecond forced fallback; each cleanup pass allows 200 milliseconds for SIGTERM and 1500 milliseconds after SIGKILL. The Pi host has a 3-second worker kill fallback. The fallback group does not count as observed progress or against the subprocess limit.

Integration coverage runs on Linux. Linux checks exclude dead zombie descendants awaiting system-init reaping; direct command children are reaped. Other Unix systems use process-group existence checks and can report cleanup failure if init delays zombie reaping. Windows only supports direct-process cleanup here, not Unix group guarantees. Descendants that deliberately leave the owned process group are outside this cleanup guarantee. This is not a sandbox.

Each call allows at most 4096 observed subprocess starts. IPC arguments and results are limited to 16 MiB. Calls still share the existing project-scoped storage; no worker-specific storage is introduced.

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
