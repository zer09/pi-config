# Pi 0.80.2 to 0.80.3 upgrade investigation

Date: 2026-07-02

## Executive verdict

The upgrade from Pi `0.80.2` to `0.80.3` is viable and has now been applied locally.

Confirmed post-upgrade state:

- Pi CLI: `0.80.3`
- Repository head: `a949574974a6a606b4cb41a60f4147bb7ede09bc` (`Update agent communication preferences`)
- Configured packages:
  - `@schultzp2020/pi-cursor@0.5.0`
  - `pi-blackhole@0.3.9`
  - `pi-btw@0.4.1`
  - `pi-browser-harness@0.6.0`
  - `pi-claude-bridge@0.6.1`
- `pi-web-access` remains intentionally unconfigured. It is absent from `~/.pi/agent/npm/node_modules`; a stale Bun global install at `~/.bun/install/global/node_modules/pi-web-access@0.10.7` is not loaded by `pi list`.

## Main compatibility question: `session_info_changed`

Pi `0.80.3` adds extension-visible session-name metadata updates through the `session_info_changed` event. Source inspection shows the event is emitted when `AgentSession.setSessionName()` appends a sanitized `session_info` entry, and `SessionManager.getSessionName()` resolves the latest such entry by walking session entries backward.

Impact on this config: **no local extension change is required**.

Reasons:

- No local extension currently registers `pi.on("session_info_changed", ...)` or otherwise depends on session names.
- `codegraph` and `context-mode` only use session lifecycle cleanup (`session_shutdown`) and dynamic tool registration.
- `theme-overrides` uses `session_start` / `session_shutdown` for timers and runtime theme application.
- `fastlane` uses `session_start`, `model_select`, and `before_provider_request`; it keys runtime state by `ctx.sessionManager`, not by session name.
- `footer` uses `session_start`, footer data callbacks, prompt/tool lifecycle handlers, and the internal Fastlane event. It does not display or cache the session name.
- `rtk` only observes `tool_call` events.
- `web-search` registers tools only and has no session metadata state.

The new event is additive for this repo. It can be used later if the footer should display live session names, but there is no migration requirement.

## Pi core changes reviewed

### Session metadata and session entry access

- Added `session_info_changed` for extension observers of session-name changes.
- Persisted session names continue to use `session_info` entries.
- RPC mode gained `get_entries` and `get_tree`, both including the current `leafId`.

Repository impact: no config or extension changes required.

### Provider/model changes

- Added inherited Claude Sonnet 5 metadata, including adaptive-thinking behavior across Anthropic-compatible provider surfaces.
- Added modern Azure Foundry endpoint handling to Azure OpenAI setup.
- Added inherited provider `Usage.reasoning` token counts.
- Fixed multiple provider streaming/retry/reasoning regressions.

Repository impact: no immediate settings change required. The active default model remains `openai-codex/gpt-5.5`.

### TUI/settings changes

- Added `outputPad` for horizontal output spacing.
- Added `externalEditor` for the Ctrl+G external-editor command.
- Fixed transcript rendering for escaped backslashes.

Repository impact: no immediate settings change required. The repo does not currently need a non-default editor or output padding override.

### Extension runtime fixes

- Fixed extension tool changes so they apply before the next provider request in the same agent run without dropping `before_agent_start` system-prompt overrides.
- The active-turn refresh path now preserves extension-provided system prompt overrides during tool-list rebuilds.

Repository impact: beneficial only; no local extension currently needs a migration for this fix.

## Package changes reviewed

### `pi-claude-bridge` 0.5.0 to 0.6.1

Applied and pinned in `agent/settings.json`.

Relevant upstream changes:

- Adds `claude-sonnet-5` and `claude-fable-5` model support.
- Adds explicit `plan` and `longContextExtraUsage` provider config for 1M-context behavior.
- Tracks served context-window values from Claude SDK `modelUsage` responses and logs them separately from registered windows.
- Rebuilds shared session/provider state across compaction and tree-navigation events instead of relying on stale resume state.
- Documents that Pi `models.json` overrides do not currently apply to extension-registered providers.

