# pp-klaviyo command reference

Use these examples as starting points. Inspect the installed command's `--help` before use because generated command surfaces can drift.

## Health and discovery

```bash
$HOME/.pi/agent/skills/pp-klaviyo/scripts/preflight.sh
klaviyo-pp-cli --version
klaviyo-pp-cli --help
klaviyo-pp-cli agent-context --pretty
klaviyo-pp-cli which "<capability>" --json
klaviyo-pp-cli <resource> <command> --help
```

The current `doctor` command probes the bare API root, so credential validation can be inconclusive. Prefer one bounded `accounts get` request for a live authenticated check. Do not print the raw account response.

## Safe live read template

```bash
klaviyo-pp-cli <resource> <read-command> \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select <required-fields>
```

Add one command-specific page bound and sparse-field flag where available. Avoid `--all`. Do not replace the explicit flags with `--agent`.

## Representative reads

These shapes were checked against `klaviyo-pp-cli 2026.8.1` help. Adjust selected fields to the request.

```bash
# Account identity. Capture and parse; do not print the raw object.
klaviyo-pp-cli accounts get \
  --fields-account timezone \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,timezone

# Email campaigns require a channel filter.
klaviyo-pp-cli campaigns get \
  --filter "equals(messages.channel,'email')" --page-size 10 \
  --fields-campaign name,status,created_at,updated_at \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,name,status,created_at,updated_at

klaviyo-pp-cli flows get \
  --page-size 10 --fields-flow name,status,trigger_type,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,name,status,trigger_type,created,updated

# One API page, with sparse non-customer fields.
klaviyo-pp-cli metrics get \
  --fields-metric name,created,updated,integration \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,name,created,updated,integration

# Profiles commonly contain PII. Keep fields non-identifying unless the request requires an identifier.
klaviyo-pp-cli profiles get \
  --page-size 5 --fields-profile created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,created,updated

# Events can contain profile data and arbitrary properties. Keep one small page.
klaviyo-pp-cli events get \
  --page-size 10 --fields-event datetime,timestamp \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,datetime,timestamp

klaviyo-pp-cli lists get \
  --page-size 10 --fields-list name,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,name,created,updated

klaviyo-pp-cli segments get \
  --page-size 10 --fields-segment name,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,name,created,updated

klaviyo-pp-cli templates get \
  --page-size 10 --fields-template name,editor_type,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select id,name,editor_type,created,updated
```

Campaign, flow, form, segment, and metric report queries use POST but are read-only analytics operations. In this CLI release, report shortcut help does not document a query-body input flag. Inspect `campaign-values-reports --help`, `flow-values-reports --help`, and `metric-aggregates --help`; do not improvise or execute a report until runtime help exposes the exact query input.

## PII controls

Profiles, events, subscriptions, suppression jobs, push tokens, reviews, list membership, segment membership, and account contact information can contain PII. Use sparse fields, small page sizes, exact filters, and `--select`. Prefer counts and aggregate summaries. Never print complete profile, event, subscription, address, phone, email, or account objects.

Use a temporary file with restrictive permissions when a response must be parsed:

```bash
tmp=$(mktemp)
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT
```

Write the command response to the file, parse only required fields, and remove the file immediately.

## High-impact operations

The following operations require the mutation workflow and final confirmation:

- campaign send, schedule, cancellation, deploy, or recipient-wide action;
- profile subscription, unsubscription, suppression, unsuppression, merge, or deletion;
- privacy deletion requests;
- bulk profile, event, catalog, coupon, or custom-object imports and jobs;
- deletion of campaigns, flows, forms, lists, segments, templates, or customer data;
- changing a flow status to live;
- webhook creation or delivery to a new external endpoint.

Do not run any write command while exploring syntax. Use `--help`, then `--dry-run` when supported. Stream-filter any authorization line before capture, and show only a redacted summary.

## Known CLI caveats

- The binary pins Klaviyo API revision `2026-04-15`; review revision changes before upgrading.
- `--agent` includes `--yes`. Never use it for remote writes or generic copyable templates.
- `--no-cache` disables the JSON response cache but does not stop SQLite write-through under `--data-source auto`.
- CLI caches are not isolated by account or credential identity.
- Never run `auth set-token`; use only `KLAVIYO_API_KEY` from the environment.
- OAuth refresh is not usable in this version. This skill supports the one-account private-key flow only.
- `KLAVIYO_BASE_URL` must be unset when using the real key.
- Installed runtime help wins over generated prose.
