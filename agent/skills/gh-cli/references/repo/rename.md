# gh repo rename

Source: https://cli.github.com/manual/gh_repo_rename
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help repo rename`.

## Summary

Rename a GitHub repository.

## Subcommands

- None

## Manual

```text
Rename a GitHub repository.

`<new-name>` is the desired repository name without the owner.

By default, the current repository is renamed. Otherwise, the repository specified
with `--repo` is renamed.

To transfer repository ownership to another user account or organization,
you must follow additional steps on `github.com`.

For more information on transferring repository ownership, see:
<https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository>


USAGE
  gh repo rename [<new-name>] [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format
  -y, --yes                      Skip the confirmation prompt

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  # Rename the current repository (foo/bar -> foo/baz)
  $ gh repo rename baz

  # Rename the specified repository (qux/quux -> qux/baz)
  $ gh repo rename -R qux/quux baz

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
