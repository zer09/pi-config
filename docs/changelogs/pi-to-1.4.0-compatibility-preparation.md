# Pi 1.4.0 compatibility preparation

**Prepared on a separate branch/worktree, not deployed.** The independent-review findings are repaired under the user-approved queue-display policy. Required offline checks and both final accumulated reviews pass against exactly **Pi 1.4.0**. Earlier readiness claims missed two acceptance cases and are superseded by the remediation evidence below. The candidate remains unstaged; live provider, native Claude executable, platform and visual acceptance are not established.

## Location and verified baseline

| Item | Value |
| --- | --- |
| Original | `/home/gc/.pi`, `master` |
| Base and fetched `origin/master` | `b7bd8eec46f3d7ebd0e74d077cf245152bc489e0` |
| Branch | `compat/pi-config-1.4.0-eZjOuk` |
| RUN | `/home/gc/worktree/pi-config-1.4.0-eZjOuk` |
| Worktree | `RUN/worktree` |
| Isolated runtime | `RUN/host/node_modules/@earendil-works/pi-coding-agent` |
| Isolated manifests/locks | `RUN/host/package.json`, `RUN/host/package-lock.json`, `RUN/host/node_modules/.package-lock.json` |
| SDK / executable | `dist/index.js` / `dist/bundle/cli.js` under the isolated runtime |
| Runtime / compiler | Node 24.18.0 / TypeScript 6.0.3 |

The original tracked tree was clean, with no staged changes or local-only commits. Relevant untracked paths, including the local Outpour skill, were recorded in `RUN/protection-before.json`, not transplanted. `lastChangelogVersion` remains **1.1.0**; it does not identify the installed dependency graph.

The live wrapper resolves to `/home/gc/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`. Its bytes equal the official **1.1.0** archive; that archive's bundle independently prints `1.1.0` inside the sandbox. Bun-global canonical Pi packages are 1.1.0, with unused legacy-scope 0.73.1 packages also present. The live extension cache instead contains canonical 1.3.0 peers and legacy aliases to 1.1.0. None of those live packages was updated by this preparation.

