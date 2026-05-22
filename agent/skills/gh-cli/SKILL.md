---
name: gh-cli
description: "GitHub CLI, or gh, is a command-line interface to GitHub for use in your terminal or scripts. Use for gh command syntax, flags, subcommands, authenticated GitHub repo/issue/PR/release/workflow operations, and GitHub automation from the command line."
---

# GitHub CLI

GitHub CLI, or `gh`, works with GitHub from the terminal and from scripts. This skill is a token-friendly command index: read this file to choose the command family, then open only the specific reference file needed for exact flags and examples.

## Operating rules

- Prefer authenticated `gh` CLI for GitHub repositories, pull requests, issues, reviews, workflows, releases, and private GitHub data.
- For GitHub HTTPS or SSH URLs, run `uv run python ~/.pi/agent/skills/gh-cli/scripts/normalize_github_url.py <url>` and read the returned `references` before using or adapting the single primary `gh.argv`.
- For read-only shell operations in Pi, run `gh` through Context Mode/RTK when available, for example `ctx_execute` or `ctx_batch_execute` with `rtk gh ...`.
- Treat GitHub writes as external hosted service mutations. Do not create, update, delete, comment, label, merge, dispatch workflows, publish releases, or push unless the user explicitly asked for that exact write.
- Do not expose tokens. Refer to token environment variables by name only, for example `GITHUB_TOKEN` or `GH_ENTERPRISE_TOKEN`.
- Use `--json`, `--jq`, `--template`, `--repo OWNER/REPO`, and `--hostname HOST` to make commands scriptable.

## Installation and prerequisites

- Install from the official README linked by the manual: https://github.com/cli/cli#installation
- Verify: `gh --version`
- Authenticate interactively: `gh auth login`
- Check auth state: `gh auth status`
- Configure editor: `gh config set editor <editor>`
- Configure aliases: `gh alias set <name> <expansion>`
- GitHub Enterprise: use `gh auth login --hostname <hostname>`; set `GH_HOST` for default host; use `GH_ENTERPRISE_TOKEN` for automation.

## Common examples

```bash
gh auth status
uv run python ~/.pi/agent/skills/gh-cli/scripts/normalize_github_url.py https://github.com/OWNER/REPO/pull/123
gh repo view OWNER/REPO --json name,description,url
gh issue list --repo OWNER/REPO --state open --json number,title,author,state
gh issue view 123 --repo OWNER/REPO --comments
gh pr list --repo OWNER/REPO --state open --json number,title,author,isDraft,reviewDecision
gh pr view 123 --repo OWNER/REPO --comments --json number,title,body,files,commits,reviews
gh pr checkout 123
gh run list --repo OWNER/REPO --limit 20
gh api repos/OWNER/REPO/pulls/123/files --paginate
```

## Command structure

Read the top-level reference for a command family, then read a subcommand reference for exact flags and examples. Each reference file contains the official manual URL and the generated `gh help` text.

### Core commands preview

- `gh auth` - Authenticate gh and git with GitHub
- `gh browse` - Open repositories, issues, pull requests, and more in the browser
- `gh codespace` - Connect to and manage codespaces
- `gh gist` - Manage gists
- `gh issue` - Manage issues
- `gh org` - Manage organizations
- `gh pr` - Manage pull requests
- `gh project` - Work with GitHub Projects.
- `gh release` - Manage releases
- `gh repo` - Manage repositories
- `gh skill` - Install and manage agent skills (preview)

### Core commands

- `gh auth <command>`
  - Authenticate gh and git with GitHub
  - commands: login, logout, refresh, setup-git, status, switch, token
  - reference: `references/auth.md`
- `gh browse`
  - Transition from the terminal to the web browser to view and interact with:
  - commands: none
  - reference: `references/browse.md`
- `gh codespace <command>`
  - Connect to and manage codespaces
  - commands: code, cp, create, delete, edit, jupyter, list, logs, ports, rebuild, ssh, stop, view
  - reference: `references/codespace.md`
- `gh gist <command>`
  - Work with GitHub gists.
  - commands: clone, create, delete, edit, list, rename, view
  - reference: `references/gist.md`
- `gh issue <command>`
  - Work with GitHub issues.
  - commands: create, list, status, close, comment, delete, develop, edit, lock, pin, reopen, transfer, unlock, unpin, view
  - reference: `references/issue.md`
- `gh org <command>`
  - Work with GitHub organizations.
  - commands: list
  - reference: `references/org.md`
- `gh pr <command>`
  - Work with GitHub pull requests.
  - commands: create, list, status, checkout, checks, close, comment, diff, edit, lock, merge, ready, reopen, revert, review, unlock, update-branch, view
  - reference: `references/pr.md`
- `gh project <command>`
  - Work with GitHub Projects.
  - commands: close, copy, create, delete, edit, field-create, field-delete, field-list, item-add, item-archive, item-create, item-delete, item-edit, item-list, link, list, mark-template, unlink, view
  - reference: `references/project.md`
- `gh release <command>`
  - Manage releases
  - commands: create, list, delete, delete-asset, download, edit, upload, verify, verify-asset, view
  - reference: `references/release.md`
