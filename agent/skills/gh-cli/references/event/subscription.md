# gh event subscription

Source: https://cli.github.com/manual/gh_event_subscription
Generated from: `gh version 2.105.0 (2026-11-17)` via `gh help event subscription`.

## Summary

Manage the event subscriptions of your account.

## Subcommands

- [`create`](subscription/create.md) - Create an event subscription (preview)
- [`delete`](subscription/delete.md) - Delete an event subscription (preview)
- [`list`](subscription/list.md) - List event subscriptions (preview)
- [`view`](subscription/view.md) - View an event subscription (preview)

## Manual

```text
Manage the event subscriptions of your account.

A subscription selects the event types to deliver for one resource, and `gh event listen`
receives its events. Subscriptions expire after 24 hours, and each account can have a limited
number of them at a time.


USAGE
  gh event subscription <command> [flags]

AVAILABLE COMMANDS
  create:        Create an event subscription (preview)
  delete:        Delete an event subscription (preview)
  list:          List event subscriptions (preview)
  view:          View an event subscription (preview)

INHERITED FLAGS
  --help[=true|false]   Show help for command

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
