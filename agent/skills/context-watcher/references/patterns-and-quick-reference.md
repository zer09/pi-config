# Patterns and quick reference

This reference expands examples from `../SKILL.md`. Load it when examples are needed for PR review, test-debug-fix, codebase orientation, infrastructure inspection, docs lookup, session recovery, or data analysis.

## Pattern 1: full PR review

1. Load `gh-cli` for GitHub data.
2. Use `gh` through Context Mode/RTK to inspect the PR.
3. Use Code Review Graph to detect changed files and impact radius.
4. Read only affected code needed for evidence.
5. Run focused tests through Context Mode.
6. Draft comments unless the user explicitly asks to post them.

## Pattern 2: test-debug-fix cycle

1. Run the failing test through `ctx_execute` or `ctx_batch_execute` with RTK.
2. Summarize the first actionable failure.
3. Use Code Review Graph to find related code paths.
4. Read/edit only relevant files.
5. Re-run focused tests.
6. Run broader checks only when needed before claiming completion.

## Pattern 3: codebase orientation

1. Check graph stats.
2. Use architecture overview, communities, flows, or hub nodes from Code Review Graph.
3. Use Context Mode/RTK for compact file inventories if graph is insufficient.
4. Avoid reading large files or broad search output into context.

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
- Abandoning Code Review Graph only because the daemon is stopped.
- Posting PR comments or pushing commits from a broad request.
- Writing files through shell redirection or Context Mode.

## Quick reference

### Setup and health

```text
ctx_doctor
ctx_stats
code_review_graph_list_graph_stats_tool
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
code_review_graph_list_graph_stats_tool
code_review_graph_detect_changes_tool
code_review_graph_get_impact_radius_tool
code_review_graph_get_review_context_tool
```
