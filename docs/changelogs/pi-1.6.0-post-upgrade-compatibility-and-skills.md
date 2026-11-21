# Pi 1.6.0 post-upgrade compatibility, package repairs and skill maintenance

Date: 2026-11-21. Branch `maintenance/pi-1.6.0-repair-6xFC4m`, base `afe1086`. Private evidence: `$HOME/worktree/pi-1.6.0-repair-6xFC4m/` (`RUN`), outside tracked files.

**Verdict: repairs installed, with limitations.** Preparation ran first; the user then approved activation (see Installation).

## Current state

The repaired package set is installed and verified: Blackhole 0.5.19 (`a78ea6b2…`), BTW 0.8.1 (`16f65339…`), Browser Harness 0.19.2 (`f6922a55…`) and stock Bridge 0.13.0 (`84242281…`). Every installed version satisfies its pin, so Pi does not reinstall stock packages at startup. A fresh Pi start after activation kept these identities. See Installation below.

## How it got here

1. **The user upgraded before this task.** Pi core 1.6.0 was installed globally through Bun (`~/.bun/install/global`). Commit `afe1086` pinned `pi-blackhole@0.5.19`, object-form `pi-browser-harness@0.19.2` with `skills: []`, and `pi-claude-bridge@0.13.0`. `pi-btw@0.8.1` was unchanged. `lastChangelogVersion` stays `1.6.0`.
2. **At first, the installed files were older than the pins.** The 14:03 to 14:06 package commands ran `npm install <name>` without a version. npm kept each `^` range already saved in `agent/npm/package.json`, so nothing changed. The cache held the verified repaired Blackhole 0.5.18 (identity `94240a11…`), repaired Harness 0.19.1 (`bdbd6888…`), patched BTW 0.8.1 (`btw.ts` `7ad87e46…`) and stock Bridge 0.12.0. Pi core 1.6.0 and its `pi-ai`, `pi-agent-core` and `pi-tui` dependencies matched the registry tarballs byte for byte.
3. **The risk that set the order of work.** Pi 1.6.0 reinstalls any npm package whose installed version does not satisfy its pin (`resolvePackageSources` in `package-manager.js`). A fresh online start in that state would have installed **stock** Blackhole 0.5.19 and Harness 0.19.2, which lack the still-required repairs.
4. **This task prepared, tested, then installed.** The ported helpers, repaired packages, rebound tests and skill/CLI candidates were prepared in this branch and under `RUN`. After the user's approval they were installed (see Installation); the pre-activation sections below are kept as the preparation record.

## Compatibility findings

| Area | Finding | Evidence |
| --- | --- | --- |
| Read-only render | No active local renderer mutates render output. Footer returns a fresh array; delegated and web-search renderers reuse `Text`. Blackhole's settings text field pushes onto `Editor.render()` output, but `Editor` builds a new array each call, so this is a type-level issue only. | Source audit; strict checks show the same 8 pre-existing diagnostics on Pi 1.5.2 and 1.6.0 declarations (`RUN/reports/tsc-ext-*.txt`). |
| Lifecycle/RPC | No local workaround depends on duplicate startup. RPC `new_session` with the full parent config succeeds with no `extension_error`. | `RUN/reports/rpc-smoke.json`. |
| `pi.exec` | github-ci and theme-overrides already reject non-zero or killed results. The macOS appearance probe ends up with the same outcome as before. | Source audit; extension suites pass. |
| Aborted batches | Unstarted calls now emit `tool_execution_start` and an error end without `durationMs`. The delegated monitor's duration-bearing rule excludes them from execution counts, progress and completion. | New regression in `tests/monitor-target.test.ts`, against the real Pi 1.6.0 agent loop. |
| `get_last_assistant_text` | Not used by the delegated loop. | `grep`. |
| Models | GPT-6.2 Sol 500K and Astra 272K; `off` is unavailable and `xhigh` is valid. At `compactAfterPercent: 0.65`, the effective thresholds are 325,000 (Sol) and 176,800 (Astra). The 180,000 fallback is unused when a window is declared. Worker models `gpt-6.1-terra` remain in the catalog. | pi-ai 1.6.0 `openai-codex.json`. |
| Proxies | OpenAI-compatible providers other than OpenAI now default to the `system` role. OrcaRouter receives `system`; CommandCode already disabled the developer role. No flag was added. | pi-ai 1.6.0 `openai-completions`. |
| Anthropic threads | No custom provider uses `api.anthropic.com`. Claude traffic uses the Bridge SDK. Unaffected. | `models.json`. |
| Find tool | No skill or doc example uses Pi-native `find` path patterns. | Skill audit. |

