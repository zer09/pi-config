# Pi 0.80.10 to 0.82.1 upgrade

Date: 2026-07-29

## Baseline, target, and outcome

| Item | Value |
|---|---|
| Requested target | Pi 0.82.1 |
| Repository source-of-truth commit | `b91b95465dab57d2fd296b048a23e287712816a1` |
| Commit date/subject | `2026-07-26T00:17:03+08:00 Remove RTK integration` |
| Baseline runtime | Pi 0.80.10 |
| Installed runtime after upgrade | Pi 0.82.1 |
| Review worktree | `/tmp/pi-config-0821-review` (detached from `origin/master`) |
| Rollback snapshot | `/tmp/pi-08010-rollback-20260729-062203` |

The remote was fetched immediately before implementation. Local `master`, `origin/master`, and the detached review worktree all pointed to the commit above. The live checkout was already dirty in `agent/AGENTS.md` and `agent/pi-blackhole/pi-blackhole-config.json`; neither file was reset. Upgrade edits were prepared in the detached worktree, then applied surgically to the live checkout. The live Blackhole configuration's newer Gemini 3.5 worker choices were preserved while the target-compatible compaction and reasoning changes were merged.

No paid model request, login, OAuth flow, destructive package sweep, compatibility symlink, full CodeGraph reindex, commit, or push was performed. Generation-path tests used an offline custom provider.

Upstream Pi tags reviewed:

| Release | Tag commit |
|---|---|
| 0.81.0 | `9c480b6ad2c7419875a7a850fb4ad5f9232313b8` |
| 0.81.1 | `20be4b18d4c57487f8993d2762bace129f0cf7c6` |
| 0.82.0 | `083e61621276bff9f6faefab87ce07fcd98734e2` |
| 0.82.1 | `b4f293684bba718d59cc1157679bcf6157b3a7f5` |

## Repository changes since the previous major upgrade

The previous upgrade commit was `f0a4d1998ea087431e4930821cc1eb92e4fa4743`. Seven later commits were included in this audit:

- `618d257` preserves transient runtime auth in pi-btw child sessions and adds regression coverage.
- `420b130` adds upstream-package fix follow-up tracking.
- `c780554` substantially expands CodeGraph multi-root watcher and reconciliation behavior.
- `40cc843` updates Cursor/default model configuration.
- `e8d6b54` updates the Linear CLI skill.
- `e26838a` supports Pi explicit-only skill metadata.
- `b91b954` removes the RTK bash-rewrite extension.

The relevant upgrade consequences were preserved: CodeGraph's watcher-heavy integration was tested against 1.5.0; the hardened pi-btw runtime-auth patch remained mandatory; configured model IDs were revalidated; explicit-only skill metadata still loaded; and there is no longer an RTK bash interceptor to migrate to the new Pi session environment.

## Breaking SDK audit

### Pi 0.81.0: agent-core and session storage

`@earendil-works/pi-agent-core` 0.81.0 changed low-level contracts:

- low-level agent loops require an explicit stream function;
- `SessionStorage` gained cursor reads, session name/statistics methods, and compaction-tail checkpoint behavior;
- `uuidv7` moved to `@earendil-works/pi-ai`;
- tool results, compactions, and branch summaries can carry persisted usage.

Impact:

- No local source implements agent-core `SessionStorage`, imports `uuidv7` from agent-core, or constructs `Agent` directly.
- `pi-blackhole@0.4.2` is the only configured package using low-level `agentLoop`. Its observer, reflector, and dropper pass an explicit `streamFn`; its peer range starts at 0.81.1. The locally patched source typechecked against Pi 0.82.1 and all 819 upstream tests passed.
- `pi-btw` uses the high-level `createAgentSession()` SDK and remains covered by the local `ModelRuntime` patch.
- Cursor, browser-harness, and Claude Bridge do not implement the changed storage interface.

### Pi 0.82.0: AgentHarness tool context

Agent-core 0.82.0 replaces `AgentHarness`'s direct `ExecutionEnv` dependency and context-free tool inputs with application-defined `toolContext` and context-aware `AgentHarnessTool` definitions.

