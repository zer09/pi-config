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
- Worker settings (`observeAfterTokens`, `observerChunkMaxTokens`, `reflectorInputMaxTokens`, `dropperInputMaxTokens`, etc.) remain hardcoded and are not percentage-scaled.

Patched files:

- `~/.pi/agent/npm/node_modules/pi-blackhole/src/core/unified-config.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/compaction-budget.ts` (new helper)
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/om/compaction-trigger.ts`
- `~/.pi/agent/npm/node_modules/pi-blackhole/src/commands/memory.ts`

Reapply helper:

```bash
node ~/.pi/agent/pi-blackhole/reapply-compact-after-percent-patch.mjs
```

Quick verification after an upgrade:

```bash
rg "compactAfterPercent|effectiveCompactAfterTokens" ~/.pi/agent/npm/node_modules/pi-blackhole/src ~/.pi/agent/pi-blackhole/pi-blackhole-config.json
```

Expected result: matches in the config plus the patched source files above. If the source matches disappear after an upgrade, reapply this patch or port the same logic to the new version.

After reapplying, restart Pi or run `/reload`. Then `/blackhole-memory` should show compaction like `triggers at 650,000 = 65% of 1,000,000` when the active model has a 1M `contextWindow`.
