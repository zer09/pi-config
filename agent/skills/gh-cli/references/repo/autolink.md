# gh repo autolink

Source: https://cli.github.com/manual/gh_repo_autolink
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help repo autolink`.

## Summary

Autolinks link issues, pull requests, commit messages, and release descriptions to external third-party services.

## Subcommands

- `gh repo autolink create` - Create a new autolink reference - [reference](autolink/create.md)
- `gh repo autolink delete` - Delete an autolink reference - [reference](autolink/delete.md)
- `gh repo autolink list` - List autolink references for a GitHub repository - [reference](autolink/list.md)
- `gh repo autolink view` - View an autolink reference - [reference](autolink/view.md)

## Manual

```text
Autolinks link issues, pull requests, commit messages, and release descriptions to external third-party services.

Autolinks require `admin` role to view or manage.

For more information, see <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/configuring-autolinks-to-reference-external-resources>


USAGE
  gh repo autolink <command> [flags]

AVAILABLE COMMANDS
  create:        Create a new autolink reference
  delete:        Delete an autolink reference
  list:          List autolink references for a GitHub repository
  view:          View an autolink reference

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
