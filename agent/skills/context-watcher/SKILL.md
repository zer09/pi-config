---
name: context-watcher
version: 1.1.0
description: >
  Unified orchestration of Context Mode, RTK Token Optimizer, and Code Review Graph. Context Mode
  gatekeeps all execution -- RTK commands and graph queries run inside its sandbox for 60-99% token
  savings with structural codebase awareness. Use for: shell commands, code review, blast radius
  analysis, graph-first exploration, test runs, git history, log analysis, web doc fetching,
  Playwright snapshots, CI/CD output, infrastructure inspection, and dependency management.
  Errors inside the sandbox trigger automatic fallback to direct execution with logging to
  ~/.pi/logs/. Works with Claude Code, ChatGPT/Codex, Gemini CLI, Cursor, Windsurf, Cline,
  VS Code Copilot, OpenCode, MiniMax, and any MCP-compatible AI agent.
triggers:
 - "set up context watcher"
 - "install context-watcher"
 - "reduce token usage"
 - "optimize context window"
 - "run command with rtk in context mode"
 - "review code changes with graph"
 - "blast radius analysis"
 - "sandbox tool calls"
 - "context mode rtk setup"
 - "code review graph in context mode"
 - "rtk not working inside context mode"
 - "run tests with token savings"
 - "analyze logs efficiently"
 - "fetch and index documentation"
 - "compact shell output"
 - "review my PR with graph"
 - "set up hooks for AI agent"
 - "context-watcher troubleshooting"
compatibility:
  requires:
    - context-mode (MCP server via npx or global install)
    - rtk (Rust binary via brew or cargo)
    - code-review-graph (Python package via pip or Claude plugin)
  optional:
    - uv (for code-review-graph MCP server)
    - sentence-transformers (for semantic search in code-review-graph)
  platforms:
    - Claude Code
    - ChatGPT / Codex
    - Gemini CLI
    - Cursor
    - Windsurf
    - Cline / Roo Code
    - VS Code Copilot
    - OpenCode
    - MiniMax
    - Any MCP-compatible AI agent
---

# Context Watcher

Context Watcher is the unified orchestration layer that makes **Context Mode**, **RTK Token Optimizer**, and **Code Review Graph** work together seamlessly. Context Mode is the gatekeeper -- every RTK command and every Code Review Graph query runs inside its sandbox so raw output never floods your context window. When something fails inside the sandbox, the command falls back to direct execution and the error is logged to `~/.pi/logs/` for post-mortem debugging.

The result: structural codebase awareness (graph), compressed CLI output (RTK), and sandboxed execution (Context Mode) -- all in one skill, across any AI agent.

## Mandatory Context7 Docs Preflight

Before implementing or advising on third-party library, framework, SDK, or API usage, ask: do I need current external documentation?

If yes, use Context7 first: resolve the library with `ctx7 library <name> <query>`, then fetch docs with `ctx7 docs <libraryId> <query>`. Use the user's intent as the query, but never include secrets, personal data, credentials, or proprietary code.

Routing rules:

1. External hosted service mutation gate wins before all tool routing: default read-only unless the user explicitly instructed the exact mutation.
2. Local installed source wins for behavior of packages installed on this machine.
3. Context7 wins for current third-party API signatures, framework docs, version-specific behavior, and implementation examples.
4. `gh-cli` wins for GitHub repositories, pull requests, issues, reviews, comments, workflows, releases, or any private GitHub data that needs authenticated access.
5. pi-web-access wins for broad web search, public GitHub repository research, articles, YouTube/video content, or when Context7 has no good match.
6. Context Mode still gatekeeps shell execution and large output; run `ctx7` and `gh` CLI commands through Context Mode with RTK when command output may be large.

## Mandatory External Hosted Service Mutation Gate

Before calling any MCP tool, CLI, API, SDK, browser action, webhook, or workflow that can change remote vendor/org state, ask: did the user explicitly request this exact mutation?

External hosted services include Figma, Linear, GitHub/GitLab/Bitbucket, Notion, Slack, PostHog, Firebase/GCP/AWS/Azure, Stripe, Sentry, Jira, and similar remote SaaS/cloud systems.

Allowed without special permission: fetch, list, search, query, download, inspect, compare, and diff.

Requires explicit user instruction: create, update, delete, post, comment, react, assign, label, close/reopen, merge, push, publish, deploy, invite, rotate keys, change quotas, or run jobs/workflows that change remote state.

If the user did not explicitly ask for the mutation, do not perform it. Provide a draft, checklist, or command for the user instead. If the user explicitly asks, for example "push that commit", "post this PR comment", "create the Linear issue", or "deploy now", the mutation is allowed unless another safety rule requires confirmation.

## Mandatory GitHub CLI Preflight

Before interacting with a GitHub repository, pull request, issue, review, comment, workflow, release, or private GitHub data, ask: does this require authenticated GitHub access or write capability?

If yes, load and follow `~/.pi/agent/skills/gh-cli/SKILL.md`, then use authenticated `gh` CLI through Context Mode/RTK. Examples: `rtk gh pr view <number> --comments`, `rtk gh issue view <number>`, `rtk gh pr comment <number> --body ...`, `rtk gh pr create ...`, or `rtk gh api ...`.