- `gh repo <command>`
  - Work with GitHub repositories.
  - commands: create, list, archive, autolink, clone, delete, deploy-key, edit, fork, gitignore, license, rename, set-default, sync, unarchive, view
  - reference: `references/repo.md`
- `gh skill <command>`
  - Install and manage agent skills from GitHub repositories.
  - commands: install, preview, publish, search, update
  - reference: `references/skill.md`

### GitHub Actions commands

- `gh cache <command>`
  - Work with GitHub Actions caches.
  - commands: delete, list
  - reference: `references/cache.md`
- `gh run <command>`
  - List, view, and watch recent workflow runs from GitHub Actions.
  - commands: cancel, delete, download, list, rerun, view, watch
  - reference: `references/run.md`
- `gh workflow <command>`
  - List, view, and run workflows in GitHub Actions.
  - commands: disable, enable, list, run, view
  - reference: `references/workflow.md`

### Alias commands

- `gh co`
  - Check out a pull request in git
  - commands: none
  - reference: `references/co.md`

### Additional commands

- `gh agent-task <command>`
  - Working with agent tasks in the GitHub CLI is in preview and subject to change without notice.
  - commands: create, list, view
  - reference: `references/agent-task.md`
- `gh alias <command>`
  - Aliases can be used to make shortcuts for gh commands or to compose multiple commands.
  - commands: delete, import, list, set
  - reference: `references/alias.md`
- `gh api`
  - Makes an authenticated HTTP request to the GitHub API and prints the response.
  - commands: none
  - reference: `references/api.md`
- `gh attestation <command>`
  - Download and verify artifact attestations.
  - commands: download, trusted-root, verify
  - reference: `references/attestation.md`
- `gh completion`
  - Generate shell completion scripts for GitHub CLI commands.
  - commands: none
  - reference: `references/completion.md`
- `gh config <command>`
  - Display or change configuration settings for gh.
  - commands: clear-cache, get, list, set
  - reference: `references/config.md`
- `gh copilot`
  - Runs the GitHub Copilot CLI.
  - commands: none
  - reference: `references/copilot.md`
- `gh extension <command>`
  - GitHub CLI extensions are repositories that provide additional gh commands.
  - commands: browse, create, exec, install, list, remove, search, upgrade
  - reference: `references/extension.md`
- `gh gpg-key <command>`
  - Manage GPG keys registered with your GitHub account.
  - commands: add, delete, list
  - reference: `references/gpg-key.md`
- `gh label <command>`
  - Work with GitHub labels.
  - commands: clone, create, delete, edit, list
  - reference: `references/label.md`
- `gh licenses`
  - View license information for third-party libraries used in this build of the GitHub CLI.
  - commands: none
  - reference: `references/licenses.md`
- `gh preview <command>`
  - Preview commands are for testing, demonstrative, and development purposes only. They should be considered unstable and can change at any time.
  - commands: prompter
  - reference: `references/preview.md`
- `gh ruleset <command>`
  - Repository rulesets are a way to define a set of rules that apply to a repository. These commands allow you to view information about them.
  - commands: check, list, view
  - reference: `references/ruleset.md`
- `gh search <command>`
  - Search across all of GitHub.
  - commands: code, commits, issues, prs, repos
  - reference: `references/search.md`
- `gh secret <command>`
  - Secrets can be set at the repository, or organization level for use in GitHub Actions or Dependabot. User, organization, and repository secrets can be set for use in GitHub Codespaces. Environment secrets can be set for use in GitHub Actions. Run `gh help secret set` to learn how to get started.
  - commands: delete, list, set
  - reference: `references/secret.md`
- `gh ssh-key <command>`
  - Manage SSH keys registered with your GitHub account.
  - commands: add, delete, list
  - reference: `references/ssh-key.md`
- `gh status`
  - The status command prints information about your work on GitHub across all the repositories you're subscribed to, including:
  - commands: none
  - reference: `references/status.md`
- `gh variable <command>`
  - Variables can be set at the repository, environment or organization level for use in GitHub Actions or Dependabot. Run `gh help variable set` to learn how to get started.
  - commands: delete, get, list, set
  - reference: `references/variable.md`

## Help topics

Help topic references live under `references/help/`:
- `gh help accessibility` - Learn about GitHub CLI's accessibility experiences - `references/help/accessibility.md`
- `gh help actions` - Learn about working with GitHub Actions - `references/help/actions.md`
- `gh help environment` - Environment variables that can be used with gh - `references/help/environment.md`
- `gh help exit-codes` - Exit codes used by gh - `references/help/exit-codes.md`
- `gh help formatting` - Formatting options for JSON data exported from gh - `references/help/formatting.md`
- `gh help mintty` - Information about using gh with MinTTY - `references/help/mintty.md`
- `gh help reference` - A comprehensive reference of all gh commands - `references/help/reference.md`
- `gh help telemetry` - Information about telemetry in gh - `references/help/telemetry.md`

## Maintenance reference

For future updates to this generated skill, read `../../../docs/skills/gh-cli-update-process.md`.
