# Pi 0.99.2 compatibility preparation

**Implemented in an isolated worktree, not deployed.** Exact core and package upgrades are prepared with the existing local patches preserved. Live/visual acceptance remains untested.

## Baseline and candidate

- Original: `/home/gc/.pi`, `master`, `git@github.com:zer09/pi-config.git`.
- Actual HEAD and fetched `origin/master`: `9bb96132e87ad794f532ebf8926f455dc2959d2d`; deployed Pi is 0.87.1.
- RUN: `/home/gc/worktrees/pi-0992-20261001T105108Z-57871`; source worktree: `RUN/worktree`.
- Isolated runtime: exact Pi 0.99.2, Node 24.18.0; Node requirement `>=22.19.0`.
- Official `v0.99.2` commit: `005af57d88ee23b33778f343a9595b32e67ff788`. Coding-agent npm integrity: `sha512-6R1BZ2N77CrVcGf3eC2KovTz1Q4RYiAeydvVWQT546N2fi1nBc81aURlbOZCgruWoW9VY/UrLzDynF4YTolpoA==`.
- Actual intervening tags are 0.99.0, 0.99.1, and 0.99.2; there are no 0.88–0.98 tags in the fetched source.

## Package upgrades

| Package | Original pin / resolved | Selected exact version | Decision |
| --- | --- | --- | --- |
| Pi core | 0.87.1 installed | 0.99.2 isolated | Requested target |
| Blackhole | 0.5.9 / 0.5.9 | 0.5.10 | Upgraded; all three local patches ported |
| BTW | 0.6.1 / 0.6.1 | 0.7.0 | Upgraded; cancellation patch ported; child extensions remain inactive |
| Browser Harness | 0.11.0 / 0.11.0 | 0.11.0 | Already latest in checked metadata; skill filter preserved |
| Claude Bridge | 0.8.0 / 0.8.0 | 0.9.1 | Upgraded; prompt-order patch ported |
| Cursor | unpinned / 0.5.2 | 0.5.2 | Already latest in checked metadata; exact pin added |

Claude Agent SDK and its installed Linux package use exact 0.3.284, the minimum allowed by Bridge's `^0.3.284`. Archive SRI, installed bytes, runtime manifests, and both locks were checked. Exact-file replacement preserved unrelated dependency bytes and mtimes; no unrelated transitive upgrades or npm pruning. CodeGraph/context-mode production dependencies are unchanged.

## Minimal maintained changes

- `agent/settings.json`: exact package pins; exclude default `builtin:mcp`, `builtin:llama.cpp`, `builtin:codemode`, and `builtin:tool-search`.
- `agent/extensions/delegated-pi-loop/protocol.ts`: treat handled input as the existing rejection case, not assignment acceptance. Keep started, queued, and legacy success responses unchanged. Two focused tests cover rejection/fallback and acceptance.
- New version-specific patch helpers and focused tests under `agent/pi-blackhole/`, `agent/pi-btw/`, and `agent/pi-claude-bridge/`. Old helpers/tests remain intact. `.gitignore` exposes the new Blackhole/BTW maintained files.
- Prepend package-local patch records and update this report and `docs/CHANGELOG.md`.

Keep `cacheWarming: "off"`, Browser Harness's `skills: []`, `openai-codex/gpt-6.1-sol`/`high`, enabled models, routing, child isolation, compaction thresholds/budgets, quiet worker settings, themes, and the write-free wrapper. `lastChangelogVersion` remains `0.87.1`. No BTW child-extension sources/configuration, new tools, login flows, or workflows were enabled.

## Ported local patches

All helpers ran with explicit disposable package roots under `RUN/tmp`, outside node_modules. They verify version/source and refuse drift or shared/linked targets before writes. Reapplication preserves bytes and timestamps. No live helper ran; no new live entrypoint was added.

