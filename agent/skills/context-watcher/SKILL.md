---
name: context-watcher
description: "Unified orchestration of Context Mode, RTK Token Optimizer, and Code Review Graph. Use for shell commands, code review, blast radius analysis, graph-first exploration, test runs, git history, log analysis, web doc fetching, Playwright snapshots, CI/CD output, infrastructure inspection, and dependency management."
---

# Context Watcher

Context Watcher protects the context window and enforces safe routing for shell work, file reads, web/docs access, GitHub data, Code Review Graph, RTK, worktrees, sub-agents, and large output.

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
- Sub-agent orchestration and parallel investigation.
- Context recovery after compaction or resume.

## Compatibility

Prefer Context Mode MCP tools when available. If a platform lacks an exact tool, use the closest sandboxed equivalent while preserving the same routing rules: keep large output out of context, use RTK-style compression when available, use graph-first exploration for supported code, and keep remote mutations behind explicit user instructions.

## Non-negotiables

- Context Mode is the default for read-only shell work and large output.
- RTK is the default read-only shell prefix when available, used inside Context Mode.
- Code Review Graph is first for supported code exploration and review.
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
    - Use Code Review Graph first for supported languages.
    - If graph is missing, empty, stale, or incomplete, build/update when authorized and useful, then retry.
    - Fall back only when unsupported, unauthorized, wasteful, or still insufficient.

13. Is this creating, using, or removing a worktree?
    - Use story-grouped worktree roots.
    - Prefer daemon-backed graph roots for active work.
    - Remove daemon watch entries when removing worktree groups.

14. Is this delegating to a sub-agent?
    - Require the sub-agent to load Context Watcher.
    - Keep default mode read-only.
    - Require compact structured findings and no raw logs, secrets, or broad dumps.

15. Did Context Mode, RTK, or Graph fail?
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
| Code review/exploration in supported languages | Code Review Graph first |
| Worktree create/use/remove | story-grouped roots plus graph daemon/watch protocol |
| Sub-agent delegation | Pi sub-agent with Context Watcher, Context Mode, RTK, Graph, and mutation gates |
| Context Mode/RTK/Graph failure | explicit fallback protocol |

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

## Code Review Graph core rule

For supported languages, graph-first is mandatory for codebase exploration and review tasks.

Supported languages: Python, TypeScript, JavaScript, Vue, Go, Rust, Java, C#, Ruby, Kotlin, Swift, PHP, Solidity, C/C++.

Use graph stats, semantic search, callers/callees, impact radius, review context, flows, communities, hub nodes, and architecture overview before broad grep/find/manual reading. If graph is unavailable or stale, build/update when authorized and appropriate, then retry.

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

For active roots, prefer daemon-backed Code Review Graph. Build/update the containing root when authorized and useful, add it to the daemon watch list, and query the graph instead of repeatedly rebuilding. When removing the group, remove the watch entry and verify deletion safety.

## Sub-agent core rule

Use sub-agents only for isolated tool-grounded investigation, review, testing, documentation research, consistency checks, or bounded parallel work.

Sub-agents must load Context Watcher, use Context Mode and RTK, use Code Review Graph first when applicable, use `gh-cli` for GitHub data, preserve hosted-service mutation gates, and return compact structured findings only. The parent remains responsible for final decisions, validation, diffs, commits, and user-facing reporting.

## Fallback core rule

Fallbacks are allowed only as explicit degraded routes. Record or summarize:

- Intended route.
- Failure reason.
- Fallback route.
- Whether results are complete or degraded.

Do not silently bypass Context Mode, RTK, Code Review Graph, GitHub routing, file-writing policy, or hosted-service mutation gates.

## Reference loading table

Load references only when their trigger applies. If a rule is needed for safe routing, keep the core rule in this file too.

| Reference | Load when |
|---|---|
| [`references/context-mode-routing.md`](references/context-mode-routing.md) | Command routing is non-trivial, Context Mode tool choice is unclear, file/log/test/build output is involved, or route examples are needed. |
| [`references/rtk-usage.md`](references/rtk-usage.md) | RTK flags, compression behavior, analytics, examples, or failure modes matter. |
| [`references/code-review-graph-protocol.md`](references/code-review-graph-protocol.md) | Code review, codebase exploration, graph build/update, stale graph, graph daemon, or graph fallback details matter. |
| [`references/github-and-context7-routing.md`](references/github-and-context7-routing.md) | GitHub/private GitHub data or current third-party library/API docs are involved. |
| [`references/worktree-graph-protocol.md`](references/worktree-graph-protocol.md) | Creating, using, watching, or removing worktrees. |
| [`references/subagent-protocol.md`](references/subagent-protocol.md) | Delegating to Pi sub-agents or orchestrating parallel investigations. |
| [`references/fallback-and-troubleshooting.md`](references/fallback-and-troubleshooting.md) | Context Mode, RTK, or Code Review Graph is unavailable, failing, stale, or producing unexpected output. |
| [`references/patterns-and-quick-reference.md`](references/patterns-and-quick-reference.md) | Examples are needed for PR review, test-debug-fix, orientation, infrastructure inspection, docs lookup, recovery, or data analysis. |
| [`references/upstream-sources.md`](references/upstream-sources.md) | Updating this skill, checking provenance, compatibility, or maintenance rules. |

## Behavioral simulation checklist

Before committing changes to this skill, verify an agent that reads only this file still routes these scenarios safely:

- Large log inspection uses `ctx_execute_file`.
- Tests/builds use Context Mode with RTK when available.
- Source edits use native `read` plus native `edit`.
- Code review uses Code Review Graph first.
- Third-party API work uses Context7 first.
- Private GitHub PRs use `gh-cli` and authenticated `gh` through Context Mode/RTK.
- Broad PR handling remains read-only unless the user explicitly asks to comment, push, merge, or otherwise mutate.
- URLs use `ctx_fetch_and_index` then `ctx_search`.
- Worktrees use story-grouped roots and graph daemon/watch rules.
- Sub-agents inherit Context Watcher, Context Mode, RTK, Graph, `gh-cli`, and mutation gates.
- Context Mode, RTK, or Graph failures use explicit fallback.
- Resumed sessions search indexed state before asking the user to repeat context.

## Maintenance

`context-watcher` is a Custom Local Skill. Update it through [`../../../docs/skills/custom-local-skills-update-process.md`](../../../docs/skills/custom-local-skills-update-process.md) and preserve [`../../../docs/skills/local-skill-update-invariants.md`](../../../docs/skills/local-skill-update-invariants.md).
