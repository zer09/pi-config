---
name: notion
description: "Operate Notion workspaces with the official `ntn` CLI: search and read content; create, edit, or trash pages; query databases/data sources; create or update rows and tasks; upload files; manage workers; and turn conversations, research, meetings, specs, or code changes into linked documentation and tracked work. Use whenever a request mentions Notion, a Notion URL/page/database/task/board, workspace search, knowledge capture, meeting prep, or Notion workers."
---

# Notion

Use the official `ntn` CLI. Treat it as self-documenting; discover current syntax instead of guessing.

## Guardrails

- Keep read-only requests read-only. Mutate Notion only when the user explicitly requests the hosted-service write.
- Resolve the exact page, parent, database, data source, or worker before writing. Ask if matches, destinations, or property mappings are materially ambiguous.
- Check for an exact-title sibling before creating a page; ask whether to reuse it or create another.
- Fetch a page before editing it. `ntn pages edit` replaces its body; preserve existing content unless a rewrite was requested.
- Confirm trashing, broad replacement, and any edit requiring `--allow-deleting-content`; never add `--yes` without prior confirmation.
- Inspect database/data-source schemas and allowed values before writes. Do not invent properties, statuses, users, or relations.
- Never print, save, or expose authentication tokens.

## Setup and discovery

1. Check `command -v ntn`. If absent, ask before installing with `curl -fsSL https://ntn.dev | bash`.
2. Check authentication with `ntn whoami`. Prefer an existing `NOTION_API_TOKEN`; otherwise use `ntn login`. If a pages/API command still requires an integration token, ask the user to configure one and share the target content with that integration.
3. Minimize context while discovering syntax:
   - `ntn <command> --help`
   - `ntn api ls`
   - `ntn api <path> --help`
   - `ntn api <path> --spec` for schemas
   - `ntn api <path> --docs` only when the reduced spec is insufficient

## Operation map

- Search/find: inspect `ntn api v1/search --help`; return 5–10 strong matches, not raw JSON.
- Read page content: `ntn pages get <page-id>`; retry with `--json` only if Markdown is truncated.
- Create/edit Markdown pages: inspect `ntn pages create --help` or `ntn pages edit --help` first.
- Query a database: resolve it with `ntn datasources resolve <database-id>`, then use `ntn datasources query <data-source-id>` with a reasonable limit (usually 20–50).
- Manage properties, comments, schemas, or unsupported page operations: use `ntn api` after inspecting that endpoint.
- Upload files: inspect `ntn files --help`.
- Manage workers: inspect `ntn workers --help` and the target subcommand.

## Execution loop

1. Parse a Notion URL/ID directly when supplied; otherwise search and resolve the target.
2. Fetch enough context and schema to avoid assumptions.
3. Ask only for ambiguity that affects the result or safety.
4. Execute the smallest requested operation.
5. Verify from the response or re-fetch, then report the title, parent/database, key changed properties, and URL/ID.

For knowledge capture, research synthesis, meeting preparation, spec/task tracking, task-board operation, or code-change documentation, read [workflows.md](references/workflows.md). Do not load it for simple CRUD, search, file, or worker requests.

## Maintenance

Follow [the Notion update process](../../../docs/skills/notion-update-process.md).
