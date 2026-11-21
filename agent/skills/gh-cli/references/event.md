# gh event

Source: https://cli.github.com/manual/gh_event
Generated from: `gh version 2.105.0 (2026-11-17)` via `gh help event`.

## Summary

Listen to events on GitHub resources as they happen, instead of polling. Changes made before the listener starts are not reported, so read the resource once it is listening.

## Subcommands

- [`listen`](event/listen.md) - Wait for events on a specific resource
- [`subscription`](event/subscription.md) - Manage event subscriptions (preview)

## Manual

```text
Listen to events on GitHub resources as they happen, instead of polling. Changes made before
the listener starts are not reported, so read the resource once it is listening.

This is a preview, available on `github.com` to accounts enabled for event subscriptions.


USAGE
  gh event <command> [flags]

AVAILABLE COMMANDS
  listen:        Wait for events on a specific resource
  subscription:  Manage event subscriptions (preview)

INHERITED FLAGS
  --help[=true|false]   Show help for command

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
