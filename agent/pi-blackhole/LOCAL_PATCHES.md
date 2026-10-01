# Local pi-blackhole patches

These notes track local changes made under `~/.pi/agent/npm/node_modules/pi-blackhole/`. Package upgrades or reinstalls can overwrite those files, so re-check this file after every `pi-blackhole` upgrade.

## 2026-10-01: `pi-blackhole@0.5.10` isolated port, not deployed

The isolated compatibility candidate and worktree settings pin exactly **0.5.10** against Pi **0.99.2**. The original `~/.pi` installation is unchanged. The three new `-0.5.10.mjs` helpers preserve the accepted percentage threshold, nullable provider headers, and fresh `context_edit` summary transformations. They retain version/source, prerequisite, isolation, link, partial-state, drift, and byte/mtime idempotence guards. All older helpers remain unchanged. There is no 0.5.10 live entrypoint.

Use a stock package extracted from the SRI-verified 0.5.10 archive under an explicit disposable `TMPDIR` outside the worktree. The helpers reject `node_modules` targets. Apply them in this order:

```bash
export TMPDIR=/home/gc/worktrees/pi-0992-20261001T105108Z-57871/tmp
node agent/pi-blackhole/reapply-compact-after-percent-patch-0.5.10.mjs "$TMPDIR/isolated-package"
node agent/pi-blackhole/reapply-nullable-provider-headers-patch-0.5.10.mjs "$TMPDIR/isolated-package"
node agent/pi-blackhole/reapply-context-edit-compaction-patch-0.5.10.mjs "$TMPDIR/isolated-package"
PI_BLACKHOLE_0_5_10_TARBALL=/home/gc/worktrees/pi-0992-20261001T105108Z-57871/archives/pi-blackhole-0.5.10.tgz node --test agent/pi-blackhole/port-0.5.10.test.mjs
```

The focused gate passed 8/8 tests. Strict compilation passed for all 123 production files in both stock and patched candidates against target declarations. The adapted offline lifecycle fixture passed 1/1 through manifest-selected `./index.ts`: one fake-provider request, one settled compaction, projected canaries, and unchanged raw JSONL prefix. Configuration bytes remain unchanged. Runtime manifests/locks select 0.5.10; exact package replacement preserved all other runtime dependency bytes and mtimes without npm pruning. Run package/runtime checks through the RUN `run-command.mjs` offline sandbox. These checks do not establish live activation or broader lifecycle coverage for 0.5.10.

## 2026-09-27 — `pi-blackhole@0.5.9` local port and live deployment

The 0.5.9 changelog adds worker notifications, elapsed worker timeouts, early worker completion, cache retention, capped recall drill-downs, dropper pool-pressure fixes, Git environment isolation, and settings persistence. It does not include this installation's percentage threshold, nullable `ProviderHeaders`, or fresh `context_edit` compaction repair. The live package, npm manifest/lock, and Pi settings now pin **0.5.9**. The three local patches are applied to its source and its manifest selects `./index.ts`. `showWorkerNotifications: false` preserves quiet output; `dropperPressureThreshold: 1` disables the newly effective pool-pressure trigger without disabling normal dropper cadence. Cache warming remains off. Fresh-process activation was confirmed after deployment.

Three separate, version- and stock-source-pinned candidate helpers apply in order to an explicit disposable package root only: `reapply-compact-after-percent-patch-0.5.9.mjs`, `reapply-nullable-provider-headers-patch-0.5.9.mjs`, and `reapply-context-edit-compaction-patch-0.5.9.mjs`. They reject the installed `node_modules` path and incomplete/drifted patch sets before writing. The first helper changes three source files and switches only the manifest's `pi.extensions` from the stock bundle to patched `index.ts`; the other helpers require exact predecessor bytes. The existing 0.5.8 helpers remain necessary and must not be run against 0.5.9.

