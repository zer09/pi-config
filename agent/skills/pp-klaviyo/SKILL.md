---
name: pp-klaviyo
description: "Access Klaviyo from Pi through the local `klaviyo-pp-cli`. Use for Klaviyo profiles, events, campaigns, flows, segments, lists, metrics, templates, reporting, webhooks, and account inspection or carefully gated changes."
---

# Klaviyo CLI

## Purpose and boundary

Use the local `klaviyo-pp-cli` as a direct REST API adapter for one Klaviyo account. Do not install, configure, start, inspect, or use an MCP component.

Treat Klaviyo as a hosted service that is read-only by default. Use only the existing `KLAVIYO_API_KEY` environment variable. Never inspect, print, persist, copy, or pass its value as an argument. Never run `auth set-token`.

## Preflight

Run the bundled preflight before authenticated access:

```bash
$HOME/.pi/agent/skills/pp-klaviyo/scripts/preflight.sh
```

Stop if the CLI or key is missing. Stop if `KLAVIYO_BASE_URL` is set, and do not print its value. Trust the installed command's `--help` over generated documentation.

## Read workflow

1. Inspect `<command> --help` before use.
2. Use these flags explicitly on every normal API read:
   ```text
   --json --compact --no-input --no-color --data-source live --no-cache
   ```
3. Request one bounded page unless the user needs more. Do not use `--all` by default.
4. Use API sparse-field flags and `--select` whenever practical.
5. Capture sensitive responses in restrictive temporary files when parsing is needed. Delete each file immediately.
6. Return only requested fields or aggregates. Summarize instead of dumping account, profile, event, subscription, address, phone, or email data.

Never use `--agent` as a generic shortcut. It includes `--yes`, which is unsafe to copy into write commands.

## Mutation workflow

Do not mutate Klaviyo unless the latest user request authorizes the exact target and effect. For each authorized mutation:

1. Inspect the installed write command's `--help`.
2. Read the exact target with `--data-source live --no-cache` and narrow output.
3. Prepare the smallest payload.
4. Run `--dry-run` when supported. Stream-filter any authorization line before capture; never save unfiltered dry-run output. Show only a redacted target and effect summary.
5. Confirm that the proposed request exactly matches the user's authorization.
6. Execute once without `--agent`. Add an explicit `--yes` only if the CLI requires it after current user confirmation.
7. Read the target back with `--data-source live --no-cache` and report the result.

Always ask for final confirmation immediately before sending or scheduling a campaign, cancelling a send, bulk subscription changes, suppression changes, profile merges or deletes, privacy deletion jobs, destructive resource deletion, making a flow live, broad imports, bulk jobs, or webhook delivery to a new endpoint. Warn that bulk unsubscribe operations can globally unsubscribe profiles outside a specified list. Also ask when scope, audience, consent, or reversibility is unclear. Never infer consent, subscription status, audience, or destructive identifiers.

## Cache and local-data boundary

Normal reads require both `--data-source live` and `--no-cache`. The first prevents automatic SQLite write-through. The second prevents the separate JSON response cache.

Do not run `sync`, local `search`, local analytics, or `--data-source auto` unless the user separately requests local storage and accepts the customer-data privacy implications.

## UI fallback

Use the API first. For API-key management or a genuinely UI-only operation, load the `pi-browser-harness` skill and follow its browser setup requirement. Keep browser actions read-only unless the user authorizes the exact UI mutation.

## Command reference

Read [the command reference](references/commands.md) for tested command shapes, PII controls, high-impact operations, and current CLI caveats.

## Maintenance

Use the [pp-klaviyo update process](../../../docs/skills/pp-klaviyo-update-process.md) for maintenance. Preserve the local secret, cache, PII, base URL, and mutation overlays when upstream changes.
