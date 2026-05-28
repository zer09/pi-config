---
name: gh-cli
description: "GitHub CLI, or gh, is a command-line interface to GitHub for use in your terminal or scripts. Use for gh command syntax, flags, subcommands, authenticated GitHub repo/issue/PR/release/workflow operations, and GitHub automation from the command line."
---

# GitHub CLI

Use `gh` for authenticated GitHub repository, issue, pull request, release, workflow, and API work. Keep this file as the runtime router; exact command syntax lives in `references/`.

## Operating rules

- Prefer authenticated `gh` CLI for GitHub data, work, and transactions, especially private repositories and PR/issue/review/workflow/release operations.
- Normalize HTTPS or SSH GitHub links to `gh` commands from memory when the route is obvious; use `uv run python ~/.pi/agent/skills/gh-cli/scripts/normalize_github_url.py <url>` only when the URL shape is ambiguous or deterministic JSON output is useful.
- For read-only shell operations in Pi, run `gh` through Context Mode/RTK when available, for example `ctx_execute` or `ctx_batch_execute` with `rtk gh ...`.
- Treat GitHub writes as external hosted service mutations. Do not create, update, delete, comment, review, label, merge, dispatch workflows, publish releases, set secrets, or push unless the user explicitly asked for that exact write.
- Do not expose tokens. Refer to token environment variables by name only, for example `GITHUB_TOKEN` or `GH_ENTERPRISE_TOKEN`.
- Prefer `--json`, `--jq`, `--template`, `--repo OWNER/REPO`, and `--hostname HOST` for scriptable output.

## Minimal local examples

Keep the command library in `references/index.md`; these examples only show local preferences for URL normalization, `--repo`, `--json`, and paginated API reads.

```bash
uv run python ~/.pi/agent/skills/gh-cli/scripts/normalize_github_url.py https://github.com/OWNER/REPO/pull/123
gh pr view 123 --repo OWNER/REPO --comments --json number,title,body,files,commits,reviews
gh api repos/OWNER/REPO/pulls/123/files --paginate
```

## Reference navigation

- `references/index.md` - command-family map and path rules.
- `references/<command>.md` - top-level command help, for example `references/pr.md`.
- `references/<command>/<subcommand>.md` - subcommand help, for example `references/pr/view.md`.
- `references/help/<topic>.md` - `gh help <topic>` pages.
- `scripts/normalize_github_url.py` - deterministic parser for GitHub HTTPS and SSH URLs.

## Maintenance

For future updates to this generated skill, read `../../../docs/skills/gh-cli-update-process.md`.
