# Pi 0.84.1 to 0.85.1 upgrade

Date: 2026-09-06

## Verdict

Pi 0.85.1 is the selected and installed target. It is the current npm `latest` release and fixes the broken 0.85.0 SDK publication. The local extension and package stack is compatible after narrow theme/footer/test changes, a CodeGraph 1.6.0 update, and a port of the two active Blackhole patches to `pi-blackhole@0.5.1`.

The migration keeps existing model, account, routing, transport, resource, liveness, and compaction policy. It does not enable Fastlane, constrained sampling, fullscreen mode, PowerShell, dynamic tool hiding, or Blackhole mid-run compaction. No live delegate, paid provider, browser, auth refresh, real-index rebuild, or original-session migration was used for validation.

## Trustworthy baselines

### Repository

| Item | Evidence |
|---|---|
| Remote | `git@github.com:zer09/pi-config.git` |
| Branch | `master`, tracking `origin/master` |
| Fetched at | `2026-09-06T15:30:59Z` |
| Fetched `origin/master` | `2d27aaa6fd2c67c84c73742973760a0243cd2d7f` |
| Live worktree HEAD | `2d27aaa6fd2c67c84c73742973760a0243cd2d7f` |
| Ahead/behind | `0/0` |
| Staged changes | none |
| Tracked dirty state | `agent/settings.json` only |
| Relevant untracked state | Browser Harness config, local skills, findings, research, and other user files; all left untouched |
| Upgrade worktree | `/home/gc/.pi-upgrade-0.85.1-NcEJ3q`, detached at fetched `origin/master` |

The live `agent/settings.json` change predates this upgrade: `defaultProvider` changed from tracked `openai-codex` to active `openai-codex-cgpt3`, and the file lost its trailing newline. The upgrade preserves the provider choice and restores a normal trailing newline.

The previous upgrade document analyzed repository commit `f50b4a8b64dbf47fb458cdf773ac15efed108930`. Commit `9a325fe347f86160d324572dcc60821d94595dee` later implemented the Pi 0.84.1 upgrade. The latter is the implementation baseline for this review. It is a direct ancestor of current HEAD; 135 repository commits follow it. Those commits include the native delegated extension, config-driven routing, strict child resource isolation, centralized model-visible instructions, user-override separation, web-search provider routing, renewable liveness, schema-8 diagnostics, expanded account aliases, Impeccable overlays, and removal of xkiro routes.

### Runtime and installation

| Layer | Baseline |
|---|---|
| Wrapper resolved by `command -v pi` | `/home/gc/.pi/agent/bin/pi` |
| Wrapper real target | `/home/gc/.bun/bin/pi` |
| Real target | symlink to `.../@earendil-works/pi-coding-agent/dist/cli.js` before upgrade |
| Wrapper and real version | `0.84.1` |
| Installer/package manager | Bun global package root at `/home/gc/.bun/install/global` |
| Global manifest pin | `@earendil-works/pi-coding-agent: 0.84.1` |
| Baseline core family | coding-agent, agent-core, pi-ai, and pi-tui 0.84.1; client/protocol 0.84.1 were dependencies of that release |
| Active config root | `${PI_CODING_AGENT_DIR:-~/.pi/agent}` = `/home/gc/.pi/agent` |

Pi 0.85.1 changes the CLI target to `dist/bundle/cli.js` and its published dependency family to coding-agent, agent-core, pi-ai, pi-tui, and Chord 0.85.1. Client and protocol are not forced into the supported install graph. The wrapper's `node --liftoff-only` invocation succeeds against the published target.

### Tracked settings, deployed settings, and local sources

The tracked fetched settings still named `openai-codex` as default. The deployed file named `openai-codex-cgpt3`. The final unstaged settings preserve the deployed default, keep `websocket-cached`, keep thinking `high`, keep the object-form Browser Harness package with `skills: []`, and advance only the Pi changelog marker and selected Blackhole pin.

The local Cursor package resolves according to settings-file relative-path rules:

```text
../../development/pi-extensions-cursor/packages/pi-cursor
-> /home/gc/development/pi-extensions-cursor/packages/pi-cursor
```

Cursor evidence:

