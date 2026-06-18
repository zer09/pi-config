# fastlane

Local Pi extension that enables Codex Fast mode and publishes state for `gc-footer`.

## Behavior

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

Fastlane does not show a `fast` text indicator. It emits `fastlane:state`; `gc-footer` uses that state to repeat the existing thinking glyph, e.g. `●●●`.

## Command

```text
/fastlane
/fastlane status
```

- `/fastlane` toggles the session override on/off.
- `/fastlane status` reports config, override, eligibility, and last injection age.

There is intentionally no `/fast` command.

## Config

Fastlane reads:

```text
agent/extensions/fastlane/config.json
```

For tests or alternate local setups, set `FASTLANE_CONFIG_PATH`.

```json
{
  "enabled": true,
  "thinkingGlyphCount": 3
}
```

Code defaults are safe (`enabled: false`) if the config file is absent or invalid.

## Testing

```sh
node agent/extensions/fastlane/test.cjs
node agent/extensions/gc-footer/test.cjs
```
