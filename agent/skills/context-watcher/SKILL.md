---
name: context-watcher
description: "Unified orchestration of Context Mode, RTK Token Optimizer, and codebase-memory-mcp. Use for shell commands, code review, blast radius analysis, graph-first exploration, test runs, git history, log analysis, web doc fetching, Playwright snapshots, CI/CD output, infrastructure inspection, and dependency management."
---

# Context Watcher

Context Watcher protects the context window and enforces safe routing for shell work, file reads, web/docs access, GitHub data, codebase-memory-mcp, RTK, worktrees, reader delegates, and large output.

Use this skill for commands, codebase exploration, code review, tests, builds, logs, data analysis, web docs, GitHub operations, infrastructure inspection, dependency checks, and any task where raw output could exceed 20 lines.

## Activation triggers

Load and apply this skill for:

- Shell commands, test runs, builds, lint output, CI/CD output, and dependency inspection.
- Git history, diffs, branch status, repository inspection, and GitHub CLI work.
- Code review, codebase orientation, refactor analysis, blast-radius analysis, and caller/callee lookup.
- Log analysis, JSON/CSV processing, data aggregation, and any task requiring counts or filters.
- URL fetching, documentation lookup, API reference checks, and current third-party library behavior.
- Browser/page snapshots, accessibility trees, Playwright output, and other large structured outputs.
- Worktree creation/use/removal and multi-repo feature roots.
- Reader delegate orchestration and parallel investigation.
- Context recovery after compaction or resume.

## Compatibility

Prefer Context Mode MCP tools when available. If a platform lacks an exact tool, use the closest sandboxed equivalent while preserving the same routing rules: keep large output out of context, use RTK-style compression when available, use graph-first structural code exploration when available, and keep remote mutations behind explicit user instructions.

## Non-negotiables

- Context Mode is the default for read-only shell work and large output.
- RTK is the default read-only shell prefix when available, used inside Context Mode.
- codebase-memory-mcp is first for structural code exploration and review when available and applicable.
- Native `read` is for editing; `ctx_execute_file` is for analysis.
- Native `write` and `edit` are the only file-writing tools.
- External hosted services are read-only unless the user explicitly requests the exact mutation.
- GitHub repo/PR/issue/review/workflow/release/private data uses the `gh-cli` skill and authenticated `gh` through Context Mode/RTK.
- Context7 is required for current third-party library/framework/API docs before implementation or advice.
- Fallbacks must be explicit, not silent bypasses.

## Mandatory preflight checklist

Before any tool call, silently verify this checklist.

1. Would this mutate an external hosted service?
   - External hosted services include Figma, Linear, GitHub/GitLab/Bitbucket, Notion, Slack, PostHog, Firebase/GCP/AWS/Azure, Stripe, Sentry, Jira, and similar remote systems.
   - Mutations include create, update, delete, post, comment, react, assign, label, close/reopen, merge, push, publish, deploy, invite, rotate keys, change quotas, or run jobs/workflows that change remote state.
   - If the user did not explicitly request the exact mutation, do not perform it. Provide a draft, checklist, or read-only summary instead.

2. Is this command on the direct Bash whitelist?
   - If yes and it is safe/local, direct Bash is allowed.
   - If no, use Context Mode.

3. Is this read-only shell work?
   - Use `ctx_batch_execute` by default, or `ctx_execute` for a single focused command.
   - Prefix with `rtk` when available.

4. Could output exceed 20 lines?
   - Use Context Mode. Do not use raw Bash.

5. Are you analyzing data?
   - Write code inside `ctx_execute` or `ctx_execute_file` and print only the compact answer.
   - Do not inspect raw output mentally.

6. Is this a file read for analysis?
   - Use `ctx_execute_file`.

7. Is this a file read for editing?
   - Use native `read`, then native `edit`.

8. Is this file creation or modification?
   - Use native `write` or `edit` only.
   - Do not write files through Bash, `ctx_execute`, or `ctx_execute_file`.

9. Is this GitHub repo, PR, issue, review, comment, workflow, release, or private GitHub data?
   - Load `gh-cli`.
   - Use authenticated `gh` through Context Mode/RTK.
   - Do not fetch private GitHub data through browser/web tools unless the user explicitly requested browser inspection.

10. Is this a URL or web document?
    - Use `ctx_fetch_and_index`, then `ctx_search`.

11. Is this third-party library/framework/API usage or version-specific behavior?
    - Use local installed source first when relevant.
    - Use Context7 (`ctx7 library`, then `ctx7 docs`) before relying on memory.
    - Do not send secrets, personal data, or proprietary code to Context7.

12. Is this codebase exploration, review, blast radius, caller/callee lookup, test discovery, architecture review, or refactor analysis?
    - Use codebase-memory-mcp first for structural code questions when available and applicable.
    - Start with `list_projects`, select the project whose `root_path` matches the active repo, then check `index_status`.
    - If the project is missing, empty, stale, or incomplete, index or re-index when authorized and useful, then retry.
    - Fall back only for literals/config/non-code, unavailable tooling, unauthorized or wasteful indexing, or still-insufficient graph results.

