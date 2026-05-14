# MANDATORY PRE-FLIGHT CHECK -- EXECUTE BEFORE EVERY TOOL CALL

Before any tool call, silently verify:

1. **Would this mutate an external hosted service?**
   External hosted services include SaaS/cloud/vendor/org remote state such as Figma, Linear, GitHub/GitLab/Bitbucket, Notion, Slack, PostHog, Firebase/GCP/AWS/Azure, Stripe, Sentry, Jira, and similar systems reached through MCP, CLIs, APIs, SDKs, browser automation, or webhooks. Mutations include create, update, delete, post, comment, react, assign, label, close/reopen, merge, push, publish, deploy, invite, rotate keys, change quotas, or run jobs/workflows that change remote state. Default is read-only. If the user has not explicitly instructed the exact write/mutation in the current task or active session, do not call it; provide a draft, checklist, or read-only summary instead. If the user explicitly says to do it, for example "push that commit", "comment this on PR #12", "create the Linear issue", or "deploy now", the mutation is allowed; still follow secret, safety, destructive-action, and tool-routing rules.

2. **Is this command on the Bash whitelist?**
   Only these are safe for direct bash: `mkdir`, `mv`, `cp`, `rm`, `touch`, `chmod`, `git add`, `git commit`, `git push`, `git checkout`, `git branch`, `git merge`, `cd`, `pwd`, `which`, `kill`, `pkill`, `npm install`, `pip install`, `echo`, `printf`.
   If not on this list: use `ctx_batch_execute`, `ctx_execute`, or `ctx_execute_file`.

3. **Is this a read-only operation?** (cat, grep, ls, find, node, python, git log/diff/status, test, build, etc.)
   If yes: use `ctx_batch_execute` (primary tool) with `rtk` prefix, or `ctx_execute` with `rtk` prefix.

4. **Am I analyzing data?** (count, filter, compare, aggregate, parse, transform)
   If yes: write code inside `ctx_execute` with language:"javascript" or "python". Do not read raw data into context to process mentally.

5. **Is this a file read for analysis?** (not for editing)
   If yes: use `ctx_execute_file`. Not `read` tool.

6. **Is this a GitHub repository, pull request, issue, review, comment, workflow, release, or any private GitHub data?**
   If yes: load and follow the `gh-cli` skill, then use authenticated `gh` CLI through Context Mode/RTK (`ctx_execute` or `ctx_batch_execute` with `rtk gh ...`). Do not open or fetch private GitHub URLs with browser/web tools to get data. Use browser/web tools only for visual inspection of public pages or when the user explicitly requests browser use.

7. **Is this a web fetch or URL?**
   If yes: use `ctx_fetch_and_index` then `ctx_search`.

8. **Is this third-party library/framework/API usage, version-specific behavior, or implementation work against an external package?**
   If yes: use Context7 (`ctx7 library` then `ctx7 docs`) for current official docs before relying on memory. Use local installed source first when answering installed-package behavior on this machine. Use pi-web-access for broad web search, public GitHub research, articles, YouTube, or when Context7 has no good match.

9. **Is this codebase exploration, code review, blast-radius analysis, caller/callee lookup, test discovery, architecture review, or refactor analysis?**
   If yes: use code-review-graph first. An unavailable, empty, stale, or incomplete graph is not automatically an error and not automatically a reason to abandon graph-first. If build/update is authorized and appropriate, build or update the graph, then retry the graph query. Fall back to Context Mode + RTK file/search commands only when graph-first is not applicable, build/update is not authorized, building would be wasteful for a one-off check, the language is unsupported, or the graph remains insufficient after build/update.

10. **Is this creating, using, or removing a worktree?**
   If yes: follow the story-grouped worktree + code-review-graph daemon rules. Create feature worktrees under `.worktrees/<story>/<feature>/<repo-name>/` when multiple repos are involved, for example `.worktrees/google-sso/feature-a/webapp/`. Put standalone fixes, hotfixes, and issue work under the common story `.worktrees/issues/<issue-number>/<repo-name>/`. Prefer daemon-backed graphs for active roots: check whether the daemon is running, start it when useful, build the graph if `.code-review-graph/graph.db` is missing or empty and build/update is authorized, add the containing story/feature/issue/repo root to the daemon watch list when missing, query instead of repeatedly rebuilding, and remove it from the daemon when the worktree group is removed.

