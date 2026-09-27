# Maintenance TODOs

## Recheck upstream package compatibility fixes

Status: rechecked on 2026-09-27. Keep every package patch local; do not publish it or open an upstream issue or pull request. Recheck against published sources before porting to a newer version.

### `pi-btw`

Current local version: `0.6.1`

Upstream now uses `modelRuntime` in child sessions, copies selected extension providers, and seeds the canonical `SessionManager`. The remaining local patch makes runtime-only credential propagation cancellation-aware. Recheck this patch when upstream adds `{ signal: ctx.signal }` to `setRuntimeApiKey()`.

Local reference:

- `agent/pi-btw/LOCAL_PATCHES.md`
- `agent/pi-btw/reapply-model-runtime-patch.mjs`

### `pi-blackhole`

Current local version: `0.5.9`

Upstream 0.4.5 fixed public custom-provider discovery. Remaining local work is resolved when Blackhole:

- supports a percentage-based session compaction threshold with a fixed-token fallback
- preserves Pi `ProviderHeaders` values, including `null` deletion markers, through worker request types
- applies active `context_edit` omissions and replacements before fresh compaction without altering raw recall or stored history

Local reference:

- `agent/pi-blackhole/LOCAL_PATCHES.md`
- `agent/pi-blackhole/reapply-live-0.5.9-patches.mjs`
- `agent/pi-blackhole/reapply-compact-after-percent-patch-0.5.9.mjs`
- `agent/pi-blackhole/reapply-nullable-provider-headers-patch-0.5.9.mjs`
- `agent/pi-blackhole/reapply-context-edit-compaction-patch-0.5.9.mjs`

The version-specific 0.5.8 helpers remain for historical recovery only; do not run them against 0.5.9.

### `pi-claude-bridge`

Current local version: `0.8.0`. Its prompt-capture ordering patch keeps extension-defined sections after known built-ins when an addendum is deleted and re-added. See `agent/pi-claude-bridge/LOCAL_PATCHES.md` and `reapply-transcript-order-patch.mjs`. Keep this patch local and recheck it on any package or Pi upgrade.

### Latest review

- 2026-09-06: `pi-blackhole@0.5.1` was the latest release. It adds Pi 0.85.1 bundled-runtime handling and `session_compact_failed` support, but still lacks percentage compaction and still narrows nullable provider headers. Both local patches were ported and pass against Pi 0.85.1. Its new retained tool-output budget is explicitly disabled to preserve current behavior.
- 2026-09-06: `pi-btw@0.4.1` still passed the removed `modelRegistry` option. This is historical; the 0.6.1 release adopted a child `ModelRuntime`.
- 2026-09-26: `pi-blackhole@0.5.8` still needs the local percentage threshold and nullable `ProviderHeaders` patches. The patched source entrypoint, idempotence, typecheck, and build passed. Two optional Undici dispatcher tests also fail in stock 0.5.8 under Node 24.18.0.
- 2026-09-26: `pi-btw@0.6.1` adopted the native/legacy provider `ModelRuntime` adapter and canonical child-session seeding. Only cancellation-aware runtime-key propagation remains locally patched; an offline native-provider child smoke passed.
- 2026-09-27: reviewed the Blackhole context-edit local patch, BTW's five offline tests, and Claude Bridge's fake SDK ordering repair. Installed and locally patched Blackhole 0.5.9 with worker notifications and the new pool-pressure trigger disabled. Do not publish local patches or create hosted issues or PRs.

### Review outcome

- If maintainers released equivalent fixes: test the new package versions under the current Pi release, upgrade the pins, and retire the corresponding local patch/helper.
- If the fixes are still absent after the review date: retain the local patches; do not create upstream issues or pull requests without a new explicit request.