The registry-SRI-pinned offline test suites for all three helpers, `port-0.5.9-integration.test.mjs`, `port-0.5.9-package-discovery.test.mjs`, and `port-0.5.9-lifecycle.test.mjs` passed independent review. Together they verify a clean stock-to-patch/reinstall cycle, second-pass byte/mtime idempotence, drift refusal, strict production-source typecheck of 123 files with zero stock and patched diagnostics, source bundling, manifest-based Pi 0.87.1 loading with a stock-bundle negative control, and one fake-provider settled-turn compaction after `agent_before_settle`. The summary uses projected `context_edit` content and leaves prior raw JSONL unchanged. Acquire an isolated 0.5.9 tarball and set `PI_BLACKHOLE_0_5_9_TARBALL` to its `/tmp` path for these tests; they check its pinned npm SRI before extraction. The percentage and nullable-header suites need `node --experimental-vm-modules --test --test-isolation=none`.

Additional reviewed Pi 0.87.1 tests cover a real queued follow-up, `AgentSessionRuntime.newSession()` while a deferred wait is pending, and `AgentSessionRuntime.dispose()` during a held settlement boundary. Queued work cancels the first wait and compacts only after final settlement. Replacement and graceful shutdown each skip the old wait through `stale_ctx` without compacting or rewriting the original synthetic JSONL. Each focused test passed 1/1 against a SRI-pinned three-patch candidate whose package-owned bytes match live 0.5.9. Fresh RPC activation, real-provider, delegated-path, Browser Harness, and interactive theme/footer checks also pass. A reinstall without ported patches would load stock `dist/index.js` and lose context-edit-aware summaries.

## 0.5.9 live-reapply helper

`agent/pi-blackhole/reapply-live-0.5.9-patches.mjs` applied the three reviewed patches to the live 0.5.9 package. Do not run the old 0.5.8 helpers against 0.5.9.

The CLI requires both `--live` and an explicit absolute `--tarball` path. It accepts no target argument or environment override. Its only target is the repository-derived `agent/npm/node_modules/pi-blackhole`, currently `/home/gc/.pi/agent/npm/node_modules/pi-blackhole`. The exported `reapplyIsolatedPatches(target, tarballPath)` permits only explicit disposable roots under the OS temp directory, outside this repository.

The helper reads a local, canonical, unlinked archive file. It verifies this pinned npm registry SRI before extraction:

`sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==`

It extracts into a private temporary directory and applies the unchanged accepted percentage, nullable-header, and context-edit candidates in that order. It then compares the complete target inventory with those exact stock and patched bytes. All 132 package-owned files, including the 123 production TypeScript files, manifest and bundle, must match one complete state. Mixed, partial, missing, extra or drifted files are refused before any target write. Temporary reference construction can still write under the OS temp directory during a refused invocation.

The package must be exactly `pi-blackhole@0.5.9`. The root and package-owned paths must be canonical and not symlinked. Every package-owned file must be a regular file with one hard link. The helper opens all ten write targets without truncation and rechecks file identity and bytes before writing. A fully patched target returns without changing its bytes or modification times.

Only these nine source files and the manifest's `pi.extensions` are changed:

- `src/core/unified-config.ts`
- `src/om/model-budget.ts`
- `src/commands/memory.ts`
- `src/om/runtime.ts`
- `src/om/provider-stream.ts`
- `src/om/agents/observer/agent.ts`
- `src/om/agents/reflector/agent.ts`
- `src/om/agents/dropper/agent.ts`
- `src/hooks/before-compact.ts`

`pi.extensions` becomes `["./index.ts"]`, after writing the source files. The helper preserves `main`, all dependency declarations, `dist`, npm's parent manifest and lockfiles, settings, local configuration, and the existing helpers. No npm commands, package code, providers, sessions, network requests or browser processes run.

An optional root `node_modules` directory is allowed only as a separate dependency tree. Its regular files must have one hard link. Internal npm `.bin` symlinks are allowed, but links outside that dependency tree, dangling links, and a linked dependency root are refused. The helper checks dependency bytes and filesystem metadata before and after patching. It never patches dependencies.

### Offline preparation check

Run from `/home/gc/.pi` using the existing verified archive:

```bash
PI_BLACKHOLE_0_5_9_TARBALL=/tmp/pi-blackhole-0.5.9-increment1-aqrwBx/pi-blackhole-0.5.9.tgz node --test agent/pi-blackhole/reapply-live-0.5.9-patches.test.mjs
```

