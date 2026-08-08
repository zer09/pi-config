# Local pi-blackhole patches

These notes track local changes made under `~/.pi/agent/npm/node_modules/pi-blackhole/`. Package upgrades or reinstalls can overwrite those files, so re-check this file after every `pi-blackhole` upgrade.

## 2026-06-26 — `compactAfterPercent` for auto-compaction only

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
- On the patched `pi-blackhole@0.4.5`, the same effective threshold is used by both the safe `agent_end` path and the opt-in `turn_end` path.
- Worker settings (`observeAfterTokens`, `observerChunkMaxTokens`, `reflectorInputMaxTokens`, `dropperInputMaxTokens`, etc.) remain hardcoded and are not percentage-scaled.
- This configuration explicitly keeps `midRunCompaction: "off"`; `ctx.compact()` aborts the shared run signal, so `turn_end` compaction is unsafe with nested/background extension work.

Patched files:

- `~/.pi/agent/npm/node_modules/pi-blackhole/src/core/unified-config.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/compaction-budget.ts` (new helper)
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/compaction-trigger.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/commands/memory.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/package.json` (loads patched `index.ts` instead of the stock bundle)

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

Expected result: matches in the config plus the patched source files above. On patched `pi-blackhole@0.4.5`, `handleTurnEnd()` and `handleAgentEnd()` both use `compactThreshold.tokens`. If the source matches disappear after an upgrade, reapply this patch or port the same logic to the new version.

After reapplying, restart Pi or run `/reload`. Then `/blackhole-memory` should show compaction like `triggers at 650,000 = 65% of 1,000,000` when the active model has a 1M `contextWindow`.

## 2026-06-30 — OM worker auth fallback for env-only providers (retired 2026-07-19)

Pi 0.80.10's `ModelRegistry.getApiKeyAndHeaders()` compatibility facade now delegates to `ModelRuntime.getAuth()` and returns canonical provider auth, including ambient environment-backed credentials. The local fallback duplicated that resolution and was removed during the 0.80.10 upgrade.

Retirement verification used a command-backed `models.json` credential, request-time credential switching and error redaction, an ambient `GEMINI_API_KEY`, and the compatibility facade. All checks passed. Do not reapply `reapply-om-auth-fallback-patch.mjs`; that helper has been removed.

## 2026-08-09 — nullable provider headers for Pi 0.84.1+

Why: Pi 0.84.1 preserves `null` header values as deletion markers in `ProviderHeaders`. Stock `pi-blackhole@0.4.5` casts these headers to `Record<string, string>`, which hides valid deletion markers at its worker boundary.

Behavior:

- Blackhole carries Pi's `ProviderHeaders` unchanged into observer, reflector, and dropper requests.
- A `null` header value continues to suppress the matching provider default.
- API keys, provider endpoints, fallback order, and worker behavior stay unchanged.

Patched files:

- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/runtime.ts`
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

Retirement: `pi-blackhole@0.4.5` includes public `getRegisteredProviderIds()` and `getRegisteredProviderConfig()` discovery in `src/om/provider-stream.ts`, plus the legacy private-map fallback. The helper now verifies upstream support and exits without editing.

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

Expected result on `pi-blackhole@0.4.5`: the helper reports `upstream support present`, and `src/om/provider-stream.ts` contains the public registry facade plus the legacy fallback.
