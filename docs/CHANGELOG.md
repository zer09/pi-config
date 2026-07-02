# Changelog

This document summarizes local Pi configuration changes. Detailed upgrade notes live under [`docs/changelogs/`](./changelogs/).

## 2026-07-02 — Pi 0.80.2 to 0.80.3

Details: [`docs/changelogs/pi-0.80.2-to-0.80.3-upgrade.md`](./changelogs/pi-0.80.2-to-0.80.3-upgrade.md)

- Upgraded local Pi from `0.80.2` to `0.80.3`.
- Updated configured package `pi-claude-bridge` from `0.5.0` to `0.6.1`.
- Added tracked `agent/claude-bridge.json` with `askClaude.enabled: false`, keeping Claude Bridge provider models available while disabling the delegate tool.
- Kept `@schultzp2020/pi-cursor`, `pi-blackhole`, `pi-btw`, and `pi-browser-harness` pins unchanged because no newer safe npm version was found.
- Verified Pi `0.80.3`'s `session_info_changed` event is additive for this config; no local extension currently consumes or depends on session-name metadata.
- Kept `pi-web-access` removed from configured packages; the local `agent/extensions/web-search` remains the active web-search implementation.
- Verified local `pi-blackhole` patches remained present after package installation.
- Validation: `web-search` Bun tests passed, `context-mode` typecheck/tests passed, local extension import smoke passed, and Pi's loader listed the updated `claude-bridge` model catalog offline.

## 2026-07-01 — Document config context cost

- Added `docs/config-context-cost.md` with a provider-calibrated and local `tiktoken` `o200k_base` breakdown of startup/first-request context cost across Pi system prompt sections, `AGENTS.md`, skill catalog entries, active tool schemas, prompt templates, extension commands, and on-demand full skill loads.
- Corrected the methodology to include `session_start` dynamic tool registration and `before_agent_start` prompt injection; this captures `pi-browser-harness` browser tools that a pre-`session_start` SDK snapshot misses.
- Added reproducible provider-calibration commands so the `hi` usage baseline can be regenerated on another machine without relying on a machine-local session file.
- Added a README pointer to the context-cost snapshot and update triggers.
- Validation: compared local runtime attribution against real `openai-codex/gpt-5.5` `hi` calibration runs and provider-reported usage stored in the session JSONL.

## 2026-07-01 — Retire Context7 CLI skill

- Removed `agent/skills/context7-cli` from active Local Skills.
- Reclassified `context7-cli` as retired in the skill inventory and converted its maintenance doc to reinstall notes.
- Updated the skill maintenance README and ADR 0001 to record the retirement decision.
- Validation: local skill validators passed for all remaining `agent/skills/*/SKILL.md`.

## 2026-06-30 — CodeGraph extension 1.1.6 upgrade

- Upgraded `agent/extensions/codegraph` to `@colbymchenry/codegraph@1.1.6` with an exact package pin.
- Updated GraphManager to reopen cached graph handles when the on-disk database is replaced.
- Aligned confirmed full reindex handling with CodeGraph 1.1.x by recreating the database before indexing.
- Improved `codegraph_status` diagnostics for explicit missing `projectPath` values and symlinked file paths.
- Validation: SDK export smoke test, strict TypeScript check, and Bun import smoke test passed for the extension.

## 2026-06-30 — Web search grounded output simplification

- Updated `agent/extensions/web-search` so successful `web_search` results enter context as final Markdown with inline citation markers and a trailing `### Sources:` section.
- Sunset `fetch_grounding`; registered web-search extension tools are now `web_search` and `fetch_contents`.
- Added a focused Gemini+Exa Markdown renderer that joins multipart Gemini responses, inserts citations from grounding support offsets, normalizes bullets/source-title spacing, and keeps `### Sources:` present even when no sources are returned.
- Added local Gemini+Exa response fixtures under the extension test tree, replacing deleted absolute-path benchmark fixtures.
- Added citation edge-case coverage for duplicate same-position supports and `endIndex: 0` insertion.
- Validation: `bun test` passed for the extension with 18 tests.

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