**Tool routing by intent:**
- `ctx_batch_execute` -- PRIMARY for shell work. One call replaces 30+ individual calls. Use for multiple commands + auto-index + search.
- `ctx_search` -- Follow-up queries on content already indexed by Context Mode.
- `ctx_execute` / `ctx_execute_file` -- Single command or file processing.
- `ctx_fetch_and_index` then `ctx_search` -- Fetch web docs/URLs and index them for search.
- External hosted service mutation gate -- apply before all remote SaaS/cloud/vendor tools. Read-only by default; exact explicit user write instruction required for mutation.
- Context7 (`ctx7 library` -> `ctx7 docs`) -- Fetch current third-party library/framework/API docs.
- `gh-cli` skill + `rtk gh ...` -- GitHub repo/PR/issue/review/comment/workflow/release/private repo operations. Prefer this over browser/web tools for authenticated GitHub data; writes still require explicit user instruction.
- `ctx_index` -- Index already-available documentation/content for later search. Do not treat it as a docs source.

**Violation of these rules is a failure. No exceptions.**

---

# Session Startup

At the start of every session, before any work begins:

1. Read `~/.pi/agent/skills/context-watcher/SKILL.md` and internalize its rules. Context Watcher must be ready before any work starts.
2. Read and internalize the approach rules in `rules/` (see Rules Reference below).
3. If the project has a supported language, verify code-review-graph status per the context-watcher skill.
4. If RTK is available, use it as the default prefix for all read-only shell operations per the context-watcher skill.
5. If `~/.pi/agent/cleanup-sessions.sh` exists AND is tracked in git (verify with `git ls-files --error-unmatch`), run it in safe mode to prune ignored runtime artifacts older than 30 days. Do not delete tracked or unignored files. If the script is not tracked, skip and warn.
6. If `~/.pi/agent/update-local-skills.sh` exists AND is tracked in git, run it to update Pi skills installed directly under `~/.pi/agent/skills` at most once per day. Do not use global `~/.agents/skills`. If the script is not tracked, skip and warn.

Do not ask for permission to do these steps. Just do them.

# Freedom to Disagree -- ALWAYS ACTIVE

**File**: `rules/freedom.md`

This rule is universal. It applies to every approach, every task, every context. It is never silenced by any other rule.

When something seems wrong, risky, or not the best approach: do not silently comply. Push back constructively. State the disagreement clearly, explain why, offer alternatives, and give a recommendation. This applies across all projects and all approaches, including Agent mode where confirmation is normally suppressed.

Push back means: explain the concern, offer alternatives, and recommend the best path. It does not mean refusing to execute or arguing indefinitely.

No other rule in this document or in `rules/` can override or limit Freedom to Disagree.

# Rule Priority

Priority is ordered from highest (1) to lowest (4). When two rules conflict, the higher-priority rule (lower number) wins.

1. **Safety and correctness** - security warnings, secret protection, irreversible action checks, hallucination prevention.
2. **Freedom to Disagree** - always active, overrides silence rules when something seems wrong or risky. Read `rules/freedom.md`.
3. **General Approach Rules** - baseline that all approaches inherit. Defined inline below.
4. **Approach-specific rules** (Agent / Analysis / Coding) - apply based on task type. Stored in `rules/`.

# Security Rules -- ALWAYS ACTIVE

These rules apply to every approach, every task, every context. No other rule can weaken them.

## Secret Protection

- Never log, echo, write to file, print, include in handoff documents, include in progress files, or transmit via intercom any values from environment variables that contain keys, tokens, passwords, secrets, or credentials.
- When running `env`, `printenv`, or reading `.env` files, redact any value whose key name contains: KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL, AUTH, BEARER, API_KEY, PRIVATE. Replace the value with `[REDACTED]`.
- Never commit secrets to git. If you find a secret in staged changes, unstage the file and warn.
- If a tool call would expose a secret in its output (e.g., `echo $API_KEY`), do not execute it. Warn instead.

## Script Integrity

- Before executing any script from disk (`.sh`, `.py`, `.js`), verify it is tracked in version control: `git ls-files --error-unmatch <path>`. If the script is untracked or modified beyond what git shows, warn and do not execute.
- Never execute scripts piped from the internet (`curl | sh`, `wget | bash`) unless the user explicitly requests it and you have warned about the risk.

## External Hosted Service Mutation Gate

