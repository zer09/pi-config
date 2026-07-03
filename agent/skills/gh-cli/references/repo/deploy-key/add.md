# gh repo deploy-key add

Source: https://cli.github.com/manual/gh_repo_deploy-key_add
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help repo deploy-key add`.

## Summary

Add a deploy key to a GitHub repository.

## Subcommands

- None

## Manual

```text
Add a deploy key to a GitHub repository.

Note that any key added by gh will be associated with the current authentication token.
If you de-authorize the GitHub CLI app or authentication token from your account, any
deploy keys added by GitHub CLI will be removed as well.


USAGE
  gh repo deploy-key add <key-file> [flags]

FLAGS
  -w, --allow-write    Allow write access for the key
  -t, --title string   Title of the new key

INHERITED FLAGS
      --help                     Show help for command
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

EXAMPLES
  # Generate a passwordless SSH key and add it as a deploy key to a repository
  $ ssh-keygen -t ed25519 -C "my description" -N "" -f ~/.ssh/gh-test
  $ gh repo deploy-key add ~/.ssh/gh-test.pub

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
