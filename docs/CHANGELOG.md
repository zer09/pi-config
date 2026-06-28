# Changelog

This document summarizes local Pi configuration changes. Detailed upgrade notes live under [`docs/changelogs/`](./changelogs/).

## 2026-06-28 — Native Gemini+Exa web search cutover

- Added local `agent/extensions/web-search` Pi extension.
- Registered public tools: `web_search`, `fetch_grounding`, and `fetch_contents`.
- `web_search` now uses native Gemini + Exa grounding first, with internal direct Exa fallbacks for web/code searches.
- Added disk-backed raw response and content caches under `~/.pi/web_search_cache` with TTL, atomic writes, secret redaction, and cache-size safeguards.
- Removed `npm:pi-web-access@0.13.0` from configured packages; existing installed files remain on disk and can be re-enabled later if needed.
- Validation: `bun test` passed for the extension and import smoke confirmed `web_search,fetch_grounding,fetch_contents`.
- Added compact/expanded TUI renderers for the web search tools.
- Increased tool-call summary truncation to 480 characters for web-search, CodeGraph, and context-mode renderers.

## 2026-06-25 — Pi 0.79.9 to 0.80.2

Details: [`docs/changelogs/pi-0.79.9-to-0.80.2-upgrade.md`](./changelogs/pi-0.79.9-to-0.80.2-upgrade.md)

- Upgraded local Pi from `0.79.9` to `0.80.2`.
- Updated configured packages:
  - `pi-blackhole` to `0.3.9`
  - `pi-web-access` to `0.13.0`
- Kept other configured packages unchanged because they were already current.
- Changed `web-search.json` to prefer Exa, use env-provided API keys, and disable extension-side summary generation with `workflow: "none"`.
- Removed stale unconfigured npm cache package `@diegopetrucci/pi-openai-fast@0.1.4`.
- No required local extension, model, theme, prompt-template, or skill migration was identified.

Important caveats:

- `pi update --all` was intentionally avoided for this transition because it updates extensions before the Pi CLI.
- `pi-web-access@0.13.0` has a single default `provider` config field; exact ordered fallback such as `Exa -> Gemini only` is not configurable.
- `code_search` was removed by `pi-web-access`; use `web_search`, `fetch_content`, or the `librarian` skill instead.