GitHub writes such as `git push`, PR creation, PR comments, reviews, merges, labels, workflow dispatches, and releases are external hosted service mutations. Perform them only when the user explicitly requests that exact write.

Do not open or fetch private GitHub URLs in browser/web tools to get data. Browser sessions and web fetch tools may not share the authenticated `gh` session. Use browser/web tools only for visual inspection of public pages or when the user explicitly requests browser inspection.

## Mandatory Graph-First Preflight

Before using grep, find, read, or broad file inspection for codebase exploration, code review, blast-radius analysis, caller/callee lookup, test discovery, architecture review, or refactor analysis, ask: can Code Review Graph answer this first?

If yes, use Code Review Graph first. Fall back to Context Mode + RTK file/search commands only when the graph is unavailable, empty, stale, unsupported for the language, or insufficient for the specific question.

An empty, stale, or incomplete graph is not itself a Code Review Graph error. Treat it as a graph maintenance condition. If build/update is authorized and appropriate for the task, build or update the graph, then retry the graph query before using Context Mode fallback. Use Context Mode fallback without rebuilding only when the task is explicitly read-only, build/update is not authorized, building would be wasteful for a one-off check, the language is unsupported, or the graph remains insufficient after build/update.

## Mandatory Sub-agent Protocol

Sub-agents are scoped Pi child processes used to protect the parent context. They must follow the same Context Watcher routing as the parent agent.

Rules:

1. Sub-agents must read `~/.pi/agent/AGENTS.md` and this `context-watcher/SKILL.md` before tool use.
2. Sub-agents must keep Context Mode, RTK, pi-mcp-adapter, and Code Review Graph available. Do not disable normal Pi extensions by default.
3. Sub-agents must use Context Mode for shell/read-only commands, tests, logs, builds, git output, API calls, and any output that may exceed 20 lines.
4. Sub-agents must use Code Review Graph first for supported code exploration, code review, blast-radius analysis, caller/callee lookup, test discovery, architecture review, and refactor analysis.
5. Sub-agents must use the `gh-cli` skill and authenticated `gh` CLI through Context Mode/RTK for GitHub repo/PR/issue/review/comment/workflow/release/private data. Do not use browser/web tools for private GitHub data unless the parent explicitly requests browser inspection.
6. Sub-agents must treat external hosted services as read-only unless the parent task explicitly authorizes the exact mutation. Without explicit authorization, return a draft/checklist instead of mutating Figma, Linear, GitHub, cloud services, or similar remote systems.
7. Sub-agents must run in isolated persistent sessions under `~/.pi/agent/subagent-sessions/<workstream>/<agent>/` and normally use `--continue`. First run creates a session; later runs resume the same workstream memory.
8. Sub-agents must return compact structured findings only. Do not return raw logs, full diffs, broad grep output, browser snapshots, test dumps, secrets, or environment variable values to the parent.
9. Default sub-agent mode is read-only. Mutating commands and file edits require explicit write-mode authorization from the parent.
10. Recursive sub-agent calls are disabled by default. Enable only when explicitly needed and bounded.

## Mandatory Worktree Graph Protocol

When creating feature worktrees, use a story-grouped root so Code Review Graph can index related repos in one graph database:

```text
.worktrees/<story>/<feature-name>/<repo-name>/
```

Examples:

```text
.worktrees/google-sso/feature-a/webapp/
.worktrees/google-sso/feature-a/admin-dashboard/
.worktrees/google-sso/feature-b/core-frontend/
```

For standalone fixes, hotfixes, and issue work, use the common `issues` story to avoid cluttering the top-level worktree directory:

```text
.worktrees/issues/<issue-number>/<repo-name>/
```

Examples:

```text
.worktrees/issues/1234/webapp/
.worktrees/issues/bug-login-timeout/api/
```

For repo-scoped or grouped-root work:

1. Prefer daemon-backed graphs for active work. Before the first graph query for a repo, story root, feature root, or issue root, check whether the Code Review Graph daemon is running.
2. If the daemon is not running, start it before doing graph work unless the task is a one-off read-only check where starting a watcher would be wasteful.
3. Check whether the containing root has `.code-review-graph/graph.db`. If the database is missing, build the graph for that root and add that root to the daemon watch list so future turns can query instead of rebuilding.
4. If the database exists but the containing root is not registered or watched by the daemon, add that root to the daemon watch list. The goal is: active roots with graph databases should be daemon-maintained.
5. Build or update Code Review Graph at the root that contains all relevant code. If sub repos are nested under a root repo, story root, feature root, or issue root, treat them as part of that containing root graph database.
6. If graph stats or queries show the graph is empty, stale, or incomplete, do not call that an error and do not immediately abandon graph-first. If build/update is authorized and appropriate, build/update the graph at the containing root and retry the graph query. Only fall back to Context Mode without rebuilding when the task is read-only, build/update is not authorized, building would be wasteful for a one-off check, the language is unsupported, or the graph remains insufficient after build/update.
7. Do not require every nested repo to be registered separately with the daemon. Register/watch only the containing story, feature, issue, or repo root when daemon watching is useful.
8. Daemon status is not graph availability. If `code-review-graph daemon status` reports stopped, unavailable, or 0 registered repos, do not treat that as permission to skip Code Review Graph. Ensure the daemon is running when useful, then build/query the current repo root or containing worktree root.
9. For grouped worktrees, add the containing story, feature, or issue root to the Code Review Graph daemon watch list after creating the worktree group.
10. Re-check daemon status periodically during long work, but do not check before every query.
11. When removing a worktree group, remove the containing story, feature, or issue root from the daemon watch list too.
12. Prefer scoped graph queries using `repo_root: ".worktrees/<story>"`, `repo_root: ".worktrees/<story>/<feature-name>"`, `repo_root: ".worktrees/issues/<issue-number>"`, or the current containing root. Avoid global `cross_repo_search` for repo-scoped, story-scoped, feature-scoped, or issue-scoped work unless explicitly requested.
13. For Git diff/change detection inside grouped worktrees, collect changed files per nested repo and map them to containing-root-relative paths before using graph impact tools.

