# gh issue

Source: https://cli.github.com/manual/gh_issue
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help issue`.

## Summary

Work with GitHub issues.

## Subcommands

- [`create`](issue/create.md) - Create a new issue
- [`list`](issue/list.md) - List issues in a repository
- [`status`](issue/status.md) - Show status of relevant issues
- [`close`](issue/close.md) - Close issue
- [`comment`](issue/comment.md) - Add a comment to an issue
- [`delete`](issue/delete.md) - Delete issue
- [`develop`](issue/develop.md) - Manage linked branches for an issue
- [`edit`](issue/edit.md) - Edit issues
- [`lock`](issue/lock.md) - Lock issue conversation
- [`pin`](issue/pin.md) - Pin an issue
- [`reopen`](issue/reopen.md) - Reopen issue
- [`transfer`](issue/transfer.md) - Transfer issue to another repository
- [`unlock`](issue/unlock.md) - Unlock issue conversation
- [`unpin`](issue/unpin.md) - Unpin an issue
- [`view`](issue/view.md) - View an issue

## Manual

```text
Work with GitHub issues.

USAGE
  gh issue <command> [flags]

GENERAL COMMANDS
  create:        Create a new issue
  list:          List issues in a repository
  status:        Show status of relevant issues

TARGETED COMMANDS
  close:         Close issue
  comment:       Add a comment to an issue
  delete:        Delete issue
  develop:       Manage linked branches for an issue
  edit:          Edit issues
  lock:          Lock issue conversation
  pin:           Pin an issue
  reopen:        Reopen issue
  transfer:      Transfer issue to another repository
  unlock:        Unlock issue conversation
  unpin:         Unpin an issue
  view:          View an issue

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

INHERITED FLAGS
  --help   Show help for command

ARGUMENTS
  An issue can be supplied as argument in any of the following formats:
  - by number, e.g. "123"; or
  - by URL, e.g. "https://github.com/OWNER/REPO/issues/123".

EXAMPLES
  $ gh issue list
  $ gh issue create --label bug
  $ gh issue view 123 --web

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
