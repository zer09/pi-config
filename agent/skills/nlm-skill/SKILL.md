---
name: nlm-skill
description: "Operate NotebookLM/Gemini Notebook through the nlm CLI or MCP. Use when the user requests operations or troubleshooting through those interfaces, not generic research or document critique."
---

# Gemini Notebook CLI and MCP

## Safety and authorization

- Default to read-only. Inspection, questions, and status checks do not authorize follow-on writes.
- Treat NotebookLM and Google Drive/Docs/Sheets changes as external hosted service mutations. Every create, add, import, generate, rename, share, invite, export, sync, configure, tag, or delete action needs an exact user request and target. Apply the same scope rule to local exports, aliases, profiles, and configuration.
- A requested create/generate action already authorizes that action on the specified target; do not ask again unless target or scope is ambiguous. It does not authorize adding sources, sharing, exporting, or cleanup unless requested too.
- Before any delete, ask for explicit confirmation of the exact target even if the command has `--confirm`. Deletions are irreversible.
- Preserve Studio confirmation: direct generation commands require `--confirm`; MCP uses its confirmation gate. Do not bypass confirmation through batch, pipeline, or MCP paths.
- Never print cookies, OAuth tokens, browser profile secrets, or raw auth headers. Never expose `notebooklm-mcp` directly to the public internet; read the remote reference before planning remote access.

## Tool choice

- Detect available NotebookLM MCP tools first, then check whether `nlm` is installed. Prefer MCP for direct operations when the needed tool is available.
- Prefer CLI for requested CLI usage, automation scripts, profiles, `nlm --ai`, or exact command behavior. If only one interface is available, use it.
- If both are available and the choice affects account/profile, output format, or repeatability, ask which interface to use. Do not install or configure a missing interface merely to satisfy a read request.

## Task routing

Load only the reference needed for the requested task. Examples are command guidance, not authorization to execute a whole workflow.

| Need | Reference |
| --- | --- |
| Exact command signatures, flags, or supported operations | [Command reference](references/command_reference.md) |
| An authorized multi-step task or automation sequence | [Workflows](references/workflows.md) |
| Authentication, network, rate-limit, syntax, or generation failure | [Troubleshooting](references/troubleshooting.md) |
| Requested Studio generation: prompt mode and settings | [Studio prompting guide](references/studio-prompting-guide.md); [prompt examples](references/studio-prompt-examples.md) when needed |
| Remote MCP deployment or server-host file paths | [Remote MCP security and account isolation](references/remote-mcp.md) |
| Requested host-instruction integration | [Adapted AGENTS snippet](references/agents-section.md) |

## Key correctness rules

- Authenticate only when needed: `nlm login` for first-time setup or confirmed stale credentials; `nlm login --check` when useful. Cookies can remain usable for weeks, so elapsed time alone does not require login.
- Auth status `unverified` is not expiry. Check connectivity or try a safe API call first; the CLI retries transient failures and performs automatic auth recovery.
- Never use `nlm chat start`, which opens an interactive REPL. Use `nlm notebook query` for one-shot Q&A.
- Research needs an authorized destination: `--notebook-id <id>` for an existing notebook or `--title <title>` for requested creation. Research status does not authorize import; stale sources do not authorize sync. Check existing aliases before creating another alias.
- Keep output bounded when it may exceed 20 lines: compact output, `--quiet`, filtered `--json`, or temp files. Prefer compact status, `--quiet` for captured IDs, and JSON only for programmatic parsing.

## Completion

Report the requested result and the notebook/artifact target, using a fresh read or status check to verify authorized changes. Distinguish submitted, pending, completed, and failed operations. Stop at missing authority, ambiguous targets, auth failure, or unavailable dependencies; do not repair these through unrequested writes or deletion.

## Maintenance

Follow the [NLM update process](../../../docs/skills/nlm-skill-update-process.md). Preserve local safety overlays and MCP dependency metadata when comparing upstream.
