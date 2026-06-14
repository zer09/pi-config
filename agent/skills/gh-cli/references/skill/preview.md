# gh skill preview

Source: https://cli.github.com/manual/gh_skill_preview
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help skill preview`.

## Summary

Render a skill's `SKILL.md` content in the terminal. This fetches the skill file from the repository and displays it using the configured pager, without installing anything.

## Subcommands

- None

## Manual

```text
Render a skill's `SKILL.md` content in the terminal. This fetches the
skill file from the repository and displays it using the configured
pager, without installing anything.

A file tree is shown first, followed by the rendered `SKILL.md` content.
When running interactively and the skill contains additional files
(scripts, references, etc.), a file picker lets you browse them
individually.

When run with only a repository argument, lists available skills and
prompts for selection.

To preview a specific version of the skill, append `@VERSION` to the
skill name. The version is resolved as a git tag, branch, or commit SHA.


USAGE
  gh skill preview <repository> [<skill>] [flags]

ALIASES
  gh skill show, gh skills show

FLAGS
  --allow-hidden-dirs   Include skills in hidden directories (e.g. .claude/skills/, .agents/skills/)

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  # Preview a specific skill
  $ gh skill preview github/awesome-copilot documentation-writer
  
  # Preview a skill at a specific version
  $ gh skill preview github/awesome-copilot documentation-writer@v1.2.0
  
  # Preview a skill at a specific commit SHA
  $ gh skill preview github/awesome-copilot documentation-writer@abc123def456
  
  # Browse and preview interactively
  $ gh skill preview github/awesome-copilot

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