No configured local extension or package constructs `AgentHarness`. Blackhole uses `agentLoop`, not `AgentHarness`, so this break has no local migration site. The new harness API was not shimmed.

### Expanded usage accounting

Pi 0.81.0 now includes these persisted sources in session totals:

- assistant messages;
- usage-bearing tool-result messages;
- compaction entries;
- branch-summary entries.

The custom footer previously summed assistant messages only. `agent/extensions/footer/token-format.ts` now mirrors the upstream persisted-entry categories while retaining the cache-hit percentage from the latest assistant request only. A focused regression test verifies all four categories.

Limits remain explicit:

- pi-btw stores child-response usage in its own custom entry details, but those child sessions are intentionally separate from the parent Pi ledger;
- Blackhole observer/reflector/dropper calls are extension-owned low-level loops and are not parent-session tool results;
- therefore the Pi footer/session totals are complete for Pi-persisted usage, not for hidden third-party worker billing.

No speculative ledger injection was added. Doing so would require upstream package/API design rather than attributing child generations to unrelated parent messages.

### Tool interfaces and constrained sampling

Pi 0.82.0 adds optional `Tool.constrainedSampling` with strict JSON Schema (`prefer`/`require`) and OpenAI grammar variants.

The local CodeGraph, context-mode, and web-search registration interfaces are structural subsets of Pi's tool definition, so the new optional field is not a runtime break. Scenario B and live SDK probes loaded every tool without an extension error.

No local tool was opted into strict constrained sampling in this upgrade:

- context-mode and web-search schemas are closed, but every tool has optional properties;
- many CodeGraph `Type.Object` schemas do not explicitly close `additionalProperties`;
- strict-schema requirements differ across current providers, and OpenAI strict tools generally require all properties to be required/nullable;
- forcing those schemas into strict mode would require user-visible schema rewrites and could convert a preference into provider request failures.

`strict: "prefer"` therefore does not provide a sufficiently portable benefit for the current mixed OpenAI Codex, Google, Cursor, Claude Bridge, and OpenCode Go model set. Grammar sampling is also a poor fit because these tools have multi-property object inputs rather than one grammar-constrained string. This was deliberately evaluated and deferred, not overlooked.

### `outputPad`

Pi 0.82.1 exposes `outputPad` to custom message renderers. Local tool renderers accept the existing render options and safely ignore unknown additions. The current settings do not configure `outputPad`, so no renderer behavior change was needed.

## Bash session environment

Pi's built-in and factory-created coding-agent bash tool now injects:

- `PI_SESSION_ID`
- `PI_SESSION_FILE`
- `PI_PROVIDER`
- `PI_MODEL`
- `PI_REASONING_LEVEL`

A direct factory-tool probe under 0.82.1 verified all five values. Direct RPC `bash` is a separate RPC execution path and does not expose those variables; its 0.82.0 feature is correlated streaming output.

The local `ctx_batch_execute` wrapper intentionally does not synthesize `PI_*` variables. Its context-mode backend owns subprocess execution and does not expose a safe per-call environment overlay. Temporarily mutating `process.env` would leak across concurrent calls, so no unsafe emulation was added. CodeGraph and web-search are not bash-like user command tools.

## Compaction and branch-summary behavior

Pi 0.81.1 adds bounded retry policy and retry lifecycle events for native compaction and branch-summary generations. Pi 0.82.0 additionally uses fresh routing session IDs with prompt caching disabled for those requests, and 0.82.1 fixes header-only authentication.

Blackhole remains the proactive compaction owner:

- `compaction: "auto"`
- `compactionEngine: "blackhole"`
- `tailBehavior: "pi-default"`
- local `compactAfterPercent: 0.65`

Blackhole's `session_before_compact` hook deterministically compiles its own summary and returns a completed extension compaction. There is no native summary model request for Pi's new retry layer to retry on that path. Native branch summarization still uses Pi's retry policy. Blackhole's observer/reflector/dropper workers retain their own provider fallback and cooldown logic.

