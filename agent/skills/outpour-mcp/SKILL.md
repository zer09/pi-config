---
name: outpour-mcp
description: Query an Outpour ministry through MCP and make explicitly requested contact or task changes. Use for Outpour data, tool schemas, and feature studies, not generic CRM or newsletter work.
---

# Outpour MCP

Use the bundled headless helper for Outpour reads by default. Contact and task writes require the user's explicit instruction for the exact hosted change.

## Access and limits

This helper is an intentional manual-key fallback, not an OAuth implementation. The [official setup guide](https://outpour.app/help/set-up-outpour-mcp) recommends OAuth for interactive clients and manual keys only when OAuth is unavailable. Point interactive users to that guide. Only owners enable MCP and create/revoke keys; admins can connect once enabled.

- Recommend Node.js 22 or newer; offline tests ran on 24.22.1.
- Require an existing `OUTPOUR_API_KEY` environment variable. Check only whether it exists; stop if missing. Never print, persist, or include the key in commands, logs, or files.
- Use only `https://mcp.outpour.app/mcp`. `OUTPOUR_MCP_URL` may be absent, empty, or exactly that string; every different value and all redirects are rejected. Do not substitute another endpoint.
- Each request has a 30-second deadline and an 8 MiB response limit. Tool discovery validates all catalog pages, up to 100, separately from ministry-record pagination. The helper requires protocol `2025-03-26`.
- OAuth migration, MCP-client setup, login/configuration changes, and auth-token persistence require a separate explicit request. Do not perform automatic setup or save a key to make a read work.

Resolve `scripts/outpour-mcp.mjs` relative to this `SKILL.md`. The commands below assume this skill directory is the working directory.

## Feature-study workflow

1. Run `list` to get the current server tool inventory and read/write labels.
2. Run `describe <tool-name>` before the first call to a tool. Use its current input schema instead of guessing arguments.
3. Start with metadata, then sample only the small read the user requested. Set the lowest useful `limit`; omit expanded details and content by default. Consult filter options before guessing tag or status IDs.
4. Follow record pagination only when the request requires it. Do not enumerate an entire ministry by default.
5. Minimize personal details, internal notes, and giving records in both retrieval and reporting. Summarize behavior and data shape unless the user needs specific records. Do not retain sensitive arguments or results.
6. Treat fields ending in `Cents` as integer minor-unit amounts. Format them as currency when reporting results.

## Supported scope

Use current official tool schemas as authoritative, not a fixed tool snapshot:

- Contacts support search, filters, options, and detail, plus `add_contact` and `edit_contact_notes` for authorized changes.
- Donations and sponsorships are read-only. Tasks support `read_tasks`, `add_task`, and `edit_task`, including completion and reopening.
- Partnerships expose detail, goals, commitments, and progress. Newsletters expose drafts and published items; request bodies only when the user asks.

Do not attempt payment credentials, transactions, refunds, cancellation, transfers, sending messages/newsletters, publishing newsletters, deleting tasks, or cross-ministry access.

## Commands

List tools concisely:

```bash
node scripts/outpour-mcp.mjs list
```

Get the full live catalog or inspect one schema before a call:

```bash
node scripts/outpour-mcp.mjs list --json
node scripts/outpour-mcp.mjs describe read_contacts
```

After the current schema confirms the arguments, a minimal requested read can use stdin:

```bash
printf '%s\n' '{"limit":1}' | node scripts/outpour-mcp.mjs call read_contacts -
```

Prefer stdin (`-`) from an in-memory producer for complex or sensitive JSON; never type sensitive values into shell commands/history. Inline JSON objects are supported; omitting arguments sends `{}`. `@<path>` also works if needed: securely create a unique private OS-temp file with owner-only permissions, write only the arguments, and clean it up promptly even after failure. Do not use a shared fixed path or retain arguments/results in the repository.

## Mutation boundary

Treat every tool whose live annotation is not strictly `readOnlyHint === true` as a hosted-service write, including missing or nonboolean hints.

- Never run write smoke tests or use writes merely to demonstrate a feature.
- Run only the exact user-authorized change, with the authorized target and values. A feature study or permission to read is not write authorization.
- Inspect the live schema and read the target record first when an exact ID or current value is required.
- Explain effects before note/task writes: `edit_contact_notes` replaces notes by default; append and clear are possible. For `edit_task`, omitted fields stay unchanged, whereas `null` can clear fields allowed by the schema. Confirm the requested mode and fields rather than assuming replacement or clearing is safe.
- Add `--allow-write` only after these conditions are satisfied, as the final CLI flag. The flag bypasses the helper's write guard; it does not provide user authorization. Do not retry a failed write automatically.

## Error handling

- `401` or `403`: check only key presence and ask the owner to verify MCP enablement/key validity. Do not display the key or change access/configuration.
- Unknown tool or rejected arguments: refresh `list` and `describe` within the requested read scope; the current schema is authoritative.
- Task failure: ask whether the ministry has Tasks enabled; do not enable it automatically.
- Connection, protocol, or bound failure: stop and report a sanitized diagnostic, without request headers, credentials, or raw sensitive records. Do not bypass endpoint or transport checks.

## Completion

Deliver the requested findings or exact authorized change outcome with minimal personal data. Distinguish schema evidence from sampled records and state untested or unsupported behavior. A nonzero exit or tool `isError` is failure, not completion; stop on missing access, authority, or schema evidence rather than expanding scope.

## Maintenance

Follow the [maintenance README](../../../docs/skills/README.md) and [Outpour update process](../../../docs/skills/outpour-mcp-update-process.md) for source ownership, preserved safeguards, and offline acceptance checks.
