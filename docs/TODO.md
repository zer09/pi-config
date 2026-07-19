# Maintenance TODOs

## Recheck upstream Pi 0.80.10 package compatibility fixes

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

Current local version: `0.3.9`

Upstream is considered fixed when custom worker-provider discovery uses supported public APIs such as:

- `ModelRegistry.getRegisteredProviderIds()`
- `ModelRegistry.getRegisteredProviderConfig()`

It must not depend only on the removed private `modelRegistry.registeredProviders` map.

Local reference:

- `agent/pi-blackhole/LOCAL_PATCHES.md`
- `agent/pi-blackhole/reapply-provider-stream-bridge-patch.mjs`

### Review outcome

- If maintainers released equivalent fixes: test the new package versions under the current Pi release, upgrade the pins, and retire the corresponding local patch/helper.
- If the fixes are still absent after the review date: prepare focused upstream issues or pull requests based on the proven local patches. Ask before creating any hosted issue or PR.
