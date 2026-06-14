# gh variable delete

Source: https://cli.github.com/manual/gh_variable_delete
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help variable delete`.

## Summary

Delete a variable on one of the following levels: - repository (default): available to GitHub Actions runs or Dependabot in a repository - environment: available to GitHub Actions runs for a deployment environment in a repository - organization: available to GitHub Actions runs or Dependabot within an organization

## Subcommands

- None

## Manual

```text
Delete a variable on one of the following levels:
- repository (default): available to GitHub Actions runs or Dependabot in a repository
- environment: available to GitHub Actions runs for a deployment environment in a repository
- organization: available to GitHub Actions runs or Dependabot within an organization


USAGE
  gh variable delete <variable-name> [flags]

ALIASES
  gh variable remove

FLAGS
  -e, --env string   Delete a variable for an environment
  -o, --org string   Delete a variable for an organization

INHERITED FLAGS
      --help                     Show help for command
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