| Item | Value |
|---|---|
| Repository | `zer09/pi-extensions-cursor`, with `schultzp2020/pi-extensions` as upstream |
| Branch/commit | `main` at merge commit `c42ebcf6ba20a3372d64b2641670c69f0e046529` |
| Origin relation | 15 commits ahead, 0 behind |
| Upstream relation | source tree exactly matches `upstream/main` at `5cb3f9032c443833c36685adde34be307781f30e`; the merge commit preserves local ancestry |
| Dirty state | only pre-existing untracked `.codegraph/` |
| Package version | `@schultzp2020/pi-cursor@0.5.1` |
| Active entrypoint | `dist/index.js` |
| Runtime dependency | `@bufbuild/protobuf ^2.14.0` |

Upstream and npm 0.5.1 include model normalization, sleep/reconnect, blob retention, and runtime recovery changes. Upstream had already incorporated the local logging, session-ID, model-normalization, diagnostics, and shutdown work. A reviewed merge selected upstream for seven overlapping source/test files and removed the release-consumed changeset; the resulting tree matches upstream exactly without replacing the configured local source. The final checkout passed all 440 tests, lint, format checking, build, the Pi 0.85.1 all-active SDK load, and a live Proxy rotation/model-catalog smoke.

## Official release span

Official tags and commits:

| Release | Tag commit | npm publication |
|---|---|---|
| 0.84.1 | `53fa77ccd8a279eb87e92294ef3687b03ff80112` | 2026-08-07T06:01:32.966Z |
| 0.84.2 | `914cf1472e715297caa30db4b9535d534a9eb718` | 2026-08-14T10:09:06.966Z |
| 0.84.3 | `4e58f324fae8ebfa98a3d45181fb248072a2afac` | 2026-08-24T11:09:37.600Z |
| 0.84.4 | `b79e4cc834970cca69daebffab7df1da7d1e52c4` | 2026-08-28T22:07:57.753Z |
| 0.85.0 | `107d79f11072bbc8a3a757ed7fd69596bee7d68c` | 2026-09-04T10:18:05.208Z |
| 0.85.1 | `d981de1229ef899957bbe968bc8dcda02a21f477` | 2026-09-05T12:17:19.281Z |

### 0.84.2

Classification: additive features, provider serialization changes, and fixes.

- `--use-theme <name[/name]>` adds a non-persistent initial interactive selection. Pair order is light first and dark second. This enables the write-free wrapper migration.
- Supported strict tool schemas are converted to closed provider schemas with required nullable optional fields while the original local definition remains intact. `null` for an optional non-nullable argument is treated as omission.
- `defaultTools`, `expandPromptTemplates`, `AssistantMessage.endTurn`, native Mistral transport, message-anchored `additional_tools`, restored streaming usage, tool-call namespaces, and fallback renderer expansion are available.
- Local effect: the Codex alias adapter's message spreads preserve `endTurn`, usage, namespaces inside tool blocks, response IDs, and additive fields. No local call uses `expandPromptTemplates`, `defaultTools`, `createGatewayBindingFetch`, or the native Mistral transport.
- Decision: adopt `--use-theme`; keep other features deferred or unused. Strict `prefer` is now technically more viable but is not enabled broadly without provider-by-provider serialization fixtures.

### 0.84.3

Classification: one source breaking rename, new diagnostics, CLI/runtime packaging changes, and fixes.

- `GoogleThinkingLevel` becomes `GoogleApiThinkingLevel`; `ResolvedGoogleThinkingLevel` represents normalized levels. No local extension, package overlay, or Cursor source uses either old type.
- JSON/RPC `toolcall_start` now includes id and tool name. The delegated monitor tolerates and ignores those private payload fields while using authoritative `tool_execution_*` events for active tools.
- `session_compact_failed` adds reason, abort, retry, source, and error state. Blackhole 0.5.1 consumes it and resets orphaned compaction state.
- The bundled CLI/RPC entrypoints move to `dist/bundle/`; local wrapper execution and delegated executable selection were tested against the published bundle.
- Compaction and branch-summary requests have empty tools, and summary truncation is rejected. Blackhole workers intentionally using tools run in separate worker calls and are not affected.
- Threshold compaction now works when streams omit usage. Source regression tests and a published-package fake provider covered that path.

### 0.84.4

Classification: one agent-core behavioral break plus lifecycle, compaction, queue, persistence, and rendering fixes.

