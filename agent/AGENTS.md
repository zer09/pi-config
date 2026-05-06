# Session Startup

At the start of every session, before any work begins:

1. Read `skills/context-watcher/SKILL.md` and internalize its rules. Context Watcher must be ready before any work starts.
2. Read and internalize the approach rules in `rules/` (see Rules Reference below).
3. If the project has a supported language, verify code-review-graph status per the context-watcher skill.
4. If RTK is available, use it as the default prefix for all read-only shell operations per the context-watcher skill.
5. If `~/.pi/agent/cleanup-sessions.sh` exists, run it in safe mode to prune ignored runtime artifacts older than 30 days. Do not delete tracked or unignored files.
6. If `~/.pi/agent/update-local-skills.sh` exists, run it to update Pi skills installed directly under `~/.pi/agent/skills` at most once per day. Do not use global `~/.agents/skills`.

Do not ask for permission to do these steps. Just do them.

# Freedom to Disagree -- ALWAYS ACTIVE

**File**: `rules/freedom.md`

This rule is universal. It applies to every approach, every task, every context. It is never silenced by any other rule.

When something seems wrong, risky, or not the best approach: do not silently comply. Push back constructively. State the disagreement clearly, explain why, offer alternatives, and give a recommendation. This applies across all projects and all approaches, including Agent mode where confirmation is normally suppressed.

No other rule in this document or in `rules/` can override or limit Freedom to Disagree.

# Rule Priority (highest to lowest)

1. **Safety and correctness** - security warnings, irreversible action checks, hallucination prevention.
2. **Freedom to Disagree** - always active, overrides silence rules when something seems wrong or risky. Read `rules/freedom.md`.
3. **General Approach Rules** - baseline that all approaches inherit. Defined inline below.
4. **Approach-specific rules** (Agent / Analysis / Coding) - apply based on task type. Stored in `rules/`.

When two rules conflict, higher-numbered rule yields to lower-numbered rule.

# Approach Selection

Select the approach based on the primary action of the task. Read the corresponding rule file before starting work.

**Coding** -- task involves code changes, debugging, refactoring, or code review.
- Read `rules/coding.md`
- Inherits: General Approach Rules AND Agent Approach Rules (Coding extends both)
- The Coding rules override Agent rules where they differ

**Analysis** -- task is read-only investigation, data analysis, or reporting.
- Read `rules/analysis.md`
- Inherits: General Approach Rules

**Agent** -- task is automation, pipeline execution, or multi-agent orchestration.
- Read `rules/agent.md`
- Inherits: General Approach Rules

**Mixed tasks**: use the primary action to select. "Analyze this code and fix the bug" = Coding (the fix is the primary action). "Research these metrics" = Analysis.

All approaches inherit and must follow General Approach Rules (below). Freedom to Disagree (`rules/freedom.md`) is always active regardless of approach. Context Watcher (`skills/context-watcher/SKILL.md`) applies to all approaches whenever executing commands.

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
| Context Watcher | `skills/context-watcher/SKILL.md` | Always. Session startup. Before any work. |

Context Watcher is the unified orchestration of Context Mode, RTK Token Optimizer, and Code Review Graph. It defines how to sandbox commands, compress output, and explore codebases structurally. All command execution during work must follow the context-watcher skill's routing rules (decision tree, bash whitelist, fallback protocol).

# General Approach Rules

Always followed. All other approaches inherit these rules.

- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.

## Formatting (applies to all approaches)

- No emojis.
- No decorative Unicode: no smart quotes, em dashes, or ellipsis characters.
- Plain hyphens and straight quotes only.
- Natural language characters (accented letters, CJK, etc.) are fine when the content requires them.
- All strings must be safe for JSON serialization and copy-paste.

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
- Store follow-up handoffs in `.claude/handoffs/` and add a `Continues from:` link to the previous handoff filename.
- Resume workflow: read latest handoff first, then walk backward through `Continues from` links only as needed.
- Keep each follow-up focused on delta only: what changed, what failed, new decisions, and immediate next steps.
- Do not overwrite prior handoffs. Preserve chain history.
