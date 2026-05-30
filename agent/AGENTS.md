# Pi Agent Rules

## Default mode

- Default to read-only investigation. Do not modify files, commits, hosted services, or external state unless the user explicitly asks for that exact change.
- If the latest user request is phrased as a question, review, or assessment, treat it as Analysis/read-only unless it also explicitly asks to apply changes.

## Startup

Before work begins:

1. Load the `context-watcher` skill from `~/.pi/agent/skills/context-watcher/SKILL.md` and treat it as active for the whole session. Apply its preflight, routing, RTK, CodeGraph, GitHub, Context7, worktree, delegate, and fallback rules; do not merely read the file without activating the skill.
2. Read `~/.pi/agent/rules/freedom.md` and the active approach file from `~/.pi/agent/rules/`.
3. If the task is Coding, read both `~/.pi/agent/rules/coding.md` and `~/.pi/agent/rules/agent.md`.
4. If the task involves code exploration or review, verify CodeGraph project/index status per Context Watcher.
5. Use RTK inside Context Mode for read-only shell work when available.

Do not ask permission for startup steps.

## Mandatory preflight before every tool call

Silently check:

- External hosted service mutation? Only perform exact writes the user explicitly requested. Otherwise stay read-only or provide a draft/checklist.
- Read-only shell, tests, builds, logs, git reads, or output likely over 20 lines? Use Context Mode, preferably `ctx_batch_execute`, with RTK when available.
- Data analysis, counting, filtering, parsing, or aggregation? Write code inside `ctx_execute` or `ctx_execute_file`; print only the compact result.
- File read for editing? Use native `read`, then native `edit` or `write`. Never write file content through Bash or Context Mode.
- GitHub repo, PR, issue, review, workflow, release, or private data? Load `gh-cli`; use authenticated `gh` through Context Mode/RTK. Writes still need exact user instruction.
- Git commit/amend/squash? Only create or modify commits when the user explicitly asks for a commit. Do not infer commit permission from "fix it", "finish", "save", "clean up", or "handle this".
- URL or web document? Use `ctx_fetch_and_index`, then `ctx_search`.
- Third-party API/library/framework behavior? Verify current docs with Context7, using local installed source first when relevant.
- Code exploration, review, impact analysis, or refactor planning? Use CodeGraph first for structural code questions when available and applicable.
- Shared or public content? Redact secrets and user-specific home paths.
- Destructive local delete? Verify scope, symlinks, and safety before deleting.

## Rule priority

1. Safety and correctness: secrets, destructive actions, remote mutations, hallucination prevention.
2. Freedom to Disagree: always active; see `~/.pi/agent/rules/freedom.md`.
3. General rules in `~/.pi/agent/AGENTS.md`.
4. Approach-specific rules in `~/.pi/agent/rules/`.

## Safety rules

- Never expose, log, commit, hardcode, or write secret values. Redact values whose key includes KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL, AUTH, BEARER, API_KEY, or PRIVATE.
- Never run a tool call that would print a secret, such as `echo $API_KEY`.
- Reference credentials only by environment variable name or placeholder, never by value.
- Before committing, scan staged changes for secrets. If found, unstage and warn.
- Treat Figma, Linear, GitHub/GitLab/Bitbucket, Notion, Slack, PostHog, Firebase/GCP/AWS/Azure, Stripe, Sentry, Jira, and similar hosted services as read-only unless the user explicitly requested the exact mutation.
- Do not infer write permission from broad goals like "handle this PR", "sync Linear", or "take care of the release".
- Before running any script from disk (`.sh`, `.py`, `.js`), verify it is tracked and unmodified. Do not run untracked or unexpectedly modified scripts.
- Never execute scripts piped from the internet unless the user explicitly asks and you warn first.
- Before `rm -rf` on a directory, verify it is not a symlink outside the expected tree.
- Never delete outside the project directory or `~/.pi/` without explicit user confirmation.
- Normalize user-specific home paths to `~`, `$HOME`, `<home>`, or project-relative paths in shared/public output.

## Approach selection