`pi-blackhole@0.4.2` adds optional `turn_end` mid-run compaction, but `ctx.compact()` aborts the shared run signal and is unsafe for nested/background work. Version 0.4.2 changed the default to `off`; this config now records `midRunCompaction: "off"` explicitly. Compaction remains at `agent_end`.

`fullFoldAlways: true` is also explicit. It fixes first-compaction observation/reflection starvation before any prior full-fold boundary exists.

## Package audit and upgrades

Registry metadata, package tarballs, package source, peer ranges, and upstream commits/changelogs were checked package by package.

| Package | Before | After | Decision |
|---|---:|---:|---|
| `@schultzp2020/pi-cursor` | 0.5.0 | 0.5.0 | Current; provider, proxy catalog, and commands load under 0.82.1. |
| `pi-blackhole` | 0.3.9 | 0.4.2 | Upgraded. Adds cleanup, first-fold fixes, OAuth/ADC auth support, and optional mid-run compaction; local patches still required. |
| `pi-btw` | 0.4.1 | 0.4.1 | Current. Local `ModelRuntime` child-session patch still required. |
| `pi-browser-harness` | 0.8.3 | 0.10.2 | Upgraded. Adds durable window/profile behavior, `browser_web_search`, `browser_read_page`, forms/research additions, and deep-research resources. |
| `pi-claude-bridge` | 0.6.2 | 0.6.3 | Upgraded. Uses `getAgentDir()`, removes obsolete context-stack code, requires Pi 0.82.1+, and adds newer Claude catalog entries including Opus 5. |

`agent/settings.json` keeps exact source pins. The ignored operational `agent/npm/package.json` was also normalized to exact versions.

A validation issue was caught during installation: `pi update --extensions` and three targeted `pi update --extension ... --force` commands reported success and `pi list` reflected the new settings sources, but installed package manifests remained at the old versions. The package cache was therefore reconciled explicitly with one exact `npm install --save-exact` transaction, after which manifests and source hashes showed the requested versions. This is why final validation uses installed manifests, not `pi list` alone.

## Local dependency refresh

| Dependency | Before | After | Status |
|---|---:|---:|---|
| `@colbymchenry/codegraph` | 1.4.1 | 1.5.0 | SDK, platform package, lockfile, and CLI upgraded. |
| `context-mode` | 1.0.169 | 1.0.169 | Already current; unchanged. |

CodeGraph 1.5.0 introduces the Rust engine, native parsing for 20 languages, adaptive workers, parallel reference resolution, database write optimizations, and release verification improvements. Schema version remains 8 and extraction version remains 24. The active index reports:

- CLI 1.5.0;
- built with CodeGraph 1.4.1 / extraction 24;
- current extraction 24;
- complete state;
- zero pending changes and references;
- `reindexRecommended: false`.

No full or incremental reindex was triggered merely because of the upgrade.

## Local patch status

### pi-blackhole percentage compaction — retained and extended

The percentage patch applies cleanly to 0.4.2. Its helper now accepts an optional isolated package root and, when the upstream `handleTurnEnd()` exists, applies the same effective threshold to both `turn_end` and `agent_end` paths. The configured mid-run path remains off; on patched 0.4.2, a later config opt-in uses the percentage-derived threshold rather than silently falling back to the fixed 180K threshold.

Live `/blackhole-memory` under Pi 0.82.1 reported:

```text
Compaction: ~0 tokens (triggers at 176,800 = 65% of 272,000)
```

The helper was applied twice to a fresh 0.4.2 package; patched hashes were unchanged on the second run.

### pi-blackhole public provider stream bridge — retained

Stock 0.4.2 still scans removed private `modelRegistry.registeredProviders` state after extension load ordering races. The local patch still scans public `getRegisteredProviderIds()` / `getRegisteredProviderConfig()` first and keeps the private-map path only as old-Pi compatibility.

Blackhole 0.4.x's upstream OAuth/ADC fix uses public configured-auth resolution. The retired local environment-auth fallback remains retired.

