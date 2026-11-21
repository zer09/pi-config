# gh event subscription view

Source: https://cli.github.com/manual/gh_event_subscription_view
Generated from: `gh version 2.105.0 (2026-11-17)` via `gh help event subscription view`.

## Summary

View an event subscription (preview)

## Subcommands

- None

## Manual

```text
View an event subscription (preview)

For more information about output formatting flags, see `gh help formatting`.

USAGE
  gh event subscription view <id> [flags]

FLAGS
  -q, --jq expression     Filter JSON output using a jq expression
      --json fields       Output JSON with the specified fields
  -t, --template string   Format JSON output using a Go template; see "gh help formatting"

INHERITED FLAGS
  --help[=true|false]   Show help for command

JSON FIELDS
  createdAt, eventTypes, eventsUrl, expiresAt, id, resourceUrl, url

EXAMPLES
  # View a subscription
  $ gh event subscription view sub_123

  # Print when a subscription expires
  $ gh event subscription view sub_123 --json expiresAt --jq .expiresAt

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
