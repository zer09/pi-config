# Pi 0.82.1 to 0.84.1 upgrade

Date: 2026-08-09

## Result

This upgrade updates the tracked configuration and active Pi installation to 0.84.1. Preparation occurred in the isolated worktree at `/tmp/pi-config-0841-review`; the approved changes were applied to `/home/gc/.pi` on 2026-08-09 and remain unstaged.

Selected package result:

| Surface | Before | Selected | Result |
|---|---:|---:|---|
| Pi core family | 0.82.1 | 0.84.1 | Applied and validated live |
| `pi-blackhole` | 0.4.2 | 0.4.5 | Applied with two local patches |
| `pi-btw` | 0.4.1 | 0.4.1 | Kept with refreshed local patch |
| `pi-browser-harness` | 0.10.2 | 0.10.2 | Keep until a fixed release exists |
| `@schultzp2020/pi-cursor` | 0.5.0 | 0.5.0 | Current and compatible |
| `pi-claude-bridge` | 0.6.3 | 0.6.3 | Current and compatible |
| `@colbymchenry/codegraph` | 1.5.0 | 1.5.0 | Current and compatible |
| `context-mode` | 1.0.169 | 1.0.169 | Current and compatible |

No paid inference was intentionally used. One early Browser Harness RPC check ran before its 0.11.0 settings pin was aligned, so `/browser-setup` fell through as a normal prompt. The isolated agent directory had no copied auth file, but `--no-session` left no usage record. Treat that check as possible unintended provider activity.

## Exact source state

Repository remote:

```text
https://github.com/zer09/pi-config
```

Fetched and analyzed repository commit:

```text
f50b4a8b64dbf47fb458cdf773ac15efed108930
2026-08-07T15:25:56+08:00 docs: refine Language and wording rules
```

`origin/master` and local `master` both pointed to this commit after the fetch.

Previous upgrade commit:

```text
1acf84c866dc233a6f90e4875f77bc58deff2dbf
```

The range from the previous upgrade through the analyzed head contains ten later commits, 31 changed files, 1,930 insertions, and 53 deletions. This upgrade preserves that later work, including web search, Blackhole configuration, delegated role isolation, global instructions, ADR 0007, and context-cost documentation.

Upstream Pi tag commits:

| Tag | Commit |
|---|---|
| `v0.82.1` | `b4f293684bba718d59cc1157679bcf6157b3a7f5` |
| `v0.83.0` | `845d6ff1f6643aba440341cce877ce1c43ebbc39` |
| `v0.84.0` | `a5f43bf8aff3c55752432655f7334e3dafd1e256` |
| `v0.84.1` | `53fa77ccd8a279eb87e92294ef3687b03ff80112` |

Registry and upstream release checks found Pi 0.84.1 to be the latest release. Gate A therefore selected the requested target without user intervention.

## Safety and rollback assets

The active checkout contained two tracked user preferences: `theme: dark` and an OpenAI Codex reflector with a 272K context window. The prepared worktree includes both preferences. Six untracked `findings/` and Browser Harness files remain untouched. The upgrade did not alter the active checkout, stage files, commit, push, or change the live Pi installation.

The isolated worktree is:

```text
/tmp/pi-config-0841-review
```

The complete pre-upgrade rollback snapshot is:

```text
/tmp/pi-0821-rollback-20260808-160920
```

`SHA256SUMS` covers 23 configuration, manifest, lock, and package archive files. The snapshot includes the Pi 0.82.1 core family and patched Blackhole 0.4.2 and pi-btw 0.4.1 package trees.

One investigation command accidentally initialized CodeGraph in the temporary review worktree. The index was removed immediately. No active project root or user index was changed.

## Release span

### Pi 0.83.0

Pi 0.83.0 upgrades the bundled TypeBox API to 1.3.7. It removes `Type.Base`, `Type.Awaited`, `Type.Promise`, `Type.AsyncIterator`, `Type.Iterator`, `Type.Options`, and `Value.Mutate`.

