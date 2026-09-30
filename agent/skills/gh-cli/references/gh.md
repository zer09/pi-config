# gh

Source: https://cli.github.com/manual/gh
Generated from: `gh version 2.101.0 (2026-09-15)` via `gh help` with isolated configuration and no extensions.

## Summary

Work seamlessly with GitHub from the command line.

## Subcommands

- [`auth`](auth.md) - Authenticate gh and git with GitHub
- [`browse`](browse.md) - Open repositories, issues, pull requests, and more in the browser
- [`codespace`](codespace.md) - Connect to and manage codespaces
- [`discussion`](discussion.md) - Work with GitHub Discussions (preview)
- [`gist`](gist.md) - Manage gists
- [`issue`](issue.md) - Manage issues
- [`org`](org.md) - Manage organizations
- [`pr`](pr.md) - Manage pull requests
- [`project`](project.md) - Work with GitHub Projects.
- [`release`](release.md) - Manage releases
- [`repo`](repo.md) - Manage repositories
- [`skill`](skill.md) - Install and manage agent skills (preview)
- [`cache`](cache.md) - Manage GitHub Actions caches
- [`run`](run.md) - View details about workflow runs
- [`workflow`](workflow.md) - View details about GitHub Actions workflows
- [`co`](co.md) - Alias for "pr checkout"
- [`agent-task`](agent-task.md) - Work with agent tasks (preview)
- [`alias`](alias.md) - Create command shortcuts
- [`api`](api.md) - Make an authenticated GitHub API request
- [`attestation`](attestation.md) - Work with artifact attestations
- [`completion`](completion.md) - Generate shell completion scripts
- [`config`](config.md) - Manage configuration for gh
- [`copilot`](copilot.md) - Run the GitHub Copilot CLI (preview)
- [`extension`](extension.md) - Manage gh extensions
- [`gpg-key`](gpg-key.md) - Manage GPG keys
- [`label`](label.md) - Manage labels
- [`licenses`](licenses.md) - View third-party license information
- [`preview`](preview.md) - Execute previews for gh features
- [`ruleset`](ruleset.md) - View info about repo rulesets
- [`search`](search.md) - Search for repositories, issues, and pull requests
- [`secret`](secret.md) - Manage GitHub secrets
- [`ssh-key`](ssh-key.md) - Manage SSH keys
- [`status`](status.md) - Print information about relevant issues, pull requests, and notifications across repositories
- [`variable`](variable.md) - Manage GitHub Actions variables

## Help topics

- [`accessibility`](help/accessibility.md)
- [`actions`](help/actions.md)
- [`environment`](help/environment.md)
- [`exit-codes`](help/exit-codes.md)
- [`formatting`](help/formatting.md)
- [`mintty`](help/mintty.md)
- [`reference`](help/reference.md)
- [`telemetry`](help/telemetry.md)

## Manual

```text
Work seamlessly with GitHub from the command line.

USAGE
  gh <command> <subcommand> [flags]

CORE COMMANDS
  auth:          Authenticate gh and git with GitHub
  browse:        Open repositories, issues, pull requests, and more in the browser
  codespace:     Connect to and manage codespaces
  discussion:    Work with GitHub Discussions (preview)
  gist:          Manage gists
  issue:         Manage issues
  org:           Manage organizations
  pr:            Manage pull requests
  project:       Work with GitHub Projects.
  release:       Manage releases
  repo:          Manage repositories
  skill:         Install and manage agent skills (preview)

GITHUB ACTIONS COMMANDS
  cache:         Manage GitHub Actions caches
  run:           View details about workflow runs
  workflow:      View details about GitHub Actions workflows

ALIAS COMMANDS
  co:            Alias for "pr checkout"

ADDITIONAL COMMANDS
  agent-task:    Work with agent tasks (preview)
  alias:         Create command shortcuts
  api:           Make an authenticated GitHub API request
  attestation:   Work with artifact attestations
  completion:    Generate shell completion scripts
  config:        Manage configuration for gh
  copilot:       Run the GitHub Copilot CLI (preview)
  extension:     Manage gh extensions
  gpg-key:       Manage GPG keys
  label:         Manage labels
  licenses:      View third-party license information
  preview:       Execute previews for gh features
  ruleset:       View info about repo rulesets
  search:        Search for repositories, issues, and pull requests
  secret:        Manage GitHub secrets
  ssh-key:       Manage SSH keys
  status:        Print information about relevant issues, pull requests, and notifications across repositories
  variable:      Manage GitHub Actions variables

HELP TOPICS
  accessibility: Learn about GitHub CLI's accessibility experiences
  actions:       Learn about working with GitHub Actions
  environment:   Environment variables that can be used with gh
  exit-codes:    Exit codes used by gh
  formatting:    Formatting options for JSON data exported from gh
  mintty:        Information about using gh with MinTTY
  reference:     A comprehensive reference of all gh commands
  telemetry:     Information about telemetry in gh

FLAGS
  --help      Show help for command
  --version   Show gh version

EXAMPLES
  $ gh issue create
  $ gh repo clone cli/cli
  $ gh pr checkout 321

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
