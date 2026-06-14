# gh attestation

Source: https://cli.github.com/manual/gh_attestation
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help attestation`.

## Summary

Download and verify artifact attestations.

## Subcommands

- `gh attestation download` - Download an artifact's attestations for offline use - [reference](attestation/download.md)
- `gh attestation trusted-root` - Output trusted_root.jsonl contents, likely for offline verification - [reference](attestation/trusted-root.md)
- `gh attestation verify` - Verify an artifact's integrity using attestations - [reference](attestation/verify.md)

## Manual

```text
Download and verify artifact attestations.


USAGE
  gh attestation [subcommand] [flags]

ALIASES
  gh at

AVAILABLE COMMANDS
  download:      Download an artifact's attestations for offline use
  trusted-root:  Output trusted_root.jsonl contents, likely for offline verification
  verify:        Verify an artifact's integrity using attestations

INHERITED FLAGS
  --help   Show help for command

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
