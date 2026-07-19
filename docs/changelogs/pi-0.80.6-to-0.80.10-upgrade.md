# Pi 0.80.6 to 0.80.10 upgrade

Date: 2026-07-19

## Baseline, target, and outcome

| Item | Value |
|---|---|
| Requested target | Pi 0.80.9 |
| Approved revised target | Pi 0.80.10 |
| Repository source-of-truth commit | `fdefcfb98e333e2377c22cff2a2f027725891cce` |
| Commit date/subject | `2026-07-19T00:38:55+08:00 Configure switchable OpenCode Go credentials` |
| Baseline runtime | Pi 0.80.6 |
| Installed runtime after upgrade | Pi 0.80.10 |
| Review worktree | `/tmp/pi-config-0809-review` (detached from `origin/master`) |
| Rollback snapshot | `/tmp/pi-0806-rollback-20260719-122934` |

The original `~/.pi` working tree was dirty. It was fetched but not pulled, reset, or overwritten. Local and documentation changes were prepared unstaged in the detached review worktree, then synchronized to the live checkout with approval. The always-dirty live `settings.json` was preserved except for `lastChangelogVersion`, and the user's experimental `pi-blackhole-config.json` was left untouched. The Bun-global core, ignored installed package source, CodeGraph CLI, and active ignored CodeGraph dependency were upgraded operationally after isolated validation.

No paid model generation was used. The only generation tests used an in-process offline mock provider.

## Why the target changed from 0.80.9 to 0.80.10

Pi 0.80.10 is a corrective patch for defects in the exact Kimi deferred-tool functionality added in 0.80.9. It fixes:

- Kimi Coding adaptive-thinking request handling
- replay of Kimi messages containing empty thinking signatures
- Kimi K3 pricing
- max-only K3 thinking metadata
- accidental retention of xAI models that 0.80.9 documented as removed

The current configuration does not enable Kimi or built-in xAI, and `cursor/cursor-grok-4.5-medium` is unrelated to the built-in xAI catalog. Nevertheless, installing 0.80.9 would knowingly retain defects in the target feature. The user approved 0.80.10 before installation.

Upstream tags reviewed:

| Release | Tag commit |
|---|---|
| 0.80.7 | `818d67457cdd6b60bce6b121d16b23141c252dd8` |
| 0.80.8 | `fae7176cb9f7c4725a40d9d481d8d70b80f18086` |
| 0.80.9 | `2d16f92973230a7e095aa984f150ba8702784f50` |
| 0.80.10 | `8dc78834cde4e329284cf505f9e3f99763df5529` |

## Breaking changes and compatibility findings

### Pi 0.80.7

- Added Dynamic Tool Loading through `getAllTools()`, `getActiveTools()`, and `setActiveTools()`.
- Tool results can now record newly added tool names, allowing provider-native deferred definitions at the tool-result position.
- Added OpenAI client tool-search and Anthropic deferred-tool/reference support.
- Replaced `OpenAIResponsesCompat.sendSessionIdHeader` with `sessionAffinityFormat` values `openai`, `openai-nosession`, and `openrouter`.
- Added `toolChoice` and Fable 5 higher thinking levels.

No local source uses `sendSessionIdHeader`. The local hand-written extension API surfaces do not yet declare the Dynamic Tool Loading methods, but that is not a runtime break while all tools remain eager.

### Pi 0.80.8

- Replaced SDK `CreateAgentSessionOptions.authStorage` and `.modelRegistry` with `.modelRuntime`.
- Introduced `ModelRuntime` as the canonical model, provider, catalog, and auth surface.
- Kept `ModelRegistry` as a synchronous extension compatibility facade.
- Replaced internal `getApiKeyAndHeaders()`-centric auth with `ModelRuntime.getAuth()`; the compatibility facade now delegates to canonical auth.
- Added live catalog refresh, `models-store.json`, and `pi update --models`. Generated `agent/models-store.json` and machine-local `agent/trust.json` are now explicitly ignored.
- Added xAI device-code OAuth and Grok 4.5 thinking support.

Direct impact:

- `pi-btw@0.4.1` still passed removed `modelRegistry` options to child SDK sessions. Pi ignored the unknown property, causing child sessions to lose extension provider registration. A documented local `ModelRuntime` migration was approved and applied.
- `pi-blackhole@0.3.9` scanned the removed private `modelRegistry.registeredProviders` map. Its custom-provider stream bridge was ported to public facade methods.
- The old Blackhole environment-auth fallback became duplicate behavior and was retired after dedicated auth tests.
- Local Fastlane's `ctx.modelRegistry.isUsingOAuth()` remains supported by the compatibility facade.