- `prepareNextTurn` and `prepareNextTurnWithContext` now run only when another assistant turn will start. No local low-level loop consumer performs end-of-run work there. Blackhole's internal `prepareNextTurnWithContext` patch belongs only to its opt-in inline resume adapter, and `midRunCompaction` remains `off`.
- Core threshold compaction can run after large tool results and before the next assistant request in the same run. The path is `AgentSession._compactBeforeNextAssistantResponse()` to `_runAutoCompaction("threshold", false)`, including `session_before_compact` hooks.
- `ui_prompt_start` and `ui_prompt_end` wrap select, confirm, input, editor, and custom UI. Nested prompts coalesce at the outer span; handlers run asynchronously as best effort.
- RPC gains `clear_queue`; `triggerTurn: false` messages no longer split a tool-call/result pair. Delegated code does not clear or emulate Pi's queue and remains tolerant of queue events.
- Session JSONL append repairs a missing trailing newline. Synthetic 0.84.1 sessions passed target append/read and target-created sessions remained readable by 0.84.1.
- Terminal capability overrides, scrollbar/search colors, selection-copy settings, and rendering fixes are optional. Existing normal-mode and theme defaults remain unchanged.

### 0.85.0

Classification: one pi-ai source break, one pi-tui source break, additive SDK/message support, UI changes, and many fixes.

- `createGatewayBindingFetch()` becomes `createAiBindingFetch()`. The new fetch forwards binding requests unchanged and requires Workers AI Gateway passthrough configuration in the model `baseUrl`. No local code imports either symbol.
- pi-tui removes coding-agent environment defaults from direct renderer construction. No local extension constructs the top-level renderer, so the coding-agent host continues to apply settings.
- `SessionManager.inMemory()` can restore external entries. Assistant-message frames, provider-native per-turn thinking metadata, and narrow pi-ai subpath exports are added.
- The default editor embeds the working indicator in its border. This config has no custom editor and adds no duplicate spinner. Blackhole's `setWorkingVisible(true)` call is confined to disabled inline resume mode.
- Built-in tools now honor `ctx.cwd`. CodeGraph and context-mode keep their explicit project-root semantics; delegated children still pass their assigned cwd.
- RPC manual-compaction abort, branch-summary budget, session fork boundaries, stream normalization, terminal SSE parsing, and imported-session collision handling are fixed.
- The 0.85.0 npm package exposed experimental client/plugin output and dependencies unintentionally. It was never installed as an intermediate version.

### 0.85.1

Classification: packaging repair, model addition, cache-payload correction, and TUI fixes.

- The supported root SDK and stdio RPC publish correctly. `client` and `experimental/plugin` now have source-only export conditions and are not importable under normal Node conditions. The published tarball has no compatibility symlink or compiled experimental client tree.
- GPT-6 Astra enters the canonical OpenAI and Codex catalogs. Alias providers map the canonical catalog when the extension loads, so a fresh process or `/reload` exposes it. No model default, enabled-model list, delegated route, or Fastlane eligibility changed.
- GPT-5.6+ Responses long-cache requests use `prompt_cache_options.ttl: "30m"`; earlier models retain the old field where supported. Codex aliases pass request options to the canonical stream unchanged and inject no duplicate cache field.
- Mouse hover/list selection, fullscreen Alt-wheel speed, and selector save-key behavior are fixed.

## Breaking-change and compatibility matrix

| Source change | Local consumer | Actual effect | Action | Proof |
|---|---|---|---|---|
| `GoogleThinkingLevel` rename in 0.84.3 | all local extensions and Cursor | no references | none | source scan under current extension and Cursor roots |
| `prepareNextTurn*` terminal semantics in 0.84.4 | Blackhole inline adapter only | opt-in resume adapter no longer treats terminal turns as preparation; configured path is off | retain `midRunCompaction: off`; use `agent_end` for settled extension compaction | Blackhole config, upstream suite, published fake-provider terminating-turn smoke |
| Core between-turn threshold compaction in 0.84.4 | Blackhole `session_before_compact`; delegated children | parent gets one Blackhole-provided summary; delegated children exclude Blackhole and use native summary | update Blackhole to 0.5.1, retain thresholds and ownership | one-run/one-summary published smoke; resource-policy tests |
| `createGatewayBindingFetch` removal in 0.85.0 | none | no runtime effect | none | source scan |
| pi-tui renderer environment defaults removed in 0.85.0 | no top-level renderer construction | no runtime effect | none | extension source/typecheck |
| working indicator moved into default editor | footer and themes | no custom editor conflict | no spinner/editor change | target source and all-active load |
| source-only experimental client/plugin in 0.85.1 | no local imports | normal imports correctly fail | do not add symlinks or dependencies | published-package import probe |
| new assistant metadata and normalized stream events | Codex aliases, Claude Bridge, Cursor, delegated RPC monitor, footer | additive fields survive; authoritative terminal event remains `message_end` | config-driven alias test update only | target tests, alias fake stream, package unit suites |

