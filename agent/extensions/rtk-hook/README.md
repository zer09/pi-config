# Pi RTK hook

Auto-wraps approved read-only Pi `bash` tool calls with `rtk` before execution.

The allowlist is based on the generated RTK instructions section `RTK (Rust Token Killer) - Token-Optimized Commands`, then narrowed to commands that are safe to auto-wrap when an agent mistakenly uses direct `bash` instead of Context Mode. The extension also asks RTK itself to rewrite the command with `rtk rewrite`; the RTK rewrite output is used as the final command.

## Scope

This is a Pi extension, not a universal RTK hook. Pi auto-discovers it from:

```text
~/.pi/agent/extensions/rtk-hook/index.ts
```

It works in every Pi project after Pi is restarted or `/reload` is run.

It does not install hooks for Claude Code, Codex, Cursor, Windsurf, or other agents. Use `rtk init --help` and the appropriate `rtk init` target for those tools.

## Policy relationship with Context Mode

Context Mode remains mandatory for compliant agents. Read-only shell work should go through `ctx_execute`, `ctx_batch_execute`, or `ctx_execute_file` according to `~/.pi/agent/AGENTS.md` and the context-watcher skill.

This hook is only a fallback safety net for agents that ignore those rules and call Pi `bash` directly. It reduces token waste and avoids unsafe rewrites, but it does not make direct `bash` the preferred path.

## Safety behavior

The extension only wraps single-command, read-only shell calls that match explicit command patterns and have an RTK-supported rewrite. It skips:

- commands already starting with `rtk`
- commands with leading environment assignments
- multi-line commands
- shell pipelines, redirects, command substitution, and chained commands
- commands that `rtk rewrite` does not support
- broad executable matches that are not explicitly approved
- mutating package-manager, git, Docker, Kubernetes, Prisma, AWS, and database commands
- dangerous `find` flags such as `-delete` and `-exec`

Examples that wrap:

- `git status`
- `git diff --stat`
- `gh pr view 123`
- `docker ps`
- `kubectl get pods`
- `pytest`
- `cargo test`
- `npm run test`
- `npx tsc` -> `rtk tsc`
- `rg TODO src` -> `rtk grep TODO src`
- `cat package.json` -> `rtk read package.json`
- `go test ./...`

Examples that do not wrap:

- `git push`
- `docker compose up`
- `kubectl apply -f app.yaml`
- `npm install`
- `prisma migrate deploy`
- `psql -f migrate.sql`
- `terraform plan`

## Smoke test

Run after editing the hook:

```bash
bun ~/.pi/agent/extensions/rtk-hook/smoke.test.ts
```

## Disable

Set this before launching Pi:

```bash
PI_RTK_HOOK=0 pi
```
