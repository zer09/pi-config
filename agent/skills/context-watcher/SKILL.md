---
name: context-watcher
description: "Unified orchestration of Context Mode, RTK Token Optimizer, and codebase-memory-mcp. Use for shell commands, code review, blast radius analysis, graph-first exploration, test runs, git history, log analysis, web doc fetching, Playwright snapshots, CI/CD output, infrastructure inspection, and dependency management."
---

# Context Watcher

Context Watcher protects the context window and routes shell work, file reads, web/docs access, GitHub data, codebase-memory-mcp, RTK, worktrees, reader delegates, and large output.

Load and apply it for shell commands, tests/builds/lints, git reads, GitHub CLI work, code review, codebase orientation, refactor or blast-radius analysis, caller/callee lookup, logs, JSON/CSV/data processing, URLs/docs/API checks, browser snapshots, dependency or infrastructure inspection, worktrees, reader delegates, and resume/compaction recovery.

## Runtime contract

- Context Mode is the default for read-only shell work and any output likely over 20 lines.
- RTK is the default read-only shell prefix when available, and belongs inside Context Mode.
- codebase-memory-mcp is first for structural code exploration, review, impact, caller/callee, worktree, and graph questions when available and applicable.
- Native `read` is for files you intend to edit; `ctx_execute_file` is for analysis reads.
- Native `write` and `edit` are the only tools for file creation or modification.
- External hosted services are read-only unless the user explicitly requests the exact mutation.
- GitHub repo/PR/issue/review/workflow/release/private data uses the `gh-cli` skill and authenticated `gh` through Context Mode/RTK.
- Context7 is required before relying on memory for current third-party library/framework/API behavior.
- Fallbacks must be explicit degraded routes, never silent bypasses.
- After resume or compaction, search indexed prior state before asking the user to repeat context.

## Mandatory preflight

Before every tool call, silently route by this checklist:

1. External hosted service mutation? Includes create, update, delete, post, comment, react, assign, label, close/reopen, merge, push, publish, deploy, invite, rotate keys, quota changes, or remote jobs on GitHub/GitLab/Bitbucket, Linear, Figma, Notion, Slack, PostHog, Firebase/GCP/AWS/Azure, Stripe, Sentry, Jira, and similar services. Do it only when the user requested that exact mutation.
2. Direct Bash whitelist? If the command is not whitelisted, or is read-only output work, use Context Mode.
3. Read-only shell, tests, builds, logs, git reads, searches, or output over 20 lines? Use `ctx_batch_execute` by default, `ctx_execute` for one focused command, with `rtk` when available.
4. Counting, filtering, parsing, comparing, aggregating, or transforming? Write code in `ctx_execute` or `ctx_execute_file` and print only the compact result.
5. File read? Use native `read` only before editing that file; otherwise use `ctx_execute_file`.
6. File creation or modification? Use native `write` or `edit`; never write content through Bash or Context Mode.
7. GitHub data or operations? Load `gh-cli`, use authenticated `gh` through Context Mode/RTK, and keep private data out of browser/web fetch tools unless explicitly requested.
8. URL or web document? Use `ctx_fetch_and_index`, then `ctx_search`.
9. Third-party API/library/framework behavior? Check local installed source when relevant, then Context7; do not guess APIs, flags, versions, package names, endpoints, or fields.
10. Codebase exploration, review, test discovery, architecture, blast radius, caller/callee, data flow, or refactor analysis? Use codebase-memory-mcp first when applicable.
11. Worktree work? Use story-grouped roots and the codebase-memory project whose `root_path` matches each repo.
12. Reader delegate? Require Context Watcher, Context Mode, RTK, codebase-memory-mcp for structural code work, `gh-cli` for GitHub, mutation gates, compact findings, and no recursive delegation.
13. Context Mode, RTK, or codebase-memory-mcp failed? Follow fallback protocol with intended route, failure, fallback route, and completeness/degraded status.

## Direct Bash whitelist

