---
name: nlm-skill
description: "Expert guide for the Gemini Notebook (formerly Google NotebookLM) CLI (`nlm`) and MCP server. Use when users want to automate NotebookLM or Gemini Notebook: manage notebooks and sources, generate podcasts or study artifacts, conduct research, chat with sources, or run CLI/MCP workflows. Triggers on `nlm`, `notebooklm`, `Gemini Notebook`, podcast generation, audio overview, document critique, and NotebookLM automation."
---

# Gemini Notebook CLI and MCP

Use this skill for Gemini Notebook, formerly Google NotebookLM, automation through the `nlm` CLI or MCP tools. Prefer the exact source reference for details rather than relying on memory.

## Tool selection

- Detect available NotebookLM MCP tools first, then check whether the `nlm` CLI is installed.
- Prefer MCP tools for direct NotebookLM operations when the needed tool is available.
- Prefer CLI commands when the user asks for CLI usage, automation scripts, profiles, `nlm --ai`, or exact command behavior.
- If both MCP and CLI are available and the choice affects account/profile, output format, or repeatability, ask which interface to use.
- If only one interface is available, use it.

## Safety rules

- Authenticate only when needed: use `nlm login` for first-time setup or confirmed stale credentials, then `nlm login --check` when useful.
- Saved cookies can remain usable for weeks. Do not force repeated login because of elapsed time alone.
- Do not treat auth status `unverified` as expired by itself; check connectivity or try a safe API call first. The CLI retries transient server failures and performs automatic auth recovery.
- Treat NotebookLM and Google Drive/Docs/Sheets changes as external hosted service mutations. Create, add, import, generate, rename, share, invite, export, sync, configure, tag, and delete only when the user explicitly requests that exact action.
- Before any delete, ask for explicit confirmation even if the CLI command has `--confirm`. Deletions are irreversible.
- Preserve confirmation for Studio generation. Direct Studio commands require `--confirm`; do not bypass confirmation through a batch or MCP path.
- Never print cookies, OAuth tokens, browser profile secrets, or raw auth headers.
- Do not use `nlm chat start`; it opens an interactive REPL. Use `nlm notebook query` for one-shot Q&A.
- Never expose `notebooklm-mcp` directly to the public internet. If remote MCP access is needed, read `references/remote-mcp.md` first.
- Keep CLI output bounded. Use compact output, `--quiet`, `--json` with filters, or temp files for outputs that may exceed 20 lines.
- Prefer default compact output for status checks, `--quiet` for captured IDs, and `--json` only when parsing fields programmatically.
- Research requires a destination: pass `--notebook-id <id>` or `--title <title>`. Check existing aliases before creating another alias.

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
nlm research start "query" --title "New Research"
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
- Sources: `nlm source add/list/get/describe/content/stale/sync/rename/delete`; current CLI releases also support local file and image upload through `source add --file`.
- Research: `nlm research start/status/import`.
- Studio generation: `nlm audio/report/quiz/flashcards/mindmap/slides/infographic/video/data-table create`.
- Artifact management: `nlm studio status/rename/delete`, `nlm download ...`, `nlm export ...`.
- Collaboration: `nlm share status/public/invite`.
- Notes and chat: `nlm note ...`, `nlm chat configure ...`, and `nlm chats list/get/export` for saved conversations.
- Organization: `nlm alias ...`, `nlm tag ...`, `nlm batch ...`, `nlm cross query ...`, `nlm pipeline ...`.
- Skill management: `nlm skill list/install/update/uninstall`.

## References

- `references/command_reference.md`: complete command signatures and options from the upstream source.
- `references/workflows.md`: end-to-end NotebookLM task sequences.
- `references/troubleshooting.md`: auth, network, rate limit, syntax, and generation recovery.
- `references/remote-mcp.md`: Streamable HTTP MCP deployment and security boundary.
- `references/studio-prompting-guide.md`: Studio prompt mode selection and generation guidance.
- `references/studio-prompt-examples.md`: fast-track and guided prompt examples for Studio artifacts.
- `references/agents-section.md`: upstream AGENTS.md snippet adapted for local use.

## Maintenance

For future updates to this NotebookLM skill, read `../../../docs/skills/nlm-skill-update-process.md`.