| Patch | Executed helper under `agent/` | Evidence |
| --- | --- | --- |
| Blackhole percentage | `pi-blackhole/reapply-compact-after-percent-patch-0.5.10.mjs` | Same accepted transformation; source entrypoint selected |
| Blackhole nullable headers | `pi-blackhole/reapply-nullable-provider-headers-patch-0.5.10.mjs` | Same accepted transformation; target declarations compile |
| Blackhole context edits | `pi-blackhole/reapply-context-edit-compaction-patch-0.5.10.mjs` | Same accepted transformation; projected summary, raw history unchanged |
| BTW credentials | `pi-btw/reapply-model-runtime-patch-0.7.0.mjs` | Only adds `{ signal: ctx.signal }`; cancellation obeyed |
| Bridge prompt ordering | `pi-claude-bridge/reapply-transcript-order-patch-0.9.1.mjs` | Unknown sections after built-ins in stable replay order; exact capture preserved |

## Focused results

Exact commands, cwd, exit codes, and failed attempts are in `RUN/reports/commands.jsonl`; labels below identify logs. Run fixture drivers only through `node RUN/run-command.mjs LABEL offline COMMAND ...`.

| Final package check | Result / exit |
| --- | --- |
| `blackhole-focused-corrected` | 8/8 / 0; application, idempotence and refusal guards |
| `blackhole-typecheck`; `blackhole-lifecycle-0510` | Stock/patched 123 files each, zero diagnostics; 1/1 manifest-discovered settled compaction / 0 |
| `btw-port-real-credential-fixed`; `btw-regression-six` | 5/5 port/cancellation and 6/6 established context/summary/restoration/restart checks / 0 |
| `btw-target-smoke` | Both production files stock/patched, zero diagnostics; zero BTW tools, unchanged commands/events, default child sources `[]` / 0 |
| `bridge-port-timestamped`; `bridge-transcript` | 7/7 helper checks and 4/4 real-Pi/fake-SDK ordering tests / 0 |
| `bridge-typecheck` | Stock/patched transcript source against target types, zero diagnostics / 0 |
| `bridge-combined-load`; `bridge-combined-cli-config` | Final combined SDK/CLI: 14 extensions, 62 active tools, 25 commands, 38 skills, 2 themes; inventories unchanged / 0 |
| `bridge-cli-version`; `bridge-final-check` | Exact 0.99.2; exact package/SDK pins and preserved unrelated files / 0 |

Earlier checks passed: protocol guard/fallback regressions, 51-file delegated and 130-file production type checks, 695 persistence/resume checks, Codex aliases/footer/Fastlane, wrapper/theme, github-ci, CodeGraph, context-mode, and web-search suites. The earlier full delegated suite was 1,457/1,460 (exit 1): one baseline instruction expectation and two supervisor assertions matching trusted artifact paths under the required RUN. Those assertions were not disabled. The user narrowed follow-up testing; no full provider/delegated matrix was repeated.

Initial package harness failures were corrected without weakening behavior/security assertions: evidence paths, version-mutation JSON, SDK import-only resolution, transcript timestamps, and hidden-lock shape. Historical failed commands remain recorded. Final focused checks passed. All three package increments completed the approved implementation/review flow. All nine independent reviews passed, including three final reviews of the accumulated diff. No blocking findings remain.

Limits: six deliberate missing-model warnings come from the empty isolated catalog. Live catalogs/auth, interactive/browser behavior, broader package lifecycle races, nested-event acceptance, `/reload`, and exhaustive result-detail serialization remain unverified. No full Bun-host compatibility claim. New built-in execution paths were not exercised.

## Isolation and stop point

Package/runtime checks used sanitized environments, fake providers/transports, and `bwrap --unshare-net`. Registry downloads alone used installation mode with scripts disabled. All runtimes, archives, caches, temp, test state, reports, and generated indexes remain under RUN outside source. No live provider, browser, search, workflow, auth refresh, telemetry upload, or real-session migration ran. Approved delegate model inference was separate from runtime acceptance.

Private original snapshots are rechecked at handoff. Changes remain unstaged in the detached worktree. No live installation/cache update, stage, commit, push, integration, or deployment ran. Rollback planning is omitted at the user's request. Merging these pins does not upgrade the global Pi executable or deploy ignored patched package bytes; those actions need separate authorization.
