# gh project field-list

Source: https://cli.github.com/manual/gh_project_field-list
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help project field-list`.

## Summary

List the fields in a project

## Subcommands

- None

## Manual

```text
List the fields in a project

For more information about output formatting flags, see `gh help formatting`.

USAGE
  gh project field-list [<number>] [flags]

FLAGS
      --format string     Output format: {json}
  -q, --jq expression     Filter JSON output using a jq expression
  -L, --limit int         Maximum number of fields to fetch (default 30)
      --owner string      Login of the owner. Use "@me" for the current user.
  -t, --template string   Format JSON output using a Go template; see "gh help formatting"

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  # List fields in the current user's project "1"
  $ gh project field-list 1 --owner "@me"

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
