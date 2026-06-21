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

The initial backend matches `@diegopetrucci/pi-openai-fast@0.1.4`:

- provider: `openai-codex`
- API: `openai-codex-responses`
- model: `gpt-5.4` or `gpt-5.5`
- ChatGPT OAuth/subscription auth, not API-key auth
- payload does not already include `service_tier`

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
