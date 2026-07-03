# gh variable

Source: https://cli.github.com/manual/gh_variable
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help variable`.

## Summary

Variables can be set at the repository, environment or organization level for use in

## Subcommands

- [`delete`](variable/delete.md) - Delete variables
- [`get`](variable/get.md) - Get variables
- [`list`](variable/list.md) - List variables
- [`set`](variable/set.md) - Create or update variables

## Manual

```text
Variables can be set at the repository, environment or organization level for use in
GitHub Actions or Dependabot. Run `gh help variable set` to learn how to get started.


USAGE
  gh variable <command> [flags]

AVAILABLE COMMANDS
  delete:        Delete variables
  get:           Get variables
  list:          List variables
  set:           Create or update variables

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
