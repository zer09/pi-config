# footer

Custom Pi footer extension for a compact local status line.

## Requirements

- Pi coding agent with extension support.
- Node.js runtime used by Pi.
- A Nerd Font configured in your terminal. Timer, queue, MCP status, agentmemory status, and experimental-feature indicators use Nerd Font glyphs.
  - Timer glyphs use `\uf017` while running and `\uf00c` after completion, with `4.1s` under a minute and `m:ss` after.
  - Queued follow-ups use `\uf46c 1`.
  - Experimental Pi features use a red `\uf00d` marker when `PI_EXPERIMENTAL=1`.
  - Thinking uses Unicode-only shapes for every level: `○` off, `·` minimal, `◦` low, `◇` medium, `◆` high, and `●` xhigh.
  - When the local `fastlane` extension reports active state, the thinking glyph is repeated according to Fastlane config, for example `●●●`. No `fast` text indicator is shown.
- No extra npm packages are required. The extension uses Pi-provided packages and Node built-ins.

## Behavior

The footer is intentionally code-configured instead of file-configured. To change what it shows, edit the extension code.

Enabled segments are fixed in code:

- git branch plus async dirty/ahead/behind state
- cwd
- extension statuses
- prompt timer
- queued follow-up count
- token totals and latest cache-hit rate
- context-window usage
- model name
- thinking glyph
- experimental marker when `PI_EXPERIMENTAL=1`

Narrow terminals use compact layouts before falling back to truncation: cwd basename, compact tokens, percent-only context, and shortened model names. Minimal layout hides model, token totals, and thinking glyph when needed.

## Fastlane glyph integration

`footer` listens for `fastlane:state` events from the local `agent/extensions/fastlane` extension.

When Fastlane is active, the footer keeps the normal thinking segment but repeats the active thinking glyph by Fastlane's configured `thinkingGlyphCount`:

```text
●   -> ●●●
◆   -> ◆◆◆
```

The footer intentionally does not render the word `fast`; repeated thinking glyphs are the indicator.

## Extension-status formatters

The middle footer segment is backed by formatter plugins in `extension-status/`.
Formatter files in that directory are loaded in filename order when the extension loads. Each file should export a formatter object as either a named `formatter` export or a default export.

Built-in formatters:

- `extension-status/agentmemory.ts` handles `🧠 agentmemory` statuses.
- `extension-status/browser.ts` handles pi-browser-harness `⚪`/`🔴`/`🟢` browser statuses.
- `extension-status/mcp.ts` handles `MCP: n/m servers` statuses.

After adding or editing formatter files, run `/reload` in Pi.

## Behavior notes

- Git branches stay compact but add useful state when available: `(main*)`, `(main +2)`, `(main -1)`, or `(main +2/-1*)`.
- Git status is cached and refreshed asynchronously with a short TTL, so footer rendering does not run `git status` directly or block on slow repositories.
- When Pi experimental features are enabled with `PI_EXPERIMENTAL=1`, footer shows a red Nerd Font `\uf00d` marker at the end of the footer.

## Testing

```sh
node agent/extensions/footer/test.cjs
```
