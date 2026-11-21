# pp-klaviyo command reference

Use these examples as starting points. Inspect the installed command's `--help` before use because generated command surfaces can drift.

## Current release safety notes

The installed CLI is `klaviyo-pp-cli 2026.11.7`. Its Klaviyo source matches release-ledger commit `1d0f487fb308e46275a10cb714de6061f8e3c258` (source `33f9f600c1cb2c06f751a0c18cb6b645adae2f31`). It uses Klaviyo API revision `2026-10-15`.

- Every data command needs `--client-profile klaviyo`. The profile holds `credential_ref = 'env:KLAVIYO_API_KEY'` plus the expected account ID and organization name. Before each command the CLI checks them through `GET /api/accounts`; a mismatch or a key without Accounts read access stops the command.
- `campaigns deploy` checks unsubscribe tags before creating a template or making other API calls. Raw campaign, variation and template writes do not inherit this check; use [HTML QA](#campaign-html-qa) before deployment or launch.
- Ambiguous transport and 5xx retries are limited to GET, HEAD, and OPTIONS. Other methods are not retried on these failures. `campaigns test-send` and A/B variation creation make a single attempt. Inspect target state before any separately authorized write retry.
- Write shortcuts that take a JSON:API body use `--stdin` and refuse to call the API without one. Inspect `--help` for the exact input; do not flatten nested objects or invent body flags.
- Path parameters are percent-encoded as single URL segments, including `.` and `..` values.

## Campaign model (API 2026-10-15)

A campaign is a container. Campaign messages carry status and send time. Campaign audiences carry included and excluded lists and segments. Campaign variations carry channel, template, subject and sender.

- Campaign IDs from before 2026-10-15 are now message IDs, and reports group by them. Campaign commands accept either a container ID or an old ID.
- `campaigns get-id` on an old ID returns a hint pointing at `campaign-messages get-id`.
- `campaign-message-assign-template` targets a variation ID; a message ID resolves to its single email variation.
- Campaign filters accept `id`, `name`, `archived`, `builder`, `created_at` and `updated_at`. Filter status on campaign messages instead.

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

Within an authorized authenticated-read task, verify the account with the identity probe. It returns only the profile name, gate outcome and the expected and observed non-secret identity:

```bash
klaviyo-pp-cli --client-profile klaviyo whoami
```

For offline maintenance, use version, help, and local `agent-context` checks only. Every other command, including local HTML QA, runs the live identity check.

## Safe live read template

```bash
klaviyo-pp-cli <resource> <read-command> \
  --client-profile klaviyo \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.<required-field>
```

`--select` operates on the raw Klaviyo JSON:API response before the CLI adds its provenance wrapper. Select resource IDs through `data.id` and attributes through `data.attributes.<field>`.

Add one command-specific page bound and sparse-field flag where available. Avoid `--all`. Do not replace the explicit flags with `--agent`, and keep output on stdout without `--deliver`.

## Representative reads

These shapes were checked against `klaviyo-pp-cli 2026.11.7` help and the bundled 2026-10-15 spec without product API calls. Adjust selected fields to the request.

```bash
# Campaign containers. Names live under definition.
klaviyo-pp-cli campaigns get \
  --client-profile klaviyo --page-size 10 \
  --filter "equals(archived,false)" \
  --fields-campaign definition.name,created_at,updated_at \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.definition.name,data.attributes.created_at,data.attributes.updated_at

# Campaign messages carry status and send options.
klaviyo-pp-cli campaign-messages get \
  --client-profile klaviyo --page-size 10 \
  --filter "equals(campaign_id,'<campaign-id>')" \
  --fields-campaign-message definition.name,definition.status,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.definition.name,data.attributes.definition.status

klaviyo-pp-cli flows get \
  --client-profile klaviyo --page-size 10 --fields-flow name,status,trigger_type,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.status,data.attributes.trigger_type,data.attributes.created,data.attributes.updated

# One API page, with sparse non-customer fields.
klaviyo-pp-cli metrics get \
  --client-profile klaviyo --fields-metric name,created,updated,integration \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.created,data.attributes.updated,data.attributes.integration

# Profiles commonly contain PII. Keep fields non-identifying unless the request requires an identifier.
klaviyo-pp-cli profiles get \
  --client-profile klaviyo --page-size 5 --fields-profile created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.created,data.attributes.updated

# Events can contain profile data and arbitrary properties. Keep one small page.
klaviyo-pp-cli events get \
  --client-profile klaviyo --page-size 10 --fields-event datetime,timestamp \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.datetime,data.attributes.timestamp

klaviyo-pp-cli lists get \
  --client-profile klaviyo --page-size 10 --fields-list name,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.created,data.attributes.updated

klaviyo-pp-cli segments get \
  --client-profile klaviyo --page-size 10 --fields-segment name,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.created,data.attributes.updated

klaviyo-pp-cli templates get \
  --client-profile klaviyo --page-size 10 --fields-template name,editor_type,created,updated \
  --json --compact --no-input --no-color \
  --data-source live --no-cache \
  --select data.id,data.attributes.name,data.attributes.editor_type,data.attributes.created,data.attributes.updated
```

Campaign, flow, form, segment, and metric report queries use POST but are read-only analytics operations. `campaign-values-reports` now exposes the query through `--timeframe`, `--statistics`, `--conversion-metric-id` and `--data-attributes-*` flags; `metric-aggregates` takes the JSON:API body through `--stdin`. Inspect the command's `--help` before each report and keep timeframes and statistics narrow. Campaign value reports have a low daily rate limit (225 per day).

`campaigns ab-test results` is a read. `send-budget` creates recipient-estimation jobs for missing estimates by default; these change no campaign, but use `send-budget --no-refresh` for a fully read-only check.

## Campaign HTML QA

Before an authorized deployment or launch, check the exact HTML file locally:

```bash
klaviyo-pp-cli plan qa-gate --html ./email.html \
  --client-profile klaviyo \
  --json --no-input --no-color --data-source live --no-cache
```

In this release even local HTML QA runs the live identity check first (one `GET /api/accounts`), so it needs the profile, network access and authenticated-read authorization. Without `--campaign-id` it reads no campaign data. Adding `--campaign-id` or `--brand` fetches account evidence and requires PII controls. Do not use `--dry-run` for validation; it only lists planned checks.

Inspect `verdict` and `findings`, not just the exit code. A failed finding can accompany exit 0. Missing HTML produces an unsubscribe warning, not proof of compliance.

Use `{% unsubscribe %}` as standalone text, or `{% unsubscribe_link %}` in an anchor's `href`. The full-link tag inside `href` and the URL-only tag outside `href` fail validation. Tags found only in comments or non-rendered `<template>` content do not count. Resolve failures and review warnings before continuing. Preview the rendered email too; this source check does not prove visibility or accessibility.

For `campaigns deploy`, `--template-file` reads a file; `--template-html` takes literal HTML. Audiences use repeatable `--list-id` and `--segment-id`, with `--exclude` for exclusions. A successful QA result does not authorize deployment, test sends or sending. Keep the mutation workflow and final confirmation gate.

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
- `campaigns test-send`, which emails previews to real addresses (`--to`, or `KLAVIYO_TEST_SEND_TO`);
- `campaigns ab-test create`, which adds variations and A/B settings to a draft;
- `forms publish` and `forms unpublish`, which change a live signup form (they preview until `--apply`);
- `flows insert-step --apply`, which edits a flow and can affect a live flow;
- profile subscription, unsubscription, suppression, unsuppression, merge, or deletion;
- privacy deletion requests;
- bulk profile, event, catalog, coupon, or custom-object imports and jobs;
- deletion of campaigns, flows, forms, lists, segments, templates, or customer data;
- changing a flow status to live;
- webhook creation or delivery to a new external endpoint.

Do not run any write command while exploring syntax. Use `--help`, then `--dry-run` or the preview mode when supported. Stream-filter any authorization line before capture, and show only a redacted summary.

## Known CLI caveats

- The binary pins Klaviyo API revision `2026-10-15`; review revision changes before upgrading.
- `--agent` sets output defaults only in this release, but use explicit flags so commands stay reviewable.
- `--no-cache` disables the JSON response cache but does not stop SQLite write-through under `--data-source auto`.
- Local data, caches and learning journals belong to the selected client profile.
- Never run `auth set-token`; use only `KLAVIYO_API_KEY` from the environment through the `klaviyo` profile.
- `KLAVIYO_BASE_URL` must be unset when using the real key.
- `--deliver` can route output to a file, a webhook or a hosted page; never use it for Klaviyo data.
- Installed runtime help wins over generated prose.