Daemon commands:

```bash
code-review-graph daemon add .worktrees/<story> --alias <story>
code-review-graph daemon add .worktrees/<story>/<feature-name> --alias <story>-<feature-name>
code-review-graph daemon add .worktrees/issues/<issue-number> --alias issue-<issue-number>
code-review-graph daemon status
code-review-graph daemon remove <alias>
```

---

## Architecture Overview

```
+-----------------------------------------------------------+
|                      AI Agent                             |
|  (Claude, ChatGPT, Gemini, Cursor, Windsurf, MiniMax)    |
+-----------------------------+-----------------------------+
                              | Command / Query
                              v
+-----------------------------------------------------------+
|              CONTEXT MODE (Gatekeeper)                    |
|  ctx_execute . ctx_execute_file . ctx_batch_execute       |
|  ctx_fetch_and_index . ctx_index . ctx_search             |
|                                                           |
|  +---------------------+   +---------------------------+  |
|  |  RTK Token          |   |  Code Review Graph        |  |
|  |  Optimizer          |   |  (MCP Tools)              |  |
|  |                     |   |                           |  |
|  |  rtk git status     |   |  detect_changes           |  |
|  |  rtk cargo test     |   |  get_impact_radius        |  |
|  |  rtk pytest         |   |  get_review_context       |  |
|  |  rtk ls / grep      |   |  query_graph              |  |
|  |  rtk gh pr view     |   |  semantic_search_nodes    |  |
|  +---------------------+   +---------------------------+  |
|                                                           |
|  Sandbox: raw output never enters context window          |
|  SQLite FTS5: session continuity after compaction         |
+-----------------------------+-----------------------------+
                              | Compressed summary only
                              v
                  Agent Context Window
                  (~1-5 KB instead of ~300+ KB)
```

---

## Think in Code -- MANDATORY

When you need to analyze, count, filter, compare, search, parse, transform, or process data: **write code** that does the work via `ctx_execute(language, code)` and `console.log()` only the answer. Do NOT read raw data into context to process mentally. Your role is to PROGRAM the analysis, not to COMPUTE it.

Write robust, pure JavaScript (or Python/shell as needed) -- no npm dependencies, only built-ins (`fs`, `path`, `child_process`). Always use `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls and saves 100x context.

```
# WRONG: reading a 500-line log into context to count errors mentally
ctx_execute_file({ path: "app.log" })
# then scanning the text in your head...

