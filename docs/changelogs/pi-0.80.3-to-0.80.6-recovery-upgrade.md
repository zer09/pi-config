# Pi 0.80.3 to 0.80.6 recovery upgrade

Date: 2026-07-10

## Baselines and outcome

These three baselines are intentionally separate:

| Baseline | Version | Meaning |
|---|---:|---|
| Tracked configuration before this work | 0.80.3 | `agent/settings.json` and upgrade documentation had not been advanced after the prior failed 0.80.4 attempt. |
| Installed runtime before this work | 0.80.5 | All four installed `@earendil-works` core packages reported 0.80.5. |
| Target and installed runtime after this work | 0.80.6 | `pi-coding-agent`, `pi-agent-core`, `pi-ai`, and `pi-tui` all report 0.80.6. |

The core installation completed successfully. The configuration and local extension changes were prepared in the recovery worktree, tested against Pi 0.80.6, and then synchronized to the live config.

## Investigation sources

The compatibility review used all of the following rather than relying only on release notes:

- upstream `pi-mono` tags `v0.80.3`, `v0.80.4`, `v0.80.5`, and `v0.80.6`
- tag-to-tag Git history and source diffs
- package manifests and npm registry metadata for the coding agent and internal packages
- an isolated 0.80.6 npm installation under `/tmp/pi-0806-isolated`
- the installed 0.80.5 and 0.80.6 package source
- local extension source, tests, settings, themes, wrapper, package locks, and patch helpers
- npm metadata for every configured package and both extension-local dependencies

Tag commits checked:

| Tag | Commit |
|---|---|
| `v0.80.3` | `a23abe4a695df8b69b613f73e9fdda2a8af894d4` |
| `v0.80.4` | `912d0953f678bb50b0725e9c0ff65b65d4be97f5` |
| `v0.80.5` | `cc62baa442b5c0333923fdfdcc1d7264f445b5b0` |
| `v0.80.6` | `2b3fda9921b5590f285165287bd442a25817f17b` |

## Most likely cause of the failed 0.80.4 upgrade

The 0.80.4 release existed as a Git tag but was not published to npm. Direct registry checks returned `E404 No match found for version 0.80.4` for:

- `@earendil-works/pi-coding-agent@0.80.4`
- `@earendil-works/pi-agent-core@0.80.4`
- `@earendil-works/pi-ai@0.80.4`
- `@earendil-works/pi-tui@0.80.4`

This is the strongest and most direct explanation for the prior failure: a package-manager upgrade to 0.80.4 could not resolve a complete, aligned core package set because none of those 0.80.4 artifacts existed in the registry.

A second local risk was also found. `agent/bin/pi` wrote the detected theme to `settings.json` before every command, including package-management and non-interactive commands. That could race Pi's own settings writer or dirty the tracked file during an upgrade. The wrapper now bypasses theme persistence for management commands, metadata commands, print mode, JSON mode, and RPC mode. This was a risk amplifier, not the primary cause of the registry `E404` failure.

## What 0.80.5 actually was

The `v0.80.4..v0.80.5` range contains only three commits:

1. add the next `[Unreleased]` changelog section
2. fix an interactive-mode test fixture
3. release/version bump to 0.80.5

No functional runtime feature was introduced in that range. Version 0.80.5 was the publishable recovery release carrying the 0.80.4 code. Its npm manifests depend on the aligned `^0.80.5` internal packages, all of which were published. It should therefore be treated as the registry-delivered form of the 0.80.4 functionality, not as a separate feature migration.

## Compatibility analysis: 0.80.3 to 0.80.4/0.80.5

The substantive 0.80.4 code, delivered through npm as 0.80.5, added or changed:

- GPT-5.6 Luna, Sol, and Terra model metadata across the OpenAI and OpenAI Codex providers
- prompt-cache miss tracking and `showCacheMissNotices`
- extension lifecycle event `agent_settled`
- extension lifecycle event `before_provider_headers`
- `InlineExtension` SDK support
- extension entry renderers for persisted display-only custom entries
- `InMemorySessionStorage` and `JsonlSessionStorage` exports
- custom metadata in JSONL session headers
- project-local resource configuration through `pi config -l`
- zstd Codex SSE transport support
- retry classification for resource exhaustion and related transient failures
- fixes around OAuth polling, context overflow detection, WebSocket rotation, message ordering, and tool-call settlement

The new APIs are additive. No removed extension API used by this repository was found.

`agent_settled` is materially better than `agent_end` for user-visible completion state. It fires only after automatic retries, compactions, and queued continuations have drained. The footer prompt timer was migrated to this event so it no longer reports completion between low-level agent runs.

`before_provider_headers`, inline extensions, custom entry renderers, and the new session-storage exports do not require changes in the current local extensions because none of them implement the affected surface.

