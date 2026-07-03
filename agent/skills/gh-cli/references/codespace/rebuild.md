# gh codespace rebuild

Source: https://cli.github.com/manual/gh_codespace_rebuild
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help codespace rebuild`.

## Summary

Rebuilding recreates your codespace.

## Subcommands

- None

## Manual

```text
Rebuilding recreates your codespace.

Your code and any current changes will be preserved. Your codespace will be rebuilt using
your working directory's dev container. A full rebuild also removes cached Docker images.


USAGE
  gh codespace rebuild [flags]

FLAGS
  -c, --codespace string    Name of the codespace
      --full                Perform a full rebuild
  -R, --repo string         Filter codespace selection by repository name (user/repo)
      --repo-owner string   Filter codespace selection by repository owner (username or org)

INHERITED FLAGS
  --help   Show help for command

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