- Treat third-party or remote hosted products as read-only by default: Figma, Linear, GitHub/GitLab/Bitbucket, Notion, Slack, PostHog, Firebase/GCP/AWS/Azure, Stripe, Sentry, Jira, and similar vendor/org services reached through MCP, CLIs, APIs, SDKs, browser automation, or webhooks.
- Read-only actions are allowed: fetch, list, search, query, download, inspect, compare, and diff.
- Mutating actions require explicit user instruction for that specific action: create, update, delete, post, comment, react, assign, label, close/reopen, merge, push, publish, deploy, invite, rotate keys, change quotas, or run jobs/workflows that change remote state.
- If the user has not explicitly asked for the mutation, do not perform it. Provide a draft, checklist, or command for the user instead.
- If the user explicitly asks for the mutation, execute it without extra confirmation unless another safety rule requires confirmation. Examples: "push that commit", "post this PR comment", "create the issue", "merge this PR", "deploy now".
- Do not infer mutation permission from broad goals like "handle this PR", "review this issue", "sync with Linear", or "take care of the release". Ask or provide a draft if the write is not explicit.

## File Deletion Safety

- Before any `rm -rf` on a directory, verify the path is not a symlink to somewhere outside the expected tree.
- Never delete files outside the project directory or `~/.pi/` without explicit user confirmation.

# Approach Selection

Select the approach based on the primary action of the task. Read the corresponding rule file before starting work.

**Coding** -- task involves code changes, debugging, refactoring, or code review.
- Read `rules/coding.md`
- Inherits: General Approach Rules AND Agent Approach Rules
- You MUST read BOTH `rules/coding.md` AND `rules/agent.md` before starting. Coding extends both and Agent rules apply unless Coding rules explicitly override them.

**Analysis** -- task is read-only investigation, data analysis, or reporting.
- Read `rules/analysis.md`
- Inherits: General Approach Rules

**Agent** -- task is automation, pipeline execution, or multi-agent orchestration.
- Read `rules/agent.md`
- Inherits: General Approach Rules

**Mixed tasks**: use the primary action to select. "Analyze this code and fix the bug" = Coding (the fix is the primary action). "Research these metrics" = Analysis.

All approaches inherit and must follow General Approach Rules (below). Freedom to Disagree (`rules/freedom.md`) is always active regardless of approach. Context Watcher (`~/.pi/agent/skills/context-watcher/SKILL.md`) applies to all approaches whenever executing commands.

# Rules Reference

All rule files live in `rules/` relative to this file. Read the relevant file(s) before starting any task.

| File | Applies when | Inherits from |
|------|-------------|---------------|
| `rules/freedom.md` | Always. Every task, every approach. | Nothing. Universal. |
| `rules/agent.md` | Automation, pipelines, multi-agent orchestration | General Approach Rules |
| `rules/analysis.md` | Read-only investigation, data analysis, reporting | General Approach Rules |
| `rules/coding.md` | Code changes, debugging, refactoring, code review | General Approach Rules + Agent Approach Rules |

# Skills Reference

| Skill | Location | Load when |
|-------|----------|-----------|
| Context Watcher | `~/.pi/agent/skills/context-watcher/SKILL.md` | Always. Session startup. Before any work. |
| GitHub CLI | `~/.pi/agent/skills/gh-cli/SKILL.md` | Any GitHub repo, pull request, issue, review, comment, workflow, release, or private GitHub data interaction. |

Context Watcher is the unified orchestration of Context Mode, RTK Token Optimizer, and Code Review Graph. It defines how to sandbox commands, compress output, and explore codebases structurally. All command execution during work must follow the context-watcher skill's routing rules (decision tree, bash whitelist, fallback protocol).

# General Approach Rules

Always followed. All other approaches inherit these rules.

- Read existing files before writing. Do not re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.
- Use Context7 for current third-party library/framework/API documentation when implementing or advising on external packages. Do not include secrets, personal data, or proprietary code in Context7 queries.

## GitHub Operations

- For GitHub repositories, pull requests, issues, reviews, comments, workflows, releases, or private GitHub data, load and follow `~/.pi/agent/skills/gh-cli/SKILL.md` and use the authenticated `gh` CLI first.
- Run GitHub CLI commands through Context Mode/RTK for read-only or potentially large output, for example `ctx_execute` or `ctx_batch_execute` with `rtk gh pr view <number> --comments`, `rtk gh issue view <number>`, or `rtk gh api ...`.
- GitHub writes such as `git push`, PR creation, PR comments, reviews, merges, labels, workflow dispatches, and releases are external hosted service mutations. They require an explicit user instruction for that exact write.
- Do not use browser automation, web fetch tools, or direct GitHub URLs to fetch private repository data unless the user explicitly requests browser inspection. These tools may not share the authenticated `gh` session.
- Use browser/web tools only for visual inspection, public GitHub pages, or non-authenticated broad web research.

