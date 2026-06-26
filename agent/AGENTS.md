# Global Agent Instructions

These are my global preferences for Agent sessions. Project-local `AGENTS.md` or `CLAUDE.md` files may add more specific instructions; follow the most specific applicable instruction when they differ.

## Communication

- Be concise, direct, and practical.
- State assumptions and risks when they matter.
- Ask before making ambiguous, destructive, or broad changes.
- Sensitive/private info may be displayed unredacted when it is only shown in your local TUI terminal. Redaction is required before saving, committing, pushing, uploading, sharing, or sending it to external services.
- When showing a code block from a file, include the block's starting line number when known.

## Glossary

- "Pi" or "pi" means the Pi agent harness from pi.dev unless context clearly indicates otherwise.
- "read-only" or "investigate" means analyze only; do not create, edit, update, delete, or otherwise alter anything.
- "leave changes unstaged" means edit files only; do not stage, unstage, stash, revert, commit, or push changes unless explicitly told.
- First-person singular terms ("I", "me", "my") refer to the human user/prompter.
- Second-person terms ("you", "your", "yourself") refer to the assistant/agent/AI.
- First-person plural terms ("we", "us", "our") refer to the human user and assistant collectively.

## Version Control

- Do not commit changes unless explicitly told to commit.
- Do not push changes unless explicitly told to push.

## File Operations

### File Reading

- Use `offset` and `limit` to target relevant sections unless a full-file read is necessary.
- Avoid re-reading entire large files when only a section is needed.

### File Editing

- Avoid shell redirection (`>`, `>>`, heredocs, `tee`) when editing files; use the available file-editing tools instead.

## Tool routing

- For source-code understanding in indexed projects, use CodeGraph first: `codegraph_explore` for areas/flows/reviews/bugs, `codegraph_node` for exact indexed files/symbols, `codegraph_search` for known names, and `codegraph_callers`/`codegraph_impact` before refactors. Trust CodeGraph results; do not re-read or grep just to verify them. Fall back only for docs/configs/unindexed/stale/exact edit-region reads.
- Use Context Mode tools (`ctx_batch_execute`, `ctx_execute_file`, `ctx_search`) for read-only shell work likely to exceed ~20 lines, multiple diagnostics, searches, git history/diffs, tests/builds/lints/typechecks, logs, large JSON/CSV, or any truncated command output.
- Prefer `ctx_batch_execute` for command sets/noisy output and `ctx_execute_file` for large local files or saved command output. If they do not surface the needed answer, use `ctx_search` on the indexed output before rerunning, switching tools, or asking the user.
- For GitHub repo/issue/PR/release/workflow reads or writes, use the `gh-cli` skill and authenticated `gh`; do not use browser/web tools on github.com unless explicitly asked for public web research.
- Use direct `bash` only for short low-output local checks or explicitly requested state-changing commands; do not use it for broad source/log/git/test output when `ctx_*` tools can index and filter.
- Use native `read` for small targeted ranges and exact edit regions, and native `edit`/`write` for all file changes.

## Python tooling

- Use `uv` for Python project/package/script workflows when applicable; do not override Poetry/PDM unless asked.
- Use `uv run <tool>` for project tools/deps, `uvx <tool>` for one-off Python CLIs.
- Use `python3`, `ruff` for lint/format, and `ty` for type checks by default when applicable.

## Task Mode

Classify each request by the action requested, not by the topic.

### Read-only mode default

- Default to read-only investigation unless the latest user request explicitly asks to change files, git state, hosted services, or other persistent state.
- Treat questions, reviews, audits, explanations, and requests using words like "analyze", "investigate", "check", "look at", or "review" as read-only.
- In read-only mode, do not create, edit, delete, stage, unstage, commit, push, or run state-changing commands.

### Change mode

- Enter change mode only when the user clearly asks for a specific change, such as "edit", "update", "fix", "implement", "apply", "create", "delete", "stage", "commit", or "push".
- Make the smallest change that satisfies the request.
- Ask before proceeding when the requested change is ambiguous, destructive, or broader than the stated scope.

#### Code changes

- When ambiguity would change the implementation, state it and ask or choose the safest narrow interpretation.
- For multi-step coding work, define concrete success checks before editing when practical.
- Make the simplest working change. Do not declare dead variables or add parameters (even with defaults) if they are never actively used.
- Use ternary expressions only for simple two-way conditionals when they improve clarity; avoid nested or chained ternaries, and prefer `if`/`else`, guard clauses, or named intermediate variables for multi-branch logic.
- Keep changes surgical and style-matched.
- Do not add speculative features, premature abstractions, or impossible-case handling.
- Do not add docstrings, type annotations, renames, reformatting, or cleanup outside the touched scope unless required.
- Three similar lines are better than a premature abstraction or extracting a tiny, single-use function.

## Response Style

### Change tasks

- Start with changed file paths or the commit hash when applicable.
- Summarize what changed and mention any tests or checks run.
- Explain only non-obvious decisions, risks, or follow-ups.
- Avoid boilerplate, praise, and unrelated suggestions.

### Read-only tasks

- Lead with the finding or conclusion.
- Prefer bullets and tables over long prose.
- Put context and method after the result.
- End with caveats or limits when relevant.
