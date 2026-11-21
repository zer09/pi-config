# GitHub CLI reference index

Use this index when the command family, exact flags, or output fields are not obvious. Each command reference was generated from local `gh help` output and includes the manual URL, summary, subcommand links, and full help text.

Verified against the prepared `gh version 2.105.0 (2026-11-17)` candidate: 243 command/alias pages, eight help topics, and [root help](gh.md). Unchanged pages retain their earlier generator attribution after a complete normalized help comparison.

Runtime route: identify the repository as `OWNER/REPO`; convert obvious GitHub HTTPS or SSH URLs directly to the matching `gh` command; use `../scripts/normalize_github_url.py` only when conversion is unclear, the URL is complex, or deterministic JSON output is useful. Keep read-only command output bounded with filters or temp files when output may be large.

## Path rules

- Root help: `gh help` -> `gh.md`.
- Top-level command: `gh pr` -> `pr.md`.
- Subcommand: `gh pr view` -> `pr/view.md`.
- Nested subcommand: `gh repo deploy-key add` -> `repo/deploy-key/add.md`.
- Help topic: `gh help formatting` -> `help/formatting.md`.

Before running writes such as create, edit, delete, comment, review, merge, release upload, secret set, workflow run, discussion edits, project item edits, or event subscription create/delete, confirm the user explicitly requested that exact GitHub mutation. `gh event listen` (preview) creates or reuses a server-side subscription that lasts 24 hours and counts against a per-account limit, so treat it as a write. To wait for a PR without that approval, use reads with a deadline: the `github_ci_wait` tool for known workflow runs (default 30-minute timeout), `timeout 30m gh pr checks --watch --interval 30` (`--interval` only sets the polling frequency; `timeout` ends the wait), or a few spaced `gh pr view` calls. Attaching to an existing subscription with `gh event listen --subscription <id> --timeout <duration>` is also allowed. Run `gh event listen` without `--subscription` only when the user explicitly authorizes creating a subscription, and always pass `--timeout`. Never add `gh repo delete --accept-cascading-deletion-of-private-forks` unless the user explicitly accepted deleting the private forks too.

## Common routes

| Task | Start with |
| --- | --- |
| Authentication and token state | [`auth.md`](auth.md), [`help/environment.md`](help/environment.md) |
| Repository metadata, cloning, forks, default repo | [`repo.md`](repo.md) |
| Issues | [`issue.md`](issue.md) |
| Pull requests and reviews | [`pr.md`](pr.md) |
| Discussions | [`discussion.md`](discussion.md) |
| GitHub Actions workflow runs | [`run.md`](run.md), [`workflow.md`](workflow.md) |
| Releases and assets | [`release.md`](release.md) |
| GitHub API calls | [`api.md`](api.md), [`help/formatting.md`](help/formatting.md) |
| Search | [`search.md`](search.md) |
| Secrets and variables | [`secret.md`](secret.md), [`variable.md`](variable.md) |
| GitHub Projects | [`project.md`](project.md) |
| Codespaces | [`codespace.md`](codespace.md) |

## Core commands

- [`auth`](auth.md) - login, logout, refresh, setup-git, status, switch, token.
- [`browse`](browse.md) - Open repositories, issues, pull requests, and more in the browser
- [`codespace`](codespace.md) - code, cp, create, delete, edit, jupyter, list, logs, ports, ports forward, ports visibility, rebuild, ssh, stop, view.
- [`discussion`](discussion.md) - create, list, comment, edit, view.
- [`gist`](gist.md) - clone, create, delete, edit, list, rename, view.
- [`issue`](issue.md) - create, list, status, artifact, artifact create, artifact delete, artifact download, artifact edit, artifact list, artifact view, close, comment, delete, develop, edit, lock, pin, reopen, transfer, unlock, unpin, view.
- [`org`](org.md) - list.
- [`pr`](pr.md) - create, list, status, checkout, checks, close, comment, diff, edit, lock, merge, ready, reopen, revert, review, unlock, update-branch, view.
- [`project`](project.md) - close, copy, create, delete, edit, field-create, field-delete, field-list, item-add, item-archive, item-create, item-delete, item-edit, item-list, link, list, mark-template, unlink, view.
- [`release`](release.md) - create, list, delete, delete-asset, download, edit, upload, verify, verify-asset, view.
- [`repo`](repo.md) - create, list, archive, autolink, autolink create, autolink delete, autolink list, autolink view, clone, delete, deploy-key, deploy-key add, deploy-key delete, deploy-key list, edit, fork, gitignore, gitignore list, gitignore view, license, license list, license view, read-dir, read-file, rename, set-default, sync, unarchive, view.
- [`skill`](skill.md) - install, list, preview, publish, search, update.

## GitHub Actions commands

- [`cache`](cache.md) - delete, list.
- [`run`](run.md) - cancel, delete, download, list, rerun, view, watch.
- [`workflow`](workflow.md) - disable, enable, list, run, view.

## Alias commands

- [`co`](co.md) - Alias for "pr checkout"

## Additional commands

- [`agent-task`](agent-task.md) - create, list, view.
- [`alias`](alias.md) - delete, import, list, set.
- [`api`](api.md) - Make an authenticated GitHub API request
- [`attestation`](attestation.md) - download, trusted-root, verify.
- [`completion`](completion.md) - Generate shell completion scripts
- [`config`](config.md) - clear-cache, get, list, set.
- [`copilot`](copilot.md) - Run the GitHub Copilot CLI (preview)
- [`event`](event.md) - listen, subscription, subscription create, subscription delete, subscription list, subscription view.
- [`extension`](extension.md) - browse, create, exec, install, list, remove, search, upgrade.
- [`gpg-key`](gpg-key.md) - add, delete, list.
- [`label`](label.md) - clone, create, delete, edit, list.
- [`licenses`](licenses.md) - View third-party license information
- [`preview`](preview.md) - prompter.
- [`ruleset`](ruleset.md) - check, list, view.
- [`search`](search.md) - code, commits, issues, prs, repos.
- [`secret`](secret.md) - delete, list, set.
- [`ssh-key`](ssh-key.md) - add, delete, list.
- [`status`](status.md) - Print information about relevant issues, pull requests, and notifications across repositories
- [`variable`](variable.md) - delete, get, list, set.

## Help topics

- [`help/accessibility.md`](help/accessibility.md) - Learn about GitHub CLI's accessibility experiences
- [`help/actions.md`](help/actions.md) - Learn about working with GitHub Actions
- [`help/environment.md`](help/environment.md) - Environment variables that can be used with gh
- [`help/exit-codes.md`](help/exit-codes.md) - Exit codes used by gh
- [`help/formatting.md`](help/formatting.md) - Formatting options for JSON data exported from gh
- [`help/mintty.md`](help/mintty.md) - Information about using gh with MinTTY
- [`help/reference.md`](help/reference.md) - A comprehensive reference of all gh commands
- [`help/telemetry.md`](help/telemetry.md) - Information about telemetry in gh

## Installed extensions

`gh stack` comes from [github/gh-stack](https://github.com/github/gh-stack), observed at v0.1.1. It is not part of the core CLI inventory above. Read `gh stack --help` and `gh stack <command> --help` for its installed syntax; do not apply the core CLI version to extension help. The hosted-write gate also applies to extension commands.