All 57 preparation tests passed under Node 24.18.0 before deployment. They verify exact ten-file output, second-pass byte/mtime idempotence, clean reinstall reproducibility, npm manifest/lock and nested dependency preservation, version and source drift refusal, partial/mixed states, link refusal, bad archive SRI, and CLI gating. The test requires live 0.5.8 and must not be run unchanged after this upgrade. A separate live second pass returned `already patched: pi-blackhole@0.5.9`.

### Live application and future reinstallation

After installing stock 0.5.9 with package writers stopped and Pi idle, reapply the local patches with:

```bash
node agent/pi-blackhole/reapply-live-0.5.9-patches.mjs --live --tarball /tmp/pi-blackhole-0.5.9-increment1-aqrwBx/pi-blackhole-0.5.9.tgz
```

The live upgrade used this command after `npm install pi-blackhole@0.5.9 --save-exact --ignore-scripts --no-audit --no-fund`; a second invocation was byte-idempotent. An isolated Pi 0.87.1 loader probe then discovered the actual installed package from its manifest and verified nine hooks and context-edit-aware fresh summary input with zero network, browser, inference, or original-session access. Use an explicit path to another copy with the same pinned SRI if the temporary archive expires. The rollback copy of patched 0.5.8 and its manifests/settings/configuration is `/home/gc/.pi-upgrade-rollback-blackhole-0.5.9-lZNZJE`. Never open a Pi 0.87.1-written session under an older Pi during rollback. Fresh-process activation has passed.

**Limits:** this is not an atomic ten-file transaction and does not lock out concurrent writers. Do not run it during npm operations or other package edits. An I/O failure or process interruption can leave a partial patch set; the next run refuses that state rather than repairing or reverting it. Stop and inspect any failed application. Recovery requires a separately authorized clean reinstall. The application and idempotent re-run succeeded. Focused lifecycle tests: `PI_BLACKHOLE_0_5_9_TARBALL=/tmp/pi-blackhole-0.5.9-increment1-aqrwBx/pi-blackhole-0.5.9.tgz node --test --test-concurrency=1 agent/pi-blackhole/port-0.5.9-lifecycle.test.mjs agent/pi-blackhole/port-0.5.9-queued-continuation.test.mjs agent/pi-blackhole/port-0.5.9-session-replacement.test.mjs agent/pi-blackhole/port-0.5.9-shutdown.test.mjs`.

## 2026-09-26 — `pi-blackhole@0.5.8` port

The published 0.5.8 release adds `compactAfterRatio`, but its threshold precedence and fallback differ from this local policy. Keep `compactAfterPercent: 0.65`: use the active model's declared `contextWindow`, then fixed `compactAfterTokens: 180000` if the declaration is unavailable. The patch now integrates with `src/om/model-budget.ts` and updates `/blackhole-memory` display. It switches the package's advertised extension entrypoint from the published `dist/index.js` to the patched `index.ts` because changes to source alone are inactive. The existing nullable-header patch also updates `src/om/provider-stream.ts` to keep `null` deletion markers across the attribution merge. The percentage helper rejects other package versions and is byte-idempotent. The legacy nullable-header helper checks exact source anchors but has no upfront version gate and can leave partial edits if a later anchor fails; never run it on another version. The separate 0.5.9 candidate fixes that guard and preflights all writes.

The local test suite, source typecheck, and build passed against Pi 0.87.1. Stock and patched 0.5.8 both fail the same two optional Undici dispatcher tests under Node 24.18.0; `providerIdleTimeoutMs` remains unset. The upgrade also explicitly sets `recallResponseMaxChars: 0`, `reflectionsPoolMaxTokens: 0`, `showPreCompactionMessage: false`, and `statusBar: false`. Fresh context-edit compaction input is covered by the separate local patch below. The target-bound deferred-compaction test passes for one settled turn; the current 0.5.9 suite also covers replacement and shutdown cancellation.

## 2026-09-27 — Pi 0.87.1 fresh context-edit compaction input

The former `pi-blackhole@0.5.8` hook uses Pi's public `buildSessionProjection()` to omit or replace selected active-branch messages before fresh compaction. It does not change raw stored history, raw recall, existing summaries, observational memory, or compaction ownership. The offline stock-to-patch, reinstallation, loader, compiler, projection, and idempotence tests passed; three independent reviews found no blocking issue. These historical 0.5.8 commands must not be used on the live 0.5.9 package. For 0.5.9 use the guarded helper above. The 0.5.8 reapply commands were:

