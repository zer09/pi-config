---
name: pp-posthog
description: "Access PostHog from Pi through the local `posthog-pp-cli`. Use for PostHog reads, feature flags, experiments, persons, dashboards, errors, events, LLM traces, cache hydration/sync/search, flag blast-radius or rollout checks, and when the user asks to query or check PostHog data."
---

# PostHog CLI

Use the local `posthog-pp-cli` for PostHog reads and carefully gated writes. PostHog is an external hosted service: stay read-only unless the user explicitly requests the exact create, update, delete, import, bulk update, or other remote mutation.

## Core rules

- Verify the binary before use: `command -v posthog-pp-cli && posthog-pp-cli --version`.
- If missing, suggest `npx -y @mvanhorn/printing-press-library install posthog --cli-only`; do not install unless the user asks.
- Verify connectivity with `posthog-pp-cli doctor`. Do not print tokens, OAuth headers, config secrets, cookies, `api_token`, or full config files.
- Prefer `--agent` for read-only commands and add `--select` to keep output small.
- Do not print raw `users retrieve @me` output. It can include email and team tokens; parse only the fields needed, usually `.results.team.project_id`.
- Treat `posthog-pp-cli sync` as local cache hydration: it reads from PostHog and writes local SQLite. Run it when the user asks to hydrate, sync, search offline, or refresh stale cache.
- For remote mutations, do a `--dry-run` first when supported and ask for confirmation unless the user has already requested that exact mutation. Remember `--agent` includes `--yes`, so do not use it casually on destructive commands.

## Read workflow

1. Check health:
   ```bash
   posthog-pp-cli doctor
   ```
2. Resolve the current project ID without printing the full user response:
   ```bash
   tmp=$(mktemp)
   trap 'rm -f "$tmp"' EXIT
   posthog-pp-cli users retrieve @me --agent > "$tmp"
   project_id=$(jq -r '.results.team.project_id // .team.project_id' "$tmp")
   ```
3. Inspect help before syntax-sensitive commands:
   ```bash
   posthog-pp-cli --help
   posthog-pp-cli projects feature-flags list --help
   ```
4. Run bounded read commands with `--agent` and `--select`:
   ```bash
   posthog-pp-cli projects feature-flags list <project_id> --limit 20 --agent --select id,key,active
   ```

## Cache and offline analysis

Hydrate or refresh the local cache when the user asks:

```bash
posthog-pp-cli sync --agent
```

Parse the final `sync_summary` and summarize warning counts instead of dumping all output. Expected non-fatal warnings include denied scopes for resources the token cannot read.

After sync, use local-capable commands:

```bash
posthog-pp-cli search "checkout" --data-source local --agent --limit 20
posthog-pp-cli analytics --type users --agent
```

## Command reference

Read [commands](references/commands.md) for tested command shapes, feature-flag safety recipes, local cache/search usage, and known command-surface drift.

Important local note: installed CLI versions may differ from the generated README. If a README command fails, trust `posthog-pp-cli --help`, `posthog-pp-cli api`, and `posthog-pp-cli which` from the installed binary.

## Maintenance

Update this Local Skill using `../../../docs/skills/pp-posthog-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`, keep hosted-service safety gates in this runtime file, and keep longer command catalogs in `references/`.