Other relevant additions include `ctx.scopedModels`, per-request provider `fetch`, the `pending` stream stop reason, raw provider stop reasons, and credential export commands.

The local source scan found no use of the removed TypeBox aliases. CodeGraph, context-mode, web-search, Blackhole 0.4.5, pi-btw, browser harness, Cursor, and Claude Bridge load without this migration.

### Pi 0.84.0

Pi 0.84.0 contains the high-risk SDK changes:

- `ModelsStreamTransforms` becomes `ModelsRequestTransforms`.
- RPC and JSON `message_update` events contain only `assistantMessageEvent` deltas.
- `message_update.message` and `assistantMessageEvent.partial` are removed.
- `message_end` remains the authoritative assistant message.
- `ModelRegistry.getApiKeyAndHeaders()` returns nullable `ProviderHeaders` values.
- `ModelRegistry.refresh()` accepts `ModelsRefreshOptions` and returns `ModelsRefreshResult`.
- `ModelRuntime.setRuntimeApiKey()` accepts auth cancellation options.
- A remote catalog refresh now requires a separate `refresh({ providers, signal })` call.
- OAuth `refreshToken(credentials, signal)` callbacks must honor a concrete signal.
- Dynamic provider refresh uses `context.stored` and generation-checked `context.publish()`.
- pi-agent-core replaces legacy harness session repositories with lane-based v4 `Session`, `SessionStorage`, and `SessionRepo` APIs.
- Custom harness file systems must implement atomic `renameFile()`.
- The CLI and RPC processes set `AI_AGENT=pi` in addition to `PI_CODING_AGENT=true`.
- Fullscreen TUI mode, Mermaid and LaTeX display, sampling parameters, and per-directory `AGENTS.override.md` become available.

### Pi 0.84.1

Pi 0.84.1 adds terminating blocked tool calls, auth readiness checks, Qwen Token Plan Individual, and fullscreen interaction fixes. `BeforeToolCallResult.terminate` can stop an all-terminating batch without another model request.

Pi 0.84.1 also prevents `Agent.reset()` during an active run and fixes extension TUI wrapper recursion.

## Breaking-change impact matrix

| Breaking contract | Local impact | Decision |
|---|---|---|
| TypeBox alias removals | No local usage found | No source change |
| RPC delta-only `message_update` | Local extensions do not consume removed cumulative fields | Document for external RPC clients |
| `ModelsRequestTransforms` rename | No local use of the old interface | No source change |
| Nullable `ProviderHeaders` | Blackhole 0.4.5 narrows headers in source types | Add a local pass-through type patch |
| `ModelRegistry.refresh()` result/options | No direct local caller | No source change |
| `setRuntimeApiKey()` cancellation | pi-btw local child runtime sets a transient key | Pass `ctx.signal` |
| OAuth callback signal | No local config-form OAuth callback | No source change |
| `context.stored` and `context.publish()` | No handwritten local dynamic model refresh | No source change |
| Agent Core v4 sessions | No local import of removed harness repository APIs | No source change |
| `FileSystem.renameFile()` | No custom local harness file system | No source change |
| `AI_AGENT` and inherited `PI_*` | Child Pi extensions inherited stale parent session metadata | Add scoped delegate environment scrubbing |

## RPC client migration

An external Pi 0.84.1 RPC client must assemble assistant output from delta events between `message_start` and `message_end`.

Do not read removed cumulative fields from `message_update`. Treat `message_end.message` as authoritative. RPC still uses LF-delimited JSONL, and `agent_settled` still marks the fully settled run.

The local configuration has no tracked RPC client that required code changes. The isolated RPC smoke helper already uses response and terminal events without the removed cumulative fields.

## Package compatibility

### pi-blackhole 0.4.5

The package peer range accepts the Pi core family from 0.81.1 through versions below 1.0.0. Its development dependencies target Pi 0.84.0.