# RIGHT: programmatic analysis, only the answer enters context
ctx_execute({
  language: "javascript",
  code: "const fs=require('fs'); const lines=fs.readFileSync('app.log','utf8').split('\\n'); const errors=lines.filter(l=>l.includes('ERROR')); console.log(`${errors.length} errors found`); errors.slice(0,5).forEach(e=>console.log(e));"
})
```

---

## BLOCKED Commands -- FORBIDDEN

These commands are forbidden in direct bash. They dump raw output into your context window and bypass the sandbox.

### curl / wget -- FORBIDDEN

Do NOT use `curl` or `wget` in any bash command. Pi's hooks block these at the tool level on platforms that support hooks.

Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP -- FORBIDDEN

Do NOT run inline HTTP calls via `node -e "fetch(..."`, `python -c "requests.get(..."`, or similar patterns. They bypass the sandbox and flood context.

Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox -- only stdout enters context

### Direct web fetching -- FORBIDDEN

Do NOT use any direct URL fetching tool that dumps raw HTML into context. Raw HTML can exceed 100 KB.

Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

---

## The Gatekeeper: How Context Mode Orchestrates Everything

Context Mode is the mandatory routing layer. Every RTK command and every Code Review Graph query passes through it. This prevents raw output from flooding the context window.

### Mandatory Rule

Default to Context Mode for ALL read-only commands. Only use direct Bash for guaranteed-small-output mutations.

### Direct Bash Whitelist (safe without Context Mode)

These commands produce minimal output and are safe to run directly:

- **File mutations**: `mkdir`, `mv`, `cp`, `rm`, `touch`, `chmod`
- **Git writes**: `git add`, `git commit`, `git push`, `git checkout`, `git branch`, `git merge`
- **Navigation**: `cd`, `pwd`, `which`
- **Process control**: `kill`, `pkill`
- **Package management**: `npm install`, `pip install`
- **Simple output**: `echo`, `printf`

The external hosted service mutation gate applies before this whitelist. For example, `git push` is direct-bash eligible only when the user explicitly requested that exact remote write.

**Everything else runs through Context Mode.** This includes all RTK commands, all Code Review Graph queries, all CLI tools, all test runners, all build tools, all infrastructure commands.

### REDIRECTED Tools -- Use Sandbox Equivalents

**bash (>20 lines output)**: bash is ONLY for the whitelist above and other short-output commands. For everything else, use `ctx_batch_execute(commands, queries)` or `ctx_execute(language: "shell", code: "...")`.

**read (for analysis)**: If you are reading a file to **edit** it, direct read is correct (edit needs content in context). If you are reading to **analyze, explore, or summarize**, use `ctx_execute_file(path, language, code)` instead.

**grep / find (large results)**: Search results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run in sandbox.

### Decision Tree

```
About to run a command?
|
+-- Would it mutate an external hosted service (Figma, Linear, GitHub, cloud/SaaS, etc.)?
|   +-- No explicit user instruction for this exact mutation? Do not call it; provide a draft/checklist instead
|   +-- Explicit user instruction present? Allowed; continue with normal safety and tool routing
|
+-- On the Bash whitelist (mutations, git writes, navigation, echo)?
|   +-- Use direct Bash
|
+-- Is it a read-only command (git log, ls, grep, test, build, lint)?
|   +-- Wrap with RTK, execute inside ctx_execute
|   |   Example: ctx_execute({ command: "rtk git status" })
|   |
|   +-- Did ctx_execute succeed?
|   |   +-- Use the compressed result
|   |
|   +-- Did ctx_execute fail?
|       +-- FALLBACK: Run "rtk git status" directly in Bash
|       +-- LOG ERROR: append to ~/.pi/logs/context-watcher.log
|
+-- Is it GitHub repo/PR/issue/review/comment/workflow/release/private data?
|   +-- Load and follow the gh-cli skill
|   +-- Use authenticated gh CLI through Context Mode/RTK: rtk gh ...
|   +-- Do not use browser/web fetch for private GitHub data unless explicitly requested
|
+-- Is it third-party library/framework/API usage?
|   +-- Use local installed source if answering installed behavior
|   +-- Otherwise use Context7 docs FIRST for current docs
|   +-- Use pi-web-access for broad web/public GitHub/article/video search or Context7 misses
|
+-- Is it a codebase exploration or review task?
|   +-- Use Code Review Graph tools FIRST (inside Context Mode)
|   |
|   +-- Did the graph tool succeed?
|   |   +-- Use the structural result
|   |
|   +-- Did the graph tool fail?
|       +-- FALLBACK: Run the graph command directly
|       +-- LOG ERROR
|       +-- Fall back to rtk grep / rtk find
|
+-- Is it a web fetch or API call?
|   +-- Use ctx_fetch_and_index -> ctx_search
|
+-- Is it a Playwright/browser operation?
|   +-- ALWAYS use filename parameter -> ctx_index(path) -> ctx_search
|
+-- Is it a large file read for analysis (not editing)?
    +-- Use ctx_execute_file
