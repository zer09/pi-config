# pp-klaviyo command reference

Use these examples as starting points. Inspect the installed command's `--help` before use because generated command surfaces can drift.

## Current release safety notes

The installed CLI is `klaviyo-pp-cli 2026.9.3`. The release ledger identifies `5bb1f7fc0d5df8cd83e88201be56458811c0eb00` as its source commit.

- `campaigns deploy` checks unsubscribe tags before creating a template or making other API calls. Raw campaign/template writes do not inherit this check; use [HTML QA](#campaign-html-qa) before deployment or launch.
- Ambiguous transport and 5xx retries are limited to GET, HEAD, and OPTIONS. Other methods, including read-only POST reports, are not retried on these failures. Bounded authentication and rate-limit recovery remain available. Inspect target state before any separately authorized write retry.
- Campaign creation and template assignment preserve nested JSON:API objects. After exact write authorization, inspect `campaigns create --help` for the JSON object flags or `--stdin`. Inspect `campaign-message-assign-template --help` for `--data-relationships-template`. Do not flatten nested objects or invent unsupported body flags.
- Path parameters are percent-encoded as single URL segments, including `.` and `..` values.

## Health and discovery

Run the [preflight](../scripts/preflight.sh) from this skill's directory, not from the project or `references/` directory:

```bash
sh ./scripts/preflight.sh
klaviyo-pp-cli --version
klaviyo-pp-cli --help
klaviyo-pp-cli agent-context --pretty
klaviyo-pp-cli which "<capability>" --json
klaviyo-pp-cli <resource> <command> --help
```

The current `doctor` command probes the bare API root, so credential validation can be inconclusive. Within an authorized authenticated-read task, prefer one bounded `accounts get` request. Do not print the raw account response. For offline maintenance, use version, help, and local `agent-context` checks only.

## Safe live read template

```bash
klaviyo-pp-cli <resource> <read-command> \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.<required-field>
```

`--select` operates on the raw Klaviyo JSON:API response before the CLI adds its provenance wrapper. Select resource IDs through `data.id` and attributes through `data.attributes.<field>`.

Add one command-specific page bound and sparse-field flag where available. Avoid `--all`. Do not replace the explicit flags with `--agent`.

## Representative reads

These shapes were checked against `klaviyo-pp-cli 2026.9.3` help without product API calls. Adjust selected fields to the request.

```bash
# Account identity. Capture and parse; do not print the raw object.
klaviyo-pp-cli accounts get \
  --fields-account timezone \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.timezone

# Email campaigns require a channel filter.
klaviyo-pp-cli campaigns get \
  --filter "equals(messages.channel,'email')" --page-size 10 \
  --fields-campaign name,status,created_at,updated_at \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.status,data.attributes.created_at,data.attributes.updated_at

klaviyo-pp-cli flows get \
  --page-size 10 --fields-flow name,status,trigger_type,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.status,data.attributes.trigger_type,data.attributes.created,data.attributes.updated

# One API page, with sparse non-customer fields.
klaviyo-pp-cli metrics get \
  --fields-metric name,created,updated,integration \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.created,data.attributes.updated,data.attributes.integration

# Profiles commonly contain PII. Keep fields non-identifying unless the request requires an identifier.
klaviyo-pp-cli profiles get \
  --page-size 5 --fields-profile created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.created,data.attributes.updated

# Events can contain profile data and arbitrary properties. Keep one small page.
klaviyo-pp-cli events get \
  --page-size 10 --fields-event datetime,timestamp \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.datetime,data.attributes.timestamp

klaviyo-pp-cli lists get \
  --page-size 10 --fields-list name,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.created,data.attributes.updated

klaviyo-pp-cli segments get \
  --page-size 10 --fields-segment name,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.created,data.attributes.updated

klaviyo-pp-cli templates get \
  --page-size 10 --fields-template name,editor_type,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.editor_type,data.attributes.created,data.attributes.updated
```

Campaign, flow, form, segment, and metric report queries use POST but are read-only analytics operations. In this CLI release, report shortcut help does not document a query-body input flag. Inspect `campaign-values-reports --help`, `flow-values-reports --help`, and `metric-aggregates --help`; do not improvise or execute a report until runtime help exposes the exact query input.

## Campaign HTML QA

Before an authorized deployment or launch, check the exact HTML file locally:

```bash
klaviyo-pp-cli plan qa-gate --html ./email.html \
  --json --no-input --no-color --data-source live --no-cache
```

Without `--campaign-id`, this command reads only the local HTML. Adding `--campaign-id` fetches campaign evidence and requires authenticated-read authorization and PII controls. Do not use `--dry-run` for validation; it only lists planned checks.

Inspect `verdict` and `findings`, not just the exit code. A failed finding can accompany exit 0. Missing HTML produces an unsubscribe warning, not proof of compliance.

Use `{% unsubscribe %}` as standalone text, or `{% unsubscribe_link %}` in an anchor's `href`. The full-link tag inside `href` and the URL-only tag outside `href` fail validation. Tags found only in comments or non-rendered `<template>` content do not count. Resolve failures and review warnings before continuing. Preview the rendered email too; this source check does not prove visibility or accessibility.

For `campaigns deploy`, `--template-file` reads a file; `--template-html` takes literal HTML despite the generated example showing a filename. A successful QA result does not authorize deployment or sending. Keep the mutation workflow and final confirmation gate.

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