### pi-btw ModelRuntime child sessions — retained

Stock pi-btw 0.4.1 still passes the removed `modelRegistry` SDK option. The local helper still creates a child `ModelRuntime`, copies the selected extension provider registration, and propagates only parent credentials whose auth source is transient `runtime` (`--api-key` / `setRuntimeApiKey`). Stored, environment, command-backed, and OAuth auth continue through canonical resolution.

All three regression tests passed against Pi 0.82.1, including an offline custom-provider child request.

## Provider and model findings

- Claude Opus 5 is available in Pi 0.82.1 and Claude Bridge 0.6.3; no default model switch was made.
- The current OpenAI Codex default remains `gpt-5.6-sol` with a 272K context window and supports grammar tools/tool search.
- Every configured enabled model and every live Blackhole worker/fallback model was found in the final model catalog.
- Generated model catalogs now expose provider-verified reasoning levels. `opencode-go/deepseek-v4-pro` exposes `high` and `max`, not `xhigh`; the two Blackhole fallbacks that intended maximum reasoning were changed from `xhigh` to `max`.
- The local Gemini 3.5 fallback choices are included in the durable configuration and were present in the target catalog.

## Startup wrapper

`agent/bin/pi` required no source change. Under the new core:

- wrapper and direct binary report 0.82.1;
- `bash -n` passes;
- management and RPC bypass behavior remains valid;
- wrapper `--version`, `list`, and RPC `get_state` leave `settings.json` byte-for-byte unchanged;
- RPC mode succeeds through the wrapper.

The wrapper still performs atomic settings replacement only for normal TUI startup and still backs off for custom non-managed themes.

## Installation performed

Rollback assets were captured first in:

```text
/tmp/pi-08010-rollback-20260729-062203
```

The snapshot contains pre-upgrade core packages and Bun lockfile, settings/models/Claude Bridge config, package manifests and locks, tarballs of the patched Blackhole and pi-btw installations, and a `SHA256SUMS` file covering every rollback asset.

Core:

```bash
bun add --global @earendil-works/pi-coding-agent@0.82.1
```

Bun aligned `pi-coding-agent`, `pi-agent-core`, `pi-ai`, and `pi-tui` to 0.82.1.

Packages were installed in one exact transaction after the Pi updater mismatch was detected:

```bash
npm install --prefix ~/.pi/agent/npm --save-exact \
  @schultzp2020/pi-cursor@0.5.0 \
  pi-blackhole@0.4.2 \
  pi-btw@0.4.1 \
  pi-browser-harness@0.10.2 \
  pi-claude-bridge@0.6.3
```

CodeGraph CLI:

```bash
CODEGRAPH_NO_INSTALL_REFRESH=1 codegraph upgrade 1.5.0
```

The environment flag prevented installer-driven agent-instruction refresh. No index rebuild followed.

## Validation performed

- fetched and recorded the exact analyzed remote commit;
- reviewed all four Pi release spans across coding-agent, agent-core, ai, and tui source/changelogs;
- audited low-level SDK imports and consumers across local and configured third-party source;
- isolated Scenario B with Pi 0.82.1, sanitized config, no auth/session/index cache, and exact candidate packages;
- Scenario B RPC `get_state`, `get_commands`, and `get_available_models` succeeded with no extension error;
- live Scenario A RPC succeeded with every configured and worker model present;
- SDK probe loaded 59 tools / 56 active, including 38 browser, 8 CodeGraph, 3 context-mode, 2 web-search, and Blackhole recall tools;
- all installed package manifests report their requested exact versions;
- Blackhole 0.4.2 typecheck passed against Pi 0.82.1;
- Blackhole upstream suite: 819 tests passed;
- Blackhole patch helpers were idempotent on fresh 0.4.2 source;
- pi-btw patch suite: 3 tests passed, including offline runtime-auth propagation;
- CodeGraph extension: 70 tests passed against SDK 1.5.0;
- context-mode: 216 tests and TypeScript check passed;
- web-search: 19 tests passed;
- footer and Fastlane suites passed;
- theme-overrides: 5 tests passed with its required Bun runner;
- CodeGraph CLI/status reports 1.5.0, complete index, extraction 24, no pending work, and no reindex recommendation;
- built-in bash factory probe verified all five `PI_*` values;
- wrapper syntax/version/list/RPC/checksum tests passed;
- live `/blackhole-memory` verified the 65% threshold under 0.82.1.

