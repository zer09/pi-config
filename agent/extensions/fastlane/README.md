# fastlane

Local Pi extension that enables Codex Fast mode and publishes active state for `footer`.

## Behavior

Fastlane is disabled by default. Run `/fastlane` to enable it for the current session, or pass the boolean `--fastlane` flag at startup.
The flag defaults to `false` and applies only to the current Pi invocation. Fastlane does not save startup intent in settings or session entries.

When enabled and the current model is eligible, Fastlane injects:

```json
{
  "service_tier": "priority"
}
```

Eligibility follows the official Codex model catalog's advertised `priority` service tier:

- provider: canonical `openai-codex` or a valid `openai-codex-<slug>` alias
- API: `openai-codex-responses`
- model: `gpt-5.4`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-sol`, or `gpt-6.1-sol`
- ChatGPT OAuth/subscription auth, not API-key auth
- payload model matches the current model ID
- payload does not already include `service_tier`, including inherited fields or an explicit `undefined` value

The catalog advertises **Fast** as 2x speed with increased usage for `gpt-6-astra` and `gpt-6.1-sol`, and 1.5x speed for `gpt-6-sol` and `gpt-6-luna`. Models without that catalog tier, including `gpt-5.4-mini`, remain ineligible. The four GPT-6 additions were checked against `openai/codex` `codex-rs/models-manager/models.json` blob `77e0389c56000ca19df5029278c30c3e9528af51`. Existing entries remain from the earlier catalog blob `47e640365d465dc710644bf9508f1f741108ff43`.

If the current model is not eligible, `/fastlane` shows a warning and leaves Fastlane disabled.
Personal, Business, and future aliases use the shared strict provider-ID classifier from `openai-codex-aliases`.
Malformed IDs such as `openai-codex-` remain ineligible.

Fastlane does not show a `fast` text indicator. It emits `fastlane:state`; `footer` uses that active/inactive state to repeat the existing thinking glyph three times, e.g. `●●●`.

## Startup intent and manual control

With `--fastlane`, session startup enables Fastlane only when the current model and auth are eligible.
Startup intent remains active across route changes: eligible to ineligible disables Fastlane; returning to eligible re-enables it.
Fastlane checks eligibility again before each provider request, including auth changes without a model switch.

A valid `/fastlane` toggle takes control from startup intent for the session, even if eligibility prevents enablement.
Later model or auth changes cannot undo a manual disable.
Manual enablement keeps the ordinary disable-only behavior: an ineligible route disables Fastlane, and returning to eligible does not re-enable it.
Unsupported command arguments do not change startup intent.

Without the flag, ordinary `/fastlane` behavior remains unchanged.
An eligible model switch keeps manual enablement active; an ineligible switch or lost OAuth auth disables it until another manual toggle.

## RPC configuration status

Only flag-requested sessions in RPC mode publish `ctx.ui.setStatus` under the fixed key `delegate-fastlane`.
The key is exported as `FASTLANE_RPC_STATUS_KEY` from `constants.ts`.
Status values are only `enabled` and `inactive`; they contain no model IDs, provider details, or auth data.
Fastlane publishes on `session_start`, `model_select`, and every `before_provider_request`, even when the status value is unchanged.
A manual toggle also publishes the updated configuration for flag-requested RPC sessions.

The status confirms child-local configuration for the current route, not actual payload injection or server speed.
Protected `service_tier` fields and mismatched payload models still prevent injection without changing the enabled configuration.
TUI, JSON, print, and non-requested RPC sessions do not publish this status.
The existing in-process `fastlane:state` event remains unchanged for the local footer.
Fastlane adds no tools and does not control another Pi process's state or footer.

## Delegated invocations

`delegate_run` can request `fastlane: true` for one invocation. The default is false, independent of parent Fastlane state. This increases subscription usage. Delegated runtime children load Fastlane as the sixth fixed approved extension; alias-only catalog preflight does not load it. Every fresh runtime fallback or replacement receives `--fastlane` only when requested.

The delegate parent shows the text marker `fastlane` only for requested, child-confirmed enabled configuration. This marker is separate from the local footer glyph. Confirmation resets at each attempt and catalog transition. Parked and administrative route-switch status is discarded. Same-model fallback needs fresh provider-request status. Missing, cleared, malformed, or unknown status clears confirmation. Accepted status renews only RPC health, never accepted activity or structural progress.

Progress, final results, restored rendering, and `/delegate:list` keep status per invocation. Final results can show the final attempt's last confirmed configuration, not a still-running child. Child status never changes the parent's `fastlane:state` bus or footer. Enabled configuration does not guarantee injection, server acceptance, or speed.

## Command

```text
/fastlane
```

- `/fastlane` toggles the session on/off.
- Unsupported arguments show `Usage: /fastlane`.

There is intentionally no `/fast` command.

## Testing

Tests use local model, auth, and RPC UI fixtures. They never make provider requests.
They cover startup flags, eligibility, route/auth changes, manual overrides, payload ownership, fixed RPC status, and ordinary interactive behavior.

```sh
node agent/extensions/fastlane/test.cjs
node agent/extensions/footer/test.cjs
```
