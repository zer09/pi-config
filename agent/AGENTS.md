# Global Pi Agent Instructions

These are my global preferences for Pi sessions. Project-local `AGENTS.md` or `CLAUDE.md` files may add more specific instructions; follow the most specific applicable instruction when they differ.

## Communication

- Be concise, direct, and practical.
- State assumptions and risks when they matter.
- Ask before making ambiguous, destructive, or broad changes.
- Sensitive/private info may be displayed unredacted when it is only shown in your local TUI terminal. Redaction is required before saving, committing, pushing, uploading, sharing, or sending it to external services.

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

## CodeGraph tooling

- When `codegraph_*` tools are available, use CodeGraph as the primary source-code understanding path for indexed projects; prefer `codegraph_explore` over `read`/`grep`/`find` exploration.
- Use `codegraph_files` to list/discover CodeGraph-indexed source files, verify whether a source file is indexed, browse by path/language/error state, or replace raw `find`/`rg --files` only when the question is specifically about indexed files. It does not read contents.
- Use `codegraph_node` for one indexed symbol body or indexed source file; prefer it over `read` for indexed source because it includes graph context. For “what does this call?”, prefer `codegraph_node` because the symbol body and trail include callees; use `codegraph_callees` only for a terse callee list.
- Use `codegraph_search` only to locate indexed symbols by name, `codegraph_callers` before refactoring a named symbol to find call sites/callback registrations, `codegraph_impact` for explicit deeper blast-radius analysis, and `codegraph_status` for index/sync health.
- Trust CodeGraph results and avoid re-verifying with grep/read loops; fall back to raw file tools for docs/configs/unindexed files, exact ranges not covered, real filesystem questions, or stale files after edits.

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
- Follow YAGNI: implement only what is needed now. Prefer simple one-liner solutions when they are clear, readable, and sufficient.
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
