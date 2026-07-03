# gh pr update-branch

Source: https://cli.github.com/manual/gh_pr_update-branch
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help pr update-branch`.

## Summary

Update a pull request branch with latest changes of the base branch.

## Subcommands

- None

## Manual

```text
Update a pull request branch with latest changes of the base branch.

Without an argument, the pull request that belongs to the current branch is selected.

The default behavior is to update with a merge commit (i.e., merging the base branch
into the PR's branch). To reconcile the changes with rebasing on top of the base
branch, the `--rebase` option should be provided.


USAGE
  gh pr update-branch [<number> | <url> | <branch>] [flags]

FLAGS
  --rebase   Update PR branch by rebasing on top of latest base branch

INHERITED FLAGS
      --help                     Show help for command
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

EXAMPLES
  $ gh pr update-branch 23
  $ gh pr update-branch 23 --rebase
  $ gh pr update-branch 23 --repo owner/repo

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