## Karpathy-Inspired Coding Constraints

Borrowed from `forrestchang/andrej-karpathy-skills`, adapted for this Pi setup. These constraints reinforce, but do not replace, the tool-routing, safety, Context Mode, and Code Review Graph rules above.

- Think before coding: state assumptions when they matter, surface tradeoffs, present multiple interpretations when a request is ambiguous, and ask instead of guessing when uncertainty would change the implementation.
- Simplicity first: write the minimum code that solves the requested problem. Do not add speculative features, premature abstractions, unrequested configurability, or defensive handling for impossible scenarios.
- Surgical changes: touch only what the task requires. Do not refactor, reformat, rename, or clean adjacent code unless it is necessary for the requested change. Match existing style even when a different style seems preferable.
- Clean up only your own mess: remove imports, variables, functions, tests, or files made unused by your changes. Mention unrelated dead code or cleanup opportunities instead of deleting them unless asked.
- Goal-driven execution: translate multi-step work into verifiable success criteria. Prefer tests or concrete checks for bug fixes, validation changes, and refactors, then loop until the checks pass or a clear blocker is found.
- Diff discipline: every changed line should trace directly to the user's request, a required safety fix, or a verified cleanup caused by the change.

## Rule Writing Location

When the user asks to "write rules", "add rules", "update rules", "remember this as a rule", "add guidelines", or similar wording without specifying a destination, treat it as a request to update project-level rules, not personal/global memory.

Default destination rules:
- Write to the current project's existing rule or guideline files, such as `AGENTS.md`, `AI_GUIDELINES.md`, `.agents/`, `agent/rules/`, `.cursor/rules/`, or equivalent project-local files.
- Prefer the nearest repository or worktree root that contains the active task files.
- If multiple project-level rule systems exist, update the one already used by that project or ask which one to use when ambiguity would cause conflicting guidance.
- If no project root or project-level rule file can be identified, ask where to place the rule before writing.
- Do not write to `~/.claude/memory`, global Claude memory, global agent memory, or other home-directory memory/rule files unless the user explicitly asks for personal/global memory or names that destination.

## Context Window Awareness

Different models have different context window sizes. Know your limit so you can manage context proactively.

**How to determine your context budget (do this once at session start):**

Step 1: If your platform already tells you your context budget (e.g., Claude 4.5+ models receive `Token usage: X/Y` system warnings, or the system prompt states the model name), use that. You are done.

Step 2: Otherwise, figure out which model you are and look yourself up. Run:

```bash
node -e "
  try {
    const d = require(require('os').homedir() + '/.pi/agent/model-context-limits.json');
    const q = (process.argv[1] || '').toLowerCase();
    let v;
    for (const [p, models] of Object.entries(d.providers)) {
      if (typeof models !== 'object') continue;
      for (const [k, t] of Object.entries(models)) {
        if (!k.startsWith('_') && q.includes(k.toLowerCase())) { v = t; break; }
      }
      if (v) break;
    }
    console.log(v || d.defaults.conservative);
  } catch(e) { console.log(128000); }
" "YOUR_MODEL_NAME"
```

Replace `YOUR_MODEL_NAME` with your model identifier. If you do not know your own model name, check one of these (in order):

1. Your system prompt -- it often states the model name.
2. Run `cat ~/.pi/agent/settings.json 2>/dev/null | grep defaultModel` to see Pi's default.
3. If you still cannot determine your model, use the conservative default.

Step 3: If neither method works, assume 128000 tokens.

**Context management practices (always follow):**
- Prefer streaming results through context-mode over loading everything at once.
- For operations that may produce large output (test suites, build logs, file reads), always use context-mode sandbox.
- If you notice your context is getting long (many tool calls, large code blocks), proactively summarize earlier findings and focus on what remains.
- When the platform compacts, summarizes, or truncates your conversation, your context-watcher knowledge base and session stats are preserved. Use `ctx_search` to recover prior state.

## Formatting (applies to all approaches)

- No emojis.
- No decorative Unicode: no smart quotes, em dashes, or ellipsis characters.
- Plain hyphens and straight quotes only.
- Natural language characters (accented letters, CJK, etc.) are fine when the content requires them.
- All strings must be safe for JSON serialization and copy-paste.

# Sub-agent Orchestration

Sub-agents are Pi child processes used to keep raw investigation output out of the parent context. They are orchestrated by the parent agent and must return compact structured findings only.

