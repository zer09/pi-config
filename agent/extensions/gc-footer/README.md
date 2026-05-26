# gc-footer

Custom Pi footer extension for a compact local status line.

## Requirements

- Pi coding agent with extension support.
- Node.js runtime used by Pi.
- A Nerd Font configured in your terminal is recommended for the default thinking status glyphs.
  - Default glyphs use `\uf10c` for thinking off and `\uf111` for thinking on.
  - If your terminal does not use a Nerd Font, set `"nerdFont": false` in `config.json` to use Unicode circle fallbacks.
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
    "tokens": true,
    "context": true,
    "model": true,
    "thinking": true
  }
}
```

## Testing

```sh
node agent/extensions/gc-footer/test.cjs
```