Upstream 0.4.5 now includes public provider discovery through `getRegisteredProviderIds()` and `getRegisteredProviderConfig()`, with the legacy private registry fallback. The old local provider-discovery patch is retired.

Two local changes remain required:

1. `compactAfterPercent` still does not exist upstream.
2. Source types narrow Pi 0.84.1 nullable headers to `Record<string, string>`.

The percentage helper patches the source and changes the package Pi entry from `dist/index.js` to `index.ts`. This is required because npm publishes a prebuilt stock bundle that does not include local source edits. Pi 0.84.1 successfully loads the patched source entry.

The nullable-header helper carries `ProviderHeaders` unchanged through the runtime and all three worker argument types. Runtime JavaScript already forwarded `auth.headers`; this patch keeps source types and future builds correct.

Blackhole typecheck and build passed. The upstream suite reported 1,334 passed tests and two failures in `provider-stream.test.ts`. Both failures arise in untouched 0.4.5 provider-stream code under Node 24.18.0 and concern its optional positive idle-timeout test harness. The configured `providerIdleTimeoutMs` is absent, so the wrapper is disabled. The local patch test passed, and the Pi 0.84.1 RPC loader passed with patched 0.4.5.

### pi-btw 0.4.1

No newer npm release exists. Stock 0.4.1 still passes the removed `modelRegistry` option into child sessions.

The existing local patch remains required. The refreshed helper now passes `ctx.signal` to `ModelRuntime.setRuntimeApiKey()` when it copies a transient parent runtime key. Four patch tests pass, including an offline custom-provider child request.

### pi-browser-harness Gate B

Version 0.11.0 is the newest release, but it is not selected.

Findings:

- Version 0.11.0 adds effective `BU_CDP_WS` remote browser selection and request cleanup fixes.
- A `BU_CDP_WS` change requires a daemon restart because the daemon reads the value at startup.
- Version 0.11.0 removes the deep-research skill, command, and subagent.
- The active repository has no direct deep-research reference outside historical upgrade notes.
- The current package still contributes the deep-research runtime resource to the active skill catalog.
- The untracked Browser Harness profile pin uses the supported version 1 schema in both package versions and remains untouched.
- Both 0.10.2 and 0.11.0 fail an offline production-layout daemon start because `tsx` is not a runtime dependency.
- Unreleased upstream main adds `tsx` as a runtime dependency and starts it through a Node-resolved CLI path.
- A packed production install from upstream main started and stopped its daemon successfully.

Options:

- **A, keep 0.10.2:** preserves current resources and avoids adopting a known unfixed release.
- **B, update 0.11.0 with a local patch:** gains remote browser fixes but adds another package patch and removes deep-research resources.
- **C, wait for the next fixed release:** avoids a local patch but defers the 0.11 features.

Decision: choose A now and C for follow-up. Do not change the pin without a later explicit decision.

### Other packages

| Package | Evidence |
|---|---|
| `@schultzp2020/pi-cursor@0.5.0` | Latest npm version; provider loaded in RPC smoke |
| `pi-claude-bridge@0.6.3` | Latest npm version; provider loaded; AskClaude remains disabled |
| `@colbymchenry/codegraph@1.5.0` | Latest tracked version; real private handler and full Explore tests pass |
| `context-mode@1.0.169` | Latest version; tests, typecheck, and fuzz pass |

## Local extension results

| Surface | Result |
|---|---|
| CodeGraph | 70 tests pass, including real `ToolHandler.executeReadTool()` and full temporary cross-project Explore |
| context-mode | 216 tests pass; typecheck and fuzz pass |
| web-search | 59 tests pass |
| footer | Local test passes; `agent_settled` timer remains correct |
| fastlane | Local test passes; eligible model behavior is unchanged |
| theme-overrides | Five Bun tests pass; wrapper smoke passes |
| Blackhole | Patched 0.4.5 loads under Pi 0.84.1; local patch test passes |
| pi-btw | Four local patch tests pass |