Official [v1.4.0](https://github.com/earendil-works/pi/releases/tag/v1.4.0) resolves to `4a080252f06caf63a525d7873c5d94d3c23887e0`, published October 21, 2026. Registry archives passed SHA-512 SRI verification. Node satisfies `>=22.19.0`. All eleven installed Pi-family manifests, including Harness's four legacy aliases, resolve to **1.4.0**. Published exports, declarations, entrypoints and consumer bindings were checked. No force, blanket overrides or peer bypass was used.

## Required fixes and preserved contracts

- **Startup and footer:** discriminate user/custom `before_agent_start` and preserve one wall-clock timer through `agent_settled`, including queued work. The user approved replacing numeric counts with the existing glyph plus `queued`, shown in the full layout only when `ctx.hasPendingMessages()` is true. Unadmitted inputs are not queued. Dequeue, immediate resubmission, overlapping admissions and retained SDK queues need no local counter or timing guess. [ADR 0018](../adr/0018-write-free-theme-startup-and-ui-prompt-state.md) records both approved decisions.
- **Rejected calls:** canonical `toolCall` parser failures, parseable length-stopped calls and schema rejections earn no execution, structural-progress or accompanying report credit. Execution counts require a matching end with finite nonnegative `durationMs`, including zero; active starts remain separate telemetry. Tool-bearing message/report credit waits until actual outcomes are known. Empty follow-ups cannot rescue rejected-only progress. Valid siblings, coercion, zero-duration success/thrown errors and later corrections still work. No additional raw argument/error/message buffer is retained.
- **Themes:** both schema references now use `https://pi.dev/schemas/theme.schema.json`. Palettes and wrapper implementation are unchanged. Schema/loading, explicit selection, custom paths, synthetic Windows detection, bypasses, inherited markers and settings non-persistence pass.
- **Provider API audit:** active consumers do not reference removed `AssistantMessageFrame` APIs, `telemetryContext`, `getPiUserAgent`, boolean `resolveTranscriptTools`, `anchorsAdditions`, or removed experimental client/plugin/Chord exports. No compatibility shim or telemetry activation was added. Harness and Bridge startup hooks consume shared system-prompt fields, not an unconditional user `prompt`.
- **Inherited 1.2–1.4 behavior:** busy startup, concurrent UI prompts, restored/default-active tools, fully qualified model ambiguity, old-model thinking isolation, final usage and nullable identity headers pass focused target-bound checks. No current route selects OpenCode; no route was restored to test it.

Models, accounts, routes, thinking levels, regular TUI, cache warming off, websocket-cached transport, optional Fastlane defaults, quiet controls, worker budgets and disabled mid-run compaction remain unchanged. The stdout-cap acknowledgement fix, bounded persisted-history validation, schema-9 privacy, cancellation and profile-controlled Oracle policy remain intact.

## Selected packages and active dependencies

Versions below are the observed installed baseline, captured registry latest, and tested selection. Runtime dependency changes and exact locks remain under RUN, outside tracked source.

| Package | Old | Latest captured | Selected | Reason / patch |
| --- | --- | --- | --- | --- |
| Pi coding-agent / AI / agent-core / TUI | 1.1.0 executable graph | 1.4.0 | **1.4.0** | Exact target; cache discrepancy above |
| pi-blackhole | 0.5.13 | 0.5.15 | **0.5.13** | Hold: newer tail/projection/supersession behavior requires patch redesign; retain all three guards |
| pi-btw | 0.7.1 | 0.8.0 | **0.8.0** | Parent-tool delta fix; port only credential cancellation signal |
| pi-browser-harness | 0.11.0 | 0.13.0 | **0.11.0** | Hold: newer header tools expand inventory; retain `skills: []` |
| @schultzp2020/pi-cursor | 0.5.3 | 0.5.3 | **0.5.3** | Latest, deprecated upstream |
| pi-claude-bridge | 0.9.2 | 0.9.3 | **0.9.3** | Stock source; ordering patch remains retired |
| Claude Agent SDK / Linux x64 | 0.3.296 | 0.3.309 | **0.3.309** | Exact SDK/native parity; native executable not run |
| @bufbuild/protobuf | 2.15.0 | 2.16.0 | **2.16.0** | Cursor consumer and upstream wire tests |
| @modelcontextprotocol/sdk | 1.30.1 | 1.32.1 | **1.32.1** | Bridge consumer subpaths pass; unused root-export limit below |
| zod | 4.6.5 | 4.6.7 | **4.6.7** | Changed collection-size and consumer tests |
| typebox | 1.3.27 | 1.4.3 | **1.3.27** | Host-owned exact dependency |
| sharp | 0.33.5 | 0.35.5 | **0.33.5** | Latest is outside Harness's declared range |
| ws | 8.22.0 | 8.22.0 | **8.22.0** | Unchanged |
| cc-session-io | 0.4.0 | 0.4.0 | **0.4.0** | Unchanged |
| change-case | 5.4.4 | 5.4.4 | **5.4.4** | Unchanged |

Pi-owned Anthropic API SDK remains 0.129.0. Active local extensions require no independent production dependency update. Retired dependency trees were excluded. Test-only tools are not a global tooling upgrade.

[Blackhole's three patches](../../agent/pi-blackhole/LOCAL_PATCHES.md) still apply in documented order and execute through `./index.ts`, not its untouched bundle. [BTW's new 0.8.0 helper](../../agent/pi-btw/LOCAL_PATCHES.md) checks whole-package identity, integrity, isolation, links and drift, with byte/mtime idempotence. SSH and child-extension features remain unconfigured. Each package transaction preserved sibling patches and unrelated source/link/mode/mtime state.

[Bridge 0.9.3](../../agent/pi-claude-bridge/LOCAL_PATCHES.md) observes summary association without taking over native or Blackhole compaction. Actual Blackhole ownership makes zero Bridge requests; native split summaries make two, and failed history stops after one. AskClaude stays disabled. Child allowlisting, replay/rollback, project-config refusal and other-route survival pass. Trusted-repository restrictions and ordinary Claude persistence remain accepted exceptions. The provider entry does not sandbox project `.claude` hooks.

## Final inventories and checks

Normal startup loads **seven local entries plus five package entries**, with zero extension errors. Factory registration alone exposes seven extension tools; ordinary session startup adds forty browser tools without launching a browser. Full parent registry: **55 tools, 51 active**, excluding native `find`, `grep`, `ls`, `powershell` from activation. There are 24 production extension commands, three prompt templates and two custom themes. Skill provenance is 38 local descriptions plus BTW's package skill; Harness exports no package skill.

Runtime child order remains `delegated-pi-loop`, `openai-codex-aliases`, `web-search`, `fastlane`, then provider-only `claude-bridge-provider/delegate-entry.ts`. Catalog order remains aliases, then Bridge. The exact seven active child tools are **read, bash, edit, write, web_search, web_code_search, fetch_contents**. Normal load, reload, resume and tree navigation retain these boundaries. Synthetic old sessions naming retired tools cannot reactivate them; default-inactive new tools stay inactive. Inert retired-path sentinels prove exclusions work with entries present. CodeGraph/context-mode remain unloaded, with no replacement feature.

| Check | Result |
| --- | --- |
| Full serialized delegated suite / strict target check | **1,632/1,632**; 58 files, zero diagnostics |
| Current focused monitor checks | **113/113**, including **21** exact-target cases |
| Exact-target startup/theme / wrapper / theme-sync | **19/19**, **7/7**, **16/16** |
| Footer, aliases and Fastlane script suites | Pass; no invented aggregate test count |
| Web-search / mocked GitHub CI | **368/368**, **77/77** |
| Blackhole guards / worker transport / lifecycle | **11/11**, **13/13**, **4/4**; stock and patched strict types pass |
| Blackhole projection | **162** cut/cancel comparisons plus retained pairing, omission, raw-history and compiler assertions |
| BTW guards / history-restart / upstream | **6/6**, **6/6**, stock and patched **173/173** each |
| Bridge upstream / provider entry / installed activation / target child | **330/330**, **16/16**, **3/3**, **2/2** |
| SDK encoder / installed ownership-terminal | **5/5**, **5/5** |
| Cursor / MCP / Zod / protobuf wire | **141/141**, **319/319**, **194/194 + 26/26**, **281/281** |
| Combined SDK / unbundled CLI-RPC / bundled CLI-RPC | **3/3**, **6/6**, **6/6**; fake turns, persistence, shutdown and no-inference children |
| Final alias-header seams / native summary seams | **3/3**, **4/4** |

Passed checks include final usage, signed-thinking isolation, null header deletion, missing terminal events, split-turn instructions, summary failure/cancellation, queued continuation, replacement, shutdown and concurrent mocked interactive prompts. Wrapper checks preserve settings bytes/mtime/mode. All executed test transports were fake and OS-network-denied. Package gates from A–E remain source-matched evidence, not a claim that every suite was rerun during remediation.

**Independent-review corrections:** R1's new rejection cases failed before repair; final intermediate and settled assertions pass. No settled false success was demonstrated before the repair. Both R1 reviews passed. R2 initially stopped without edits because exact counts could not distinguish dequeue from overlapping admission through the public API. The user approved the pending-state indicator instead. Six new registered-action cases failed before repair and now pass, covering dequeue, immediate/multiple-message resubmission, delayed admission and both overlap orders. Existing timer and session-count assertions remain. Final SDK and both CLI/RPC suites executed refreshed current extension copies: 352 source/copy hash matches, with the host graph unchanged. Earlier failed tests, the blocked R2 result and corrected fixture/timeout diagnostics remain recorded.

**P3 coverage correction:** The oversized-message test now completes tool lifecycles and proves turn-end argument traversal with a small valid control. It separates message credit from tool/turn-summary credit and retains all six payload classes plus recovery. The incomplete-lifecycle control fails as expected. Fresh checks pass **113/113** focused cases, **1,632/1,632** maintained cases and **58 files with zero diagnostics**. Both P3 reviews pass. Production code is unchanged. Earlier SDK/CLI and source-copy snapshots precede this test-only edit; those suites were not rerun. Evidence: `RUN/reports/p3-bounds-handoff.md` and `RUN/reports/remediation-review-status.md`.

**Failed or unavailable checks remain explicit:** Bridge's additional whole-source strict experiment reports 14 diagnostics on old 0.9.2 and 15 on 0.9.3; upstream configured compilation and strict integration boundaries pass. Both MCP versions reproduce missing unused package-root exports; all active consumer subpaths resolve. Protobuf's compiler-dependent `binary.test.ts` could not run without `upstream-protobuf`; the public SDK implementation suite is unavailable. No actual Windows/macOS, visual terminal/browser, native Claude executable, real-provider or billing acceptance ran. Blackhole's inherited `showPreCompactionMessage` loader limitation remains; no fourth patch was added. Corrected fixture failures and failed investigation roles remain recorded, not relabeled passes.

## Cost effects with unchanged policy

- Codex default context: **272,000 → 500,000**. Blackhole at 65%: **176,800 → 325,000**. Native 16,384-token reserve: **255,616 → 483,616**. These are trigger calculations, not output budgets.
- Bridge Haiku 5.5 context: **200,000 → 1,000,000**. Blackhole at 65%: **130,000 → 650,000**. Model IDs/order and account choices do not change.
- Native summary output no longer has the old explicit history/prefix/branch caps. Longer output can cost more. Blackhole's fixed budgets, 180,000 fallback and percentage policy are unchanged. Bridge already omitted forwarding the old `maxTokens`, so cap removal alone does not prove a new Bridge-specific charge.

## Isolation and evidence

Execution uses `RUN/offline.mjs`: sanitized HOME/config/cache/agent/session state, hidden original/live installation, network denial and private RUN-backed `/tmp`. Downloads are separate. Public upstream retrieval used authenticated read-only `gh`, including BTW and dependency source downloads; no credential refresh/export was performed. No test used real inference/search, live delegated provider execution, browser launch, workflow calls, original sessions, indexes or diagnostic uploads.

The 24,745-file protection audit confirms unchanged original HEAD, branch and protected installed Pi and extension-package trees. **Outside changes occurred:** original settings changed `hideThinkingBlock` from false to true, then returned to baseline bytes while retaining a changed mtime. Bun-global `package.json` and `bun.lock` remain byte-different. Original `.git/index` bytes also changed; its cause is not established, although staged and unstaged tracked diffs are empty. The old strict raw-index audit failed on that mismatch. The current audit records the mismatch instead of claiming byte identity. No outside change was copied or reverted. Do not describe the entire original/live tree or index as unchanged.

Initial investigations violated read-only/RUN-only scratch constraints: temporary sources/checkers, npm metadata cache and harness logs escaped RUN. Known logs include `/tmp/pi-bash-23b30ece6c428871.log`, `/tmp/pi-bash-5fda2d9944a7e9fc.log`, and `/tmp/pi-bash-a2cabc02b184b581.log`; one further minified-bundle spill was not located. Final review also produced `/tmp/pi-bash-4917449e6a6bd940.log` and `/tmp/pi-bash-dc0ed3a53bb3fd97.log` from source-diff inspection. Independent review, fresh verification and final remediation review added eight more reported harness-output spills, listed in `RUN/reports/remediation-review-status.md`. No credentials were reported in these spills. Two solution-a runs remained failures. The user approved continuation from completed evidence and required subsequent delegates to use only `openai-codex`. Acceptance test processes stayed isolated; review-output spills still violated RUN-only artifact placement. These deviations are not erased by passing tests.

Detailed evidence remains under RUN: `protection-before.json`, `protection-after.json`, `reports/parent-final-audit.json`, `registry-inventory.json`, `increment-{a,b,c,d,e}-handoff.md`, `commands.jsonl`, `e-command-table.md`, `e-inventory.md`, `e-source-final.json`, and `logs/`. Report names after the first three resolve under `RUN/reports`. They contain exact commands/exits, full inventory names, SRIs, source hashes and corrected diagnostics. Current remediation evidence is `RUN/reports/r1-monitor-handoff.md`, `r2-footer-handoff.md`, `r2-footer-approved-handoff.md`, `r2-approved-final-source.json`, `r2-approved-acceptance-audit.json`, and `remediation-review-status.md`; all report names resolve under `RUN/reports`. New combined outputs live under `RUN/reports/r2-approved-generated/`, preserving previous E outputs. The parent additionally ran `parent-baseline-version` and the earlier `parent-bundled-cli-rpc` through the same launcher. Root-lock SHA-256: `539dace9afc37ed19e8b055202e5324e75a921a7c57b3e8d66f317172e6c602e`.

## Later actions, not executed

1. Review this unstaged branch and reconcile outside settings/global-package changes before separately authorizing integration.
2. Separately authorize exact Pi installation, active dependency installation and guarded patch deployment. Copying settings alone does not install Pi or deploy patched bytes; preserve RUN and its locks until then.
3. Finish active children and restart fresh parent, child and BTW sessions after deployment. Run separately authorized real-provider and visual checks. Do not reload the live session as part of preparation.

Optional recommendations, **not implemented**: report MCP's unused root-export packaging gap upstream; fix Bridge's upstream strict typing separately; perform platform/visual acceptance before deployment. No optional feature adoption is included.