```

---

## RTK Inside Context Mode

RTK compresses shell output by 60-90%. Running RTK inside Context Mode stacks the savings: RTK compresses the raw output, and Context Mode sandboxes it so only a summary enters context.

### How to Run RTK Commands Inside Context Mode

Always prefix read-only commands with `rtk` inside `ctx_execute`:

```
ctx_execute({ language: "shell", code: "rtk git status" })
ctx_execute({ language: "shell", code: "rtk git log -n 10" })
ctx_execute({ language: "shell", code: "rtk cargo test" })
ctx_execute({ language: "shell", code: "rtk pytest" })
ctx_execute({ language: "shell", code: "rtk ls src/" })
ctx_execute({ language: "shell", code: "rtk grep 'pattern' src/" })
ctx_execute({ language: "shell", code: "rtk gh pr view 42" })
ctx_execute({ language: "shell", code: "rtk docker ps" })
ctx_execute({ language: "shell", code: "rtk tsc" })
ctx_execute({ language: "shell", code: "rtk vitest run" })
```

### Batch Operations

Use `ctx_batch_execute` for multiple RTK commands in a single context entry. The optional `queries` parameter auto-searches the indexed output:

```
ctx_batch_execute({
  commands: [
    { label: "Git status", command: "rtk git status" },
    { label: "Recent commits", command: "rtk git log -n 10" },
    { label: "Current diff", command: "rtk git diff" }
  ],
  queries: ["uncommitted changes", "recent feature work"]
})
```

Labels become FTS5 chunk titles -- descriptive labels improve search accuracy.

### RTK Command Chaining Inside Context Mode

Even within command chains, always use the `rtk` prefix:

```
ctx_execute({
  language: "shell",
  code: "rtk git add . && rtk git commit -m 'fix: resolve parse error' && rtk git push"
})
```

### RTK Token Savings Reference

| Category         | Commands                                        | Typical Savings |
| ---------------- | ----------------------------------------------- | --------------- |
| Tests            | vitest, playwright, cargo test, pytest, rspec   | 60-99%          |
| Build            | next build, tsc, lint, prettier                 | 70-87%          |
| Git              | status, log, diff, add, commit                  | 59-80%          |
| GitHub CLI       | gh pr, gh run, gh issue                         | 26-87%          |
| Package Managers | pnpm, npm, pip, bundle install                  | 70-90%          |
| Files            | ls, read, grep, find                            | 60-75%          |
| Infrastructure   | docker, docker compose, kubectl                 | 85%             |
| Linters          | ruff check, golangci-lint, rubocop, cargo clippy| 60-85%          |

### RTK Global Flags

```
rtk -u <command>      # --ultra-compact: maximum compression
rtk -v <command>      # --verbose: for debugging (stack: -v, -vv, -vvv)
rtk read <file> -l aggressive   # Signatures only (strips function bodies)
rtk smart <file>      # 2-line heuristic code summary
```

### RTK Analytics (Inside Context Mode)

```
ctx_execute({ language: "shell", code: "rtk gain" })
ctx_execute({ language: "shell", code: "rtk gain --graph" })
ctx_execute({ language: "shell", code: "rtk gain --history" })
ctx_execute({ language: "shell", code: "rtk gain --daily" })
ctx_execute({ language: "shell", code: "rtk discover" })
ctx_execute({ language: "shell", code: "rtk session" })
```

---

## Code Review Graph Inside Context Mode

Code Review Graph builds a persistent structural map of your codebase using Tree-sitter. When running inside Context Mode, the graph query results are sandboxed -- only compact summaries enter your context window.

### Supported Languages

Python, TypeScript, JavaScript, Vue, Go, Rust, Java, C#, Ruby, Kotlin, Swift, PHP, Solidity, C/C++.

If the repository language is supported, graph-first workflow is mandatory. If unsupported, fall back to RTK-based exploration (`rtk grep`, `rtk find`, `rtk read`).

### Initial Graph Build

```
ctx_execute({ language: "shell", code: "code-review-graph build" })
```

Or via Claude Code plugin: `/code-review-graph:build-graph`

Or install as plugin: `claude plugin marketplace add tirth8205/code-review-graph`

First build parses the full codebase (~10 seconds for 500 files). Subsequent updates are incremental (<2 seconds).

### Graph-First Exploration (Inside Context Mode)

Instead of grepping or reading entire files, query the graph:

| Task                     | Graph Tool (preferred)                  | Fallback (RTK in ctx_execute)           |
| ------------------------ | --------------------------------------- | --------------------------------------- |
| Find a function/class    | `semantic_search_nodes`                 | `ctx_execute({ code: "rtk grep ..." })` |
| Understand change impact | `get_impact_radius`                     | Manual import tracing                   |
| Review code changes      | `detect_changes` + `get_review_context` | `ctx_execute({ code: "rtk git diff" })` |
| Find callers/callees     | `query_graph` (callers_of/callees_of)   | `ctx_execute({ code: "rtk grep ..." })` |
| Find tests for a file    | `query_graph` (tests_for)               | `ctx_execute({ code: "rtk find ..." })` |
| Architecture overview    | `get_architecture_overview`             | `ctx_execute({ code: "rtk ls ." })`     |
| Find large functions     | `find_large_functions`                  | Manual file reading                     |
| Find dead code           | `refactor_tool`                         | Manual analysis                         |

### Code Review Workflow (Inside Context Mode)

```
# Step 1: Update the graph
ctx_execute({ language: "shell", code: "code-review-graph update" })

# Step 2: Detect changes (via MCP tool)
detect_changes()

# Step 3: Get blast radius (via MCP tool)
get_impact_radius({ files: ["src/auth/models.py", "src/api/views.py"] })

# Step 4: Get compact review context (via MCP tool)
get_review_context()

# Step 5: Read only affected files via RTK inside Context Mode
ctx_execute({ language: "shell", code: "rtk read src/auth/models.py" })
```

### Continuous Graph Updates

Keep the graph fresh during development:

```bash
# Terminal: watch mode (runs alongside your editor)
code-review-graph watch

