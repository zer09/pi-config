# Maintenance TODOs

## Recheck upstream package compatibility fixes

Status: waiting for maintainers  
Review on or after: **2026-08-19**, or earlier when either package publishes a new release

Do not open upstream issues or pull requests yet. First check the latest npm releases and maintainer source for fixes equivalent to the local patches.

### `pi-btw`

Current local version: `0.4.1`

Upstream is considered fixed when BTW child sessions:

- pass `modelRuntime` rather than the removed `modelRegistry` option to `createAgentSession()`
- preserve the selected extension provider registration for child conversation and summarizer sessions

Local reference:

- `agent/pi-btw/LOCAL_PATCHES.md`
- `agent/pi-btw/reapply-model-runtime-patch.mjs`

### `pi-blackhole`

Current local version: `0.4.5`

Upstream 0.4.5 fixed public custom-provider discovery. Remaining local work is resolved when Blackhole:

- supports a percentage-based session compaction threshold with a fixed-token fallback
- preserves Pi `ProviderHeaders` values, including `null` deletion markers, through worker request types

Local reference:

- `agent/pi-blackhole/LOCAL_PATCHES.md`
- `agent/pi-blackhole/reapply-compact-after-percent-patch.mjs`
- `agent/pi-blackhole/reapply-nullable-provider-headers-patch.mjs`

### Latest review

- 2026-08-09: `pi-blackhole@0.4.5` upstreamed public provider discovery, so that local patch is retired. Percentage compaction and nullable source types still need local patches.
- 2026-08-09: `pi-btw@0.4.1` remains the latest release and still needs the local cancellation-aware `ModelRuntime` child-session patch.

### Review outcome

- If maintainers released equivalent fixes: test the new package versions under the current Pi release, upgrade the pins, and retire the corresponding local patch/helper.
- If the fixes are still absent after the review date: prepare focused upstream issues or pull requests based on the proven local patches. Ask before creating any hosted issue or PR.
