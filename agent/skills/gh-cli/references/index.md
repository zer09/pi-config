# GitHub CLI reference index

Use this index when the command family, exact flags, or output fields are not obvious. Each command reference was generated from local `gh help` output and includes the manual URL, summary, subcommand links, and full help text.

Runtime route: identify the repository as `OWNER/REPO`; convert obvious GitHub HTTPS or SSH URLs directly to the matching `gh` command; use `../scripts/normalize_github_url.py` only when conversion is unclear, the URL is complex, or deterministic JSON output is useful. Keep read-only command output bounded with filters or temp files when output may be large.

## Path rules

- Top-level command: `gh pr` -> `pr.md`.
- Subcommand: `gh pr view` -> `pr/view.md`.
- Nested subcommand: `gh repo deploy-key add` -> `repo/deploy-key/add.md`.
- Help topic: `gh help formatting` -> `help/formatting.md`.

Before running writes such as create, edit, delete, comment, review, merge, release upload, secret set, workflow run, discussion edits, or project item edits, confirm the user explicitly requested that exact GitHub mutation.

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
- [`issue`](issue.md) - create, list, status, close, comment, delete, develop, edit, lock, pin, reopen, transfer, unlock, unpin, view.
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