Direct Bash is only for short safe local commands on this list:

```text
mkdir, mv, cp, rm, touch, chmod, git add, git commit, git push,
git checkout, git branch, git merge, cd, pwd, which, kill, pkill,
npm install, pip install, echo, printf
```

Rules:

- `git push` still requires exact explicit user instruction because it mutates GitHub.
- Before `rm -rf` on a directory, verify the path is not a symlink outside the expected tree.
- Never delete outside the project directory or `.pi/` without explicit user confirmation.
- Do not create or modify file content through shell redirection or generated commands.
- Read-only commands such as `ls`, `find`, `grep`, `rg`, `cat`, `git status`, `git log`, tests, builds, and scripts must use Context Mode.

## Tool routing table

| Intent | Required route |
|---|---|
| Multiple shell checks, tests, builds, git reads, searches | `ctx_batch_execute`, with `rtk` when available |
| Single shell check or programmed analysis | `ctx_execute` |
| Analyze a file, log, JSON, CSV, snapshot, or large source file | `ctx_execute_file` |
| Edit an existing file | native `read`, then native `edit` |
| Create or replace a file | native `write` |
| Fetch a URL or web docs | `ctx_fetch_and_index`, then `ctx_search` |
| Search indexed docs or prior session state | `ctx_search` |
| Index already-available docs | `ctx_index` |
| Third-party API/library docs | Context7 first; local installed source first when relevant |
| GitHub/private repo data | `gh-cli` plus authenticated `gh` through Context Mode/RTK |
| Code review/exploration | codebase-memory-mcp first for structural questions |
| Worktree create/use/remove | story-grouped roots plus codebase-memory project/index lifecycle |
| Reader delegation | `reader` with Context Watcher, Context Mode, RTK, codebase-memory-mcp, and mutation gates |
| Tool failure | explicit fallback protocol |

## Core tool rules

### Context Mode and RTK

Use `ctx_batch_execute` as the primary shell research tool; use `ctx_execute` for one command or analysis, `ctx_execute_file` for file/log/data analysis, `ctx_fetch_and_index` for URLs, `ctx_search` for indexed state, and `ctx_index` for already-available docs. Use management tools only for their explicit purposes; `ctx_purge` is destructive and needs explicit scope.

Use RTK as the default prefix for read-only shell operations when available, inside Context Mode, for example `ctx_execute({ language: "shell", code: "rtk git status --short --branch" })`. RTK compresses output; it does not replace sandboxing, indexing, graph-first exploration, or programmed analysis.

### Think in code

For counts, filters, diffs, parsing, aggregation, or transforms, program the analysis in Context Mode and print only the answer. Do not inspect raw logs, test output, snapshots, JSON, CSV, or large source mentally.

### codebase-memory-mcp

Start structural graph work with:

1. `codebase_memory_mcp_list_projects`.
2. Match the active repository root to a project by `root_path`.
3. If a project matches, call `codebase_memory_mcp_index_status(project=...)`; if none matches, skip status and treat the project as missing.
4. Rebuild the active repository graph with `codebase_memory_mcp_index_repository(repo_path=<active repo root>, mode="full", persistence=false)` only when indexing is authorized and useful, and when the project is missing, status is empty/stale/incomplete/failed, the branch/worktree state changed, code was edited and graph accuracy matters, or deep/semantic graph accuracy is required. Then repeat project selection and status checks.
5. `codebase_memory_mcp_get_architecture(project=...)` or `codebase_memory_mcp_get_graph_schema(project=...)`.
6. Focused tools: `codebase_memory_mcp_search_graph`, `codebase_memory_mcp_trace_path`, `codebase_memory_mcp_query_graph`, `codebase_memory_mcp_detect_changes`, `codebase_memory_mcp_search_code`, and `codebase_memory_mcp_get_code_snippet`.

