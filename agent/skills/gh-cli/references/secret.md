# gh secret

Source: https://cli.github.com/manual/gh_secret
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help secret`.

## Summary

Secrets can be set at the repository, or organization level for use in GitHub Actions or Dependabot. User, organization, and repository secrets can be set for use in GitHub Codespaces. Environment secrets can be set for use in GitHub Actions. Run `gh help secret set` to learn how to get started.

## Subcommands

- `gh secret delete` - Delete secrets - [reference](secret/delete.md)
- `gh secret list` - List secrets - [reference](secret/list.md)
- `gh secret set` - Create or update secrets - [reference](secret/set.md)

## Manual

```text
Secrets can be set at the repository, or organization level for use in
GitHub Actions or Dependabot. User, organization, and repository secrets can be set for
use in GitHub Codespaces. Environment secrets can be set for use in
GitHub Actions. Run `gh help secret set` to learn how to get started.


USAGE
  gh secret <command> [flags]

AVAILABLE COMMANDS
  delete:        Delete secrets
  list:          List secrets
  set:           Create or update secrets

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

INHERITED FLAGS
  --help   Show help for command

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