### Pi 0.80.9

- Added Kimi K3 and Kimi-native deferred tool serialization.
- Extended deferred tool loading across built-in supported providers.
- Changed xAI authentication to prefilled SuperGrok/X Premium device authorization and made Grok 4.5 the default.
- Documented removal of obsolete Grok 3, Grok 3 Fast, Grok 4.20 variants, and Grok Code Fast 1.

The generated 0.80.9 xAI catalog accidentally retained those obsolete IDs. Version 0.80.10 corrects that catalog.

### Pi 0.80.10

No additional extension SDK or Dynamic Tool Loading break was found relative to 0.80.9. The release contains Kimi/catalog corrections and aligned core version bumps.

## Package audit

Registry metadata was checked package by package before changing configured pins.

| Package | Configured | Latest checked | Action/status |
|---|---:|---:|---|
| `@schultzp2020/pi-cursor` | 0.5.0 | 0.5.0 | Kept. Provider and commands load under 0.80.10. |
| `pi-blackhole` | 0.3.9 | 0.3.9 | Kept. Two active local patches are required; obsolete auth patch retired. |
| `pi-btw` | 0.4.1 | 0.4.1 | Kept. Local `ModelRuntime` SDK migration required and applied. |
| `pi-browser-harness` | 0.8.3 | 0.8.3 | Kept. All 36 browser tools load; package still declares legacy Mario Zechner peer names, so runtime smoke is authoritative. |
| `pi-claude-bridge` | 0.6.2 | 0.6.2 | Kept. Provider catalog loads; `AskClaude` remains disabled by config. |
| `pi-web-access` | absent | 0.13.0 | Remains absent. The local Gemini+Exa extension remains authoritative. |

The exact package list and tool names were preserved. No package update, removal, or silent scope change was needed.

## Local dependency refresh

| Dependency | Before | After | Status |
|---|---:|---:|---|
| `@colbymchenry/codegraph` | 1.4.0 | 1.4.1 | Package and lock updated; CLI updated to 1.4.1. |
| `context-mode` | 1.0.169 | 1.0.169 | Already current; unchanged. |

CodeGraph 1.4.1 advances database schema 7 to 8 but keeps extraction version 24. It adds index/init process supervision, reference-healing corrections, update-notice improvements, and ranking/platform fixes. A disposable copy of the index opened successfully and full upstream Explore returned expected source before the active CLI was upgraded.

The active index was not rebuilt. `codegraph status --json` reports:

- CLI 1.4.1
- index built with CodeGraph 1.4.0 / extraction 24
- complete full-index state
- zero pending references and source changes
- `reindexRecommended: false`

The schema migration is backward-readable by the previous 1.4.0 SDK in this environment. No full reindex is required or authorized.

## Dynamic Tool Loading assessment

Pi 0.80.10 registered 57 tools and kept 54 active:

- seven built-ins registered; `read`, `bash`, `edit`, and `write` active
- eight CodeGraph tools
- three context-mode tools
- two web-search tools
- Blackhole `recall`
- 36 browser-harness tools

Offline `tiktoken` `o200k_base` attribution for active schemas plus guidelines:

| Group | Schema tokens | Guideline tokens | Combined |
|---|---:|---:|---:|
| Browser harness | 4,457 | 2,551 | 7,008 |
| CodeGraph | 1,647 | 414 | 2,061 |
| Context mode | 511 | 239 | 750 |
| Built-ins | 600 | 129 | 729 |
| Web search | 315 | 264 | 579 |
| Blackhole | 265 | 138 | 403 |

Candidate specialized tools such as `codegraph_files`, `codegraph_node`, `codegraph_explore`, and `ctx_search` individually cost about 183–485 tokens including guidance. Deferring a useful specialized subset would save roughly 1.3k tokens, but would also require an extra discovery call and would change existing direct CodeGraph/Context Mode routing.

Important cache detail: activating a deferred tool with `promptSnippet` or `promptGuidelines` rebuilds the system prompt and can invalidate the stable prefix even when the provider supports native deferred schemas. The current local CodeGraph/context-mode definitions intentionally carry routing guidance. A cache-correct migration would therefore require moving or consolidating that guidance, not merely toggling activation.

The dominant cost is the third-party browser package. It eagerly registers 36 tools and has no supported local deferred-loader mode. Patching it would add another third-party maintenance surface.

### Decision and implementation status

**Recommendation: keep the current eager tool set for this upgrade.**

