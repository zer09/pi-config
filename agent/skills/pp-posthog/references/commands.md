# pp-posthog command reference

Use these as starting points, then inspect `--help` on the installed binary because Printing Press command surfaces can drift.

## Health and identity

```bash
posthog-pp-cli --version
posthog-pp-cli doctor
posthog-pp-cli users retrieve @me --agent --select id,uuid,is_staff
```

Do not print raw `users retrieve @me` output; it may include email or team token fields. For project ID, save to a temp file and parse only the needed field:

```bash
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
posthog-pp-cli users retrieve @me --agent > "$tmp"
project_id=$(jq -r '.results.team.project_id // .team.project_id' "$tmp")
```

## Discover commands

```bash
posthog-pp-cli --help
posthog-pp-cli api
posthog-pp-cli api projects
posthog-pp-cli which "list feature flags" --agent
posthog-pp-cli projects feature-flags list --help
```

Known drift observed on `posthog-pp-cli 2026.6.1`: top-level `organizations` and `query` commands from some README examples were absent. Use `projects ...`, `users ...`, `api`, and `--help` from the installed binary.

## Project-scoped reads

Most resource commands need `<project_id>`. Resolve it from the current user response via the temp-file pattern above and avoid printing sensitive fields.

```bash
posthog-pp-cli projects feature-flags list <project_id> --limit 20 --agent --select id,key,active,created_at
posthog-pp-cli projects events list <project_id> --limit 20 --agent --select id,event,timestamp
posthog-pp-cli projects insights list <project_id> --limit 20 --agent --select id,name,short_id
posthog-pp-cli projects dashboards list <project_id> --limit 20 --agent --select id,name
posthog-pp-cli projects experiments list <project_id> --limit 20 --agent --select id,name,feature_flag_key
posthog-pp-cli projects persons list <project_id> --limit 20 --agent --select id,distinct_ids,created_at
```

## Feature flag safety

Use before archiving, renaming, or ramping flags.

```bash
posthog-pp-cli flags blast-radius --key <flag-key> --agent
posthog-pp-cli flags rollout-health --key <flag-key> --window 24h --agent
posthog-pp-cli flags stale --days 60 --agent --select key,days_stale
```

If a command requires a positional flag key rather than `--key`, inspect its help and use the installed syntax.

## Cache hydration, search, and local analytics

```bash
posthog-pp-cli sync --agent
posthog-pp-cli sync --latest-only --agent
posthog-pp-cli search "checkout" --data-source local --agent --limit 20
posthog-pp-cli analytics --type users --agent
posthog-pp-cli analytics --type organizations --agent
```

Summarize `sync_summary` and warning counts. Permission warnings for unavailable resources are often non-fatal if the summary reports successful resources.

## Compound analysis

```bash
posthog-pp-cli dashboard health --stale-days 7 --agent
posthog-pp-cli experiments pre-check --agent
posthog-pp-cli persons at-risk --cohort <cohort-key-or-id> --silent-days 14 --agent
posthog-pp-cli events property-drift <event-name> --agent
posthog-pp-cli llm cost-attribution --flag <flag-key> --days 30 --agent
```

These commands may require synced local data or project-specific identifiers. If results look empty, run `doctor`, resolve the project ID, and hydrate with `sync`.

## Remote mutation gate

Examples of commands that mutate PostHog and require exact user instruction: `create`, `update`, `partial-update`, `destroy`, `bulk-delete-create`, `bulk-update-tags-create`, `import`, invite redemption, and user-home-settings changes.

For mutations:

1. Verify target project/resource IDs.
2. Run `--dry-run` where supported.
3. Ask for explicit confirmation unless already provided.
4. Avoid printing payloads containing secrets or PII.
