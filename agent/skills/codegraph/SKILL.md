---
name: codegraph
description: "Use CodeGraph for local code knowledge graph exploration, architecture questions, code review, caller/callee lookup, flow tracing, refactor impact analysis, indexed file structure, and MCP/CLI setup with .codegraph indexes. Trigger when structural code exploration should use an indexed graph before grep/read loops."
---

# CodeGraph

CodeGraph is the local structural code graph. Use it before grep, broad file reads, or manual source walking when a task asks about architecture, code review, callers, callees, traces, blast radius, refactors, or how a feature works.

## Runtime contract

- Start structural code work with CodeGraph when the repository has a `.codegraph/` index.
- Use Context Mode/RTK for shell commands, git reads, tests, logs, and large output.
- Use native `read` before editing exact files; use native `edit` or `write` for file modifications.
- Do not run `codegraph init`, `codegraph index`, `codegraph sync`, or `codegraph uninit` unless local index mutation is explicitly authorized or the user asked for CodeGraph setup.
- Pass `projectPath` on MCP calls when the target repo may differ from the session root or when working in a worktree.
- If CodeGraph is unavailable, uninitialized, stale, or insufficient, state the degraded route and fall back to Context Mode/RTK plus targeted reads.

## Setup and status

Use read-only checks first:

```text
codegraph --version
codegraph status <repo>
```

If status says the repo is not initialized, offer setup or run it only when authorized:

```text
codegraph init -i <repo>
```

Keep `.codegraph/` ignored before initializing a repo.

## MCP tool selection

| Intent | Tool |
|---|---|
| Architecture, onboarding, area, bug explanation | `codegraph_context` |
| Flow or path between concepts/symbols | `codegraph_trace` |
| Known symbol lookup | `codegraph_search` |
| One exact symbol source/signature | `codegraph_node` |
| Related source across multiple symbols/files | `codegraph_explore` |
| Direct callers | `codegraph_callers` |
| Direct callees | `codegraph_callees` |
| Refactor blast radius | `codegraph_impact` |
| Indexed file tree/layout | `codegraph_files` |
| Health, pending sync, counts | `codegraph_status` |

## Common workflows

### Architecture or orientation

1. Call `codegraph_status` if project health is unknown.
2. Call `codegraph_context` with the user's question.
3. Call one `codegraph_explore` only when source bodies for returned symbols are needed.

### Flow tracing

1. Call `codegraph_trace` first.
2. If the trace identifies relevant symbols, call one `codegraph_explore` for supporting source.
3. Use targeted native reads only for files you will edit or files listed in a stale banner.

### Code review

1. Use Context Mode/RTK for git diff, changed files, tests, and lint output.
2. Use `codegraph_context` for the changed feature area.
3. Use `codegraph_impact` for public or high fan-in changed symbols.
4. Use `codegraph_callers`, `codegraph_callees`, or `codegraph_trace` for specific dependency or control-flow questions.
5. Do not post review comments or mutate hosted services unless explicitly requested.

### Refactor planning

1. Use `codegraph_search` for the symbol if the exact name is known.
2. Use `codegraph_callers` and `codegraph_impact` to find dependencies and blast radius.
3. Use `codegraph_explore` for the impacted source set.
4. Run tests/checks through Context Mode after edits.

## Staleness policy

- CodeGraph watches and syncs indexed projects, but responses may include stale-file notices after edits.
- If a stale banner names files, read only those files for exact latest content.
- If `codegraph_status` shows pending sync files and graph accuracy matters, wait for sync or ask before running a local sync/index command.
- Do not re-check all CodeGraph results with grep; trust unstale graph output unless a specific missing detail requires another route.

## Anti-patterns

Avoid:

- Grep/find/manual source reading before CodeGraph for structural code questions.
- `codegraph_search` plus repeated `codegraph_node` calls when `codegraph_context` or `codegraph_explore` can answer in one call.
- Looping over many symbols with `codegraph_node`.
- Treating an uninitialized index as permission to skip graph-first silently.
- Using CodeGraph as a substitute for tests, type checks, lint, or exact source reads before edits.

## References

Read [`references/tool-routing.md`](references/tool-routing.md) when argument examples, worktree usage, code review chains, staleness details, or fallback examples matter.