## Write-free theme migration

Design A is adopted and recorded by ADR 0018.

- `agent/bin/pi` keeps Windows `AppsUseLightTheme` detection and prepends `--use-theme dark|light` for ordinary interactive starts.
- No normal automatic startup creates, parses, writes, renames, chmods, or replaces settings.
- A user `--use-theme` prevents injection. `theme-overrides` also backs off for that explicit choice even when saved settings name `dark` or `light`.
- `PI_THEME_WRAPPER_INJECTED=1` distinguishes only the wrapper default, allowing the extension to continue Windows appearance polling. The wrapper clears stale inherited markers.
- Management commands, auth, metadata, model listing, export, print, JSON, and RPC modes bypass injection. Parsing respects option values and `--`.
- Local resource-loader themes register ahead of built-ins for runtime name lookup, so custom `dark` and `light` objects retain their source paths. `--theme <path>` remains resource loading; `--use-theme <name>` remains selection.
- Native `light/dark` automatic switching is not adopted because it follows terminal reports rather than Windows application appearance. Changing that source remains a separate user policy decision.

Automated wrapper coverage includes repeated options, spaces, `@file` arguments, command words inside prompts, custom config roots, missing/invalid settings, the disabled path, concurrent starts, exact argv, and settings bytes/mtime/mode. Target controller source tests cover initial non-persistence, pair ordering, live terminal changes, later explicit settings selection, and disposal. A fresh real-terminal visual check remains required because unit and PTY startup checks cannot prove the user's Windows Terminal colors.

## UI prompts and working indicator

The footer now renders a separate `? waiting` state from `ui_prompt_start` until `ui_prompt_end`. It stores no title, text, kind, or reason. Waiting does not pause the wall-clock prompt timer and does not redefine `agent_settled`. Session shutdown clears stale state.

Delegated children see no new RPC wire event. A blocking child prompt appears as `extension_ui_request`; the supervisor sends a cancellation response for supported dialogs. UI traffic renews only protocol health and explicitly does not renew accepted activity, structural progress, tool liveness, or leases. Headless prompt-response policy and renewable liveness remain unchanged.

The default editor uses Pi 0.85.0's embedded border indicator. No local extension calls working-indicator or custom-editor APIs to duplicate it.

## Compaction and liveness outcome

- Native in-run threshold compaction invokes Blackhole's `session_before_compact` hook in the parent. It does not enable Blackhole's separate `turn_end` trigger.
- The effective Blackhole auto threshold remains `floor(contextWindow * compactAfterPercent)` with `compactAfterTokens` fallback. For a 272K session model the configured threshold is 176,800 tokens.
- `midRunCompaction` stays `off`; `fullFoldAlways`, percentage, fixed worker budgets, worker models/thinking, cooldowns, fallbacks, and summary ownership stay unchanged.
- Blackhole 0.5.1 adds `session_compact_failed` handling and Pi 0.85.1 bundled-runtime adapter discovery. Both active local patches remain required.
- Blackhole 0.5.0 introduced `retainedToolOutputMaxTokens: 20000`. The config explicitly sets it to `0` so the package update does not change provider-visible historical tool output.
- Summary calls expose no Pi session tools and use provider-neutral `toolChoice` behavior. Blackhole's own observer/reflector/dropper agent loops may still use their intentional worker tools.
- RPC abort now cancels manual compaction. Target source tests cover failure, abort, overflow retry, queued steering, truncated-summary rejection, split turns, branch-summary budgeting, and usage-omitting streams.
- Delegated children exclude Blackhole, BTW, Browser Harness, Claude Bridge, Cursor, footer, Fastlane, and themes. Core compaction events count as activity only; no compaction event fabricates structural progress or unlimited keepalive.
- No original user session was opened or changed. Synthetic sessions with compaction entries passed 0.84.1 to 0.85.1 and 0.85.1 to 0.84.1 reads, including trailing-newline repair.

