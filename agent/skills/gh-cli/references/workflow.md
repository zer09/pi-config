# gh workflow

Source: https://cli.github.com/manual/gh_workflow
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help workflow`.

## Summary

List, view, and run workflows in GitHub Actions.

## Subcommands

- `gh workflow disable` - Disable a workflow - [reference](workflow/disable.md)
- `gh workflow enable` - Enable a workflow - [reference](workflow/enable.md)
- `gh workflow list` - List workflows - [reference](workflow/list.md)
- `gh workflow run` - Run a workflow by creating a workflow_dispatch event - [reference](workflow/run.md)
- `gh workflow view` - View the summary of a workflow - [reference](workflow/view.md)

## Manual

```text
List, view, and run workflows in GitHub Actions.

USAGE
  gh workflow <command> [flags]

AVAILABLE COMMANDS
  disable:       Disable a workflow
  enable:        Enable a workflow
  list:          List workflows
  run:           Run a workflow by creating a workflow_dispatch event
  view:          View the summary of a workflow

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

INHERITED FLAGS
  --help   Show help for command

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
