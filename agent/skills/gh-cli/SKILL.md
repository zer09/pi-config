---
name: gh-cli
description: "GitHub CLI, or gh, is a command-line interface to GitHub for use in your terminal or scripts. Use for gh command syntax, flags, subcommands, authenticated GitHub repo/issue/PR/release/workflow operations, and GitHub automation from the command line."
---

# GitHub CLI

Use `gh` for authenticated GitHub repository, issue, pull request, release, workflow, and API work. Keep this file as the runtime router; exact command syntax lives in `references/`.

## Operating rules

- Prefer authenticated `gh` CLI for GitHub data, especially private repositories and PR/issue/review/workflow/release operations.
- For GitHub HTTPS or SSH URLs, run `uv run python ~/.pi/agent/skills/gh-cli/scripts/normalize_github_url.py <url>` and read the returned `references` before using or adapting the single primary `gh.argv`.
- For read-only shell operations in Pi, run `gh` through Context Mode/RTK when available, for example `ctx_execute` or `ctx_batch_execute` with `rtk gh ...`.
- Treat GitHub writes as external hosted service mutations. Do not create, update, delete, comment, review, label, merge, dispatch workflows, publish releases, set secrets, or push unless the user explicitly asked for that exact write.
- Do not expose tokens. Refer to token environment variables by name only, for example `GITHUB_TOKEN` or `GH_ENTERPRISE_TOKEN`.
- Prefer `--json`, `--jq`, `--template`, `--repo OWNER/REPO`, and `--hostname HOST` for scriptable output.

## Runtime workflow

1. Identify the repository as `OWNER/REPO`; normalize a GitHub URL with the bundled script when a URL is provided.
2. Read `references/index.md` to choose the command family.
3. Read the exact top-level or subcommand reference file before relying on flags or output fields.
4. Run read-only commands through Context Mode/RTK when output may be large.
5. If a write is needed, stop unless the user explicitly requested that exact GitHub mutation.

## Common read-only examples

```bash
gh auth status
gh repo view OWNER/REPO --json name,description,url
gh issue list --repo OWNER/REPO --state open --json number,title,author,state
gh issue view 123 --repo OWNER/REPO --comments
gh pr list --repo OWNER/REPO --state open --json number,title,author,isDraft,reviewDecision
gh pr view 123 --repo OWNER/REPO --comments --json number,title,body,files,commits,reviews
gh run list --repo OWNER/REPO --limit 20
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