## Delegation, aliases, accounts, and search

### Delegated extension

The current version-2 route registry contains 7 model capabilities, 10 profiles, and 14 roles. It preserves seven solution roles, three review roles, one implementation, remediation, verification, and oracle assignment as configured at this head. The earlier changelog's five routing expectation failures no longer reproduce: the current suite has 489 passing tests, and the current routing check is clean. This is a baseline improvement from later routing commits, not a Pi 0.85.1 fix.

The RPC monitor already implements delta-only `message_update`, cumulative top-level usage tolerance, authoritative `message_end`, tool execution IDs, unknown event tolerance, queue changes, same-session report recovery, extension UI cancellation, and terminal lifecycle validation. `clear_queue` remains an RPC client opportunity; the supervisor does not need it because it does not submit queued steering/follow-up messages outside its two correlated prompt rounds.

Schema-8 diagnostic permissions, bounded report suffix retention, metadata-only successful telemetry, no-follow retention, one shared-tree mutator, role isolation, renewable liveness, no total runtime ceiling, and child resource allowlists remain unchanged. No historical telemetry was migrated or deleted.

### Codex aliases and Fastlane

The alias test no longer hard-codes obsolete Personal/Business fixtures as the deployed config. It validates the current config-driven alias set, real target loader registration, separate provider identity, cross-provider replay isolation, full stream sequences, terminal errors, abort, usage, provider thinking metadata, `endTurn`, raw stop reason, response ID, and additive fields.

Credential storage remains keyed by provider ID. Alias streams canonicalize only the active alias history and mark canonical Codex history as foreign inside that request. Other aliases remain foreign. Target pi-ai also keeps cached WebSocket state credential-specific.

Fastlane still requires a recognized Codex provider ID, `openai-codex-responses`, OAuth, an exact eligible model, a matching payload model, and no existing `service_tier`. GPT-6 Astra was not added because no provider evidence says it supports priority service tier. Existing footer glyph behavior is unchanged.

### Web search

The public contract remains exactly `web_search`, `web_code_search`, and `fetch_contents`. All 366 mocked tests pass under 0.84.1 and 0.85.1. Direct Gemini, Parallel, Exa, Tavily, and Firecrawl HTTP code does not inherit Pi provider retry/cache changes; its own bounded retries, cancellation, credential skipping, safety termination, degraded Tavily document, citation duties, schema-3 selection record, legacy reads, redaction, output bounds, and measured usage semantics remain local and unchanged.

## Package and CLI decisions

| Surface | Old source/version | Latest candidate | Final decision/result | Patch/resource state |
|---|---|---|---|---|
| Pi core | Bun-global 0.84.1 | 0.85.1 | installed 0.85.1 | published root SDK and stdio RPC verified |
| `pi-blackhole` | npm 0.4.5, patched source | 0.5.1 | installed exact 0.5.1 | percentage and nullable-header patches ported; stock source entry retained; new tool-output budget disabled |
| `pi-btw` | npm 0.4.1, patched | 0.4.1 | held and patch re-applied | native provider, runtime-only key, canonical auth, and cancellation preserved |
| Browser Harness | object-form npm 0.10.2, `skills: []` | published 0.11.0 | held 0.10.2 | 0.11.0 production-only install has no `tsx`; unreleased main/0.11.1 source fixes it but no npm artifact exists; skill filter preserved |
| Claude Bridge | npm 0.6.3, AskClaude disabled | 0.7.0 | held 0.6.3 | 0.7.0 passes 184 offline tests and target typecheck but adds substantial MCP/attachment/session behavior and first-use config notice writes; not required for core compatibility |
| CodeGraph SDK | exact 1.5.0 | 1.6.0 | installed exact 1.6.0 | platform bundle/private handler present; 70 tests pass |
| CodeGraph CLI | standalone 1.5.0 | 1.6.0 | installed 1.6.0 | installer instruction and prompt-hook refresh disabled during upgrade |
| context-mode | exact 1.0.169 | 1.0.169 | held | 216 tests, typecheck, fuzz, bundle anchors and three-tool surface pass |
| local Cursor | local commit, package 0.5.0 | upstream/npm 0.5.1 | merged upstream into local `main` at `c42ebcf6`; installed source reports 0.5.1 | resulting tree equals `upstream/main`; 440 tests, lint, format, build, SDK load, and live Proxy rotation pass |

