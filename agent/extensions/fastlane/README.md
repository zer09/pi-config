# fastlane

Local Pi extension that enables Codex Fast mode and publishes active state for `footer`.

## Behavior

Fastlane is disabled by default. Run `/fastlane` to enable it for the current session.

When enabled and the current model is eligible, Fastlane injects:

```json
{
  "service_tier": "priority"
}
```

Eligibility follows the official Codex model catalog's advertised `priority` service tier:

- provider: `openai-codex`
- API: `openai-codex-responses`
- model: `gpt-5.4`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, or `gpt-5.6-terra`
- ChatGPT OAuth/subscription auth, not API-key auth
- payload does not already include `service_tier`

The catalog describes `priority` as **Fast — 1.5x speed, increased usage**. Models without that catalog tier, including `gpt-5.4-mini`, remain ineligible. The source checked for this allowlist was `openai/codex` `codex-rs/models-manager/models.json` blob `47e640365d465dc710644bf9508f1f741108ff43`.

If the current model is not eligible, `/fastlane` shows a warning and leaves Fastlane disabled.

Fastlane does not show a `fast` text indicator. It emits `fastlane:state`; `footer` uses that active/inactive state to repeat the existing thinking glyph three times, e.g. `●●●`.

## Command

```text
/fastlane
```

- `/fastlane` toggles the session on/off.
- Unsupported arguments show `Usage: /fastlane`.

There is intentionally no `/fast` command.

## Testing

```sh
node agent/extensions/fastlane/test.cjs
node agent/extensions/footer/test.cjs
```
