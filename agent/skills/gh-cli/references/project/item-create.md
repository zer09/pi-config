# gh project item-create

Source: https://cli.github.com/manual/gh_project_item-create
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help project item-create`.

## Summary

Create a draft issue item in a project

## Subcommands

- None

## Manual

```text
Create a draft issue item in a project

For more information about output formatting flags, see `gh help formatting`.

USAGE
  gh project item-create [<number>] [flags]

FLAGS
      --body string       Body for the draft issue
      --format string     Output format: {json}
  -q, --jq expression     Filter JSON output using a jq expression
      --owner string      Login of the owner. Use "@me" for the current user.
  -t, --template string   Format JSON output using a Go template; see "gh help formatting"
      --title string      Title for the draft issue

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  # Create a draft issue in the current user's project "1"
  $ gh project item-create 1 --owner "@me" --title "new item" --body "new item body"

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
