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

1. Local installed source wins for behavior of packages installed on this machine.
2. Context7 wins for current third-party API signatures, framework docs, version-specific behavior, and implementation examples.
3. pi-web-access wins for broad web search, GitHub repositories, articles, YouTube/video content, or when Context7 has no good match.
4. Context Mode still gatekeeps shell execution and large output; run `ctx7` CLI commands through Context Mode with RTK when command output may be large.

## Mandatory Graph-First Preflight

Before using grep, find, read, or broad file inspection for codebase exploration, code review, blast-radius analysis, caller/callee lookup, test discovery, architecture review, or refactor analysis, ask: can Code Review Graph answer this first?

If yes, use Code Review Graph first. Fall back to Context Mode + RTK file/search commands only when the graph is unavailable, empty, stale, unsupported for the language, or insufficient for the specific question.

## Mandatory Worktree Graph Protocol

When creating feature worktrees, use a grouped feature root so Code Review Graph can index related repos in one graph database:

```text
.worktrees/<feature-name>/<repo-name>/
```

Examples:

```text
.worktrees/feature-a/webapp/
.worktrees/feature-a/admin-dashboard/
.worktrees/feature-a/core-frontend/
```

For grouped feature worktrees:

1. Build or update Code Review Graph at the grouped feature root, not each repo separately, unless single-repo isolation is explicitly needed.
2. Add the grouped feature root to the Code Review Graph daemon watch list after creating the worktree group.
3. Before the first Code Review Graph query for a feature, check that the daemon is configured and running. Re-check periodically during long work, but do not check before every query.
4. When removing a worktree group, remove the grouped feature root from the daemon watch list too.
5. Prefer feature-scoped graph queries using `repo_root: ".worktrees/<feature-name>"`. Avoid global `cross_repo_search` for feature-scoped work unless explicitly requested.
6. For Git diff/change detection inside grouped worktrees, collect changed files per nested repo and map them to grouped-root-relative paths before using graph impact tools.

Daemon commands:

```bash
code-review-graph daemon add .worktrees/<feature-name> --alias <feature-name>
code-review-graph daemon status
code-review-graph daemon remove <feature-name>
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

**Everything else runs through Context Mode.** This includes all RTK commands, all Code Review Graph queries, all CLI tools, all test runners, all build tools, all infrastructure commands.

### REDIRECTED Tools -- Use Sandbox Equivalents

**bash (>20 lines output)**: bash is ONLY for the whitelist above and other short-output commands. For everything else, use `ctx_batch_execute(commands, queries)` or `ctx_execute(language: "shell", code: "...")`.

**read (for analysis)**: If you are reading a file to **edit** it, direct read is correct (edit needs content in context). If you are reading to **analyze, explore, or summarize**, use `ctx_execute_file(path, language, code)` instead.

**grep / find (large results)**: Search results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run in sandbox.

### Decision Tree

```
About to run a command?
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
+-- Is it third-party library/framework/API usage?
|   +-- Use local installed source if answering installed behavior
|   +-- Otherwise use Context7 docs FIRST for current docs
|   +-- Use pi-web-access for broad web/GitHub/article/video search or Context7 misses
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
