# gh event subscription delete

Source: https://cli.github.com/manual/gh_event_subscription_delete
Generated from: `gh version 2.105.0 (2026-11-17)` via `gh help event subscription delete`.

## Summary

Delete an event subscription before it expires, which frees a place under the limit of subscriptions of your account.

## Subcommands

- None

## Manual

```text
Delete an event subscription before it expires, which frees a place under the limit of
subscriptions of your account.

Event streams that are already open on the subscription are not guaranteed to close.


USAGE
  gh event subscription delete <id> [flags]

INHERITED FLAGS
  --help[=true|false]   Show help for command

EXAMPLES
  # Delete a subscription
  $ gh event subscription delete sub_123

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