```bash
node ~/.pi/agent/pi-blackhole/reapply-context-edit-compaction-patch.mjs
node --test ~/.pi/agent/pi-blackhole/reapply-context-edit-compaction-patch.test.mjs
```

See `agent/pi-blackhole/CONTEXT_EDIT_PATCH.md` for exact boundaries and limits. Restart Pi or run `/reload` while idle after applying the source patch. The isolated `auto-compaction-lifecycle.test.mjs` initializes Pi's theme through its public API. It passed against published Pi 0.87.1 and patched Blackhole 0.5.8: `agent_end` waited through `agent_before_settle`, then exactly one compaction ran after settlement. Its summary excluded an omitted `context_edit` canary, included a visible canary, and left prior raw history unchanged. The current 0.5.9 lifecycle suite also covers queued continuation, replacement, and shutdown cancellation.

## 2026-06-26 — `compactAfterPercent` for auto-compaction only (historical details)

Why: the stock config uses fixed token thresholds. With a 1M-token session model, the previous `compactAfterTokens: 180000` compacted at only ~18% of context. We only want percentage scaling for auto-compaction; worker thresholds stay fixed because worker models may have smaller context windows (for example 200k).

Config:

```json
{
  "compactAfterPercent": 0.65,
  "compactAfterTokens": 180000
}
```

Behavior:

- If the active session model exposes `contextWindow`, auto-compaction threshold is `floor(contextWindow * compactAfterPercent)`.
- If no valid `contextWindow` is available, it falls back to `compactAfterTokens`.
- On the patched `pi-blackhole@0.5.1`, the same effective threshold was used by both the safe `agent_end` path and the opt-in `turn_end` path. In 0.5.8, the patched `autoCompactThreshold()` feeds the trigger and the command display.
- Worker settings (`observeAfterTokens`, `observerChunkMaxTokens`, `reflectorInputMaxTokens`, `dropperInputMaxTokens`, etc.) remain hardcoded and are not percentage-scaled.
- This configuration explicitly keeps `midRunCompaction: "off"`; `ctx.compact()` aborts the shared run signal, so `turn_end` compaction is unsafe with nested/background extension work.

Patched files:

