# gh event subscription create

Source: https://cli.github.com/manual/gh_event_subscription_create
Generated from: `gh version 2.105.0 (2026-11-17)` via `gh help event subscription create`.

## Summary

Create a subscription to events of the given types on a resource, without listening to it.

## Subcommands

- None

## Manual

```text
Create a subscription to events of the given types on a resource, without listening to it.

Pass the resource URL with `--resource` and the event types with `--event`, repeating the flag
or separating types with commas:

- `com.github.pull_request.review.submitted.v1`: a review was submitted
- `com.github.pull_request.state.changed.v1`: the pull request was merged, closed, reopened, marked ready for review, or converted to draft
- `com.github.pull_request.head.changed.v1`: the head branch changed, for example after a push
- `com.github.pull_request.merge_conflict.v1`: the pull request has a merge conflict
- `com.github.pull_request.check_suite.status.changed.v1`: a check suite on the head commit completed, such as a CI workflow

Creating a subscription is idempotent: if an active subscription for the same resource and
event types exists, it is returned instead.

Once successful, the command prints the subscription ID to stdout. Use
`gh event listen --subscription` to receive its events. To create a subscription and listen
to it in one step, use `gh event listen --resource` instead.

For more information about output formatting flags, see `gh help formatting`.

USAGE
  gh event subscription create [flags]

FLAGS
      --event type        Event type to subscribe to; repeat or separate with commas for more than one
  -q, --jq expression     Filter JSON output using a jq expression
      --json fields       Output JSON with the specified fields
      --resource string   URL of the resource to subscribe to
  -t, --template string   Format JSON output using a Go template; see "gh help formatting"

INHERITED FLAGS
  --help[=true|false]   Show help for command

JSON FIELDS
  createdAt, eventTypes, eventsUrl, expiresAt, id, resourceUrl, url

EXAMPLES
  # Subscribe to reviews and state changes of a pull request
  $ gh event subscription create --resource https://github.com/OWNER/REPO/pull/123 --event com.github.pull_request.review.submitted.v1,com.github.pull_request.state.changed.v1

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
