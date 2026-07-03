# gh repo

Source: https://cli.github.com/manual/gh_repo
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help repo`.

## Summary

Work with GitHub repositories.

## Subcommands

- [`create`](repo/create.md) - Create a new repository
- [`list`](repo/list.md) - List repositories owned by user or organization
- [`archive`](repo/archive.md) - Archive a repository
- [`autolink`](repo/autolink.md) - Manage autolink references
- [`clone`](repo/clone.md) - Clone a repository locally
- [`delete`](repo/delete.md) - Delete a repository
- [`deploy-key`](repo/deploy-key.md) - Manage deploy keys in a repository
- [`edit`](repo/edit.md) - Edit repository settings
- [`fork`](repo/fork.md) - Create a fork of a repository
- [`gitignore`](repo/gitignore.md) - List and view available repository gitignore templates
- [`license`](repo/license.md) - Explore repository licenses
- [`read-dir`](repo/read-dir.md) - List a directory in a repository (preview)
- [`read-file`](repo/read-file.md) - Read a file from a repository (preview)
- [`rename`](repo/rename.md) - Rename a repository
- [`set-default`](repo/set-default.md) - Configure default repository for this directory
- [`sync`](repo/sync.md) - Sync a repository
- [`unarchive`](repo/unarchive.md) - Unarchive a repository
- [`view`](repo/view.md) - View a repository

## Manual

```text
Work with GitHub repositories.

USAGE
  gh repo <command> [flags]

GENERAL COMMANDS
  create:        Create a new repository
  list:          List repositories owned by user or organization

TARGETED COMMANDS
  archive:       Archive a repository
  autolink:      Manage autolink references
  clone:         Clone a repository locally
  delete:        Delete a repository
  deploy-key:    Manage deploy keys in a repository
  edit:          Edit repository settings
  fork:          Create a fork of a repository
  gitignore:     List and view available repository gitignore templates
  license:       Explore repository licenses
  read-dir:      List a directory in a repository (preview)
  read-file:     Read a file from a repository (preview)
  rename:        Rename a repository
  set-default:   Configure default repository for this directory
  sync:          Sync a repository
  unarchive:     Unarchive a repository
  view:          View a repository

INHERITED FLAGS
  --help   Show help for command

ARGUMENTS
  A repository can be supplied as an argument in any of the following formats:
  - "OWNER/REPO"
  - by URL, e.g. "https://github.com/OWNER/REPO"

EXAMPLES
  $ gh repo create
  $ gh repo clone cli/cli
  $ gh repo view --web

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
