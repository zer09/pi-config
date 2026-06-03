# Patterns and quick reference

This reference expands examples from `../SKILL.md`. Load it when examples are needed for PR review, test-debug-fix, codebase orientation, infrastructure inspection, docs lookup, session recovery, or data analysis.

## Pattern 1: full PR review

1. Load `gh-cli` for GitHub data.
2. Use `gh` through Context Mode/RTK to inspect the PR.
3. Use CodeGraph to map changed areas, impacted symbols, callers/callees, and risky traces.
4. Read only affected code needed for evidence.
5. Run focused tests through Context Mode.
6. Draft comments unless the user explicitly asks to post them.

## Pattern 2: test-debug-fix cycle

1. Run the failing test through `ctx_execute` or `ctx_batch_execute` with RTK.
2. Summarize the first actionable failure.
3. Use CodeGraph to find related symbols, callers, callees, data flow, or request paths.
4. Read/edit only relevant files.
5. Re-run focused tests.
6. Run broader checks only when needed before claiming completion.

## Pattern 3: codebase orientation

1. Check read-only `codegraph status <repo>` or exposed `codegraph_status` when project health is unknown.
2. If the repo is not initialized or stale and graph accuracy matters, run `codegraph init <repo>`, `codegraph sync <repo>`, or `codegraph index <repo>` when setup/indexing/freshness was explicitly requested; otherwise ask before local index mutation.
3. Use `codegraph_explore` first for orientation, architecture, bug, flow/path, and source survey questions.
4. Use `codegraph_search` for known symbols and `codegraph_node` only for one exact symbol.
5. Use `codegraph_callers`, `codegraph_callees`, and `codegraph_impact` for focused relationship and refactor evidence.
6. Use CodeGraph CLI through Context Mode when graph output should be indexed, searched later, batched, parsed, or compared.
7. Use Context Mode/RTK for compact file inventories if graph results are insufficient.
8. Avoid reading large files or broad search output into context.

## Pattern 4: infrastructure inspection

1. Treat cloud and hosted vendor services as read-only by default.
2. Use CLI/API commands through Context Mode.
3. Programmatically filter large JSON responses.
4. Never print secrets or credential-bearing environment values.
5. Do not deploy, rotate keys, update quotas, or run mutating jobs without exact user instruction.

## Pattern 5: web documentation lookup

1. For third-party libraries/APIs, use Context7 first.
2. For URLs, use `ctx_fetch_and_index`.
3. Use `ctx_search` with targeted queries.
4. Cite only what was fetched or locally verified.

## Pattern 6: session recovery after compaction

1. Use `ctx_search(sort: "timeline")` for prior session state.
2. Search indexed handoffs, plans, validation output, and decisions.
3. Verify current git state before editing.
4. Do not ask the user to repeat information that is recoverable from indexed state.

## Pattern 7: data analysis

1. Keep raw data in the sandbox.
2. Write code to parse/filter/count/compare.
3. Print only summaries, relevant records, and caveats.
4. Store artifacts in files when the user needs full output.

## Anti-patterns

Avoid:

- Reading a 500-line log into context to count errors manually.
- Running raw test suites through direct Bash.
- Using browser/web tools for private GitHub data.
- Moving a mandatory rule into a reference without a visible trigger in `SKILL.md`.
- Treating RTK as a replacement for programmed analysis.
- Abandoning graph-first structural code work only because an index is stale or missing.
- Posting PR comments or pushing commits from a broad request.
- Writing files through shell redirection or Context Mode.

## Quick reference

### Setup and health

```text
ctx_doctor
ctx_stats
ctx_insight  # optional local analytics dashboard
codegraph --version
codegraph status <repo>
# Optional when exposed by the live MCP server:
codegraph_status(projectPath="<repo>")
```

### Git reads

```text
ctx_execute({ language: "shell", code: "rtk git status --short --branch" })
ctx_execute({ language: "shell", code: "rtk git log --oneline --max-count=20" })
ctx_execute({ language: "shell", code: "rtk git diff --stat" })
```

### Tests and builds

