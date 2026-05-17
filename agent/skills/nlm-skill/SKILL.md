---
name: nlm-skill
description: "Expert guide for the NotebookLM CLI (`nlm`) and MCP server. Use when users want to automate Google NotebookLM: create or manage notebooks, add URL/YouTube/text/Drive sources, generate podcasts/audio overviews, reports, quizzes, flashcards, mind maps, slides, infographics, videos, data tables, conduct research, chat with sources, or run NotebookLM workflows. Triggers on `nlm`, `notebooklm`, `notebook lm`, podcast generation, audio overview, NotebookLM research, NotebookLM MCP, and NotebookLM CLI tasks."
---

# NotebookLM CLI and MCP

Use this skill for Google NotebookLM automation through the `nlm` CLI or NotebookLM MCP tools. Prefer the exact source reference for details rather than relying on memory.

## Tool selection

- Detect available NotebookLM MCP tools first, then check whether the `nlm` CLI is installed.
- Prefer MCP tools for direct NotebookLM operations when the needed tool is available.
- Prefer CLI commands when the user asks for CLI usage, automation scripts, profiles, `nlm --ai`, or exact command behavior.
- If both MCP and CLI are available and the choice affects account/profile, output format, or repeatability, ask which interface to use.
- If only one interface is available, use it.

## Safety rules

- Authenticate before operations: `nlm login`, then `nlm login --check` when needed.
- Sessions expire in about 20 minutes; re-run `nlm login` after auth failures.
- Treat NotebookLM and Google Drive/Docs/Sheets changes as external hosted service mutations. Create, add, import, generate, rename, share, invite, export, sync, configure, tag, and delete only when the user explicitly requests that exact action.
- Before any delete, ask for explicit confirmation even if the CLI command has `--confirm`. Deletions are irreversible.
- Never print cookies, OAuth tokens, browser profile secrets, or raw auth headers.
- Do not use `nlm chat start`; it opens an interactive REPL. Use `nlm notebook query` for one-shot Q&A.
- Use Context Mode/RTK for CLI commands and for outputs that may exceed 20 lines.
- Prefer default compact output for status checks, `--quiet` for captured IDs, and `--json` only when parsing fields programmatically.

## Quick commands

```bash
nlm --help
nlm --ai
nlm --version
nlm login
nlm login --check
nlm notebook list
nlm notebook create "Title"
nlm source add <notebook-id> --url "https://example.com"
nlm notebook query <notebook-id> "question"
nlm research start "query" --notebook-id <notebook-id>
nlm studio status <notebook-id>
```

## Common workflows

### Create a notebook and add sources

```bash
nlm login
nlm notebook create "Research Notebook"
nlm alias set research <notebook-id>
nlm source add research --url "https://example.com/article"
nlm source add research --text "Notes..." --title "Notes"
nlm source list research
```

### Research then generate an audio overview

```bash
nlm research start "topic" --notebook-id research --mode deep
nlm research status research --max-wait 300
nlm research import research <task-id>
nlm audio create research --confirm
nlm studio status research
```

Use `nlm research import <notebook-id> <task-id> --cited-only` when the user wants only sources cited by the research report.

### Generate study materials

```bash
nlm report create <notebook-id> --format "Study Guide" --confirm
nlm quiz create <notebook-id> --count 10 --focus "Key concepts" --confirm
nlm flashcards create <notebook-id> --focus "Vocabulary" --confirm
```

## Command map

- Auth and profiles: `nlm login`, `nlm login profile ...`, `nlm login switch`.
- Notebooks: `nlm notebook list/create/get/describe/query/rename/delete`.
- Sources: `nlm source add/list/get/describe/content/stale/sync/rename/delete`.
- Research: `nlm research start/status/import`.
- Studio generation: `nlm audio/report/quiz/flashcards/mindmap/slides/infographic/video/data-table create`.
- Artifact management: `nlm studio status/rename/delete`, `nlm download ...`, `nlm export ...`.
- Collaboration: `nlm share status/public/invite`.
- Notes and chat config: `nlm note ...`, `nlm chat configure ...`.
- Organization: `nlm alias ...`, `nlm tag ...`, `nlm batch ...`, `nlm cross query ...`, `nlm pipeline ...`.
- Skill management: `nlm skill list/install/update/uninstall`.

## References

- `references/command_reference.md`: complete command signatures and options from the upstream source.
- `references/workflows.md`: end-to-end NotebookLM task sequences.
- `references/troubleshooting.md`: auth, network, rate limit, syntax, and generation recovery.
- `references/agents-section.md`: upstream AGENTS.md snippet adapted for local use.
- `../../../docs/skills/nlm-skill-update-process.md`: source-of-truth and update workflow for future agents.
