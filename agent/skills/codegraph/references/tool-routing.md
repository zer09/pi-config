# CodeGraph tool routing

Use this reference for CodeGraph MCP arguments, CLI setup checks, worktree routing, code review chains, and fallback decisions.

## MCP call shapes

List server tools:

```text
mcp({ server: "codegraph" })
```

Health check with an explicit project path:

```text
mcp({ tool: "codegraph_status", server: "codegraph", args: "{\"projectPath\":\"<repo-absolute-path>\"}" })
```

Architecture context:

```text
mcp({ tool: "codegraph_context", server: "codegraph", args: "{\"task\":\"How does auth work?\",\"projectPath\":\"<repo-absolute-path>\"}" })
```

Symbol lookup:

```text
mcp({ tool: "codegraph_search", server: "codegraph", args: "{\"query\":\"AuthService\",\"projectPath\":\"<repo-absolute-path>\"}" })
```

Trace a flow:

```text
mcp({ tool: "codegraph_trace", server: "codegraph", args: "{\"from\":\"login route\",\"to\":\"session creation\",\"projectPath\":\"<repo-absolute-path>\"}" })
```

Explore returned symbols:

```text
mcp({ tool: "codegraph_explore", server: "codegraph", args: "{\"query\":\"symbols from the prior result\",\"projectPath\":\"<repo-absolute-path>\"}" })
```

Tool schemas are authoritative. If a parameter name differs from these examples, follow the live MCP tool description.

## CLI checks

Read-only checks:

```text
codegraph --version
codegraph status <repo>
codegraph files <repo>
```

Local index mutations, only when authorized:

```text
codegraph init -i <repo>
codegraph index <repo>
codegraph sync <repo>
codegraph uninit <repo>
```

`uninit` removes local graph state. Treat it as destructive local deletion.

## Intent chains

### Architecture or onboarding

```text
codegraph_status -> codegraph_context -> codegraph_explore if source is needed
```

Use a task-shaped prompt for `codegraph_context`, such as "Explain the request path for password reset" or "Find where webhook retries are configured".

### Code review

```text
Context Mode git diff/tests -> codegraph_context -> codegraph_search -> codegraph_impact -> codegraph_explore
```

Use CodeGraph for structure and blast radius. Use Context Mode/RTK for diff output, tests, lint, and build output. Use native reads only for exact files that need evidence or edits.

### Refactor impact

```text
codegraph_search -> codegraph_callers -> codegraph_callees -> codegraph_impact -> codegraph_explore
```

Prefer `impact` before edits to detect high fan-in symbols, route handlers, public APIs, tests, and cross-language edges when indexed.

### Flow or data path

```text
codegraph_trace -> codegraph_explore
```

Start with `trace` rather than search when the user asks "how does X reach Y", "where does this request go", "what calls this async job", or "why does this side effect happen".

### Regression debugging

```text
codegraph_context -> codegraph_callers -> codegraph_trace -> codegraph_impact
```

Use callers first when a suspicious function is known. Widen to impact when the failure may be caused by an upstream caller or downstream side effect.

## Worktrees and multi-repo work

- Each repo/worktree should have its own `.codegraph/` index unless the intended project root is a parent directory.
- Run `codegraph status <worktree>` before graph-dependent work in a new worktree.
- If status is missing and graph accuracy matters, ask before `codegraph init -i <worktree>` unless setup was explicitly requested.
- Pass `projectPath` for every MCP call that targets a worktree or a repo outside the active session root.
- If CodeGraph reports a worktree mismatch, use the path named by the notice or initialize the intended worktree.

## Staleness handling

- CodeGraph MCP watches indexed projects and catches up on connect.
- A stale banner means only the listed files need raw reads for exact latest content.
- Use `codegraph_status` for pending sync files when graph accuracy matters.
- Do not run broad grep just to verify unstale CodeGraph results.

## Fallbacks

Fallback is appropriate when:

- The repo is not initialized and the user did not authorize setup.
- The MCP server is unavailable or tool metadata is stale after reconnect/restart attempts.
- The question is about literals, config values, generated files, docs, logs, test output, or non-code files.
- A CodeGraph result explicitly lacks needed dynamic/runtime information.

When falling back, state:

```text
Intended route: CodeGraph <tool>
Problem: <unavailable/uninitialized/stale/insufficient>
Fallback route: Context Mode/RTK plus targeted native reads
Completeness: complete|degraded
```

## Anti-patterns

- Starting structural investigation with `rg` or `find`.
- Calling `codegraph_search` for every architecture question instead of `codegraph_context`.
- Calling `codegraph_node` in a loop for many symbols instead of one `codegraph_explore`.
- Running `codegraph init`, `index`, `sync`, or `uninit` as a hidden side effect.
- Passing user-specific paths in shared output; use `<repo-absolute-path>`, `<worktree>`, or project-relative paths in docs and examples.
