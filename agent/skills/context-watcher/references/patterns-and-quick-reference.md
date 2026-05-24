# Patterns and quick reference

This reference expands examples from `../SKILL.md`. Load it when examples are needed for PR review, test-debug-fix, codebase orientation, infrastructure inspection, docs lookup, session recovery, or data analysis.

## Pattern 1: full PR review

1. Load `gh-cli` for GitHub data.
2. Use `gh` through Context Mode/RTK to inspect the PR.
3. Use codebase-memory-mcp to detect changed files, impacted symbols, callers/callees, and risky traces.
4. Read only affected code needed for evidence.
5. Run focused tests through Context Mode.
6. Draft comments unless the user explicitly asks to post them.

## Pattern 2: test-debug-fix cycle

1. Run the failing test through `ctx_execute` or `ctx_batch_execute` with RTK.
2. Summarize the first actionable failure.
3. Use codebase-memory-mcp to find related symbols, callers, callees, data flow, or cross-service paths.
4. Read/edit only relevant files.
5. Re-run focused tests.
6. Run broader checks only when needed before claiming completion.

## Pattern 3: codebase orientation

1. Call `codebase_memory_mcp_list_projects`.
2. Select the project whose `root_path` matches the active repo.
3. Call `codebase_memory_mcp_index_status(project=...)`.
4. Use `codebase_memory_mcp_get_architecture(project=...)` and `codebase_memory_mcp_get_graph_schema(project=...)` for first-pass orientation.
5. Use `search_graph`, `trace_path`, `query_graph`, and `get_code_snippet` for focused evidence.
6. Use Context Mode/RTK for compact file inventories if graph results are insufficient.
7. Avoid reading large files or broad search output into context.

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
codebase_memory_mcp_list_projects
codebase_memory_mcp_index_status(project="...")
codebase_memory_mcp_get_graph_schema(project="...")
```

### Git reads

```text
ctx_execute({ language: "shell", code: "rtk git status --short --branch" })
ctx_execute({ language: "shell", code: "rtk git log --oneline --max-count=20" })
ctx_execute({ language: "shell", code: "rtk git diff --stat" })
```

### Tests and builds

```text
ctx_execute({ language: "shell", code: "rtk npm test" })
ctx_execute({ language: "shell", code: "rtk uv run pytest" })
ctx_execute({ language: "shell", code: "rtk npm run build" })
```

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

### Graph review

```text
codebase_memory_mcp_list_projects
codebase_memory_mcp_index_status(project="my-project")
codebase_memory_mcp_get_architecture(project="my-project")
codebase_memory_mcp_get_graph_schema(project="my-project")
codebase_memory_mcp_detect_changes(project="my-project", since="HEAD~1", depth=2)
codebase_memory_mcp_search_graph(project="my-project", query="natural language target", limit=10)
codebase_memory_mcp_trace_path(project="my-project", function_name="Target", direction="both", depth=3, risk_labels=true)
codebase_memory_mcp_get_code_snippet(project="my-project", qualified_name="exact.qualified.Name", include_neighbors=true)
```

Use `query_graph` with bounded `max_rows` for custom Cypher, fan-in/fan-out, and edge inspection. Use one-line Cypher strings inside MCP JSON when copy-paste simplicity matters.
