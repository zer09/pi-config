# gh repo deploy-key list

Source: https://cli.github.com/manual/gh_repo_deploy-key_list
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help repo deploy-key list`.

## Summary

List deploy keys in a GitHub repository

## Subcommands

- None

## Manual

```text
List deploy keys in a GitHub repository

For more information about output formatting flags, see `gh help formatting`.

USAGE
  gh repo deploy-key list [flags]

ALIASES
  gh repo deploy-key ls

FLAGS
  -q, --jq expression     Filter JSON output using a jq expression
      --json fields       Output JSON with the specified fields
  -t, --template string   Format JSON output using a Go template; see "gh help formatting"

INHERITED FLAGS
      --help                     Show help for command
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

JSON FIELDS
  createdAt, id, key, readOnly, title

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
