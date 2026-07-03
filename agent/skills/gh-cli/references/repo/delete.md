# gh repo delete

Source: https://cli.github.com/manual/gh_repo_delete
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help repo delete`.

## Summary

Delete a GitHub repository.

## Subcommands

- None

## Manual

```text
Delete a GitHub repository.

With no argument, deletes the current repository. Otherwise, deletes the specified repository.

For safety, when no repository argument is provided, the `--yes` flag is ignored
and you will be prompted for confirmation. To delete the current repository non-interactively,
specify it explicitly (e.g., `gh repo delete owner/repo --yes`).

Deletion requires authorization with the `delete_repo` scope.
To authorize, run `gh auth refresh -s delete_repo`


USAGE
  gh repo delete [<repository>] [flags]

FLAGS
  --yes   Confirm deletion without prompting

INHERITED FLAGS
  --help   Show help for command

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
