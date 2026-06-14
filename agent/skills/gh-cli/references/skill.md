# gh skill

Source: https://cli.github.com/manual/gh_skill
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help skill`.

## Summary

Install and manage agent skills from GitHub repositories.

## Subcommands

- `gh skill install` - Install agent skills from a GitHub repository (preview) - [reference](skill/install.md)
- `gh skill preview` - Preview a skill from a GitHub repository (preview) - [reference](skill/preview.md)
- `gh skill publish` - Validate and publish skills to a GitHub repository (preview) - [reference](skill/publish.md)
- `gh skill search` - Search for skills across GitHub (preview) - [reference](skill/search.md)
- `gh skill update` - Update installed skills to their latest versions (preview) - [reference](skill/update.md)

## Manual

```text
Install and manage agent skills from GitHub repositories.

Working with agent skills in the GitHub CLI is in preview and
subject to change without notice.


USAGE
  gh skill <command> [flags]

ALIASES
  gh skills

AVAILABLE COMMANDS
  install:       Install agent skills from a GitHub repository (preview)
  preview:       Preview a skill from a GitHub repository (preview)
  publish:       Validate and publish skills to a GitHub repository (preview)
  search:        Search for skills across GitHub (preview)
  update:        Update installed skills to their latest versions (preview)

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  # Search for skills
  $ gh skill search terraform
  
  # Install a skill
  $ gh skill install github/awesome-copilot documentation-writer
  
  # Preview a skill before installing
  $ gh skill preview github/awesome-copilot documentation-writer
  
  # Update all installed skills
  $ gh skill update --all
  
  # Validate skills for publishing
  $ gh skill publish --dry-run

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