13. Is this creating, using, or removing a worktree?
    - Use story-grouped worktree roots.
    - For each worktree repo, select or create the matching codebase-memory project by `root_path`.
    - Re-index when missing or stale before relying on graph relationships.
    - Do not delete codebase-memory projects unless the user explicitly asks for that local memory deletion.

14. Is this delegating to a `reader` delegate?
    - Require the reader delegate to load Context Watcher.
    - Keep the task read-only.
    - Require Context Mode, RTK, codebase-memory-mcp for structural code work, GitHub routing, and mutation gates when applicable.
    - Require compact structured findings and no raw logs, secrets, or broad dumps.
    - Do not ask the delegate to route or recommend other delegates.

15. Did Context Mode, RTK, or codebase-memory-mcp fail?
    - Follow the fallback protocol.
    - Record or summarize the intended route, failure, fallback route, and degraded status.

## Direct Bash whitelist

Direct Bash is only for short safe commands on this whitelist:

```text
mkdir, mv, cp, rm, touch, chmod, git add, git commit, git push,
git checkout, git branch, git merge, cd, pwd, which, kill, pkill,
npm install, pip install, echo, printf
```

Rules:

- `git push` still requires exact explicit user instruction because it mutates GitHub.
- Before `rm -rf` on a directory, verify the path is not a symlink outside the expected tree.
- Never delete outside the project directory or `.pi/` without explicit user confirmation.
- The whitelist allows filesystem operations; it does not allow writing file content through shell redirection or generated commands. Use native `write`/`edit` for content-bearing file creation or modification.
- Read-only commands such as `ls`, `find`, `grep`, `rg`, `cat`, `git status`, `git log`, tests, builds, and scripts must use Context Mode.

## Tool routing table

| Intent | Required route |
|---|---|
| Multiple shell checks, tests, builds, git reads, searches | `ctx_batch_execute` with `rtk` prefix when available |
| Single shell check or programmed analysis | `ctx_execute` |
| Analyze a file, log, JSON, CSV, snapshot, or large source file | `ctx_execute_file` |
| Edit an existing file | native `read` for the edited file, then native `edit` |
| Create or replace a file | native `write` |
| Fetch a URL or web docs | `ctx_fetch_and_index`, then `ctx_search` |
| Search indexed docs or prior session state | `ctx_search` |
| Index already-available docs | `ctx_index` |
| Third-party API/library docs | Context7 first; local installed source first when relevant |
| GitHub/private repo data | `gh-cli` skill plus authenticated `gh` through Context Mode/RTK |
| Code review/exploration | codebase-memory-mcp first for structural code questions |
| Worktree create/use/remove | story-grouped roots plus codebase-memory project/index lifecycle |
| Reader delegation | Pi `reader` delegate with Context Watcher, Context Mode, RTK, codebase-memory-mcp, and mutation gates |
| Context Mode/RTK/codebase-memory-mcp failure | explicit fallback protocol |

## Context Mode core tools

- `ctx_batch_execute`: primary shell research tool. Run commands, index output, and search in one call.
- `ctx_execute`: one sandboxed command or programmed analysis.
- `ctx_execute_file`: analyze a file in the sandbox.
- `ctx_fetch_and_index`: fetch and index URL content.
- `ctx_index`: index documentation or knowledge content already available.
- `ctx_search`: search indexed content. Batch all questions in one call.
- `ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`: management commands. Purge is destructive and needs explicit scope.

## Think in code

When you need to count, filter, compare, aggregate, parse, or transform, write code in `ctx_execute` or `ctx_execute_file`. Print only the result.

Do not read raw logs, command dumps, test output, snapshots, JSON, CSV, or large source files into context for mental processing.

## RTK core rule

Use RTK as the default prefix for read-only shell operations when available:

```text
ctx_execute({ language: "shell", code: "rtk git status --short --branch" })
```

RTK belongs inside Context Mode. It compresses output; it does not replace sandboxing, indexing, graph-first exploration, or programmed analysis.

## codebase-memory-mcp core rule

Use codebase-memory-mcp for structural codebase work before grep/find/manual file reading.

Default sequence:

1. `codebase_memory_mcp_list_projects`.
2. Select the project whose `root_path` matches the active repository.
3. `codebase_memory_mcp_index_status(project=...)`.
4. Use `get_architecture` or `get_graph_schema` for orientation.
5. Use `search_graph`, `trace_path`, `query_graph`, `detect_changes`, and `get_code_snippet` for focused evidence.
6. Re-index with `index_repository` only when missing, stale, incomplete, authorized, and useful.

Most codebase-memory query tools require `project`; get it from `list_projects` and do not guess. Use `get_code_snippet` only after `search_graph` finds an exact `qualified_name`. Treat `delete_project`, `manage_adr(mode="update")`, `ingest_traces`, and persistent indexing as deliberate local memory mutations.

## GitHub core rule

