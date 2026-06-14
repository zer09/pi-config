# gh cache

Source: https://cli.github.com/manual/gh_cache
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help cache`.

## Summary

Work with GitHub Actions caches.

## Subcommands

- `gh cache delete` - Delete GitHub Actions caches - [reference](cache/delete.md)
- `gh cache list` - List GitHub Actions caches - [reference](cache/list.md)

## Manual

```text
Work with GitHub Actions caches.

USAGE
  gh cache <command> [flags]

AVAILABLE COMMANDS
  delete:        Delete GitHub Actions caches
  list:          List GitHub Actions caches

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh cache list
  $ gh cache delete --all

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
