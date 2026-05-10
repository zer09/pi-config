# Pi RTK hook

Auto-wraps safe Pi `bash` tool calls with `rtk` before execution.

## Scope

This is a Pi extension, not a universal RTK hook. Pi auto-discovers it from:

```text
~/.pi/agent/extensions/rtk-hook/index.ts
```

It works in every Pi project after Pi is restarted or `/reload` is run.

It does not install hooks for Claude Code, Codex, Cursor, Windsurf, or other agents. Use `rtk init --help` and the appropriate `rtk init` target for those tools.

## Safety behavior

The extension only wraps single-command, allowlisted shell calls. It skips:

- commands already starting with `rtk`
- multi-line commands
- shell pipelines, redirects, command substitution, and chained commands
- mutating git subcommands such as `commit`, `push`, `reset`, `checkout`, `merge`, and `rebase`
- mutating package-manager subcommands such as `install`, `update`, and `publish`
- dangerous `find` flags such as `-delete` and `-exec`

## Disable

Set this before launching Pi:

```bash
PI_RTK_HOOK=0 pi
```
