# CodeGraph tool routing

Use this reference for CodeGraph MCP arguments, CLI setup checks, worktree routing, code review chains, and fallback decisions.

## MCP call shapes

List server tools first. CodeGraph defines 10 MCP tool capabilities, but `tools/list` is intentionally gated by the server's active/default project. Projects with fewer than 500 indexed files expose only the 5 core MCP tools: `codegraph_search`, `codegraph_context`, `codegraph_node`, `codegraph_explore`, and `codegraph_trace`. Larger active projects can expose all 10 unless `CODEGRAPH_MCP_TOOLS` allowlists fewer tools. Passing `projectPath` to an individual tool call does not change the already-listed MCP tools.

In Pi's MCP gateway, tool names can be prefixed with the server name, for example `codegraph_codegraph_context`. Use the exact live name returned by the server list.

```text
mcp({ server: "codegraph" })
```

Architecture context:

```text
mcp({ tool: "codegraph_codegraph_context", server: "codegraph", args: "{\"task\":\"How does auth work?\",\"projectPath\":\"<repo-absolute-path>\"}" })
```

Symbol lookup:

```text
mcp({ tool: "codegraph_codegraph_search", server: "codegraph", args: "{\"query\":\"AuthService\",\"projectPath\":\"<repo-absolute-path>\"}" })
```

Trace a flow:

```text
mcp({ tool: "codegraph_codegraph_trace", server: "codegraph", args: "{\"from\":\"login route\",\"to\":\"session creation\",\"projectPath\":\"<repo-absolute-path>\"}" })
```

Explore returned symbols:

```text
mcp({ tool: "codegraph_codegraph_explore", server: "codegraph", args: "{\"query\":\"symbols from the prior result\",\"projectPath\":\"<repo-absolute-path>\"}" })
```

Tool schemas are authoritative. If a parameter name or tool name differs from these examples, follow the live MCP tool description.

## CLI checks

Read-only checks:

```text
codegraph --version
codegraph status <repo>
codegraph files -p <repo> --format tree|flat|grouped
codegraph query -p <repo> <symbol-or-term>
codegraph context -p <repo> "<task>" --no-code
codegraph callers -p <repo> <symbol>
codegraph callees -p <repo> <symbol>
codegraph impact -p <repo> <symbol> --depth 2
codegraph affected -p <repo> [files...] --quiet
```

Use CLI `codegraph status <repo>` as the reliable status check when the MCP server does not expose `codegraph_status`. CLI project routing is inconsistent by command: `status`, `init`, `index`, `sync`, and `uninit` accept a positional path; `files`, `query`, `context`, `callers`, `callees`, `impact`, and `affected` use `-p/--path`. The CLI search command is named `query`, while the MCP search tool is named `codegraph_search`.

Local index mutations, only when authorized:

```text
codegraph init <repo> --index
codegraph index <repo>
codegraph sync <repo>
codegraph uninit <repo>
```

`uninit` removes local graph state. Treat it as destructive local deletion.

## CLI usage notes from practice

- `codegraph files` has no positional repo argument; use `-p <repo>`. Useful filters: `--filter <dir>`, `--pattern "**/*.test.ts"`, `--format tree|flat|grouped`, `--max-depth <n>`, `--no-metadata`, and `--json`.
- `codegraph query --json` returns an array of `{ node, score }`; read fields under `node`, such as `node.name`, `node.kind`, `node.filePath`, `node.startLine`, and `node.signature`.
- `codegraph context` takes a task-shaped code question. It is not a docs search tool; for markdown or config questions, use Context Mode/RTK or targeted reads.
- `codegraph callers`, `callees`, and `impact` are always available in the CLI even when MCP tool gating exposes only the 5 core tools.
- `codegraph affected -p <repo> --stdin --quiet` accepts changed file paths on stdin and prints affected tests when the graph can infer them. Empty output means no affected tests were found, not necessarily that no tests should run.
- After `codegraph index` or `codegraph sync`, run `codegraph status <repo>` when counts matter; status is the authoritative health/count summary.
- Before or after `codegraph init <repo> --index`, ensure `.codegraph/` is ignored. Prefer a tracked `.gitignore` for project policy or `.git/info/exclude` for local-only practice indexes.
- `codegraph serve --mcp` is the stdio MCP command. `codegraph serve -p <repo> --mcp` can pin the active/default project used for MCP tool gating; omit `-p` when the MCP client supplies roots and you plan to use `projectPath` per call.
- `codegraph serve --no-watch` disables auto-sync and should be reserved for slow or problematic filesystems.
- `codegraph install` and `codegraph uninstall` mutate agent configuration. Use `codegraph install --print-config <agent>` for read-only config snippets; do not run install/uninstall without exact user authorization.
- `codegraph unlock <repo>` removes stale index locks. Use only when status/index/sync reports a stale lock.