The local handwritten Pi API shims remain valid. No extension uses removed TypeBox aliases, legacy session repository names, `ModelsStreamTransforms`, `context.store`, or `assistantMessageEvent.partial`.

## Feature decisions

- Keep `agent_settled` for footer timing.
- Keep existing custom `renderCall` and `renderResult` implementations.
- Keep Pi's parallel custom-tool default. No local tool needs a compatibility serialization shim.
- Do not adopt fullscreen mode by default. Existing footer and theme code works in the normal mode, and no redraw API change is required.
- Do not add sampling parameters without a model-specific need.
- Do not add scoped-model logic. Existing enabled-model behavior remains deliberate.
- Keep `websocket-cached` transport.
- Keep Blackhole `tailBehavior: pi-default` and the current 65 percent threshold.
- Do not add a `keepRecentTokens` override. The `pi-default` tail continues to use Pi's configured/default tail policy.
- Keep `midRunCompaction: off` to preserve established nested-extension safety.
- Do not add provider refresh code because local providers do not need it.
- Add cancellation only to the existing pi-btw runtime credential sync.
- Add `terminate` handling only when a local tool needs to block and terminate a batch.

## Child process environment decision

Pi 0.84.1 overwrites inherited `AI_AGENT` with `pi` and `PI_CODING_AGENT` with `true`. It does not clear parent `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, or `PI_REASONING_LEVEL` in the main process or generic `pi.exec()` children.

The delegated workflow now clears those five session/model markers before every delegate. Pi's built-in bash tool publishes the child session's own values. Claude delegates also clear inherited `AI_AGENT` and `PI_CODING_AGENT` because Claude does not run as Pi.

A controlled child test confirmed that the scrub leaves the five parent markers absent while Pi restores its two agent markers.

## Changes made

- Updated `agent/settings.json` to Pi changelog 0.84.1 and Blackhole 0.4.5.
- Ported the Blackhole percentage patch to 0.4.5 source layout.
- Added a nullable `ProviderHeaders` Blackhole patch.
- Retired the Blackhole provider discovery patch where upstream 0.4.5 supplies it.
- Added a Blackhole local patch regression test.
- Made the pi-btw transient runtime-key sync cancellation-aware.
- Added a pi-btw migration regression for the prior uncancellable patch.
- Added scoped delegated process environment cleanup.
- Updated ADR 0007 and context-cost attribution.
- Aligned the README with the preserved dark theme, corrected the Cursor model, and removed stale RTK and patch inventory text.
- Added this upgrade record and the main changelog entry.

## Applied validation

The active installation reports Pi core, Agent Core, AI, and TUI version 0.84.1. The live RPC smoke returned three successful responses, 59 commands, 102 models, no stderr, and no extension errors.

Live validation also passed:

- CodeGraph: 70 tests.
- context-mode: 216 tests, typecheck, and fuzz.
- web-search: 59 tests.
- theme-overrides: five tests.
- Blackhole local patch: one test.
- pi-btw local patch: four tests.
- Footer, Fastlane, wrapper syntax, JSON parsing, and all 34 Local Skill validations.

`npm audit --omit=dev` reports eight current transitive findings: four high, three moderate, and one low. The affected tree belongs to Browser Harness dependencies (`sharp`, Hono/MCP packages, `fast-uri`, and `ip-address`). npm's proposed direct-package fix is an incompatible Browser Harness downgrade to 0.2.0. No automatic audit fix was applied; Browser Harness remains pinned to the validated 0.10.2.

## Operator steps

### 1. Reconcile the active checkout

The prepared worktree already merges the two tracked user preferences that existed at the start. Confirm the active tree has no additional tracked edits:

```bash
git -C /home/gc/.pi fetch --all --tags --prune
git -C /home/gc/.pi log -1 --format='%H %cI %s'
git -C /tmp/pi-config-0841-review log -1 --format='%H %cI %s'
git -C /home/gc/.pi status --short --untracked-files=no
git -C /home/gc/.pi diff -- agent/settings.json agent/pi-blackhole/pi-blackhole-config.json
```

The analyzed baseline is `f50b4a8b64dbf47fb458cdf773ac15efed108930`. Expected tracked edits are only the dark theme and OpenAI Codex reflector override. Stop if any other tracked edit exists or either preference has changed. Existing untracked files are outside the copy list and remain untouched.

### 2. Copy the prepared repository changes

Proceed only after the active diff matches the preserved preferences above.

```bash
cd /tmp/pi-config-0841-review
{
  git diff --name-only
  git ls-files --others --exclude-standard
} | sort -u > /tmp/pi-0841-copy-files.txt

