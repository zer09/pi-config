# gh issue status

Source: https://cli.github.com/manual/gh_issue_status
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help issue status`.

## Summary

Show status of relevant issues

## Subcommands

- None

## Manual

```text
Show status of relevant issues

For more information about output formatting flags, see `gh help formatting`.

USAGE
  gh issue status [flags]

FLAGS
  -q, --jq expression     Filter JSON output using a jq expression
      --json fields       Output JSON with the specified fields
  -t, --template string   Format JSON output using a Go template; see "gh help formatting"

INHERITED FLAGS
      --help                     Show help for command
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

JSON FIELDS
  assignees, author, body, closed, closedAt, closedByPullRequestsReferences,
  comments, createdAt, id, isPinned, labels, milestone, number, projectCards,
  projectItems, reactionGroups, state, stateReason, title, updatedAt, url

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