- Use the Pi-native `subagent_run` tool when a task benefits from isolated context, such as focused investigation, review, testing, documentation research, or consistency checks.
- Do not use sub-agents just to think. The parent orchestrator should handle pure reasoning tasks directly unless isolated critique is explicitly requested.
- If a sub-agent is used, require tool-grounded evidence for investigation, verification, file/repo facts, tests, logs, docs, or external data unless the task is explicitly a reasoning-only critique.
- Do not use `AskClaude` for this workflow unless the user explicitly asks for it.
- Sub-agents must run with normal Pi extensions enabled so Context Mode, pi-mcp-adapter, rtk-hook, and Code Review Graph remain available.
- Sub-agents must explicitly load and follow `~/.pi/agent/skills/context-watcher/SKILL.md` before tool use.
- Sub-agents must use Context Mode for shell/read-only commands and large output, and Code Review Graph first for supported code exploration/review tasks.
- Sub-agents must use the `gh-cli` skill and authenticated `gh` CLI through Context Mode/RTK for GitHub repo/PR/issue/review/comment/workflow/release/private data. Do not use browser/web tools for private GitHub data unless the parent explicitly requests browser inspection.
- Sub-agents must treat external hosted services as read-only unless the parent task explicitly authorizes the exact mutation. Without explicit authorization, return a draft/checklist instead of mutating Figma, Linear, GitHub, cloud services, or similar remote systems.
- Sub-agents must use isolated persistent sessions under `~/.pi/agent/subagent-sessions/<workstream>/<agent>/` and normally run with `--continue`. First run creates a session; later runs resume the same sub-agent workstream memory.
- Default sub-agent mode is read-only. File edits or mutating commands require explicit `mode: "write"` and parent review.
- Sub-agents must not return raw logs, full diffs, broad grep output, browser snapshots, test dumps, secrets, or environment variable values. Return structured JSON with summary, finding, evidence, tools used, confidence, blockers, and recommended next step.
- Recursive sub-agent calls are disabled by default. Enable only when explicitly needed and bounded.
- The parent agent remains responsible for final decisions, diff review, validation, commits, and user-facing reporting.

# Cross-Platform Notes

This configuration is used across multiple AI platforms: Claude Code, ChatGPT/Codex, Gemini CLI, Cursor, MiniMax, and others. Some platform-specific notes:

- **Rule file loading**: If your platform does not auto-load rule files from disk, you must read the relevant rule files using your file-reading tools before starting work. The rules are not optional just because they are not auto-loaded.
- **MCP tools**: Context-watcher references MCP tool names (`ctx_execute`, `ctx_batch_execute`, `detect_changes`, etc.). If MCP tools are not available on your platform, use the closest equivalent (direct shell commands with RTK prefix). The routing rules still apply conceptually.
- **Handoff files**: Store handoff documents in `agent/handoffs/`. Create the directory if it does not exist.
- **Subagent orchestration**: Subagent definitions in `agent/agents/` include `model:` fields. These are routing hints for platforms that support model selection. If your platform does not support model routing, ignore the `model:` field and use your default model.

# Python CLI Tooling

- Use `uv` as the default Python package, project, script, and tool runner.
- If a project has `uv.lock` or uv-generated requirements headers, use `uv sync`, `uv add`, `uv remove`, and `uv run` instead of pip, virtualenv, poetry, or direct Python execution.
- Do not use `uv` for Poetry projects with `poetry.lock` or PDM projects with `pdm.lock` unless the user explicitly asks to migrate.
- Use `uv run <tool>` when the tool is a project dependency or the project environment matters.
- Use `uvx <tool>` for one-off Python tools that are not project dependencies.
- Use `ruff` for Python linting and formatting. Prefer `uv run ruff ...` when pinned, otherwise `uvx ruff ...`.
- Before formatting with ruff, run `ruff format --diff` or `uv run ruff format --diff` and avoid broad formatting churn unless requested.
- Use `ty` for Python type checking. Prefer `uv run ty check ...` when pinned, otherwise `uvx ty check ...`.
- Scope ruff and ty checks to changed files when possible, then run broader checks before claiming completion.

# Handoff Continuity Rule

- For every new handoff after an existing handoff in the same workstream, create a chained follow-up handoff.
- Store follow-up handoffs in `agent/handoffs/` and add a `Continues from:` link to the previous handoff filename.
- Resume workflow: read latest handoff first, then walk backward through `Continues from` links only as needed.
- Keep each follow-up focused on delta only: what changed, what failed, new decisions, and immediate next steps.
- Do not overwrite prior handoffs. Preserve chain history.
- Never include secret values, API keys, or tokens in handoff documents. Reference them by environment variable name only.