rsync -a \
  --files-from=/tmp/pi-0841-copy-files.txt \
  /tmp/pi-config-0841-review/ \
  /home/gc/.pi/

git -C /home/gc/.pi status --short
```

Do not stage or commit unless separately authorized.

### 3. Install Pi 0.84.1

```bash
bun add --global @earendil-works/pi-coding-agent@0.84.1
pi --version
node -p "require('/home/gc/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/package.json').version"
node -p "require('/home/gc/.bun/install/global/node_modules/@earendil-works/pi-agent-core/package.json').version"
node -p "require('/home/gc/.bun/install/global/node_modules/@earendil-works/pi-ai/package.json').version"
node -p "require('/home/gc/.bun/install/global/node_modules/@earendil-works/pi-tui/package.json').version"
```

All five version outputs should be `0.84.1`.

### 4. Install Blackhole and reapply local patches

```bash
pi install npm:pi-blackhole@0.4.5
node /home/gc/.pi/agent/pi-blackhole/reapply-compact-after-percent-patch.mjs
node /home/gc/.pi/agent/pi-blackhole/reapply-nullable-provider-headers-patch.mjs
node /home/gc/.pi/agent/pi-blackhole/reapply-provider-stream-bridge-patch.mjs
node /home/gc/.pi/agent/pi-btw/reapply-model-runtime-patch.mjs
```

The provider bridge helper should report upstream support. The percentage helper should change the package Pi entry to `./index.ts`.

### 5. Verify patches and package pins

```bash
PI_BLACKHOLE_PACKAGE_ROOT=/home/gc/.pi/agent/npm/node_modules/pi-blackhole \
  node --test /home/gc/.pi/agent/pi-blackhole/reapply-local-patches.test.mjs

PI_BTW_PACKAGE_ROOT=/home/gc/.pi/agent/npm/node_modules/pi-btw \
PI_BIN=/home/gc/.bun/bin/pi \
  node --test /home/gc/.pi/agent/pi-btw/reapply-model-runtime-patch.test.mjs

pi list
```

Expected local test totals are one Blackhole test and four pi-btw tests.

### 6. Run an offline loader smoke

```bash
printf '%s\n' \
  '{"id":"commands","type":"get_commands"}' \
  '{"id":"models","type":"get_models"}' \
  | PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi --mode rpc --no-session
```

Confirm both responses succeed and no `extension_error` event appears. Offline catalog warnings can occur for remotely discovered model patterns.

### 7. Restart

Close existing Pi sessions and start a fresh Pi process. Package source changes and provider registrations require a restart or `/reload`; a full restart is safer for this upgrade.

## Rollback

Stop active Pi processes before restoring package directories.

Verify the rollback snapshot first:

```bash
cd /tmp/pi-0821-rollback-20260808-160920
sha256sum -c SHA256SUMS
```

Restore the Pi core family:

```bash
core_root=/home/gc/.bun/install/global/node_modules
rm -rf \
  "$core_root/@earendil-works/pi-coding-agent" \
  "$core_root/@earendil-works/pi-agent-core" \
  "$core_root/@earendil-works/pi-ai" \
  "$core_root/@earendil-works/pi-tui"
tar -xzf /tmp/pi-0821-rollback-20260808-160920/archives/earendil-works-core-0.82.1.tar.gz \
  -C "$core_root"