Repository impact:

- Existing `enabledModels` entry `claude-bridge/claude-opus-4-6` remains valid.
- `agent/claude-bridge.json` is now tracked with `askClaude.enabled: false`; the configured provider still loads through the package while the delegate tool stays disabled.
- No local code patches were present for `pi-claude-bridge`, so no patch port was required.

### `pi-blackhole` 0.3.9

No newer npm/GitHub release was found, so the configured pin remains `0.3.9`.

Local patch status after the package install:

- `compactAfterPercent` patch is still present in `src/core/unified-config.ts`, `src/om/compaction-budget.ts`, `src/om/compaction-trigger.ts`, and `src/commands/memory.ts`.
- OM worker provider-env auth fallback is still present in `src/om/runtime.ts`.

No reapply was needed.

### Other configured packages

No newer safe npm versions were found for:

- `@schultzp2020/pi-cursor@0.5.0`
- `pi-btw@0.4.1`
- `pi-browser-harness@0.6.0`

Pins remain unchanged.

### `pi-web-access`

`pi-web-access@0.13.0` remains removed from `agent/settings.json`.

Rationale:

- The active local `agent/extensions/web-search` extension now owns the intended public tools: `web_search` and `fetch_contents`.
- `pi-web-access` upstream has useful provider and SSRF updates, but reintroducing it would duplicate or rename the active web-search surface (`fetch_content` vs local `fetch_contents`) and add curator behavior that this config intentionally removed.
- `pi list` confirms `pi-web-access` is not a loaded user package.
- The stale Bun global package cache is not loaded by Pi and was left untouched to avoid deleting unrelated local state.

## Local config changes from this upgrade

### `agent/settings.json`

- Updated `lastChangelogVersion` from `0.80.2` to `0.80.3`.
- Updated configured package pin from `npm:pi-claude-bridge@0.5.0` to `npm:pi-claude-bridge@0.6.1`.

### `agent/claude-bridge.json`

- Added tracked Claude Bridge config with `askClaude.enabled: false` so the package provider remains available without registering the AskClaude delegate tool.

### `README.md`

- Updated the current settings snapshot to list `npm:pi-claude-bridge@0.6.1`.
- Documented `agent/claude-bridge.json` in the repository contents table.

### Installed runtime

- Ran `pi update --self --approve`, which updated the Bun global Pi install from `0.80.2` to `0.80.3`.
- Ran `pi install npm:pi-claude-bridge@0.6.1 --approve`, which installed the updated package and rewrote the configured package pin.

## Validation

Performed during the upgrade:

- `git fetch --prune origin master` confirmed local `master` and `origin/master` were both at `a949574974a6a606b4cb41a60f4147bb7ede09bc` before changes.
- `pi --version` returned `0.80.3` after the self-update.
- `pi list` showed the expected configured package set with `pi-claude-bridge@0.6.1`.
- Package manifest checks confirmed installed versions for all configured npm packages.
- Local `pi-blackhole` patch markers were verified after the extension package install.
- `bun test` passed for `agent/extensions/web-search` (18 tests).
- `npm run check` passed for `agent/extensions/context-mode`.
- `npm test` passed for `agent/extensions/context-mode` (141 tests).
- Bun import smoke passed for local extension entrypoints: `web-search`, `codegraph`, `context-mode`, `fastlane`, `footer`, `theme-overrides`, and `rtk`.
- `PI_OFFLINE=1 pi --list-models claude-bridge --approve --no-context-files --no-prompt-templates` loaded the installed extension package through Pi's loader and listed the expected `claude-bridge` models, including `claude-sonnet-5` and `claude-fable-5`.

Follow-up validation still recommended after restarting Pi:

- Start a fresh Pi session and confirm the extension list/tool list loads without startup errors.
- If using Claude Bridge interactively, select one bridge model once to confirm the updated provider catalog loads as expected.
