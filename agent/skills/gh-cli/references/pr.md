# gh pr

Source: https://cli.github.com/manual/gh_pr
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help pr`.

## Summary

Work with GitHub pull requests.

## Subcommands

- [`create`](pr/create.md) - Create a pull request
- [`list`](pr/list.md) - List pull requests in a repository
- [`status`](pr/status.md) - Show status of relevant pull requests
- [`checkout`](pr/checkout.md) - Check out a pull request in git
- [`checks`](pr/checks.md) - Show CI status for a single pull request
- [`close`](pr/close.md) - Close a pull request
- [`comment`](pr/comment.md) - Add a comment to a pull request
- [`diff`](pr/diff.md) - View changes in a pull request
- [`edit`](pr/edit.md) - Edit a pull request
- [`lock`](pr/lock.md) - Lock pull request conversation
- [`merge`](pr/merge.md) - Merge a pull request
- [`ready`](pr/ready.md) - Mark a pull request as ready for review
- [`reopen`](pr/reopen.md) - Reopen a pull request
- [`revert`](pr/revert.md) - Revert a pull request
- [`review`](pr/review.md) - Add a review to a pull request
- [`unlock`](pr/unlock.md) - Unlock pull request conversation
- [`update-branch`](pr/update-branch.md) - Update a pull request branch
- [`view`](pr/view.md) - View a pull request

## Manual

```text
Work with GitHub pull requests.

USAGE
  gh pr <command> [flags]

GENERAL COMMANDS
  create:        Create a pull request
  list:          List pull requests in a repository
  status:        Show status of relevant pull requests

TARGETED COMMANDS
  checkout:      Check out a pull request in git
  checks:        Show CI status for a single pull request
  close:         Close a pull request
  comment:       Add a comment to a pull request
  diff:          View changes in a pull request
  edit:          Edit a pull request
  lock:          Lock pull request conversation
  merge:         Merge a pull request
  ready:         Mark a pull request as ready for review
  reopen:        Reopen a pull request
  revert:        Revert a pull request
  review:        Add a review to a pull request
  unlock:        Unlock pull request conversation
  update-branch: Update a pull request branch
  view:          View a pull request

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

INHERITED FLAGS
  --help   Show help for command

ARGUMENTS
  A pull request can be supplied as argument in any of the following formats:
  - by number, e.g. "123";
  - by URL, e.g. "https://github.com/OWNER/REPO/pull/123"; or
  - by the name of its head branch, e.g. "patch-1" or "OWNER:patch-1".

EXAMPLES
  $ gh pr checkout 353
  $ gh pr create --fill
  $ gh pr view --web

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
