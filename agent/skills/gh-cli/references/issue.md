# gh issue

Source: https://cli.github.com/manual/gh_issue
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help issue`.

## Summary

Work with GitHub issues.

## Subcommands

- `gh issue create` - Create a new issue - [reference](issue/create.md)
- `gh issue list` - List issues in a repository - [reference](issue/list.md)
- `gh issue status` - Show status of relevant issues - [reference](issue/status.md)
- `gh issue close` - Close issue - [reference](issue/close.md)
- `gh issue comment` - Add a comment to an issue - [reference](issue/comment.md)
- `gh issue delete` - Delete issue - [reference](issue/delete.md)
- `gh issue develop` - Manage linked branches for an issue - [reference](issue/develop.md)
- `gh issue edit` - Edit issues - [reference](issue/edit.md)
- `gh issue lock` - Lock issue conversation - [reference](issue/lock.md)
- `gh issue pin` - Pin a issue - [reference](issue/pin.md)
- `gh issue reopen` - Reopen issue - [reference](issue/reopen.md)
- `gh issue transfer` - Transfer issue to another repository - [reference](issue/transfer.md)
- `gh issue unlock` - Unlock issue conversation - [reference](issue/unlock.md)
- `gh issue unpin` - Unpin a issue - [reference](issue/unpin.md)
- `gh issue view` - View an issue - [reference](issue/view.md)

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
  pin:           Pin a issue
  reopen:        Reopen issue
  transfer:      Transfer issue to another repository
  unlock:        Unlock issue conversation
  unpin:         Unpin a issue
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