## Package repair ledger

| Package | Before activation | Pinned | Upstream equivalence | Candidate | Validation |
| --- | --- | --- | --- | --- | --- |
| Blackhole | 0.5.18 repaired, `./index.ts` | 0.5.19 | No `context_edit` handling, no `compactAfterPercent`, no nullable header type. Stock fails 8/9 context and 3/5 percentage checks. | Three helpers ported to 0.5.19. Two context-edit anchors changed upstream (`ExtensionContext` import, `isProviderConversationEntry`); the repair delta is otherwise line-identical to 0.5.18. Identity `a78ea6b2…`, 147 files, `./index.ts`. | Guards 10/10, behavior 5/5, workers 25/25, context 9/9 with stock Bridge 0.13.0, zero SDK calls. |
| Harness | 0.19.1 repaired | 0.19.2 | Recipe files unchanged; stock 0.19.2 still reproduces snapshot borrowing on all three routes. | Helper rebased to the 0.19.2 identity (`40bb3636…`, 128 files). Delta identical to installed 0.19.1. Identity `f6922a55…`. | Helper guards 7/7; recipe snapshot 18/18 repaired; stock reproduces the defect. |
| BTW | 0.8.1 patched | 0.8.1 | Stock ignores cancellation on Pi 1.6.0. | Unchanged helper; installed bytes already correct. | 6/6 on Pi 1.6.0. |
| Bridge | 0.12.0 stock | 0.13.0 | Same Pi API use (`on`, `registerProvider`, `getAllTools`, `sendMessage`). AskClaude removed upstream. Forwards Pi's whole system prompt (new `systemPromptPreset`, default `claude_code`). User-only setting sources unchanged. Dependency pins unchanged. | Stock 0.13.0, identity `84242281…`. | Provider-only wrapper tests pass; Blackhole summary ownership with Bridge present; RPC registration. |

The candidate graph (`RUN/final/npm`) changes only these three packages against the live graph: no dependency additions or removals. It was built from a copy of live `agent/npm` with `npm install <exact pins> --legacy-peer-deps --ignore-scripts`, then repaired package directories replaced the stock Blackhole and Harness directories.

Upstream behavior accepted with 0.5.19: `custom_message` is no longer observed; transient worker failures use a 5-minute cooldown (`cooldownMinutesTransient`) instead of `cooldownHours` on the Gemini fallbacks; the config file's `showPreCompactionMessage` is now honored (the wrapper variable still wins); priority reflections and yield tracing are new. Configuration is unchanged.

## Tests

All execution used `RUN/bin/sbx`: bubblewrap with no network, a hidden real home, a cleared environment, synthetic agent/Claude directories and `PI_OFFLINE=1`. Runtimes: Node 26.13.1, isolated Pi 1.6.0 at `RUN/pi160` (byte-identical to the installed core), Pi 1.5.2 declarations at `RUN/pi152` for comparison only.