For GitHub work:

- Load `gh-cli`.
- Use authenticated `gh` through Context Mode/RTK.
- Keep private GitHub data out of browser/web fetch tools unless the user explicitly requests browser inspection.
- Treat `git push`, PR creation, comments, reviews, labels, workflow dispatches, releases, and merges as external hosted service mutations requiring exact explicit user instruction.

## Context7 core rule

For current third-party library/framework/API docs, use Context7 before relying on memory. Do not guess APIs, flags, versions, or package names. Do not send secrets, personal data, or proprietary code to Context7.

## Worktree core rule

Use story-grouped worktree roots:

```text
.worktrees/<story>/<feature-name>/<repo-name>/
.worktrees/issues/<issue-number>/<repo-name>/
```

For active worktrees, use the codebase-memory project whose `root_path` matches the repo. If missing or stale, index the worktree repo when authorized and useful, then query that project. For related multi-repo work, index each repo and use cross-repo intelligence only when the task requires it. When removing a worktree group, verify deletion safety and do not delete codebase-memory projects unless the user explicitly requests that local memory cleanup.

## Reader delegate core rule

Use `reader` delegates only for isolated tool-grounded investigation, review, testing, documentation research, consistency checks, or bounded parallel work.

Reader delegates must load Context Watcher, use Context Mode and RTK, use codebase-memory-mcp for structural code work when applicable, use `gh-cli` for GitHub data, preserve hosted-service mutation gates, and return compact structured findings only. Do not ask reader delegates to route or recommend other delegates. The parent remains responsible for orchestration, final decisions, validation, diffs, commits, and user-facing reporting.

## Fallback core rule

Fallbacks are allowed only as explicit degraded routes. Record or summarize:

- Intended route.
- Failure reason.
- Fallback route.
- Whether results are complete or degraded.

Do not silently bypass Context Mode, RTK, codebase-memory-mcp, GitHub routing, file-writing policy, or hosted-service mutation gates.

## Reference loading table

Load references only when their trigger applies. If a rule is needed for safe routing, keep the core rule in this file too.

| Reference | Load when |
|---|---|
| [`references/context-mode-routing.md`](references/context-mode-routing.md) | Command routing is non-trivial, Context Mode tool choice is unclear, file/log/test/build output is involved, or route examples are needed. |
| [`references/rtk-usage.md`](references/rtk-usage.md) | RTK flags, compression behavior, analytics, examples, or failure modes matter. |
| [`references/codebase-memory-mcp-protocol.md`](references/codebase-memory-mcp-protocol.md) | Code review, codebase exploration, graph indexing, stale graph, project selection, Cypher, trace, or graph fallback details matter. |
| [`references/github-and-context7-routing.md`](references/github-and-context7-routing.md) | GitHub/private GitHub data or current third-party library/API docs are involved. |
| [`references/worktree-graph-protocol.md`](references/worktree-graph-protocol.md) | Creating, using, indexing, or removing worktrees. |
| [`references/reader-protocol.md`](references/reader-protocol.md) | Delegating to Pi `reader` delegates or orchestrating parallel investigations. |
| [`references/fallback-and-troubleshooting.md`](references/fallback-and-troubleshooting.md) | Context Mode, RTK, or codebase-memory-mcp is unavailable, failing, stale, or producing unexpected output. |
| [`references/patterns-and-quick-reference.md`](references/patterns-and-quick-reference.md) | Examples are needed for PR review, test-debug-fix, orientation, infrastructure inspection, docs lookup, recovery, or data analysis. |
| [`references/upstream-sources.md`](references/upstream-sources.md) | Updating this skill, checking provenance, compatibility, or maintenance rules. |

## Behavioral simulation checklist

Before committing changes to this skill, verify an agent that reads only this file still routes these scenarios safely:

- Large log inspection uses `ctx_execute_file`.
- Tests/builds use Context Mode with RTK when available.
- Source edits use native `read` plus native `edit`.
- Code review uses codebase-memory-mcp first for structural code questions.
- Third-party API work uses Context7 first.
- Private GitHub PRs use `gh-cli` and authenticated `gh` through Context Mode/RTK.
- Broad PR handling remains read-only unless the user explicitly asks to comment, push, merge, or otherwise mutate.
- URLs use `ctx_fetch_and_index` then `ctx_search`.
- Worktrees use story-grouped roots and codebase-memory project/index lifecycle.
- Reader delegates inherit Context Watcher, Context Mode, RTK, codebase-memory-mcp, `gh-cli`, and mutation gates.
- Context Mode, RTK, or codebase-memory-mcp failures use explicit fallback.
- Resumed sessions search indexed state before asking the user to repeat context.

## Maintenance

`context-watcher` is a Custom Local Skill. Update it through [`../../../docs/skills/custom-local-skills-update-process.md`](../../../docs/skills/custom-local-skills-update-process.md) and preserve [`../../../docs/skills/local-skill-update-invariants.md`](../../../docs/skills/local-skill-update-invariants.md).