# Or as a pre-commit hook
# .git/hooks/pre-commit
#!/bin/sh
code-review-graph update
```

### Graph Ignore Configuration

Create `.code-review-graphignore` in project root:

```
generated/**
*.generated.ts
vendor/**
node_modules/**
dist/**
__pycache__/**
migrations/**
```

---

## Context Mode Management Commands

These commands manage the context-mode knowledge base and health:

| Command       | Action |
| ------------- | ------ |
| `ctx stats`   | Call the `stats` MCP tool and display full output verbatim |
| `ctx doctor`  | Call the `doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `upgrade` MCP tool, run the returned shell command, display as checklist |
| `ctx purge`   | Call the `purge` MCP tool with confirm: true. Warns before wiping the knowledge base |

After conversation compaction (`/clear`, `/compact`, or platform-triggered): the knowledge base and session stats are preserved. Use `ctx_search` to recover prior state. Use `ctx purge` only if you want to start completely fresh.

---

## Error Handling and Fallback Protocol

When RTK or Code Review Graph commands fail inside Context Mode, the skill follows a strict fallback protocol that ensures work continues while errors are captured for debugging.

### Fallback Flow

```
ctx_execute({ command: "rtk cargo test" })
|
+-- SUCCESS -> use compressed result (normal path)
|
+-- FAILURE (exit code != 0 or ctx_execute itself errors)
    |
    +-- Step 1: Execute the command directly (outside Context Mode)
    |   Run: rtk cargo test
    |   (The command still uses RTK for compression, just not sandboxed)
    |
    +-- Step 2: Log the error
    |   Append to: ~/.pi/logs/context-watcher.log
    |   Format:
    |   [ISO-8601 timestamp] [FALLBACK] command="rtk cargo test"
    |   [ISO-8601 timestamp] [ERROR] reason="ctx_execute timeout / MCP connection lost / ..."
    |   [ISO-8601 timestamp] [RESULT] exit_code=0 (fallback succeeded)
    |
    +-- Step 3: Continue with the direct result
```

### When Fallback Triggers

Fallback from Context Mode to direct execution happens when:

1. **MCP server unreachable**: `context-mode` process crashed or was not started
2. **Sandbox timeout**: command took too long inside the subprocess
3. **Hook misconfiguration**: PreToolUse/PostToolUse hooks not firing
4. **SQLite lock**: FTS5 database locked by another process
5. **RTK binary not found in sandbox PATH**: RTK installed but not accessible inside ctx_execute
6. **Graph database stale/corrupt**: `.code-review-graph/graph.db` needs rebuild

### Reviewing Logs

```bash
# View recent fallback events
tail -50 ~/.pi/logs/context-watcher.log

# Count fallbacks in the last session
grep -c "\[FALLBACK\]" ~/.pi/logs/context-watcher.log

# Find which commands fail most
grep "\[FALLBACK\]" ~/.pi/logs/context-watcher.log | sort | uniq -c | sort -rn
```

---

## Context Mode Sandbox Tools Reference

### ctx_execute -- Run a command in sandbox

```
ctx_execute({ language: "shell", code: "rtk git status" })
ctx_execute({ language: "javascript", code: "const r = await fetch('http://localhost:3000/api'); console.log(r.status);" })
ctx_execute({ language: "python", code: "import json; print(json.dumps({'status': 'ok'}))" })
```

### ctx_execute_file -- Read and analyze a file in sandbox

```
ctx_execute_file({ path: "./logs/access.log", language: "python", code: "print(len(FILE_CONTENT.splitlines()))" })
```

### ctx_batch_execute -- Multiple commands, one context entry

```
ctx_batch_execute({
  commands: [
    { label: "Git status", command: "rtk git status" },
    { label: "Test results", command: "rtk cargo test" },
    { label: "Lint check", command: "rtk cargo clippy" }
  ],
  queries: ["failing tests", "clippy warnings"]
})
```

### ctx_fetch_and_index -- Fetch and sandbox a URL

```
ctx_fetch_and_index({ url: "https://docs.example.com/api", source: "API docs" })
```

### ctx_index -- Index content for later search

```
ctx_index({ path: "/tmp/playwright-snapshot.md", source: "Playwright snapshot" })
```

### ctx_search -- Query indexed content via BM25

```
ctx_search({ queries: ["authentication error 401", "login flow"], source: "API docs" })
```

### ctx_purge -- Clear indexed content

```
ctx_purge({ confirm: true })
```

---

## Tool Selection Hierarchy

When deciding which tool to use, follow this priority:

1. **GATHER**: `ctx_batch_execute(commands, queries)` -- Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries)` -- Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` -- Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` -- Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` -- Store content in FTS5 knowledge base for later search.

---

## Real-World Patterns

### Pattern 1: Full PR Review (Graph + RTK + Context Mode)

```
# 1. Update graph
ctx_execute({ language: "shell", code: "code-review-graph update" })

# 2. Detect changes via graph MCP tool
detect_changes()

# 3. Get blast radius
get_impact_radius({ files: ["src/payments/processor.py"] })

# 4. Get compact review context
get_review_context()

# 5. Read only affected files with RTK compression
ctx_batch_execute({
  commands: [
    { label: "Payment processor", command: "rtk read src/payments/processor.py" },
    { label: "Payment tests", command: "rtk read tests/test_payments.py" },
    { label: "API views", command: "rtk read src/api/views.py" }
  ],
  queries: ["payment validation", "error handling"]
})

# Result: ~15 files read at ~15K tokens instead of full codebase at ~739K tokens
```

### Pattern 2: Test-Debug-Fix Cycle

```
# 1. Run tests with RTK inside Context Mode
ctx_execute({ language: "shell", code: "rtk cargo test" })

# 2. If failures, find callers of failing function via graph
query_graph({ pattern: "callers_of", target: "validate_input" })

# 3. Read the failing file with aggressive compression
ctx_execute({ language: "shell", code: "rtk read src/validator.rs -l aggressive" })

# 4. Fix the code (direct Bash -- it is a mutation)
# ... edit file ...

# 5. Re-run tests
ctx_execute({ language: "shell", code: "rtk cargo test" })
```

### Pattern 3: Codebase Orientation (New Project)

```
# 1. Architecture overview via graph
get_architecture_overview()

# 2. Directory tree via RTK inside Context Mode
ctx_execute({ language: "shell", code: "rtk ls ." })

# 3. Git history
ctx_execute({ language: "shell", code: "rtk git log -n 20" })

# 4. Graph stats
ctx_execute({ language: "shell", code: "code-review-graph status" })
```

### Pattern 4: Infrastructure Inspection

```
ctx_batch_execute({
  commands: [
    { label: "Containers", command: "rtk docker ps" },
    { label: "Images", command: "rtk docker images" },
    { label: "Compose services", command: "rtk docker compose ps" },
    { label: "Pod status", command: "rtk kubectl pods" },
    { label: "Services", command: "rtk kubectl services" }
  ]
})
```

### Pattern 5: Web Documentation Lookup

```
# Fetch and index docs (sandboxed -- raw HTML never enters context)
ctx_fetch_and_index({ url: "https://docs.example.com/api/v2", source: "API v2 docs" })

# Search indexed docs
ctx_search({ queries: ["rate limiting", "authentication headers", "pagination"], source: "API v2 docs" })
```

### Pattern 6: Session Recovery After Compaction

```
# After context compaction, recover state via Context Mode's SQLite
ctx_search({ queries: ["currently editing authentication middleware"] })
ctx_search({ queries: ["unresolved errors last session"] })
ctx_search({ queries: ["pending tasks"] })
```

### Pattern 7: Data Analysis (Think in Code)

```
# WRONG: reading CSV into context and counting manually
ctx_execute_file({ path: "data.csv" })

# RIGHT: programmatic analysis
ctx_execute({
  language: "javascript",
  code: "const fs=require('fs'); const rows=fs.readFileSync('data.csv','utf8').trim().split('\\n'); console.log('Total rows:', rows.length-1); const headers=rows[0].split(','); console.log('Columns:', headers.join(', '));"
})
```

---

## Anti-Patterns (What NOT to Do)

| Anti-Pattern                            | Why It Is Wrong                          | Correct Approach                                                 |
| --------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `bash: git log`                         | Raw output floods context (~2000 tokens) | `ctx_execute({ code: "rtk git log" })` (~200 tokens)             |
| `bash: curl http://api/endpoint`        | FORBIDDEN. Raw HTTP response (~50KB)     | `ctx_fetch_and_index({ url: "..." })` then `ctx_search`          |
| `bash: node -e "fetch(...)"`            | FORBIDDEN. Bypasses sandbox              | `ctx_execute({ language: "javascript", code: "..." })`           |
| `bash: python -c "requests.get(...)"`   | FORBIDDEN. Bypasses sandbox              | `ctx_execute({ language: "python", code: "..." })`               |
| `bash: cat large-file.json`             | Entire file in context                   | `ctx_execute_file({ path: "..." })`                              |
| `bash: npm test`                        | Full test output in context              | `ctx_execute({ code: "rtk vitest run" })`                        |
| `grep pattern src/` as first step       | Misses structural context                | `semantic_search_nodes` or `query_graph` first                   |
| Reading entire codebase for review      | Wastes ~739K tokens                      | `get_impact_radius` -> read only blast radius (~15K)             |
| `browser_snapshot()` without filename   | 135K tokens flood context                | `browser_snapshot(filename: "/tmp/snap.md")` -> `ctx_index(path)`|
| `ctx_index(content: large_data)`        | Data enters context as parameter         | `ctx_index(path: "/tmp/data.json")` -- reads server-side         |
| Running `git status` without rtk prefix | Uncompressed output                      | Always use `rtk git status`                                      |
| Skipping graph for supported languages  | Misses callers/dependents/test gaps      | Graph-first is mandatory for supported languages                 |
| Reading file to count/filter/aggregate  | Wastes context on raw data               | Write code in ctx_execute, print only the answer                 |

---

## Troubleshooting

### RTK commands not compressing output

```bash
rtk init --show           # Check hook status
rtk --version             # Verify installation
rtk gain --history        # Verify savings are tracked
```

If `rtk gain` fails, you may have the wrong crates.io package. Reinstall from source:

```bash
cargo install --git https://github.com/rtk-ai/rtk
```

### Context Mode tools not routing

```bash
# Claude Code
/context-mode:ctx-doctor

# Other platforms
ctx_doctor
```

Verify hooks are registered and routing file exists (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, etc.). Without hooks, routing compliance drops to ~60%.

### Code Review Graph not connecting

```bash
# Claude Code plugin install (simplest)
claude plugin marketplace add tirth8205/code-review-graph
claude plugin install code-review-graph

# Or manual MCP registration
code-review-graph install
claude mcp list              # Verify registration
code-review-graph status     # Check graph health
```

### Graph is stale

```bash
code-review-graph update     # Incremental re-parse
code-review-graph build      # Full rebuild if needed
```

### Semantic search not working

```bash
pip install "code-review-graph[embeddings]"
code-review-graph embed      # Compute embeddings (one-time)
```

### RTK not found inside ctx_execute

Ensure RTK is in PATH inside the sandbox:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Fallback errors piling up in logs

```bash
# Review the log
tail -100 ~/.pi/logs/context-watcher.log

# Common fixes
# 1. Restart context-mode: npm update -g context-mode
# 2. Rebuild graph: code-review-graph build
# 3. Reinstall RTK hook: rtk init -g
```

### uv not found (required by code-review-graph)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# or
pip install uv
```

---

## Quick Reference Card

```
# === SETUP ===
brew install rtk && npm install -g context-mode && pip install code-review-graph
rtk init -g && code-review-graph install
mkdir -p ~/.pi/logs
# Restart AI tool

# === DAILY USE (everything inside Context Mode) ===
# Git
ctx_execute({ code: "rtk git status" })
ctx_execute({ code: "rtk git log -n 10" })
ctx_execute({ code: "rtk git diff" })

# Tests
ctx_execute({ code: "rtk cargo test" })
ctx_execute({ code: "rtk pytest" })
ctx_execute({ code: "rtk vitest run" })

# Build and Lint
ctx_execute({ code: "rtk tsc" })
ctx_execute({ code: "rtk cargo clippy" })
ctx_execute({ code: "rtk next build" })
ctx_execute({ code: "rtk ruff check" })
ctx_execute({ code: "rtk golangci-lint run" })

# Code Review (graph-first)
detect_changes() -> get_impact_radius() -> get_review_context()
ctx_execute({ code: "rtk read <file>" })

# Files
ctx_execute({ code: "rtk ls ." })
ctx_execute({ code: "rtk grep 'pattern' src/" })
ctx_execute_file({ path: "./large-file.log" })

# Web docs
ctx_fetch_and_index({ url: "https://..." }) -> ctx_search({ queries: [...] })

# Package managers
ctx_execute({ code: "rtk pip list" })
ctx_execute({ code: "rtk pip outdated" })
ctx_execute({ code: "rtk bundle install" })

# Analytics
ctx_execute({ code: "rtk gain --graph" })
ctx_execute({ code: "rtk discover" })

# Management
ctx stats / ctx doctor / ctx upgrade / ctx purge

# === DIRECT BASH (mutations only) ===
git add . && git commit -m "msg" && git push
mkdir -p src/new-module
rm -rf dist/
npm install
```

---

## Platform Compatibility Matrix

| Platform         | RTK Hook                     | Context Mode  | Code Review Graph |
| ---------------- | ---------------------------- | ------------- | ----------------- |
| Claude Code      | `rtk init -g`                | Plugin (full) | Plugin (full)     |
| GitHub Copilot   | `rtk init -g`                | MCP server    | MCP server        |
| Gemini CLI       | `rtk init -g --gemini`       | MCP + hooks   | MCP server        |
| ChatGPT / Codex  | `rtk init -g --codex`        | MCP server    | MCP server        |
| Cursor           | `rtk init -g --agent cursor` | MCP + hooks   | MCP server        |
| Windsurf         | `rtk init --agent windsurf`  | MCP + hooks   | MCP server        |
| Cline / Roo Code | `rtk init --agent cline`     | MCP + hooks   | MCP server        |
| VS Code Copilot  | `rtk init -g`                | MCP + hooks   | MCP server        |
| OpenCode         | `rtk init -g --opencode`     | MCP + plugin  | MCP server        |
| MiniMax          | `rtk init -g`                | MCP server    | MCP server        |

All three tools work on any platform that supports MCP servers and shell hooks. The agent-specific configuration handles the differences in hook format and instruction file placement.

---

## References

### RTK Token Optimizer

- GitHub: https://github.com/rtk-ai/rtk
- Website: https://www.rtk-ai.app/
- Skill (Aradotso): https://github.com/Aradotso/trending-skills/blob/main/skills/rtk-token-optimizer/SKILL.md
- Skill (FlorianBruniaux): https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/examples/skills/rtk-optimizer/SKILL.md
- Generated from `rtk init`

### Context Mode

- GitHub: https://github.com/mksglu/context-mode
- Skill (Aradotso): https://github.com/Aradotso/trending-skills/blob/main/skills/context-mode-mcp/SKILL.md
- Skill (mksglu): https://github.com/mksglu/context-mode/blob/main/skills/context-mode/SKILL.md
- Agent Config (Pi): https://github.com/mksglu/context-mode/blob/main/configs/pi/AGENTS.md
- Reference Patterns: https://github.com/mksglu/context-mode/tree/main/skills/context-mode/references

### Code Review Graph

- GitHub: https://github.com/nicobailon/code-review-graph
- Skill (Aradotso): https://github.com/Aradotso/trending-skills/blob/main/skills/code-review-graph/SKILL.md
- Plugin: `claude plugin marketplace add tirth8205/code-review-graph`
- Generated from `code-review-graph init`

### Project Documents (Custom)

- RTK Command Integration and Usage Protocols (project file)
- RTK Token Optimization and Command Reference Guide (project file)
- The Graph-First Protocol for Code Review Analysis (project file)