## Intent chains

### Architecture or onboarding

```text
codegraph status <repo> -> codegraph_context -> codegraph_explore if source is needed
```

Use a task-shaped prompt for `codegraph_context`, such as "Explain the request path for password reset" or "Find where webhook retries are configured".

### Code review

```text
Context Mode git diff/tests -> codegraph_context -> codegraph_search -> codegraph_trace -> codegraph_explore
```

Use optional `codegraph_impact`, `codegraph_callers`, and `codegraph_callees` when the live MCP server exposes them. Use CodeGraph for structure and blast radius. Use Context Mode/RTK for diff output, tests, lint, and build output. Use native reads only for exact files that need evidence or edits.

### Refactor impact

```text
codegraph_search -> optional codegraph_callers/codegraph_callees/codegraph_impact -> codegraph_explore
```

Prefer `impact` before edits when exposed to detect high fan-in symbols, route handlers, public APIs, tests, and cross-language edges when indexed. If optional relationship tools are not exposed, use `codegraph_context`, `codegraph_trace`, and `codegraph_explore` to build the smallest safe impact picture.

### Flow or data path

```text
codegraph_trace -> codegraph_explore
```

Start with `trace` rather than search when the user asks "how does X reach Y", "where does this request go", "what calls this async job", or "why does this side effect happen".

### Regression debugging

```text
codegraph_context -> codegraph_trace -> codegraph_explore -> optional codegraph_impact
```

Use callers first when exposed and a suspicious function is known. Widen to impact when exposed and the failure may be caused by an upstream caller or downstream side effect.

## Worktrees and multi-repo work

- Each repo/worktree should have its own `.codegraph/` index unless the intended project root is a parent directory.
- Run `codegraph status <worktree>` before graph-dependent work in a new worktree.
- If status is missing and graph accuracy matters, ask before `codegraph init <worktree> --index` unless setup was explicitly requested.
- Pass `projectPath` for every MCP call that targets a worktree or a repo outside the active session root.
- If CodeGraph reports a worktree mismatch, use the path named by the notice or initialize the intended worktree.

## Staleness handling

- CodeGraph MCP watches indexed projects and catches up on connect.
- A stale banner means only the listed files need raw reads for exact latest content.
- Use `codegraph status <repo>` or an exposed `codegraph_status` tool for pending sync files when graph accuracy matters.
- Do not run broad grep just to verify unstale CodeGraph results.

## Fallbacks

Fallback is appropriate when:

- The repo is not initialized and the user did not authorize setup.
- The MCP server is unavailable or tool metadata is stale after reconnect/restart attempts.
- The live MCP server does not expose an optional relationship/status tool and the core tools are insufficient.
- The question is about literals, config values, generated files, docs, logs, test output, or non-code files.
- A CodeGraph result explicitly lacks needed dynamic/runtime information.

When falling back, state:

```text
Intended route: CodeGraph <tool>
Problem: <unavailable/uninitialized/stale/insufficient/not exposed>
Fallback route: Context Mode/RTK plus targeted native reads
Completeness: complete|degraded
```

## Anti-patterns

- Starting structural investigation with `rg` or `find`.
- Calling `codegraph_search` for every architecture question instead of `codegraph_context`.
- Calling `codegraph_node` in a loop for many symbols instead of one `codegraph_explore`.
- Running `codegraph init`, `index`, `sync`, `uninit`, `install`, `uninstall`, or `unlock` as a hidden side effect.
- Assuming every documented CodeGraph tool is exposed without checking the live server list.
- Passing user-specific paths in shared output; use `<repo-absolute-path>`, `<worktree>`, or project-relative paths in docs and examples.
