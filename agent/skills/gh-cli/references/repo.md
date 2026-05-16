# gh repo

Source: https://cli.github.com/manual/gh_repo
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help repo`.

## Summary

Work with GitHub repositories.

## Subcommands

- `gh repo create` - Create a new repository - [reference](repo/create.md)
- `gh repo list` - List repositories owned by user or organization - [reference](repo/list.md)
- `gh repo archive` - Archive a repository - [reference](repo/archive.md)
- `gh repo autolink` - Manage autolink references - [reference](repo/autolink.md)
- `gh repo clone` - Clone a repository locally - [reference](repo/clone.md)
- `gh repo delete` - Delete a repository - [reference](repo/delete.md)
- `gh repo deploy-key` - Manage deploy keys in a repository - [reference](repo/deploy-key.md)
- `gh repo edit` - Edit repository settings - [reference](repo/edit.md)
- `gh repo fork` - Create a fork of a repository - [reference](repo/fork.md)
- `gh repo gitignore` - List and view available repository gitignore templates - [reference](repo/gitignore.md)
- `gh repo license` - Explore repository licenses - [reference](repo/license.md)
- `gh repo rename` - Rename a repository - [reference](repo/rename.md)
- `gh repo set-default` - Configure default repository for this directory - [reference](repo/set-default.md)
- `gh repo sync` - Sync a repository - [reference](repo/sync.md)
- `gh repo unarchive` - Unarchive a repository - [reference](repo/unarchive.md)
- `gh repo view` - View a repository - [reference](repo/view.md)

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
