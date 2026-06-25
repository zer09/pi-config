# Pi 0.79.9 to 0.80.2 upgrade investigation

Date: 2026-06-25

## Executive verdict

The upgrade from Pi `0.79.9` to `0.80.2` is viable and has now been applied locally.

Confirmed post-upgrade state:

- Pi CLI: `0.80.2`
- Repository head: `203285989523ac710679e38f0c7c14ec258901b5` (`Add resume light theme`)
- `pi-blackhole`: `0.3.9`
- `pi-web-access`: `0.13.0`
- Other configured packages remained current:
  - `@schultzp2020/pi-cursor@0.5.0`
  - `pi-btw@0.4.1`
  - `pi-browser-harness@0.6.0`
  - `pi-claude-bridge@0.5.0`

The important ordering risk was that `pi update --all` updates extensions before the Pi CLI. That is unsafe for this transition because new `pi-web-access` releases use the Pi 0.80-compatible `@earendil-works/pi-ai/compat` import path. The upgrade was therefore handled as:

```bash
pi update --self
pi update --extensions
```

## Pi core changes

### 0.79.10

- Added `reason` and `willRetry` fields to `session_before_compact` and `session_compact` events.
- Compaction reasons are `manual`, `threshold`, and `overflow`.
- `willRetry` identifies overflow-recovery compactions that retry the aborted turn.
- Improved update workflow: Pi self-update installs the exact checked version and shows the changelog URL.
- Fixed nested git repository handling in `find`.
- Improved reload/session replacement behavior for extensions.

Repository impact:

- Existing `pi-blackhole` config remains compatible.
- Current blackhole config already uses modern automatic compaction settings.
- No local extension change required.

### 0.80.0

- Moved the old `@earendil-works/pi-ai` global API to `@earendil-works/pi-ai/compat`.
- Extension runtime aliases both old and new package names to compat entrypoints for extension code.
- Removed selective provider entrypoints such as `@earendil-works/pi-ai/base` and `@earendil-works/pi-agent-core/base`.
- Added `Ctrl+J` newline keybinding.
- Fixed provider/model behavior around OpenAI Responses, OpenAI Codex reconnects, Cloudflare routing, custom provider auth, OpenCode Go GLM-5.2 reasoning, and package themes under `--resume`.

Repository impact:

- Local extensions do not import removed `base` entrypoints.
- `pi-web-access@0.13.0` depends on the Pi 0.80-compatible import surface, which is why Pi had to be updated before extensions.
- Existing `opencode-go/glm-5.2` model override remains safe.

Caveat:

- npm does not currently expose `@earendil-works/pi-coding-agent@0.80.0`; available 0.80 npm releases are `0.80.1` and `0.80.2`.

### 0.80.1

- Fixed Amazon Bedrock scoped `AWS_PROFILE` endpoint resolution.
- Fixed Fireworks Anthropic-compatible session affinity/tool-field defaults.
- Fixed Together MiniMax M2.7 metadata reasoning toggle.

Repository impact:

- No direct config change required unless these providers are used.

### 0.80.2

- Changed `ApiKeyCredential` discriminator to auth-file-compatible `type: "api_key"`.
- Provider-scoped `env` values now participate in auth resolution.
- Request-scoped `apiKey` and `env` overrides now affect provider auth, important for Cloudflare/Gemini gateway use.
- Renamed public shell execution options type from `ExecutionEnvExecOptions` to `ShellExecOptions`.
- Restored temporary legacy compat stream aliases.
- Restored OpenAI completions compat fallback for models without explicit compat metadata.

Repository impact:

- Local extensions do not use `ExecutionEnvExecOptions`.
- Existing `pi.exec(...)` usage remains compatible.
- If auth files are edited manually, use `type: "api_key"` going forward.

## Package changes

### `pi-blackhole` 0.3.8 to 0.3.9

`pi-blackhole@0.3.9` is a targeted runtime fix:

- Adds an `autoCompactionController` to runtime state.
- Adds an `agent_start` handler that aborts pending auto-compaction waits when a new turn begins.
- Replaces the fragile one-shot idle check after `agent_end` with a short polling loop that waits until Pi is idle before starting auto-compaction.

Impact:

- Automatic blackhole-driven compaction should be more reliable after busy turns.
- Existing config remains valid.
- Future improvement: blackhole could explicitly branch on Pi's new `reason` and `willRetry` compaction metadata, especially for overflow recovery.

### `pi-web-access` 0.10.7 to 0.13.0

Major additions:

- New providers: OpenAI, Brave, Parallel, Tavily.
- Existing providers retained: Exa, Perplexity, Gemini API, Gemini Web.
- `workflow: "auto-summary"` mode.
- `webSearch.enabled` config switch.
- Cloudflare/Gemini gateway support through env/config.
- Config lookup now prefers `PI_CODING_AGENT_DIR`, then `$XDG_CONFIG_HOME/pi`, then `~/.pi`.
- SSRF protection with optional `ssrf.allowRanges` CIDR exemptions.

Removed:

- `code_search` tool was removed. Use `web_search`, `fetch_content`, or the `librarian` skill instead.

Security and behavior fixes:

- Updated `@mozilla/readability` to `^0.6.0` for advisory `GHSA-3p6v-hrg8-8qj7`.
- Added URL/redirect validation against localhost/private/reserved IP targets.
- Hardened curator markdown rendering.
- Hardened GitHub clone extraction against path and symlink escape.
- Browser-open failures no longer kill curator sessions.
- Summary model selection now respects Pi `enabledModels` and falls back deterministically when no enabled summary model is available.

Repository impact:

- `web-search.json` now uses env-provided API keys rather than storing provider secrets in the file.
- Default provider is set to `exa`.
- Default workflow is set to `none` so the active Pi conversation model handles the returned search result instead of `pi-web-access` invoking a separate summary model.
- `summaryModel` is intentionally omitted.

Provider caveat:

- `pi-web-access` supports multiple providers and provider fallback, but the config schema has a single `provider` field, not an explicit ordered provider list.
- With `provider: "exa"`, Exa is used when available.
- Gemini remains available through `GEMINI_API_KEY` and is part of the package fallback chain, but exact `Exa -> Gemini only` fallback ordering is not configurable in `0.13.0`.
- The package also supports multiple search queries per call and parallel URL fetches, but not multi-provider fan-out from one config setting.

## Local config changes from this upgrade

### `web-search.json`

The config now intentionally stores behavior only, not API keys:

```json
{
  "provider": "exa",
  "workflow": "none",
  "chromeProfile": "Pi-Agent"
}
```

Rationale:

- `EXA_API_KEY` and `GEMINI_API_KEY` are expected from the environment.
- Exa is the default provider.
- Gemini remains available as a fallback provider when the package resolves it as available.
- `workflow: "none"` disables extension-side summary generation, avoiding a separate `summaryModel` call.

### npm extension cache

The stale, unconfigured package cache entry `@diegopetrucci/pi-openai-fast@0.1.4` was removed from `agent/npm`.

It was not present in `agent/settings.json`, so it was not a configured Pi package.

## What can remain unchanged

- `agent/settings.json`
- `agent/models.json`
- `agent/pi-blackhole/pi-blackhole-config.json`
- local extensions:
  - CodeGraph
  - context-mode
  - Fastlane
  - footer
  - theme-overrides
  - RTK
- prompt templates
- skills
- theme selection
- package list in settings

## Follow-ups

- If exact ordered provider fallback becomes important, add a local wrapper or request upstream support for a provider priority list, for example `["exa", "gemini"]`.
- Watch for a future `pi-blackhole` release that explicitly handles Pi's `reason` and `willRetry` compaction metadata.
- Do not reintroduce API keys into tracked config files; keep provider credentials in environment variables or private auth/config state.