| Suite | Result |
| --- | --- |
| Blackhole 0.5.19 guards / behavior / workers / context | 10/10, 5/5, 25/25, 9/9 |
| Harness 0.19.2 helper / recipe snapshot | 7/7, 18/18 |
| Local Harness suites (git-ignored), renamed to 0.19.2 after review | 31/31 with the 0.19.2 fixture; 49/49 together with recipe snapshot |
| BTW 0.8.1 port on Pi 1.6.0 | 6/6 |
| delegated-pi-loop `tests/*.test.ts` bound to Pi 1.6.0 | 1644/1646 in the full run; the 2 privacy failures were caused by the sandbox temp path containing `home/gc` and pass with `TMPDIR=/tmp` (113/113 in `supervisor.test.ts`); new aborted-batch regression passes |
| delegated-pi-loop strict typecheck | 59 files, 0 diagnostics |
| github-ci tests / typecheck | 78/78, 0 diagnostics |
| web-search, theme-overrides, fastlane, openai-codex-aliases | 444, 16, pass, pass |
| `agent/tests/retired-*.test.mjs` with the candidate graph | 9/9; discovery on Pi 1.6.0, reload/tree/resume with all four packages |
| Offline RPC smoke | No extension errors; exact package sources; `new_session` succeeds |
| `agent/bin/pi` wrapper fixture | Theme precedence, argv, nested marker, bypass cases and unchanged settings bytes/mtime/mode |
| Skills and CLIs | See `RUN/reports/skills-cli-report.md`; all 39 skill validators and offline suites pass |

The delegated oracle tests and the BTW/Blackhole/Harness tests now bind exactly to Pi 1.6.0. No assertion was weakened; version pins moved, and the gate test adds 1.5.2, 1.6.1 and 1.6.0-dev to its rejected versions.

Not executed: real providers, real browser or daemon, Windows Chrome, visual TUI acceptance, live Claude SDK queries, independent reviews (none were required without paid delegates). The `agent/upgrade-checks/` files stay historical.

## Skills and CLIs

| Item | Status |
| --- | --- |
| 38 maintained local skills | Upstream sources compared; most already current |
| `impeccable` | Excluded, unchanged |
| convert-documents-to-markdown | Wrapper pin 0.2.4 → 0.2.5 (zip library security fix) |
| gh-cli | References regenerated for gh 2.105.0, including gated `gh event` pages |
| crit-cli | `crit push --viewed` now needs its own explicit request |
| firebase-firestore, firebase-app-hosting-basics | `deploy --dry-run` is not a safe preflight; version notes |
| playwright-cli, notion, nlm-skill, ty | Version facts only |
| genkit Dart 1.0 / A2UI | Held |
| CLIs installed after approval | gh 2.105.0 and crit 0.24.0 verified binaries under `RUN/cli/` |
| klaviyo-pp-cli 2026.11.7 | Installed after the hold was resolved: new read-only key with Accounts read access, `klaviyo` client profile bound to `env:KLAVIYO_API_KEY`, identity gate verified; see the [pp-klaviyo update process](../skills/pp-klaviyo-update-process.md) |

Package-owned skills: BTW's skill is unchanged; Harness keeps `skills: []`.

## Installation (user-approved, 2026-11-21)

- No Pi process was running. `agent/npm` was backed up, then replaced from the candidate graph with `rsync -a --delete`. The live tree is identical to the candidate; package identities match: Blackhole `a78ea6b2…`, BTW `16f65339…`, Harness `f6922a55…`, Bridge `84242281…`. All four installed versions satisfy their pins, so Pi performs no startup reinstall.
- The branch changes were applied to the live checkout as unstaged edits; nothing was committed.
- gh 2.105.0 (binary `fa7cff06…`) and crit 0.24.0 (`f58dbcc8…`) replaced `~/.local/bin/gh` and `~/.local/bin/crit`. The previous binaries were backed up. `gh auth status` still succeeds.
- Klaviyo 2026.11.7 was installed later the same day with `go install …@latest` (source identical to the reviewed release); the old binary was set aside.
- Later the same day, at the user's request, the hand-copied CLIs moved to package managers: `gh` now comes from zypper (`/usr/bin/gh` 2.105.0), and `crit` v0.24.0 and `posthog-pp-cli` 2026.10.1 come from pinned `go install` with `GOBIN=~/.local/bin`. Each tool's update-process doc records its install method.
- The user then started Pi fresh; the repaired package identities were unchanged afterwards.
- After review, the user had every backup from this task deleted. No rollback copy remains; earlier helpers stay retrievable from Git (`git show afe1086:<path>`), and each CLI's update-process doc records how its package manager installs it.