No Dynamic Tool Loading behavior was implemented. This preserves all current workflows, tool names, routing instructions, and direct tool availability. No follow-up prototype is scheduled: the measured benefit is not worth the added discovery call, routing changes, prompt-guidance refactor, and third-party patch surface. Reconsider only if browser-harness gains upstream deferred-loading support or the tool inventory changes materially.

Provider-native support is available for the current OpenAI Codex GPT-5.6 default through `supportsToolSearch`; Kimi uses its own `deferredToolsMode: "kimi"`. Capability exists, but the current extension/package design does not yet yield a sufficiently low-risk migration.

## Local patch status

### pi-blackhole percentage compaction — retained

The 2026-06-26 `compactAfterPercent: 0.65` patch remains active. Focused checks produced:

- 272,000 context → 176,800 tokens
- 1,000,000 context → 650,000 tokens
- missing context → 180,000-token fallback

A live Pi 0.80.10 `/blackhole-memory` RPC command reported `241,800 = 65% of 372,000` and succeeded.

### pi-blackhole auth fallback — retired

The installed `src/om/runtime.ts` was restored exactly to the stock 0.3.9 hash. Pi 0.80.10's compatibility facade resolved command-backed credentials, request-time credential changes, failure redaction, and ambient Google auth in a focused smoke test. The old reapply helper is removed from the tracked config so the duplicate shim cannot be reintroduced.

### pi-blackhole provider stream bridge — added

The `agent_start` fallback now enumerates registered extension providers through public `getRegisteredProviderIds()` and reads each config through `getRegisteredProviderConfig()`. It retains the old private-map scan only for older Pi compatibility.

An offline custom-provider prompt confirmed the handler discovered `offline-mock`, `cursor`, and `claude-bridge`, captured both custom `streamSimple` functions, and completed without network access.

Reapply with:

```bash
node ~/.pi/agent/pi-blackhole/reapply-provider-stream-bridge-patch.mjs
```

### pi-btw ModelRuntime migration — added

Both BTW child-session constructors now create a canonical `ModelRuntime` and copy the selected extension provider's public registration before calling `createAgentSession({ modelRuntime })`. A post-merge review found that a credential supplied only through `--api-key` or `ModelRuntime.setRuntimeApiKey()` was still parent-runtime-only. The helper now detects only the `runtime` auth source and copies that transient key into the child; stored, environment, command-backed, and OAuth auth remain canonical.

Offline regression tests proved:

- stock pi-btw is patched with provider and runtime-auth propagation
- the previous local ModelRuntime patch upgrades in place rather than being mistaken for the final patch
- a parent `--api-key` reaches an offline custom-provider BTW child session
- the conversation and summarizer constructors use the shared migrated helper
- TypeScript strict checking against Pi 0.80.10 declarations passed

Reapply with:

```bash
node ~/.pi/agent/pi-btw/reapply-model-runtime-patch.mjs
```

Both new helpers are idempotent and fail closed if upstream source anchors change.

## Startup wrapper and CLI semantics

`agent/bin/pi` remains compatible and required no source change.

Validated behavior:

- direct Pi and wrapper both report 0.80.10
- `pi -ne` is the exact `--no-extensions` short flag; `-n` alone is session naming
- `--mode rpc`, `--no-session`, and `--list-models` remain valid
- `pi update --models` is present
- wrapper bypass works for `list`, `update`, `update --models`, `config`, and RPC mode
- wrapper command tests left the settings checksum unchanged
- `bash -n agent/bin/pi` passed

## Installation performed

Rollback assets were captured before installation in:

```text
/tmp/pi-0806-rollback-20260719-122934
```

The snapshot contains pre-upgrade settings/models, Bun lockfile, package manifests/locks, the complete 0.80.6 core package family, a tarball of the patched Blackhole package, and SHA-256 records gathered during capture.

Core upgrade:

```bash
bun add --global @earendil-works/pi-coding-agent@0.80.10
```

Bun aligned these four packages to 0.80.10:

- `pi-coding-agent`
- `pi-agent-core`
- `pi-ai`
- `pi-tui`

The live settings checksum was unchanged by core installation.

CodeGraph CLI upgrade:

```bash
CODEGRAPH_NO_INSTALL_REFRESH=1 codegraph upgrade 1.4.1
```

The upgrade intentionally suppressed agent-instruction refresh. The active index was checked but not rebuilt.

## Validation performed