One test command was initially invoked with Node's test runner even though `theme-overrides/index.test.ts` imports `bun:test`; Node rejected the `bun:` URL scheme. Re-running with `bun test` passed all five tests. This was a runner-selection error, not a product failure.

## Deferred or intentionally unchanged

- No constrained-sampling flag was added; current schemas are not uniformly portable strict schemas.
- No `PI_*` emulation was added to context-mode's custom subprocess backend.
- No Dynamic Tool Loading change was revisited; the previous eager-tool decision remains valid, while browser-harness now contributes two additional useful tools.
- No parent-ledger accounting was invented for hidden Blackhole workers or pi-btw child sessions.
- No real provider generation or deliberate transient compaction failure was needed after source, type, offline-provider, and integration validation.
- No full CodeGraph reindex was needed.

## Operator steps

1. Close the Pi process that was running before the Bun-global replacement and start a fresh Pi process.
2. Verify:

   ```bash
   pi --version
   codegraph --version
   codegraph status --json
   pi list
   ```

   Expect Pi 0.82.1 and CodeGraph 1.5.0.

3. Start Pi normally and visually inspect the footer/theme, `/blackhole-memory`, `/btw`, and browser status. Browser control remains on-demand; run `/browser-setup` only when browser access is wanted.
4. Review the unstaged diff. The live checkout still includes a pre-existing user change in `agent/AGENTS.md`; the Gemini 3.5 worker IDs are included in this upgrade's staged configuration.
5. Commit and push only when desired. This upgrade did neither.

## Rollback

Close all Pi processes first. Verify the rollback assets before using them:

```bash
cd /tmp/pi-08010-rollback-20260729-062203
sha256sum --check SHA256SUMS
```

Core:

```bash
bun add --global @earendil-works/pi-coding-agent@0.80.10
pi --version
```

Installed package versions:

```bash
npm install --prefix ~/.pi/agent/npm --save-exact \
  @schultzp2020/pi-cursor@0.5.0 \
  pi-blackhole@0.3.9 \
  pi-btw@0.4.1 \
  pi-browser-harness@0.8.3 \
  pi-claude-bridge@0.6.2
```

Restore exact prior patched Blackhole/pi-btw source if needed:

```bash
rm -rf ~/.pi/agent/npm/node_modules/pi-blackhole
mkdir -p ~/.pi/agent/npm/node_modules
tar -C ~/.pi/agent/npm/node_modules \
  -xzf /tmp/pi-08010-rollback-20260729-062203/pi-blackhole-0.3.9-patched.tar.gz

rm -rf ~/.pi/agent/npm/node_modules/pi-btw
tar -C ~/.pi/agent/npm/node_modules \
  -xzf /tmp/pi-08010-rollback-20260729-062203/pi-btw-0.4.1-patched.tar.gz
```

Restore settings only after reviewing current local differences:

```bash
cp /tmp/pi-08010-rollback-20260729-062203/config/settings.json ~/.pi/agent/settings.json
```

Do not broadly restore the old Blackhole config over the user's preserved Gemini 3.5 changes.

CodeGraph CLI and SDK:

```bash
CODEGRAPH_NO_INSTALL_REFRESH=1 codegraph upgrade 1.4.1
npm install --prefix ~/.pi/agent/extensions/codegraph --save-exact @colbymchenry/codegraph@1.4.1
codegraph status --json
```

The active schema-8/extraction-24 index is compatible with both versions. A full reindex is not part of rollback.

If registry installation is unavailable, the snapshot's `earendil-works-0.80.10.tar.gz` and saved Bun lockfile provide an emergency archive restore, but package-manager rollback is preferred.
