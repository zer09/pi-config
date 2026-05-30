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

Create `config.json` next to `index.ts`:

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
  }
}
```

## Behavior notes

- Git branches stay compact but add useful state when available: `(main*)`, `(main +2)`, `(main -1)`, or `(main +2/-1*)`.
- Git status is cached and refreshed asynchronously with a short TTL, so footer rendering does not run `git status` directly or block on slow repositories.
- Narrow terminals use compact layouts before falling back to truncation: cwd basename, compact tokens, percent-only context, and shortened model names.

## Testing

```sh
node agent/extensions/gc-footer/test.cjs
```