Use `ctx_batch_execute` by default for multiple checks or output-heavy suites. Use `ctx_execute` for one focused command.

```text
ctx_execute({ language: "shell", code: "rtk npm test" })
ctx_execute({ language: "shell", code: "rtk uv run pytest" })
ctx_execute({ language: "shell", code: "rtk npm run build" })
```

Keep `concurrency: 1` for tests and builds unless each command is independent and cannot race on locks, caches, ports, or generated files.

### Parallel I/O batches

Use parallel Context Mode batches for independent network or read-only I/O work.

```text
ctx_batch_execute({
  commands: [
    { label: "issue 1", command: "gh issue view 1" },
    { label: "issue 2", command: "gh issue view 2" },
    { label: "issue 3", command: "gh issue view 3" }
  ],
  queries: ["root cause", "proposed fix", "risks"],
  concurrency: 4
})
```

Use `concurrency: 4-8` for I/O-bound reads. Keep `concurrency: 1` for CPU-bound or stateful commands.

### Files

```text
# Editing
native read -> native edit

# Analysis
ctx_execute_file({ path: "path/to/file", language: "javascript", code: "..." })
```

### Docs and URLs

```text
ctx_fetch_and_index({ url: "https://example.com/docs", source: "docs" })
ctx_search({ queries: ["specific API option"] })
```

For multiple public docs pages, fetch as a bounded batch:

```text
ctx_fetch_and_index({
  requests: [
    { url: "https://example.com/guide", source: "example-guide" },
    { url: "https://example.com/api", source: "example-api" }
  ],
  concurrency: 5
})
```

### Local indexing and search

Index local docs or a bounded project slice when repeated search will be cheaper than repeated reads.

```text
ctx_index({
  path: "docs",
  source: "project-docs",
  maxDepth: 5,
  maxFiles: 200,
  extensions: [".md", ".mdx", ".txt"]
})
ctx_search({ source: "project-docs", queries: ["routing rules", "upgrade process"], limit: 5 })
```

If MCP tools are unavailable, fall back to the CLI:

```text
context-mode index docs --source project-docs --max-depth 5 --max-files 200
context-mode search "routing rules" --source project-docs --limit 5
```

### Graph review

```text
codegraph_explore(query="How does the changed feature work? KnownSymbol related file names", projectPath="<repo>")
codegraph_search(query="KnownSymbol", projectPath="<repo>")
codegraph_node(symbol="KnownSymbol", projectPath="<repo>")
codegraph_callers(symbol="KnownSymbol", projectPath="<repo>")
codegraph_callees(symbol="KnownSymbol", projectPath="<repo>")
codegraph_impact(symbol="KnownSymbol", projectPath="<repo>")
codegraph_files(projectPath="<repo>")
codegraph_status(projectPath="<repo>")
```

### Indexed graph output

```text
ctx_batch_execute({
  commands: [
    { label: "codegraph status", command: "codegraph status <repo> | perl -pe 's/\\e\\[[0-9;?]*[ -\\/]*[@-~]//g'" },
    { label: "codegraph search KnownSymbol", command: "codegraph query -p <repo> KnownSymbol | perl -pe 's/\\e\\[[0-9;?]*[ -\\/]*[@-~]//g'" },
    { label: "codegraph callers KnownSymbol", command: "codegraph callers -p <repo> KnownSymbol | perl -pe 's/\\e\\[[0-9;?]*[ -\\/]*[@-~]//g'" },
    { label: "codegraph impact KnownSymbol", command: "codegraph impact -p <repo> KnownSymbol | perl -pe 's/\\e\\[[0-9;?]*[ -\\/]*[@-~]//g'" }
  ],
  queries: ["health", "KnownSymbol callers", "KnownSymbol impact"]
})
```

Use MCP first when symbol ambiguity matters. Use plain CLI with ANSI stripped when output should be indexed and searched later. Use CLI `--json` only inside programmed analysis that prints a compact summary. Use plain `codegraph files -p <repo> --format flat` when symbol counts matter.

Use live MCP schemas as authoritative if parameter names differ from examples.
