# gh event subscription list

Source: https://cli.github.com/manual/gh_event_subscription_list
Generated from: `gh version 2.105.0 (2026-11-17)` via `gh help event subscription list`.

## Summary

List event subscriptions (preview)

## Subcommands

- None

## Manual

```text
List event subscriptions (preview)

For more information about output formatting flags, see `gh help formatting`.

USAGE
  gh event subscription list [flags]

ALIASES
  gh event subscription ls

FLAGS
  -q, --jq expression     Filter JSON output using a jq expression
      --json fields       Output JSON with the specified fields
  -L, --limit int         Maximum number of subscriptions to list (default 30)
  -t, --template string   Format JSON output using a Go template; see "gh help formatting"

INHERITED FLAGS
  --help[=true|false]   Show help for command

JSON FIELDS
  createdAt, eventTypes, eventsUrl, expiresAt, id, resourceUrl, url

EXAMPLES
  # List your subscriptions
  $ gh event subscription list

  # Print the ID and resource of each subscription
  $ gh event subscription list --json id,resourceUrl --jq '.[] | [.id, .resourceUrl] | @tsv'

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