## Compatibility analysis: 0.80.5 to 0.80.6

Version 0.80.6 adds:

- `max` as a thinking level above `xhigh`
- explicit `max` support for GPT-5.6 and adaptive-thinking Claude models
- model-cost tiers selected by total input-token thresholds
- long-context GPT-5.6 Codex metadata: 372,000-token context with a pricing tier above 272,000 input tokens
- `~` expansion in `shellPath`
- fixes for stale post-compaction token budgeting
- corrected GPT-5.4, GPT-5.5, and GPT-5.6 long-context pricing
- preservation of Anthropic empty thinking blocks
- removal of the nonexistent bare `gpt-5.6` alias

The tracked/live model uses `openai-codex/gpt-5.6-sol`, not the removed bare alias, so no model rename was required.

The local footer now renders `max` as `✦` using the new `thinkingMax` theme color. Both tracked themes define that color. `xhigh` remains `●`, so the two levels are distinguishable.

Model cost tiers are consumed by Pi core. No local extension calculates model request cost, so no local pricing code migration was required. The live RPC smoke confirmed that `gpt-5.6-sol` resolves with the expected 372,000 context window and the above-272,000 pricing tier.

## Local extension impact

| Extension | Impact | Action/status |
|---|---|---|
| `footer` | Direct SDK/behavior impact from `agent_settled` and `max`. | Timer now stops on `agent_settled`; `max` uses `✦` and `thinkingMax`; regression tests added. |
| `fastlane` | Indirect display impact because it repeats the footer thinking glyph. Operationally, its existing model allowlist still only covers `gpt-5.4` and `gpt-5.5`. | Max-glyph repetition is tested. GPT-5.6 was not added to the allowlist because public API Priority Processing is not sufficient proof that ChatGPT OAuth Codex Fast mode accepts the same model/tier contract. |
| `theme-overrides` | Theme schema gained optional `thinkingMax`; core also has native terminal auto-theme synchronization. | Kept local host-OS polling behavior; added `thinkingMax` to both local themes. No API break. |
| `context-mode` | No Pi SDK break. Dependency advanced from 1.0.163 to 1.0.169. Validation exposed that process `PWD` could override the active Pi extension context. | Project resolution now prefers `ctx.cwd` over process `PWD`; 210 tests, typecheck, and fuzz pass. |
| `codegraph` | No Pi SDK break. Dependency advanced from 1.2.0 to 1.3.1. | Package and lock updated; SDK calls remained compatible; build and Pi RPC loading passed. |
| `web-search` | No affected Pi API use. | Existing 19-test suite and Pi RPC loading passed unchanged. |
| `rtk.ts` | No affected Pi API use. | Pi RPC loading passed unchanged. |

Configured package extension status:

- `@schultzp2020/pi-cursor@0.5.0`: current npm version; no affected lifecycle hook use; loaded under 0.80.6.
- `pi-blackhole@0.3.9`: current npm version; peer range accepts 0.80.6; loaded under 0.80.6; local patches preserved/reapplied as described below.
- `pi-btw@0.4.1`: current npm version; no affected lifecycle hook use; loaded under 0.80.6.
- `pi-browser-harness@0.8.3`: updated tracked pin from 0.6.0; current npm version; loaded under 0.80.6.
- `pi-claude-bridge@0.6.2`: updated tracked pin from 0.6.1; current npm version; peers accept Pi 0.80.6; loaded model catalog under 0.80.6.

## Package and local dependency refresh

| Package/dependency | Before tracked | After | Reason |
|---|---:|---:|---|
| Pi core package family | 0.80.3 tracked / 0.80.5 installed | 0.80.6 installed | Target runtime and SDK alignment. |
| `pi-browser-harness` | 0.6.0 | 0.8.3 | Bring tracked pin in sync with the already-installed current package. |
| `pi-claude-bridge` | 0.6.1 | 0.6.2 | Bring tracked pin in sync with the current compatible package. |
| `@colbymchenry/codegraph` | 1.2.0 | 1.3.1 | Current npm release; package and lock updated. |
| `context-mode` | 1.0.163 | 1.0.169 | Current npm release; package and lock updated. |

No update was available or required for `@schultzp2020/pi-cursor`, `pi-blackhole`, or `pi-btw`. `pi-web-access` remains intentionally absent; the local Gemini+Exa web-search extension is still authoritative.

## pi-blackhole patch status

Both documented local patches are present after the upgrade:

1. percentage-based auto-compaction using `compactAfterPercent: 0.65`
2. OM worker provider-auth fallback through `getApiKeyForProvider`

