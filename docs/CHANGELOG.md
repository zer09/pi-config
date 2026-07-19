# Changelog

This document summarizes local Pi configuration changes. Detailed upgrade notes live under [`docs/changelogs/`](./changelogs/).

## 2026-07-19 — Pi 0.80.6 to 0.80.10 upgrade

Details: [`docs/changelogs/pi-0.80.6-to-0.80.10-upgrade.md`](./changelogs/pi-0.80.6-to-0.80.10-upgrade.md)

- Reworked native CodeGraph freshness around per-root SDK watchers, initial and 10-second query reconciliation, pending-file watcher draining, a four-root watcher LRU, and nested-repository/worktree isolation; `getChangedFiles()` is now status-only diagnostics rather than the sync gate.
- Follow-up review hardening: copy only transient runtime API-key overrides into pi-btw child runtimes, add stock/previous-patch/offline integration regression tests, and make `agent/pi-btw/` denylist-by-default.
- Added `docs/TODO.md` to recheck maintainer releases on or after 2026-08-19 before deciding whether to submit the proven local `pi-btw` and `pi-blackhole` fixes upstream.

- Revised the requested 0.80.9 target to 0.80.10 with approval because 0.80.10 fixes Kimi deferred-tool regressions and the 0.80.9 xAI catalog-removal defect.
- Upgraded the Bun-global Pi core package family to 0.80.10 and migrated active child SDK construction from removed `modelRegistry` options to `ModelRuntime` through a documented `pi-btw@0.4.1` local patch.
- Ported Blackhole's custom-provider stream scan from removed private registry state to public ModelRegistry facade methods; retained percentage compaction and retired the now-duplicate environment-auth shim.
- Upgraded CodeGraph CLI and native extension dependency from 1.4.0 to 1.4.1 without a full reindex; kept context-mode at current 1.0.169.
- Measured Pi 0.80.10's 57 registered/54 active tools. Kept the eager tool set because browser-harness dominates context cost and current deferred candidates carry active-only prompt guidance that would undermine cache stability.
- Validation included complete isolated Scenario B loading, package/local extension suites, strict type checks, disposable CodeGraph migration/full Explore, command-backed and ambient auth, wrapper checks, Blackhole threshold/bridge tests, and offline custom-provider BTW conversation/summarizer tests. No paid inference was used.

## 2026-07-10 — Upgrade native CodeGraph integration to 1.4.0

- Refreshed upstream Git tags, npm metadata, and the GitHub release before selecting CodeGraph 1.4.0; confirmed the WSL CLI was already current.
- Upgraded the native extension dependency and Linux x64 platform bundle from 1.3.1 to 1.4.0 with an exact package pin and refreshed lockfile.
- Added full-index completeness and pending-reference status reporting, query-time healing for unresolved references left by interrupted indexing, and incomplete-index warnings.
- Reworked `/codegraph-upgrade` into an execution prompt that always fetches authoritative upstream metadata, reconciles npm/tag/GitHub/CLI versions, performs compatible upgrades, and validates in WSL.
- Replaced the extension README's stale concrete upgrade version with a `<version>` placeholder and refreshed prompt-template inventory/token attribution.
- Validation: npm clean install and dependency checks passed; required public SDK exports are present; the 401-module Bun build passed; Node 24 opened the existing index and reported completeness; Pi RPC startup passed without inference; CLI update check reports 1.4.0 current.

## 2026-07-10 — Extend Fastlane to official GPT-5.6 Fast models

- Replaced the stale GPT-5.4/GPT-5.5-only Fastlane allowlist with the official Codex model catalog's complete `priority`/Fast tier set: `gpt-5.4`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra`.
- Kept `gpt-5.4-mini` and every model without an advertised Fast tier ineligible.
- Documented the catalog semantics (`Fast`, 1.5x speed, increased usage) and exact source blob.
- Validation: Fastlane tests cover all five eligible models and the unsupported-model guard; footer integration and Pi RPC startup passed without a paid inference request.

## 2026-07-10 — Pi 0.80.3 to 0.80.6 recovery upgrade

Details: [`docs/changelogs/pi-0.80.3-to-0.80.6-recovery-upgrade.md`](./changelogs/pi-0.80.3-to-0.80.6-recovery-upgrade.md)

- Reconstructed the failed 0.80.4 transition and confirmed that 0.80.4 existed only as a Git tag: all four `@earendil-works` 0.80.4 npm packages return `E404`. Version 0.80.5 was the publishable recovery build and contains no functional runtime change beyond the 0.80.4 code.
- Upgraded the Bun-global Pi core package family from installed 0.80.5 to 0.80.6 and verified `pi-coding-agent`, `pi-agent-core`, `pi-ai`, and `pi-tui` all report 0.80.6.
- Synchronized tracked settings with the live baseline: `pi-browser-harness` 0.8.3, `pi-claude-bridge` 0.6.2, `gpt-5.6-sol`, `high` thinking, and changelog state 0.80.6.
- Migrated the footer timer from low-level `agent_end` to session-level `agent_settled`; added distinct `max` thinking glyph/color support in the footer and both themes.
- Updated CodeGraph 1.2.0 → 1.3.1 and context-mode 1.0.163 → 1.0.169 with lockfiles; made context-mode prefer Pi's active `ctx.cwd` over process `PWD`.
- Hardened the theme wrapper so package/config and non-interactive commands bypass settings writes.
- Reapplied and verified both local pi-blackhole patches after package refresh, including recreation of `src/om/compaction-budget.ts`.
- Validation: footer/fastlane/web-search suites passed; context-mode 210 tests, typecheck, and fuzz passed; CodeGraph build passed; all local and configured package extensions loaded under Pi 0.80.6 RPC mode; both themes loaded; post-patch pi-blackhole RPC smoke passed.

## 2026-07-09 — Add Directus browser-operation skill

- Added `agent/skills/directus-browser`, a custom local skill for operating Directus Studio through `pi-browser-harness` when Directus MCP is unavailable.
- Documented Directus Studio routing, browser-first workflows, read-only same-origin API probes, script/API mutation gates, and Directus schema/access-control safety rules.
- Added split Directus reference files with official source inventory, authenticated schema API mutation workflow, the Directus browser skill maintenance doc, installed-skill inventory entry, and refreshed skill-catalog context-cost attribution.
- Validation: Directus skill validator passed; all local skill validators passed.

## 2026-07-08 — Align native `codegraph_node` symbol/file behavior

- Updated the native Pi CodeGraph extension so `codegraph_node` treats `symbol` + `file` as symbol mode filtered by file, matching CodeGraph MCP semantics instead of reading the whole file and ignoring `symbol`.
- Kept `file`-only calls as file-read mode and hardened invalid/blank argument handling to fail before graph readiness/sync work where practical.
- Improved strict no-match diagnostics for wrong `symbol` + `file` calls by listing matching symbols outside the requested file without returning unrelated symbol bodies as successful results.
- Validation: Bun extension build passed, cached diff whitespace check passed, Pi was reloaded, and independent smoke tests passed for file-only, symbol-only, symbol+correct-file, symbol+wrong-file, whitespace-file, empty-args, and blank-symbol cases.

## 2026-07-04 — Add structured review prompt

- Added `agent/prompts/codex-review.md`, a slash-command prompt template for code-review output using structured Markdown findings and correctness verdicts.
- Updated the prompt-template inventory in `README.md` and prompt-template token attribution in `docs/config-context-cost.md`.
- Validation: loaded prompt templates through Pi's prompt-template loader and counted prompt-template tokens with local `tiktoken` `o200k_base`.

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
