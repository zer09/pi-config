# MANDATORY PRE-FLIGHT CHECK -- EXECUTE BEFORE EVERY TOOL CALL

Before any tool call, silently verify:

1. **Is this command on the Bash whitelist?**
   Only these are safe for direct bash: `mkdir`, `mv`, `cp`, `rm`, `touch`, `chmod`, `git add`, `git commit`, `git push`, `git checkout`, `git branch`, `git merge`, `cd`, `pwd`, `which`, `kill`, `pkill`, `npm install`, `pip install`, `echo`, `printf`.
   If not on this list: use `ctx_batch_execute`, `ctx_execute`, or `ctx_execute_file`.

2. **Is this a read-only operation?** (cat, grep, ls, find, node, python, git log/diff/status, test, build, etc.)
   If yes: use `ctx_batch_execute` (primary tool) with `rtk` prefix, or `ctx_execute` with `rtk` prefix.

3. **Am I analyzing data?** (count, filter, compare, aggregate, parse, transform)
   If yes: write code inside `ctx_execute` with language:"javascript" or "python". Do not read raw data into context to process mentally.

4. **Is this a file read for analysis?** (not for editing)
   If yes: use `ctx_execute_file`. Not `read` tool.

5. **Is this a web fetch or URL?**
   If yes: use `ctx_fetch_and_index` then `ctx_search`.

6. **Is this third-party library/framework/API usage, version-specific behavior, or implementation work against an external package?**
   If yes: use Context7 (`ctx7 library` then `ctx7 docs`) for current official docs before relying on memory. Use local installed source first when answering installed-package behavior on this machine. Use pi-web-access for broad web search, GitHub, articles, YouTube, or when Context7 has no good match.

7. **Is this codebase exploration, code review, blast-radius analysis, caller/callee lookup, test discovery, architecture review, or refactor analysis?**
   If yes: use code-review-graph first, unless the graph is unavailable, empty, stale, or unsupported for the language. Fall back to Context Mode + RTK file/search commands only after graph-first exploration is not applicable.

8. **Is this creating, using, or removing a worktree?**
   If yes: follow the story-grouped worktree + code-review-graph daemon rules. Create feature worktrees under `.worktrees/<story>/<feature>/<repo-name>/` when multiple repos are involved, for example `.worktrees/google-sso/feature-a/webapp/`. Put standalone fixes, hotfixes, and issue work under the common story `.worktrees/issues/<issue-number>/<repo-name>/`. Build/query code-review-graph at the containing story or issue root, add that root to the code-review-graph daemon watch list when daemon watching is useful, and remove it from the daemon when the worktree group is removed.

**Tool routing by intent:**
- `ctx_batch_execute` -- PRIMARY for shell work. One call replaces 30+ individual calls. Use for multiple commands + auto-index + search.
- `ctx_search` -- Follow-up queries on content already indexed by Context Mode.
- `ctx_execute` / `ctx_execute_file` -- Single command or file processing.
- `ctx_fetch_and_index` then `ctx_search` -- Fetch web docs/URLs and index them for search.
- Context7 (`ctx7 library` -> `ctx7 docs`) -- Fetch current third-party library/framework/API docs.
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

Context Watcher is the unified orchestration of Context Mode, RTK Token Optimizer, and Code Review Graph. It defines how to sandbox commands, compress output, and explore codebases structurally. All command execution during work must follow the context-watcher skill's routing rules (decision tree, bash whitelist, fallback protocol).

# General Approach Rules

Always followed. All other approaches inherit these rules.

- Read existing files before writing. Do not re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.
- Use Context7 for current third-party library/framework/API documentation when implementing or advising on external packages. Do not include secrets, personal data, or proprietary code in Context7 queries.

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
