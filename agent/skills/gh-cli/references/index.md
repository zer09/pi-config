# GitHub CLI reference index

Use this index after `SKILL.md` to choose the smallest exact reference file to read. Each command reference was generated from local `gh help` output and includes the manual URL, summary, subcommand links, and full help text.

## Path rules

- Top-level command: `gh pr` -> `pr.md`.
- Subcommand: `gh pr view` -> `pr/view.md`.
- Nested subcommand: `gh repo deploy-key add` -> `repo/deploy-key/add.md`.
- Help topic: `gh help formatting` -> `help/formatting.md`.

Before running writes such as create, edit, delete, comment, review, merge, release upload, secret set, workflow run, or project item edits, confirm the user explicitly requested that exact GitHub mutation.

## Common routes

| Task | Start with |
| --- | --- |
| Authentication and token state | [`auth.md`](auth.md), [`help/environment.md`](help/environment.md) |
| Repository metadata, cloning, forks, default repo | [`repo.md`](repo.md) |
| Issues | [`issue.md`](issue.md) |
| Pull requests and reviews | [`pr.md`](pr.md) |
| GitHub Actions workflow runs | [`run.md`](run.md), [`workflow.md`](workflow.md) |
| Releases and assets | [`release.md`](release.md) |
| GitHub API calls | [`api.md`](api.md), [`help/formatting.md`](help/formatting.md) |
| Search | [`search.md`](search.md) |
| Secrets and variables | [`secret.md`](secret.md), [`variable.md`](variable.md) |
| GitHub Projects | [`project.md`](project.md) |
| Codespaces | [`codespace.md`](codespace.md) |

## Core commands

- [`auth`](auth.md) - login, logout, refresh, setup-git, status, switch, token.
- [`browse`](browse.md) - open GitHub resources in the browser.
- [`codespace`](codespace.md) - code, cp, create, delete, edit, jupyter, list, logs, ports, ports forward, ports visibility, rebuild, ssh, stop, view.
- [`gist`](gist.md) - clone, create, delete, edit, list, rename, view.
- [`issue`](issue.md) - close, comment, create, delete, develop, edit, list, lock, pin, reopen, status, transfer, unlock, unpin, view.
- [`org`](org.md) - list.
- [`pr`](pr.md) - checkout, checks, close, comment, create, diff, edit, list, lock, merge, ready, reopen, revert, review, status, unlock, update-branch, view.
- [`project`](project.md) - close, copy, create, delete, edit, field-create, field-delete, field-list, item-add, item-archive, item-create, item-delete, item-edit, item-list, link, list, mark-template, unlink, view.
- [`release`](release.md) - create, delete, delete-asset, download, edit, list, upload, verify, verify-asset, view.
- [`repo`](repo.md) - archive, autolink, clone, create, delete, deploy-key, edit, fork, gitignore, license, list, rename, set-default, sync, unarchive, view.
- [`skill`](skill.md) - install, preview, publish, search, update.

## GitHub Actions commands

- [`cache`](cache.md) - delete, list.
- [`run`](run.md) - cancel, delete, download, list, rerun, view, watch.
- [`workflow`](workflow.md) - disable, enable, list, run, view.

## Alias commands

- [`co`](co.md) - alias for checking out a pull request in git.

## Additional commands

- [`agent-task`](agent-task.md) - create, list, view.
- [`alias`](alias.md) - delete, import, list, set.
- [`api`](api.md) - authenticated GitHub API requests.
- [`attestation`](attestation.md) - download, trusted-root, verify.
- [`completion`](completion.md) - shell completion scripts.
- [`config`](config.md) - clear-cache, get, list, set.
- [`copilot`](copilot.md) - GitHub Copilot CLI entry point.
- [`extension`](extension.md) - browse, create, exec, install, list, remove, search, upgrade.
- [`gpg-key`](gpg-key.md) - add, delete, list.
- [`label`](label.md) - clone, create, delete, edit, list.
- [`licenses`](licenses.md) - third-party license information.
- [`preview`](preview.md) - prompter.
- [`ruleset`](ruleset.md) - check, list, view.
- [`search`](search.md) - code, commits, issues, prs, repos.
- [`secret`](secret.md) - delete, list, set.
- [`ssh-key`](ssh-key.md) - add, delete, list.
- [`status`](status.md) - account and repository status.
- [`variable`](variable.md) - delete, get, list, set.

## Help topics

- [`help/accessibility.md`](help/accessibility.md) - accessibility experiences.
- [`help/actions.md`](help/actions.md) - working with GitHub Actions.
- [`help/environment.md`](help/environment.md) - environment variables.
- [`help/exit-codes.md`](help/exit-codes.md) - exit codes.
- [`help/formatting.md`](help/formatting.md) - JSON formatting, `--jq`, and templates.
- [`help/mintty.md`](help/mintty.md) - MinTTY notes.
- [`help/reference.md`](help/reference.md) - comprehensive command reference.
- [`help/telemetry.md`](help/telemetry.md) - telemetry notes.
