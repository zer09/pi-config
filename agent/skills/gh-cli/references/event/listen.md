# gh event listen

Source: https://cli.github.com/manual/gh_event_listen
Generated from: `gh version 2.105.0 (2026-11-17)` via `gh help event listen`.

## Summary

Listen to events on a pull request and print each event to stdout as it happens, as one CloudEvent JSON object per line.

## Subcommands

- None

## Manual

```text
Listen to events on a pull request and print each event to stdout as it happens, as one
CloudEvent JSON object per line.

Status messages go to stderr, so stdout carries only events. Use this to wait for changes instead of polling.

By default, the command exits after the first event. Use `--count` to exit after a number of
events, or `--follow` to keep listening until it is stopped. Use `--timeout` to limit how
long it listens. When the timeout is reached first, the command exits with status 8.

Pass a pull request URL with `--resource` and the event types to listen to with `--event`, repeating the flag
or separating types with commas:

- `com.github.pull_request.review.submitted.v1`: a review was submitted
- `com.github.pull_request.state.changed.v1`: the pull request was merged, closed, reopened, marked ready for review, or converted to draft
- `com.github.pull_request.head.changed.v1`: the head branch changed, for example after a push
- `com.github.pull_request.merge_conflict.v1`: the pull request has a merge conflict
- `com.github.pull_request.check_suite.status.changed.v1`: a check suite on the head commit completed, such as a CI workflow

Events are thin single line JSON objects with their `data.api_url` pointing at the object that changed,
such as the review, the pull request, or the check suite. Fetch it to learn what changed.

A pull request usually has several check suites, and each one sends its own event when it completes, with
its `data.conclusion`, such as `success` or `failure`. To wait for all checks,
read the pull request checks after each event, for example with `gh pr checks`.

Use `--jq` or `--template` to format each event; see `gh help formatting`.

A status message is printed each time the event stream is attached. Earlier events are not
replayed: only events that happen after that are delivered, so read the current state of the pull
request once the message is printed, even if you read it before.

The command creates a subscription for the resource and event types, or reuses an
existing one. Subscriptions expire after 24 hours, and each account can have a limited number
of them at a time. To listen to an existing subscription, pass its ID with `--subscription`.

If the event stream breaks, the command reconnects. Events that happen while it is disconnected are not delivered.

Events are only available for pull requests on `github.com`, not on GitHub Enterprise Server or GHE.com.

For more information about output formatting flags, see `gh help formatting`.

USAGE
  gh event listen [flags]

FLAGS
      --count int             Exit after this many events (default 1)
      --event type            Event type to listen to; repeat or separate with commas for more than one
      --follow[=true|false]   Keep listening for events until stopped
  -q, --jq expression         Filter each event using a jq expression
      --resource string       URL of the pull request to listen to
      --subscription string   ID of an existing subscription to listen to
  -t, --template string       Format each event using a Go template; see "gh help formatting"
      --timeout duration      Exit with status 8 after this long, in seconds or as a duration such as 30s or 10m

INHERITED FLAGS
  --help[=true|false]   Show help for command

EXAMPLES
  # Wait for the next review on a pull request, for up to 30 minutes
  $ gh event listen --resource https://github.com/OWNER/REPO/pull/123 --event com.github.pull_request.review.submitted.v1 --timeout 30m

  # Wait for a pull request to be merged or closed
  $ gh event listen --resource https://github.com/OWNER/REPO/pull/123 --event com.github.pull_request.state.changed.v1

  # Wait for the next check suite to complete and print its conclusion
  $ gh event listen --resource https://github.com/OWNER/REPO/pull/123 --event com.github.pull_request.check_suite.status.changed.v1 --jq .data.conclusion

  # Keep printing reviews and state changes until stopped
  $ gh event listen --resource https://github.com/OWNER/REPO/pull/123 --follow --event com.github.pull_request.review.submitted.v1,com.github.pull_request.state.changed.v1

  # Print the type and API URL of each event until stopped
  $ gh event listen --resource https://github.com/OWNER/REPO/pull/123 --follow --event com.github.pull_request.review.submitted.v1,com.github.pull_request.state.changed.v1 --jq '[.type, .data.api_url] | @tsv'

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
