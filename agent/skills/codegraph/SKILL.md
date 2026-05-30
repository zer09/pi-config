---
name: codegraph
description: "Use CodeGraph for local code knowledge graph exploration, architecture questions, code review, caller/callee lookup, flow tracing, refactor impact analysis, indexed file structure, and MCP/CLI setup with .codegraph indexes. Trigger when structural code exploration should use an indexed graph before grep/read loops."
---

# CodeGraph

CodeGraph is the local structural code graph. Use it before grep, broad file reads, or manual source walking when a task asks about architecture, code review, callers, callees, traces, blast radius, refactors, or how a feature works.

## Runtime contract

- Start structural code work with CodeGraph when the repository has a `.codegraph/` index.
- Use Context Mode/RTK for shell commands, git reads, tests, logs, and large output, including CodeGraph CLI output.
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
codegraph init <repo> --index
```

Keep `.codegraph/` ignored before or immediately after initializing a repo; use `.git/info/exclude` for local-only practice indexes.

## MCP tool selection

Important tool-gating rule: CodeGraph defines 10 MCP tool capabilities, but `tools/list` is intentionally gated by the server's active/default project. Projects with fewer than 500 indexed files expose only the 5 core MCP tools: `codegraph_search`, `codegraph_context`, `codegraph_node`, `codegraph_explore`, and `codegraph_trace`. Larger active projects can expose all 10 unless `CODEGRAPH_MCP_TOOLS` allowlists fewer tools.

In Pi, the active/default project comes from the CodeGraph server launch path, such as `codegraph serve --mcp --path ${workspaceFolder}`. Passing `projectPath` to an individual tool call does not change the already-listed MCP tools. If optional MCP tools are absent, use the CLI equivalents (`codegraph status`, `files`, `callers`, `callees`, `impact`) through Context Mode/RTK. Always list the live `codegraph` server tools before relying on optional tools. In Pi's MCP gateway, tool names may be prefixed as `codegraph_codegraph_context`; use the live listed name.

| Intent | Tool |
|---|---|
| Architecture, onboarding, area, bug explanation | `codegraph_context` |
| Flow or path between concepts/symbols | `codegraph_trace` |
| Known symbol lookup | `codegraph_search` |
| One exact symbol source/signature | `codegraph_node` |
| Related source across multiple symbols/files | `codegraph_explore` |
| Direct callers, when exposed | `codegraph_callers` |
| Direct callees, when exposed | `codegraph_callees` |
| Refactor blast radius, when exposed | `codegraph_impact` |
| Indexed file tree/layout, when exposed | `codegraph_files` |
| Health, pending sync, counts, when exposed | `codegraph_status`; otherwise `codegraph status <repo>` via Context Mode |

## Common workflows

### Architecture or orientation

1. Run read-only `codegraph status <repo>` through Context Mode if project health is unknown, or use `codegraph_status` when that MCP tool is exposed.
2. Call `codegraph_context` with the user's question.
3. Call one `codegraph_explore` only when source bodies for returned symbols are needed.

### Flow tracing

1. Call `codegraph_trace` first.
2. If the trace identifies relevant symbols, call one `codegraph_explore` for supporting source.
3. Use targeted native reads only for files you will edit or files listed in a stale banner.

### Code review

1. Use Context Mode/RTK for git diff, changed files, tests, and lint output.
2. Use `codegraph_context` for the changed feature area.
3. Use `codegraph_impact` for public or high fan-in changed symbols when the tool is exposed.
4. Use `codegraph_callers`, `codegraph_callees`, or `codegraph_trace` for specific dependency or control-flow questions when those tools are exposed; otherwise use `codegraph_context`, `codegraph_trace`, and `codegraph_explore`.
5. Do not post review comments or mutate hosted services unless explicitly requested.

### Refactor planning

1. Use `codegraph_search` for the symbol if the exact name is known.
2. Use `codegraph_callers` and `codegraph_impact` to find dependencies and blast radius when those tools are exposed.
3. Use `codegraph_context`, `codegraph_trace`, and `codegraph_explore` as the core fallback when optional relationship tools are not exposed.
4. Run tests/checks through Context Mode after edits.

## Staleness policy

- CodeGraph watches and syncs indexed projects, but responses may include stale-file notices after edits.
- If a stale banner names files, read only those files for exact latest content.
- If `codegraph status <repo>` or an exposed `codegraph_status` tool shows pending sync files and graph accuracy matters, wait for sync or ask before running a local sync/index command.
- Do not re-check all CodeGraph results with grep; trust unstale graph output unless a specific missing detail requires another route.
- Use `codegraph affected -p <repo> --stdin --quiet` to find graph-inferred tests for changed files; empty output is a graph miss, not proof that no validation is needed.

## Anti-patterns

Avoid:

- Grep/find/manual source reading before CodeGraph for structural code questions.
- `codegraph_search` plus repeated `codegraph_node` calls when `codegraph_context` or `codegraph_explore` can answer in one call.
- Looping over many symbols with `codegraph_node`.
- Treating an uninitialized index as permission to skip graph-first silently.
- Using CodeGraph as a substitute for tests, type checks, lint, or exact source reads before edits.

## References

Read [`references/tool-routing.md`](references/tool-routing.md) when argument examples, worktree usage, code review chains, staleness details, or fallback examples matter.

## Maintenance

`codegraph` is a Custom Local Skill. Update it through [`../../../docs/skills/custom-local-skills-update-process.md`](../../../docs/skills/custom-local-skills-update-process.md) and preserve [`../../../docs/skills/local-skill-update-invariants.md`](../../../docs/skills/local-skill-update-invariants.md).
