# gh release

Source: https://cli.github.com/manual/gh_release
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help release`.

## Summary

Manage releases

## Subcommands

- [`create`](release/create.md) - Create a new release
- [`list`](release/list.md) - List releases in a repository
- [`delete`](release/delete.md) - Delete a release
- [`delete-asset`](release/delete-asset.md) - Delete an asset from a release
- [`download`](release/download.md) - Download release assets
- [`edit`](release/edit.md) - Edit a release
- [`upload`](release/upload.md) - Upload assets to a release
- [`verify`](release/verify.md) - Verify the attestation for a release
- [`verify-asset`](release/verify-asset.md) - Verify that a given asset originated from a release
- [`view`](release/view.md) - View information about a release

## Manual

```text
Manage releases

USAGE
  gh release <command> [flags]

GENERAL COMMANDS
  create:        Create a new release
  list:          List releases in a repository

TARGETED COMMANDS
  delete:        Delete a release
  delete-asset:  Delete an asset from a release
  download:      Download release assets
  edit:          Edit a release
  upload:        Upload assets to a release
  verify:        Verify the attestation for a release
  verify-asset:  Verify that a given asset originated from a release
  view:          View information about a release

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