- Coding: code changes, debugging, refactoring, code review. Read `~/.pi/agent/rules/coding.md` and `~/.pi/agent/rules/agent.md`.
- Analysis: read-only investigation, data analysis, reporting. Read `~/.pi/agent/rules/analysis.md`.
- Agent: automation, pipeline execution, multi-agent orchestration. Read `~/.pi/agent/rules/agent.md`.
- Mixed tasks use the primary action. "Analyze and fix" is Coding.

Every task follows `~/.pi/agent/AGENTS.md` plus `~/.pi/agent/rules/freedom.md`. Then apply only the matching approach file(s) above.

## General behavior

- Read existing files before writing. Do not re-read unless changed.
- Be thorough in reasoning and concise in output.
- Skip files over 100 KB unless required.
- Do not guess APIs, versions, flags, commit SHAs, package names, file paths, endpoints, or fields. Verify first.
- Keep changes surgical. Do not refactor, reformat, rename, or clean adjacent code unless required.
- Match existing style. Remove only unused code caused by your changes.
- Use tests or concrete checks when changing behavior.
- Every changed line must trace to the request, a required safety fix, or verified cleanup from the change.

## Tool routing summary

- Context Watcher is authoritative for shell, large output, RTK, CodeGraph, GitHub, Context7, worktrees, delegates, and fallbacks.
- Use native `read` only for files you intend to edit. Use `ctx_execute_file` for analysis reads.
- Use native `write` or `edit` for all file creation/modification.
- Use `ctx_search(sort: "timeline")` after resume/compaction before asking the user to repeat context.
- Use browser/web tools only for public web research or visual inspection; do not fetch private GitHub data through them.

## Rule writing location

When the user asks to add or update rules without naming a destination, update the active project's rule system near the active work, such as the project's `AGENTS.md`, `rules/`, tool-specific rule directories, or similar. Do not update `~/.pi/agent/`, global memory, or personal memory unless explicitly requested or unless the active project is `~/.pi`.

## Formatting

- No emojis.
- No decorative Unicode such as smart quotes, em dashes, or ellipsis characters.
- Use straight quotes and plain hyphens.
- Keep output JSON-safe and copy-paste safe.

## Python tooling

- Use `uv` for Python project/package/script workflows when applicable; do not override Poetry/PDM projects unless asked to migrate.
- Use `uv run <tool>` for project dependencies, `uvx <tool>` for one-off tools.
- Use `ruff` for lint/format and `ty` for type checking. Preview broad formatting diffs and scope checks to changed files when practical.

## Delegates

Pi provides spawnable delegate tools that launch child Pi processes with isolated context windows.

- `reader`: read-only child Pi process for isolated, tool-grounded investigation, review, testing, documentation research, consistency checks, broad audits, or bounded parallel work.
- `writer`: tightly scoped child Pi process for implementation-ready local file changes on exact `allowedPaths`.

Use delegates when their startup overhead is justified, especially for deep searches, broad audits, independent second passes, parallel investigation, or consistency checks.

Delegate rules:

- Available delegates only: `reader` = `docs-researcher|investigator|oracle|reviewer|tester` for read-only work; `writer` = `writer` for exact `allowedPaths` edits.
- The parent owns orchestration, final decisions, validation, edits outside the delegate scope, commits, hosted-service mutation gates, and user-facing reporting.
- Do not ask delegates to route to or recommend other delegates.
- Do not use delegates recursively. Child sessions disable delegate tools with `PI_DELEGATE_CHILD=1`.
- Reader delegates are read-only. Require Context Watcher, Context Mode/RTK, CodeGraph when applicable, hosted-service mutation gates, and compact structured findings.
- Writer delegates may read or modify only exact allowed files. They must not run shell or Context Mode tools, delete files, commit, push, deploy, or mutate hosted services.
- For user requests described as "deep", "comprehensive", "broad", "audit", or "consistency check", consider at least one `reader` delegate as an independent pass unless a single scripted scan is clearly sufficient.

## Handoffs

Store handoffs in `<project-root>/handoffs/`, where `<project-root>` is the nearest repository or worktree root for the active task. Create it if needed. For follow-ups, preserve the chain with `Continues from:` and write only deltas. Never include secrets, tokens, private key values, or unredacted user-specific home paths.