- fetched remote repository state; local `master` and `origin/master` were both the analyzed commit
- compared upstream tags, changelogs, source, manifests, npm metadata, and installed declarations
- isolated Pi 0.80.10 install and sanitized Scenario B config
- final Scenario B loaded all five package extensions and every local extension together
- RPC `get_state`, `get_commands`, and `get_available_models` all succeeded
- no `extension_error`, `Cannot`, `Failed`, or runtime error was emitted
- all configured worker model IDs were present in the catalog
- core manifests all report 0.80.10
- command-backed and ambient auth smoke passed without credential disclosure
- Blackhole percentage threshold helper and live `/blackhole-memory` passed
- Blackhole public provider bridge passed with an offline custom provider
- pi-btw conversation and summarizer child runtimes passed with an offline custom provider
- pi-btw strict TypeScript check passed against Pi 0.80.10
- footer tests passed
- fastlane tests passed
- theme-overrides tests passed (5)
- web-search tests passed (19)
- CodeGraph tests passed (52)
- context-mode tests passed (216), plus check and fuzz
- CodeGraph Node-target build passed with 28 modules and host Pi packages externalized
- CodeGraph strict TypeScript check passed when target host declarations were supplied
- disposable CodeGraph schema/open/search/full-Explore smoke passed
- active CodeGraph status reports complete index, zero pending work, and no reindex recommendation
- wrapper syntax, management bypass, RPC, and settings checksum checks passed
- exact patch reapply helpers passed twice to verify idempotence

No paid provider request, OAuth login, interactive login, or destructive package sweep was performed.

## Operator steps

The tracked upgrade files and active package patches are synchronized. The running Pi process was started before the global replacement and cannot replace its own already-loaded modules.

1. Close this Pi process and start a new terminal/Pi process.
2. Verify:

   ```bash
   pi --version
   codegraph --version
   codegraph status --json
   pi list
   ```

   Expect Pi 0.80.10 and CodeGraph 1.4.1.

3. Start Pi normally and visually check the footer, current live theme, `/blackhole-memory`, `/btw`, and browser status.
4. Review the unstaged live checkout diff. Commit and push only when desired; this upgrade did not stage, commit, or push anything.

A paid real-provider test was explicitly authorized but not run because the offline provider tests already exercised the migrated provider-registration and streaming paths. It would add cost without materially improving compatibility confidence.

## Rollback

### Preferred core/config rollback

Close all Pi processes first.

```bash
bun add --global @earendil-works/pi-coding-agent@0.80.6
pi --version
```

If these changes remain unstaged, restore only the upgrade paths after reviewing the diff; do not overwrite unrelated live settings. If they were committed, revert the upgrade commit rather than restoring broad paths over unrelated work.

Restore the exact pre-upgrade live settings/models if needed:

```bash
cp /tmp/pi-0806-rollback-20260719-122934/config/settings.json ~/.pi/agent/settings.json
cp /tmp/pi-0806-rollback-20260719-122934/config/models.json ~/.pi/agent/models.json
```

Restore the exact prior patched Blackhole package:

```bash
rm -rf ~/.pi/agent/npm/node_modules/pi-blackhole
tar -C ~/.pi/agent/npm/node_modules \
  -xzf /tmp/pi-0806-rollback-20260719-122934/pi-blackhole-0.3.9-patched.tar.gz
```

Reinstall stock `pi-btw@0.4.1` to remove the 0.80.10 SDK patch if returning to the old core:

```bash
pi update --extension npm:pi-btw@0.4.1 --force
```

### CodeGraph rollback

```bash
CODEGRAPH_NO_INSTALL_REFRESH=1 codegraph upgrade 1.4.0
npm ci --prefix ~/.pi/agent/extensions/codegraph
codegraph status --json
```

The 1.4.0 SDK successfully read the schema-8 active index during validation. If a future environment rejects it, a CodeGraph index is derived data and can be recreated with 1.4.0, but ask before running a full `codegraph index -f`.

### Emergency core archive restore

Prefer Bun's package-manager rollback. If registry installation is unavailable:

```bash
rm -rf ~/.bun/install/global/node_modules/@earendil-works
mkdir -p ~/.bun/install/global/node_modules
tar -C ~/.bun/install/global/node_modules \
  -xzf /tmp/pi-0806-rollback-20260719-122934/earendil-works-0.80.6.tar.gz
cp /tmp/pi-0806-rollback-20260719-122934/bun.lock ~/.bun/install/global/bun.lock
```

## Remaining decisions

None. Dynamic Tool Loading remains intentionally disabled, no prototype is scheduled, and paid real-provider tests were judged unnecessary.