The published Browser Harness 0.11.0 production fixture also auto-installs obsolete `@mariozechner/*` peers and has no local or hoisted `tsx`. No browser or daemon was started.

CodeGraph 1.6.0 advances extraction version 24 to 25. A disposable copy of the 1.5.0 index first proved backward readability. The user later approved and ran the real rebuild. Final status is complete under engine 1.6.0/extraction 25 with 396 files, 8,792 nodes, 30,455 edges, zero pending references, and no full reindex recommendation.

## Opportunity decisions

| Opportunity | Classification | Decision |
|---|---|---|
| write-free `--use-theme` startup | adopt now | equivalent first-frame behavior with explicit precedence and no settings write |
| footer UI-prompt state | adopt now | minimal boolean state, no prompt content, no timer/liveness change |
| strict constrained sampling `prefer` | test/defer | 0.84.2 removes the original nullable/closed-object blocker, but broad provider/routing serialization and accepted-argument parity need dedicated fixtures |
| `defaultTools` | defer | current tool surface is intentional; no context-cost migration requested |
| PowerShell tool | no local use | WSL remains a Bash environment |
| `expandPromptTemplates` | no local use | delegated/user content must not gain command expansion implicitly |
| native deferred/additional tools | defer | provider protocol support does not justify hiding active local tools or weakening child isolation |
| restored in-memory sessions | compatibility verified | synthetic restore and fork/session reads pass; no local external-session consumer needs code |
| narrow pi-ai imports | optional | no measurable local startup benefit established |
| native Mistral transport | no local use | no current Mistral consumer |
| terminal capability overrides | optional | keep auto-detection and current normal/fullscreen preference |
| GPT-6 Astra aliases | available after fresh load | do not add to enabled defaults, delegation, or Fastlane without policy/provider evidence |
| Blackhole 0.5.1 retained output budget | compatibility override | set to zero to preserve old behavior |
| CodeGraph extraction 25 rebuild | completed by user | final index is complete under engine 1.6.0/extraction 25 |
| Cursor 0.5.1 upstream merge | completed | merge commit `c42ebcf6`; local ancestry preserved and resulting source tree equals upstream |

## Validation matrix

| Scenario | Result |
|---|---|
| A: Pi 0.84.1, current head/current package code | delegated 489/489; CodeGraph 70/70; context-mode 216/216 plus check/fuzz; web-search 366/366; footer/Fastlane/theme/patch suites pass. Codex alias test exposed one pre-existing stale configured-alias expectation. |
| B: published Pi 0.85.1, unchanged code/packages | same suites pass except the same alias expectation, proving no target-specific regression |
| C: published Pi 0.85.1, required fixes and candidate Blackhole/CodeGraph | updated alias, theme, footer, wrapper, Blackhole patch, CodeGraph, strict production types, SDK/RPC load, compaction, and session compatibility pass |
| D: live exact candidates | fresh wrapper/real version, manifests, package source entrypoints, 60-tool all-active load, patch suite, routing, and offline RPC/SDK smokes pass |

Notable executed checks:

- Published 0.85.1 root SDK imports; normal client/plugin imports fail as source-only.
- Published 0.85.1 CLI reports 0.85.1 through `node --liftoff-only`.
- All 13 active local/package entrypoints load with no extension error through stdio RPC and the SDK; after `session_start`, 60 active tools are present.
- Wrapper: 6 tests; theme: 7 tests; footer and aliases pass. The final isolated and all-active PTY startup benchmarks exit cleanly and preserve settings bytes, mtime, and mode.
- Blackhole 0.5.1: typecheck and build pass against Pi 0.85.1; 1,551/1,553 tests pass before and after local patches. The same two untouched optional positive-idle-timeout Undici harness tests fail under Node 24.18.0. The configured timeout is absent, so the affected wrapper is inactive.
- Blackhole helpers apply to clean 0.5.1 and produce identical hashes on the second pass.
- BTW: 5/5 patch tests, including an offline custom provider child.
- Cursor: 440/440 final-tree tests plus lint, format check, build, Pi 0.85.1 all-active SDK load, and live Proxy rotation with 46 registered Cursor models. The temporary replacement returned health 200, then exited after its one-shot client closed.
- Claude Bridge 0.7.0 candidate: 184/184 offline tests and target typecheck, but held for scope/behavior reasons.
- Browser Harness 0.11.0: production-only, hoisted install proves missing `tsx`; no browser startup attempted.
- Disposable CodeGraph index and extension suite pass without touching the real index.
- Synthetic compaction gives one summary, preserves the large tool result, resumes inside one agent run, preserves final usage, and skips preparation after a terminating tool.
- Synthetic 0.84.1/0.85.1 session reads and missing-trailing-newline repair pass in both directions.

