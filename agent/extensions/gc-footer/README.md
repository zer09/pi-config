# gc-footer

Custom Pi footer extension for a compact local status line.

## Requirements

- Pi coding agent with extension support.
- Node.js runtime used by Pi.
- A Nerd Font configured in your terminal is recommended for the default timer, queue, MCP, and thinking status glyphs.
  - Timer glyphs use `\uf017` while running and `\uf00c` after completion, with `4.1s` under a minute and `m:ss` after.
  - Queued follow-ups use `\uf46c 1` in Nerd Font mode and `q 1` with `"nerdFont": false`.
  - Thinking glyphs use `\uf10c` for thinking off and `\uf111` for thinking on.
  - If your terminal does not use a Nerd Font, set `"nerdFont": false` in `config.json` to use text timer labels, text queue labels, and Unicode circle thinking fallbacks.
- No extra npm packages are required. The extension uses Pi-provided packages and Node built-ins.

## Optional config

By default, gc-footer reads config from:

```text
agent/extensions/gc-footer/config.json
```

You can point the extension at another file with `GC_FOOTER_CONFIG_PATH`. Restart or reload Pi after changing config; the file is read when the extension loads.

### Compact model only

Use this when you want the footer to stay in its normal full layout, but want the model item to render in compact form:

```json
{
  "segmentProfiles": {
    "model": "compact"
  }
}
```

Example output change:

```text
openai-codex/gpt-5.5 -> codex/gpt-5.5
opencode-go/deepseek-v4-flash -> deepseek-v4-flash
minimax/MiniMax-M2.7 -> MiniMax-M2.7
```

### Full config shape

All keys are optional. Missing keys keep the defaults. Unknown keys or invalid values are ignored.

```json
{
  "nerdFont": true,
  "segments": {
    "cwd": true,
    "branch": true,
    "statuses": true,
    "timer": true,
    "queue": true,
    "tokens": true,
    "context": true,
    "model": true,
    "thinking": true
  },
  "segmentProfiles": {
    "model": "compact"
  }
}
```

### Config keys

- `nerdFont`: `true` uses Nerd Font glyphs. `false` uses text or Unicode fallbacks.
- `segments`: enables or disables footer segments. For example, set `"model": false` to hide the model entirely.
- `segmentProfiles`: overrides the display profile for individual profile-aware segments without changing the main footer profile.

`segmentProfiles` values:

- `inherit`: use the main footer profile. This is also the default when a segment has no override.
- `full`: use the full segment rendering.
- `compact`: use the compact segment rendering.
- `minimal`: use the minimal segment rendering when the segment supports it.

Profile-aware segments:

- `cwd`: full path vs basename.
- `statuses`: full statuses vs active compact statuses.
- `tokens`: full cache-aware totals vs compact totals.
- `context`: percent plus token/window details vs percent only.
- `model`: full provider/model vs compact provider-aware model.

`branch`, `timer`, `queue`, and `thinking` currently do not have profile-specific variants.

Use `/gc-footer` or `/gc-footer status` to inspect the active config. Active overrides are shown as `segmentProfiles: model=compact`.

## Behavior notes

- Git branches stay compact but add useful state when available: `(main*)`, `(main +2)`, `(main -1)`, or `(main +2/-1*)`.
- Git status is cached and refreshed asynchronously with a short TTL, so footer rendering does not run `git status` directly or block on slow repositories.
- Narrow terminals use compact layouts before falling back to truncation: cwd basename, compact tokens, percent-only context, and shortened model names.

## Testing

```sh
node agent/extensions/gc-footer/test.cjs
```