cp /tmp/pi-0821-rollback-20260808-160920/locks/bun-global.lock \
  /home/gc/.bun/install/global/bun.lock
node -e 'const fs=require("node:fs");const p="/home/gc/.bun/install/global/package.json";const j=JSON.parse(fs.readFileSync(p));j.dependencies["@earendil-works/pi-coding-agent"]="0.82.1";fs.writeFileSync(p,JSON.stringify(j,null,2)+"\\n")'
```

Restore patched packages and package metadata:

```bash
package_root=/home/gc/.pi/agent/npm/node_modules
rm -rf "$package_root/pi-blackhole" "$package_root/pi-btw"
tar -xzf /tmp/pi-0821-rollback-20260808-160920/archives/pi-blackhole-0.4.2-patched.tar.gz \
  -C "$package_root"
tar -xzf /tmp/pi-0821-rollback-20260808-160920/archives/pi-btw-0.4.1-patched.tar.gz \
  -C "$package_root"
cp /tmp/pi-0821-rollback-20260808-160920/manifests/pi-packages-package.json \
  /home/gc/.pi/agent/npm/package.json
cp /tmp/pi-0821-rollback-20260808-160920/locks/pi-packages-package-lock.json \
  /home/gc/.pi/agent/npm/package-lock.json
```

Restore tracked runtime configuration:

```bash
cp /tmp/pi-0821-rollback-20260808-160920/config/settings.json /home/gc/.pi/agent/settings.json
cp /tmp/pi-0821-rollback-20260808-160920/config/models.json /home/gc/.pi/agent/models.json
cp /tmp/pi-0821-rollback-20260808-160920/config/claude-bridge.json /home/gc/.pi/agent/claude-bridge.json
cp /tmp/pi-0821-rollback-20260808-160920/config/pi-blackhole-config.json \
  /home/gc/.pi/agent/pi-blackhole/pi-blackhole-config.json
```

Verify rollback:

```bash
pi --version
pi list
```

Expected Pi version: `0.82.1`.

Repository documentation and helper edits do not affect the restored runtime. If no later user edits overlap the upgrade, restore the original repository state with:

```bash
cd /home/gc/.pi
git restore --source=f50b4a8b64dbf47fb458cdf773ac15efed108930 -- \
  .gitignore README.md agent/AGENTS.md \
  agent/pi-blackhole/LOCAL_PATCHES.md \
  agent/pi-blackhole/pi-blackhole-config.json \
  agent/pi-blackhole/reapply-compact-after-percent-patch.mjs \
  agent/pi-blackhole/reapply-provider-stream-bridge-patch.mjs \
  agent/pi-btw/LOCAL_PATCHES.md \
  agent/pi-btw/reapply-model-runtime-patch.mjs \
  agent/pi-btw/reapply-model-runtime-patch.test.mjs \
  agent/settings.json \
  agent/skills/delegated-pi-loop/SKILL.md \
  agent/skills/delegated-pi-loop/references/prompt-contracts.md \
  docs/CHANGELOG.md docs/TODO.md \
  docs/adr/0007-delegated-pi-role-isolation.md \
  docs/config-context-cost.md \
  docs/skills/delegated-pi-loop-update-process.md
rm -f \
  agent/pi-blackhole/reapply-local-patches.test.mjs \
  agent/pi-blackhole/reapply-nullable-provider-headers-patch.mjs \
  docs/changelogs/pi-0.82.1-to-0.84.1-upgrade.md
cp /tmp/pi-0821-rollback-20260808-160920/config/settings.json agent/settings.json
cp /tmp/pi-0821-rollback-20260808-160920/config/pi-blackhole-config.json \
  agent/pi-blackhole/pi-blackhole-config.json
```

The final two copies restore the pre-upgrade dark theme and OpenAI Codex reflector preferences. Existing untracked Browser Harness and `findings/` files remain untouched.