Failure classification:

| Failure | Class | Impact |
|---|---|---|
| Old alias test expected removed Personal/Business config | pre-existing local test drift | fixed by testing the deployed config, not caused by core |
| Historical five delegated routing expectations | historical baseline at an earlier snapshot | no longer reproduce at current HEAD; 489/489 now pass |
| Two Blackhole provider-stream tests | pre-existing package/Node 24 test-harness issue | optional timeout wrapper only; configured path inactive |
| First all-active PTY benchmark held the process open | local-change-induced cleanup failure | fixed by unrefing theme polling/retry timers; isolated and all-active reruns exit 0 |
| First TypeScript 6 strict invocations rejected the temporary config's deprecated `baseUrl` option | validation-harness configuration | rerun with `ignoreDeprecations: "6.0"`; all strict checks passed without changing source assertions |
| No real terminal visual matrix | missing environment/manual evidence | first-frame colors and fullscreen appearance require operator observation |
| No live paid-inference/delegate/browser smoke | intentionally unverified | Cursor startup/model discovery was exercised without inference; paid activity, user-browser mutation, and live delegates remain excluded |

## Changes made

- Upgraded the active Bun-global Pi core to 0.85.1.
- Upgraded `pi-blackhole` to exact 0.5.1 and ported both active patches.
- Disabled Blackhole's new retained tool-output budget to preserve behavior.
- Upgraded CodeGraph SDK and standalone CLI to 1.6.0; the user later rebuilt the real index at extraction 25.
- Replaced wrapper settings writes with `--use-theme` injection and exact argv/mode handling.
- Made explicit `--use-theme` selections immune to runtime override polling and unrefed theme retry/poll timers so non-interactive startup benchmarks can exit cleanly.
- Added the footer's privacy-safe waiting state and a strict footer null-stream guard.
- Made Codex alias tests follow the deployed config and cover additive target metadata.
- Merged Cursor upstream 0.5.1 into the configured local checkout at `c42ebcf6`, rebuilt its active distribution, and rotated the Proxy.
- Updated package, extension, patch, TODO, README, ADR, changelog, and rollback documentation.

## Limitations and remaining risks

1. A fresh real-terminal check is still needed for the first frame, Windows appearance changes, regular/fullscreen switching, selection/search/scrolling, `/reload`, `/resume`, and later `/settings` choices.
2. Browser Harness 0.11.0 remains held. Its published production daemon defect is real; the fix exists only in unpublished 0.11.1 source.
3. Claude Bridge 0.7.0 remains a separately validated behavior decision.
4. The user restarted Pi after the Cursor merge. The fresh process loaded the 0.5.1 extension, started the expected Proxy entrypoint, and returned HTTP 200 from its health endpoint.

## Operator checks

Start a fresh shell and process after this session ends:

```bash
command -v pi
readlink -f "$HOME/.bun/bin/pi"
pi --version
node -p "require('$HOME/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/package.json').version"
node -p "require('$HOME/.bun/install/global/node_modules/@earendil-works/pi-agent-core/package.json').version"
node -p "require('$HOME/.bun/install/global/node_modules/@earendil-works/pi-ai/package.json').version"
node -p "require('$HOME/.bun/install/global/node_modules/@earendil-works/pi-tui/package.json').version"
node -p "require('$HOME/.bun/install/global/node_modules/@earendil-works/chord/package.json').version"
```

All version lines must be `0.85.1`. Then verify the settings checksum is unchanged across an ordinary startup, confirm explicit `pi --use-theme light` and `pi --use-theme dark`, and observe one Windows appearance change. Use `/reload`, `/resume`, and `/settings` to confirm the explicit/run-time/saved precedence described in ADR 0018.

