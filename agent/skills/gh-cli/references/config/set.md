# gh config set

Source: https://cli.github.com/manual/gh_config_set
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help config set`.

## Summary

Update configuration with a value for the given key

## Subcommands

- None

## Manual

```text
Update configuration with a value for the given key

USAGE
  gh config set <key> <value> [flags]

FLAGS
  -h, --host string   Set per-host setting

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh config set editor vim
  $ gh config set editor "code --wait"
  $ gh config set git_protocol ssh --host github.com
  $ gh config set prompt disabled

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