The upgrade/package smoke exposed one important cache behavior: the added helper file `src/om/compaction-budget.ts` was missing while the edits to existing package files remained. Both tracked reapply helpers were run. The percentage helper recreated the missing file, the existing edits were confirmed idempotently, and the auth helper confirmed both configured-model and session-model paths. A second full live-package RPC startup passed and the helper/import/auth markers remained present afterward.

Because package refreshes can remove files that are not part of the npm tarball, both helpers must still be run after every `pi update`, package reinstall, or `pi-blackhole` refresh. The tracked verification commands now pass `rg --no-ignore`; without it, the repository's ignored `agent/npm/` path can hide valid source matches and produce a false missing-patch diagnosis.

## Actual installation performed

A rollback snapshot was created first:

```text
/tmp/pi-0805-rollback-20260710-1649/
```

It contains the pre-upgrade `settings.json`, global Bun lockfile, and a tar archive of the complete pre-upgrade `@earendil-works` package directory.

The core upgrade command was:

```bash
bun add --global @earendil-works/pi-coding-agent@0.80.6
```

Bun installed the coding agent and aligned `pi-agent-core`, `pi-ai`, and `pi-tui` to 0.80.6. The settings checksum was unchanged by the core install.

## Validation performed

- confirmed all four installed core manifests report 0.80.6
- confirmed direct Pi and the local wrapper report 0.80.6
- confirmed wrapper management/non-interactive bypass leaves settings checksum and mtime unchanged
- footer tests passed
- fastlane tests passed
- context-mode: 210 tests passed, TypeScript check passed, fuzz passed
- web-search: 19 tests passed
- CodeGraph: 401-module Bun build passed with Pi peer imports externalized
- all seven local extensions loaded together in a Pi 0.80.6 RPC session
- all configured package extensions loaded together in a live Pi 0.80.6 RPC session
- dark and light themes both loaded in Pi 0.80.6 RPC mode
- `gpt-5.6-sol` resolved with `max`, tiered pricing, and a 372,000-token context window
- Claude Bridge model catalog loaded offline
- both pi-blackhole patch helpers passed and a post-reapply live RPC smoke passed
- package-lock roots resolve CodeGraph 1.3.1 and context-mode 1.0.169
- JSON/settings/theme parsing, shell syntax, repository diff checks, and secret-path checks passed

No paid model generation was used for the smoke tests; RPC `get_state` exercised startup and resource loading without an inference request.

## Remaining operator steps

1. Close or restart this pre-upgrade Pi process. Its code was loaded before the global package replacement.
2. Start a fresh terminal session and run `pi --version`; expect `0.80.6`.
3. Start Pi normally and visually confirm the footer and dark/light theme behavior.
4. Optionally select a model that exposes `max` and confirm the footer shows `✦`.
5. If `/fastlane` is needed on GPT-5.6, verify the ChatGPT Codex backend contract before extending the allowlist; current behavior intentionally remains restricted to GPT-5.4/5.5.
6. Review the unstaged repository diff, then commit and push only if desired.

## Rollback

Preferred package-manager rollback:

```bash
bun add --global @earendil-works/pi-coding-agent@0.80.5
node ~/.pi/agent/pi-blackhole/reapply-compact-after-percent-patch.mjs
node ~/.pi/agent/pi-blackhole/reapply-om-auth-fallback-patch.mjs
pi --version
```

To restore the full tracked config while these changes are still unstaged, first verify that the diff contains only this upgrade, then restore the tracked files and the pre-upgrade live settings:

```bash
cd ~/.pi
git diff --name-only
git restore -- README.md agent/bin/pi agent/extensions/codegraph \
  agent/extensions/context-mode agent/extensions/footer \
  agent/pi-blackhole/LOCAL_PATCHES.md agent/settings.json \
  agent/themes/dark.json agent/themes/light.json \
  docs/CHANGELOG.md docs/config-context-cost.md
rm -f docs/changelogs/pi-0.80.3-to-0.80.6-recovery-upgrade.md
cp /tmp/pi-0805-rollback-20260710-1649/settings.json ~/.pi/agent/settings.json
npm ci --prefix agent/extensions/codegraph
npm ci --prefix agent/extensions/context-mode
```

Do not run the `git restore` block after mixing unrelated edits into these paths; revert the eventual upgrade commit instead.

If registry rollback is unavailable, restore the captured package archive and lockfile only after closing every Pi process:

```bash
rm -rf ~/.bun/install/global/node_modules/@earendil-works
mkdir -p ~/.bun/install/global/node_modules

tar -C ~/.bun/install/global/node_modules \
  -xzf /tmp/pi-0805-rollback-20260710-1649/earendil-works-0.80.5.tar.gz
cp /tmp/pi-0805-rollback-20260710-1649/bun.lock ~/.bun/install/global/bun.lock
```

The archive fallback is an emergency path. Prefer the package-manager rollback because it keeps Bun's global dependency graph coherent.