For auth readiness, run only the safe documented form if a refresh is acceptable:

```bash
pi auth check --provider <provider> --no-refresh
```

Do not add `--credentials` or use credential-print commands for this check.

## Rollback

Private rollback snapshot:

```text
/home/gc/.pi-upgrade-backups/pi-0.84.1-to-0.85.1-20260906T163145Z
```

It contains six mode-0600 archives plus `SHA256SUMS.json`, under a mode-0700 parent. It captures the complete 0.84.1 Bun `@earendil-works` tree and global manifest/lock, patched Blackhole 0.4.5, patched BTW 0.4.1, package metadata, runtime settings/config/wrapper, and CodeGraph CLI 1.5.0.

The later Cursor merge has a separate private snapshot:

```text
/home/gc/.pi-upgrade-backups/cursor-0.5.0-to-0.5.1-20260906T173929Z
```

It contains a complete Git bundle, the prior 0.5.0 built distribution and manifest, pre-merge status, and checksums. To reverse only the committed Cursor merge while preserving history, stop the Cursor Proxy, run `git -C /home/gc/development/pi-extensions-cursor revert -m 1 c42ebcf6ba20a3372d64b2641670c69f0e046529`, rebuild `@schultzp2020/pi-cursor`, and start a fresh Pi process. Do not reset the branch.

Stop fresh Pi processes and package workers before rollback. Do not remove sessions, browser profiles, Blackhole memory, CodeGraph indexes, telemetry, or caches. The real CodeGraph index now uses extraction 25; restoring only the 1.5.0 CLI does not downgrade that derived index.

Verify the snapshot:

```bash
backup=/home/gc/.pi-upgrade-backups/pi-0.84.1-to-0.85.1-20260906T163145Z
node - "$backup" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const root = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'SHA256SUMS.json'), 'utf8'));
for (const [file, expected] of Object.entries(manifest.files)) {
  const body = fs.readFileSync(path.join(root, file));
  const actual = crypto.createHash('sha256').update(body).digest('hex');
  if (actual !== expected.sha256) throw new Error(`checksum mismatch: ${file}`);
}
console.log(`verified ${Object.keys(manifest.files).length} rollback archives`);
NODE
```

Restore runtime packages and config:

```bash
backup=/home/gc/.pi-upgrade-backups/pi-0.84.1-to-0.85.1-20260906T163145Z
core=$HOME/.bun/install/global
rm -rf "$core/node_modules/@earendil-works"
tar -xzf "$backup/bun-core-global-0.84.1.tar.gz" -C "$core"

pkg=$HOME/.pi/agent/npm
rm -rf "$pkg/node_modules/pi-blackhole" "$pkg/node_modules/pi-btw"
tar -xzf "$backup/pi-blackhole-0.4.5-patched.tar.gz" -C "$pkg/node_modules"
tar -xzf "$backup/pi-btw-0.4.1-patched.tar.gz" -C "$pkg/node_modules"
tar -xzf "$backup/pi-packages-metadata.tar.gz" -C "$pkg"
tar -xzf "$backup/runtime-config.tar.gz" -C "$HOME/.pi"

rm -rf "$HOME/.codegraph/versions/v1.6.0"
rm -f "$HOME/.local/bin/codegraph"
tar -xzf "$backup/codegraph-cli-1.5.0.tar.gz" -C "$HOME"
```

Verify rollback through the real executable, not updater text:

```bash
PI_THEME_WRAPPER_DISABLE=1 pi --version
node -p "require('$HOME/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/package.json').version"
node -p "require('$HOME/.pi/agent/npm/node_modules/pi-blackhole/package.json').version"
codegraph --version
```

Expected values are Pi 0.84.1, Blackhole 0.4.5, and CodeGraph 1.5.0. The restored settings keep the pre-upgrade deployed `openai-codex-cgpt3` choice.

Repository source rollback is safe only if no later edit overlaps these upgrade paths. Review `git diff` first. For unchanged paths, restore tracked modifications from `2d27aaa6fd2c67c84c73742973760a0243cd2d7f`, remove only files introduced by this upgrade, then re-extract `runtime-config.tar.gz` to recover the pre-existing settings and wrapper bytes. Never use `git reset`, stash, or broad cleanup as rollback.