Most query tools require `project`; get it from `codebase_memory_mcp_list_projects`. Use `codebase_memory_mcp_get_code_snippet` only after `codebase_memory_mcp_search_graph` finds an exact `qualified_name`. If needed indexing fails or remains incomplete, follow the fallback protocol and state that graph results are degraded. Treat `codebase_memory_mcp_delete_project(project=...)`, `codebase_memory_mcp_manage_adr(project=..., mode="update")`, `codebase_memory_mcp_ingest_traces(project=..., traces=...)`, and persistent indexing as deliberate local memory mutations.

### GitHub, Context7, worktrees, readers, fallback

- GitHub: load `gh-cli`; use authenticated `gh` through Context Mode/RTK; keep `git push`, PR creation, comments, reviews, labels, workflow dispatches, releases, and merges behind exact user instruction.
- Context7: use before current third-party API/library/framework advice or implementation; do not send secrets, personal data, or proprietary code.
- Worktrees: use `.worktrees/<story>/<feature-name>/<repo-name>/` or `.worktrees/issues/<issue-number>/<repo-name>/`; select/index the matching codebase-memory project by `root_path`; do not delete codebase-memory projects unless explicitly asked.
- Reader delegates: use only for read-only bounded investigation/review/testing/docs/consistency work; require Context Watcher routing and compact structured findings; parent owns validation, edits, commits, hosted mutations, and final reporting.
- Fallback: record intended route, failure reason, fallback route, and whether results are complete or degraded.

## Reference loading table

Load references only when their trigger applies. If a rule is needed for safe routing, keep the core rule here too.

| Reference | Load when |
|---|---|
| [`references/context-mode-routing.md`](references/context-mode-routing.md) | Context Mode tool choice, command routing, file/log/test/build output, or examples matter. |
| [`references/rtk-usage.md`](references/rtk-usage.md) | RTK flags, compression behavior, analytics, examples, or failure modes matter. |
| [`references/codebase-memory-mcp-protocol.md`](references/codebase-memory-mcp-protocol.md) | Code review, exploration, graph indexing, stale graph, project selection, Cypher, trace, or graph fallback details matter. |
| [`references/github-and-context7-routing.md`](references/github-and-context7-routing.md) | GitHub/private GitHub data or current third-party library/API docs are involved. |
| [`references/worktree-graph-protocol.md`](references/worktree-graph-protocol.md) | Creating, using, indexing, or removing worktrees. |
| [`references/reader-protocol.md`](references/reader-protocol.md) | Delegating to `reader` delegates or orchestrating parallel investigations. |
| [`references/fallback-and-troubleshooting.md`](references/fallback-and-troubleshooting.md) | Context Mode, RTK, or codebase-memory-mcp is unavailable, failing, stale, or unexpected. |
| [`references/patterns-and-quick-reference.md`](references/patterns-and-quick-reference.md) | Examples are needed for PR review, test-debug-fix, orientation, infrastructure, docs lookup, recovery, or data analysis. |
| [`references/upstream-sources.md`](references/upstream-sources.md) | Updating this skill, checking provenance, compatibility, or maintenance rules. |

## Behavioral self-check

Before committing changes to this skill, verify that base-only loading still routes: large logs to `ctx_execute_file`; tests/builds/git reads to Context Mode plus RTK; source edits to native `read`/`edit`; new files to `write`; structural review to codebase-memory-mcp first; third-party APIs to Context7; private GitHub to `gh-cli` plus authenticated `gh`; broad PR handling as read-only unless exact mutation is requested; URLs to `ctx_fetch_and_index`/`ctx_search`; worktrees to story roots plus graph lifecycle; readers with inherited routing and mutation gates; failures to explicit fallback; resumed sessions to `ctx_search(sort: "timeline")` before asking the user.

## Maintenance

`context-watcher` is a Custom Local Skill. Update it through [`../../../docs/skills/custom-local-skills-update-process.md`](../../../docs/skills/custom-local-skills-update-process.md) and preserve [`../../../docs/skills/local-skill-update-invariants.md`](../../../docs/skills/local-skill-update-invariants.md).
