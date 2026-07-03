# gh pr ready

Source: https://cli.github.com/manual/gh_pr_ready
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help pr ready`.

## Summary

Mark a pull request as ready for review.

## Subcommands

- None

## Manual

```text
Mark a pull request as ready for review.

Without an argument, the pull request that belongs to the current branch
is marked as ready.

If supported by your plan, convert to draft with `--undo`


USAGE
  gh pr ready [<number> | <url> | <branch>] [flags]

FLAGS
  --undo   Convert a pull request to "draft"

INHERITED FLAGS
      --help                     Show help for command
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
