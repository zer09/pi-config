---
name: linear-cli
description: "Manage Linear from the terminal with the local `linear` CLI. Use for reading/searching issues, teams, projects, cycles, labels, documents, and GraphQL API data, or for drafting/running Linear mutations only when the user explicitly requests the exact hosted-service write."
---

# Linear CLI

Use the local `linear` command for Linear reads and carefully gated writes. Linear is an external hosted service: stay read-only unless the user explicitly requests the exact create, update, delete, comment, assign, label, attach, link, relation, close, reopen, auth, or other mutation.

## Core rules

- Prefer the installed `linear` command. Verify with `linear --version`; if missing, suggest `npx @schpet/linear-cli` instead of installing unless the user asks.
- Use Context Mode for read-only commands that may exceed 20 lines: issue searches, schema output, GraphQL JSON, comments, documents, or generated help.
- Before any mutation, verify the target identifier, team/project/workspace, command, flags, and body file. If the user did not request that exact mutation, provide a command draft instead of running it.
- Never print tokens. `linear auth token` writes a secret to stdout; do not run it in a way that enters the transcript, logs, shell history, or committed files.
- Do not guess flags or required fields. Check `linear <command> --help` or the local reference files before syntax-sensitive answers.

## Discovery workflow

```bash
linear --version
linear --help
linear issue --help
linear issue view --help
linear team list
```

Use `linear team list` or project/cycle list commands to resolve identifiers before writes. Some commands infer team from repository config, but do not rely on inference for mutations.

## Reference navigation

Start with [commands](references/commands.md), then open the smallest command reference needed:

- [auth](references/auth.md) - authentication and identity
- [issue](references/issue.md) - issues, comments, links, relations, agent sessions
- [team](references/team.md), [project](references/project.md), [cycle](references/cycle.md), [milestone](references/milestone.md)
- [initiative](references/initiative.md), [initiative-update](references/initiative-update.md), [project-update](references/project-update.md)
- [label](references/label.md), [document](references/document.md), [config](references/config.md)
- [schema](references/schema.md), [api](references/api.md) - GraphQL fallback
- [organization-features](references/organization-features.md) - curated examples for organization workflows

## Issue and comment content

For Markdown descriptions or comment bodies, prefer file-based flags:

```bash
linear issue create --title "<title>" --description-file <description.md>
linear issue update <ISSUE-ID> --description-file <description.md>
linear issue comment add <ISSUE-ID> --body-file <comment.md>
```

Use inline `--description` or `--body` only for simple one-line text. File flags preserve formatting, avoid shell escaping issues, and prevent literal `\n` from appearing in Linear.

Known gotchas:

- `issue list` requires a sort order: pass `--sort manual` or `--sort priority`, or configure `issue_sort` / `LINEAR_ISSUE_SORT`.
- `issue list` usually needs `--team <key>` unless team inference is verified.
- `--no-pager` is only supported on `issue list`; do not pass it to commands like `project list`.

## GraphQL fallback

Prefer first-class CLI commands. Use `linear api` only when the CLI does not expose the needed read or mutation.

```bash
linear schema -o "${TMPDIR:-/tmp}/linear-schema.graphql"
rg -n "type Issue|cycle" "${TMPDIR:-/tmp}/linear-schema.graphql"
```

Pass GraphQL queries with variables through heredoc stdin, especially when a query contains non-null markers such as `String!`:

```bash
linear api --variable teamId=<team-id> <<'GRAPHQL'
query($teamId: String!) { team(id: $teamId) { name } }
GRAPHQL
```

For JSON processing, run the command inside Context Mode and print only the derived fields. Avoid direct `curl` unless full HTTP control is required and the user explicitly requested the operation.

## Maintenance

Update this Local Skill using `../../../docs/skills/linear-cli-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md` and keep generated command catalogs in `references/`, not in this runtime file.
