# gh extension

Source: https://cli.github.com/manual/gh_extension
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help extension`.

## Summary

GitHub CLI extensions are repositories that provide additional gh commands.

## Subcommands

- [`browse`](extension/browse.md) - Enter a UI for browsing, adding, and removing extensions
- [`create`](extension/create.md) - Create a new extension
- [`exec`](extension/exec.md) - Execute an installed extension
- [`install`](extension/install.md) - Install a gh extension from a repository
- [`list`](extension/list.md) - List installed extension commands
- [`remove`](extension/remove.md) - Remove an installed extension
- [`search`](extension/search.md) - Search extensions to the GitHub CLI
- [`upgrade`](extension/upgrade.md) - Upgrade installed extensions

## Manual

```text
GitHub CLI extensions are repositories that provide additional gh commands.

The name of the extension repository must start with `gh-` and it must contain an
executable of the same name. All arguments passed to the `gh <extname>` invocation
will be forwarded to the `gh-<extname>` executable of the extension.

An extension cannot override any of the core gh commands. If an extension name conflicts
with a core gh command, you can use `gh extension exec <extname>`.

When an extension is executed, gh will check for new versions once every 24 hours and display
an upgrade notice. See `gh help environment` for information on disabling extension notices.

Extensions are not verified, signed, or endorsed by GitHub. When you install or upgrade
		an extension, you are trusting its publisher. It is your responsibility to review the
		source and provenance of any extension before use.

For the list of available extensions, see <https://github.com/topics/gh-extension>.


USAGE
  gh extension [flags]

ALIASES
  gh extensions, gh ext

AVAILABLE COMMANDS
  browse:        Enter a UI for browsing, adding, and removing extensions
  create:        Create a new extension
  exec:          Execute an installed extension
  install:       Install a gh extension from a repository
  list:          List installed extension commands
  remove:        Remove an installed extension
  search:        Search extensions to the GitHub CLI
  upgrade:       Upgrade installed extensions

INHERITED FLAGS
  --help   Show help for command

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
