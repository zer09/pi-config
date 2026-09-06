# Maintenance TODOs

## Recheck upstream package compatibility fixes

Status: rechecked on 2026-09-06; remaining fixes are still not upstream.

Review again when either package publishes a newer release.

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

Current local version: `0.5.1`

Upstream 0.4.5 fixed public custom-provider discovery. Remaining local work is resolved when Blackhole:

- supports a percentage-based session compaction threshold with a fixed-token fallback
- preserves Pi `ProviderHeaders` values, including `null` deletion markers, through worker request types

Local reference:

- `agent/pi-blackhole/LOCAL_PATCHES.md`
- `agent/pi-blackhole/reapply-compact-after-percent-patch.mjs`
- `agent/pi-blackhole/reapply-nullable-provider-headers-patch.mjs`

### Latest review

- 2026-09-06: `pi-blackhole@0.5.1` is the latest release. It adds Pi 0.85.1 bundled-runtime handling and `session_compact_failed` support, but still lacks percentage compaction and still narrows nullable provider headers. Both local patches were ported and pass against Pi 0.85.1. Its new retained tool-output budget is explicitly disabled to preserve current behavior.
- 2026-09-06: `pi-btw@0.4.1` remains the latest release. Stock child sessions still pass the removed `modelRegistry` option, so the cancellation-aware native-provider `ModelRuntime` patch remains required for conversation and summarizer children.
- Focused upstream issue/PR evidence is ready in the local helpers and tests. Do not create hosted issues or PRs without separate authorization.

### Review outcome

- If maintainers released equivalent fixes: test the new package versions under the current Pi release, upgrade the pins, and retire the corresponding local patch/helper.
- If the fixes are still absent after the review date: prepare focused upstream issues or pull requests based on the proven local patches. Ask before creating any hosted issue or PR.
