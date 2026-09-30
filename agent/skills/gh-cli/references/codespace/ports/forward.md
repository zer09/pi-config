# gh codespace ports forward

Source: https://cli.github.com/manual/gh_codespace_ports_forward
Generated from: `gh version 2.101.0 (2026-09-15)` via `gh help codespace ports forward`.

## Summary

Forward ports from a codespace to your local machine.

## Subcommands

- None

## Manual

```text
Forward ports from a codespace to your local machine.

Ports bind to loopback (`127.0.0.1`) by default. Use `--all-interfaces`
to bind to all interfaces.


USAGE
  gh codespace ports forward <remote-port>:<local-port>... [flags]

FLAGS
  --all-interfaces   Listen on all network interfaces

INHERITED FLAGS
  -c, --codespace string    Name of the codespace
      --help                Show help for command
  -R, --repo string         Filter codespace selection by repository name (user/repo)
      --repo-owner string   Filter codespace selection by repository owner (username or org)

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