- `~/.pi/agent/npm/node_modules/pi-blackhole/src/core/unified-config.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/compaction-budget.ts` (new helper)
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/compaction-trigger.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/commands/memory.ts`

Stock `pi-blackhole@0.5.1` loaded `index.ts`. Version 0.5.8 loads `dist/index.js` by default, so the new helper changes its package extension entrypoint back to the patched `index.ts`.

Reapply helper:

```bash
node ~/.pi/agent/pi-blackhole/reapply-compact-after-percent-patch.mjs
# Optional isolated-package target for upgrade testing:
node ~/.pi/agent/pi-blackhole/reapply-compact-after-percent-patch.mjs /tmp/pi-blackhole-package
PI_BLACKHOLE_PACKAGE_ROOT=/tmp/pi-blackhole-package node --test ~/.pi/agent/pi-blackhole/reapply-local-patches.test.mjs
```

Quick verification after an upgrade:

```bash
rg --no-ignore "compactAfterPercent|effectiveCompactAfterTokens|compactThreshold\\.tokens" ~/.pi/agent/npm/node_modules/pi-blackhole/src ~/.pi/agent/pi-blackhole/pi-blackhole-config.json
```

Expected result in 0.5.8: matches in the config, `src/core/unified-config.ts`, `src/om/model-budget.ts`, and `src/commands/memory.ts`. Check `package.json` for `pi.extensions: ["./index.ts"]`. If the source matches disappear after an upgrade, reapply this patch or port it to the new version.

After reapplying, restart Pi or run `/reload`. Then `/blackhole-memory` should show compaction like `triggers at 650,000 = 65% of 1,000,000` when the active model has a 1M `contextWindow`.

## 2026-06-30 — OM worker auth fallback for env-only providers (retired 2026-07-19)

Pi 0.80.10's `ModelRegistry.getApiKeyAndHeaders()` compatibility facade now delegates to `ModelRuntime.getAuth()` and returns canonical provider auth, including ambient environment-backed credentials. The local fallback duplicated that resolution and was removed during the 0.80.10 upgrade.

Retirement verification used a command-backed `models.json` credential, request-time credential switching and error redaction, an ambient `GEMINI_API_KEY`, and the compatibility facade. All checks passed. Do not reapply `reapply-om-auth-fallback-patch.mjs`; that helper has been removed.

## 2026-09-06 — `pi-blackhole@0.5.1` port and behavior-preserving config

Version 0.5.1 adds Pi 0.85.1 bundled-runtime adapter support, unified `session_compact_failed` handling, custom provider+API stream identity, and lazy loading. It also adds a provider-visible retained tool-output budget that defaults to 20,000 tokens. This configuration sets `retainedToolOutputMaxTokens: 0` so the package upgrade does not change the previous tool-output projection policy.

Both local patches remain required in 0.5.1. The percentage helper was ported to the new source while the package's stock `index.ts` entrypoint is retained. The nullable-header helper also preserves the new worker `env` propagation while removing only the invalid header narrowing.

The full upstream suite passes 1,551 of 1,553 tests under Node 24.18.0 before and after the local patches. The same two untouched optional positive `providerIdleTimeoutMs` dispatcher tests fail because of their Undici test harness; this config leaves `providerIdleTimeoutMs` unset, so that wrapper is inactive. Typecheck and build pass against Pi 0.85.1.

## 2026-08-09 — nullable provider headers for Pi 0.84.1+

Why: Pi 0.84.1 preserves `null` header values as deletion markers in `ProviderHeaders`. Stock `pi-blackhole@0.4.5` casts these headers to `Record<string, string>`, which hides valid deletion markers at its worker boundary.

Behavior:

- Blackhole carries Pi's `ProviderHeaders` unchanged into observer, reflector, and dropper requests.
- A `null` header value continues to suppress the matching provider default.
- API keys, provider endpoints, fallback order, and worker behavior stay unchanged.

Patched files:

- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/runtime.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/provider-stream.ts` (0.5.8 attribution merge)
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/agents/observer/agent.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/agents/reflector/agent.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/agents/dropper/agent.ts`

Reapply helper:

```bash
node ~/.pi/agent/pi-blackhole/reapply-nullable-provider-headers-patch.mjs
```

Quick verification:

```bash
rg --no-ignore "ProviderHeaders|headers: auth.headers" ~/.pi/agent/npm/node_modules/pi-blackhole/src/om
```

Expected result: the runtime and three worker argument types use `ProviderHeaders`, with no cast to `Record<string, string>`.

## 2026-07-19 — public custom-provider stream bridge for Pi 0.80.8+ (retired 2026-08-09)

Why: `pi-blackhole@0.3.9` scanned the removed private `modelRegistry.registeredProviders` map during `agent_start`. Pi 0.80.8 replaced registry internals with `ModelRuntime`, so custom worker providers such as Claude Bridge could no longer be copied into Blackhole's cross-module stream bridge.

Retirement: `pi-blackhole@0.4.5` and `0.5.1` include public `getRegisteredProviderIds()` and `getRegisteredProviderConfig()` discovery in `src/om/provider-stream.ts`, plus the legacy private-map fallback. The helper now verifies upstream support and exits without editing.

Behavior:

- The one-time fallback scan enumerates extension providers with public `ModelRegistry.getRegisteredProviderIds()`.
- It reads each public registration with `getRegisteredProviderConfig()` and captures custom `streamSimple` functions.
- The old private-map path remains only as backward compatibility for pre-0.80.8 Pi releases.
- Worker model IDs, fallback order, tools, commands, and thresholds are unchanged.

Patched file:

- `~/.pi/agent/npm/node_modules/pi-blackhole/index.ts`

Reapply helper:

```bash
node ~/.pi/agent/pi-blackhole/reapply-provider-stream-bridge-patch.mjs
```

Quick verification after an upgrade:

```bash
rg --no-ignore "getRegisteredProviderIds|getRegisteredProviderConfig" ~/.pi/agent/npm/node_modules/pi-blackhole/index.ts
```

Expected result on `pi-blackhole@0.5.1`: the helper reports `upstream support present`, and `src/om/provider-stream.ts` contains the public registry facade plus the legacy fallback.
