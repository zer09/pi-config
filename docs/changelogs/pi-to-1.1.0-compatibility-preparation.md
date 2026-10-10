# Pi 1.1.0 compatibility preparation

**Prepared in an isolated worktree, not deployed.** Tested candidate: exactly **1.1.0**. Verdict: **ready with limitations**. Final review-a and review-b passed with no blocking findings. No live upgrade, integration, or restart occurred.

## Baseline and paths

- Original: `/home/gc/.pi`, remote `git@github.com:zer09/pi-config.git`, branch `master`, HEAD `84aa2a528bfa677f0d151f4deb43e3e331761faf`. No staged or unstaged tracked changes; existing untracked state was recorded.
- Fetched `origin/master` and detached candidate base: `5909e9b5faf41f0fdc07f1e9e5840dfe7e2eba46`. The original has one local-only commit removing an OpenCode Go delegate route. This preparation does not incorporate or overwrite that routing change.
- RUN: `/home/gc/worktrees/pi-config-1.1.0-UkWvry`; worktree: `RUN/worktree`; target host: `RUN/runtime`; isolated baseline host/source: `RUN/baseline`.
- Actual original CLI and installed global manifest: **0.99.2**, separately verified. Deployed package manifests match the old pins below. Previous preparation documents were not treated as deployment evidence. Active-session loaded bytes were not inferred from disk.
- Official Pi `v1.1.0`: `abe508e1b89912adde45528136c3221eb69acdd7`. Published coding-agent SRI: `sha512-SeEi/4hdcHNgA9UWlefZl7ZZpm3dzi2OoxNjDHsBJ9o298LNOtbL4DGKgitlEj6uCTccvtw6f2hlCkTPVJ2RXg==`. Node 24.18.0 satisfies `>=22.19.0`. All four SDK archives, exports, declarations, and actual bundled CLI were verified.

## Decisions and fixes

| Package/dependency | Old pin / installed | Latest checked | Selected | Decision |
|---|---|---|---|---|
| Pi family | 0.99.2 | 1.1.0 | 1.1.0 | Exact requested isolated target |
| pi-blackhole | 0.5.10 | 0.5.12 | 0.5.12 | Updated; Pi 1.x peers and three guarded ports |
| pi-btw | 0.7.0 | 0.7.1 | 0.7.1 | Updated; Pi 1.x peers and cancellation port |
| pi-browser-harness | 0.11.0 | 0.11.0 | 0.11.0 | Already current; object-form `skills: []` retained |
| pi-claude-bridge | 0.9.1 | 0.9.2 | 0.9.2 | Updated; ordering repair proved upstream |
| @schultzp2020/pi-cursor | 0.5.2 | 0.5.3 | 0.5.3 | Updated; runtime source unchanged; deprecated upstream |
| Claude Agent SDK / Linux package | 0.3.284 | 0.3.296 | 0.3.296 | Updated and version-aligned; fake transport validated |
| Local CodeGraph / platform | 1.6.0 | 1.6.2 | 1.6.2 | Updated exact manifest/lock; private adapter validated |
| Local standalone TypeBox | ^1.2.10 / 1.2.10 | 1.3.36 | 1.3.36 | Updated exact manifest/lock; host ownership separate |
| Host TypeBox | 1.3.27 | 1.3.36 | 1.3.27 | Held: Pi owns this version; actual loader identity verified |
| context-mode | 1.0.169 | 1.0.169 | 1.0.169 | Already current; existing lock retained |
| Cursor protobuf | 2.15.0 | 2.16.0 | 2.15.0 | Held package-owned tested graph; no independent transitive update |
| Harness ws | 8.21.0 | 8.22.0 | 8.22.0 | Candidate resolves current compatible stable version |
| Harness sharp | 0.33.5 | 0.35.5 | 0.33.5 | Held: latest is outside package's ^0.33.0 range |

Other package-owned dependencies were inspected without blanket churn. Bridge retains MCP SDK 1.30.1 versus latest 1.32.1, current cc-session-io 0.4.0/change-case 5.4.4/Zod 4.6.5, and host-owned Anthropic API SDK 0.129.0 versus latest 0.133.0. context-mode retains @clack/prompts 1.6.0 versus 1.8.1 and MCP SDK 1.29.0 versus 1.32.1 to preserve its tested lock. Its better-sqlite3 12.11.1 and Zod 3.25.76 stay within declared major ranges rather than adopting latest 13.0.3/4.6.5. Domino, picocolors, turndown, and turndown-plugin-gfm are already current. Full metadata and reasons are in `RUN/reports/{bridge-d-dependency-metadata,codegraph-e-metadata,f-dependency-metadata}.json`.

- `agent/settings.json`: explicit `tuiMode: "regular"` preserves the verified previous implicit mode. Exact package pins updated. `lastChangelogVersion` stays **0.99.2**; `outputPad` stays unset.
- Delegated monitor: aborted settlement cannot mean completion or start report recovery. Unexpected abortion uses existing `child_failed`; accepted parent cancellation remains `interrupted`. A cancelled retry can settle without another final `agent_end` only after a matched idle retry boundary. Invalid superseding starts discard stale matching evidence. Exact 1.1.0 projection oracle and regression fixtures were revalidated.
- CodeGraph: only dependency/lock updates and a valid initialized-index test fixture. Production adapters remain unchanged. Host TypeBox stays 1.3.27; standalone tests also exercise 1.3.36.
- Models, aliases, routing, reasoning, child permissions/resources, liveness, compaction policy, theme, Fastlane policy, wrapper, and `cacheWarming: "off"` remain unchanged. All four `-builtin:` exclusions remain. CLI wildcard/modifier selection and stricter provider/model validation passed without enabling MCP. Additive metadata did not become successful completion or novel progress. No Azure ID is configured.

Blackhole's three patches remain required: percentage precedence with fixed fallback, nullable provider headers, and context-edit-aware fresh summaries preserving raw history. New 0.5.12 helpers preserve version/source/prerequisite/link/drift guards, clean application, and byte/mtime idempotence; Pi executes patched `index.ts`, not stock `dist`. BTW's single credential-signal patch remains required and guarded on 0.7.1. Bridge's ordering patch is retired **only for candidate 0.9.2** after exact replay/capture/wire equivalence; live 0.9.1 and historical helpers remain untouched. Direct patch records are updated; retired patches were not revived.

## Tests and limitations

Commands, cwd, exits, failed attempts, and classifications: `RUN/reports/commands.jsonl`. Per-increment evidence: `increment-a-evidence.json`, `remediation-a1-evidence.md`, `blackhole-b-evidence.md`, `btw-c-evidence.md`, `bridge-d-evidence.md`, `codegraph-e-evidence.md`, and final `f-evidence.json`.

| Final gate | Result |
|---|---|
| Delegated serialized suite / target strict types | 1,546 passed, no skips / 52 files, zero diagnostics |
| Untouched fetched-base affected checks on isolated 0.99.2 | 816 passed |
| Blackhole | Guards 11/11; workers 13/13; four lifecycle cases; 162 projection parity cases plus history checks; stock/patched upstream 2,613 each; strict 129 roots each |
| BTW | Guards/cancellation 5/5; established regressions 6/6; stock/patched upstream 144 each; both production roots compile |
| Bridge / SDK | Ordering/lifecycle/loader 5/5, including four fake-SDK requests; offline units 296; historical guards 7/7; upstream production types and strict transcript types pass |
| Cursor / Harness | 441 / 287 passed; Harness has eight upstream Windows/macOS skips; Harness 75 target type roots pass |
| CodeGraph / context-mode | 71 passed under each TypeBox binding / 322, check, and fuzz pass; disposable SDK/RPC, exact CLI Explore parity, sync/migration/cleanup pass |
| Other local checks | Codex aliases, footer, Fastlane, theme, wrapper 6, web-search 366, and mocked GitHub 77 pass; 132 local production roots compile |
| Padding/rendering | All 360 ASCII width/expanded/collapsed/padding cases pass; Unicode baseline limitation below remains |
| Final combined published target SDK/CLI/RPC | 7/7, no skips: 14 extensions, 62 active tools, 24 actual extension commands; persisted fake-provider turns and graceful shutdown |

The combined runtime-child profile has exactly six approved extensions and 18 active tools; catalog has the alias extension and four built-ins. No recursive delegate tools, package extensions, optional built-ins, unselected skills, prompts, or themes enter children. Optional delegated Fastlane remains off by default. SDK/CLI resolve E's CodeGraph 1.6.2, not the old baseline copy. Wrapper checks preserve explicit themes, unchanged argv, and settings bytes/metadata.

**Non-green checks are not passed:** Cursor has one `ProviderModelConfig.thinkingLevelMap` source-type diagnostic, reproduced against isolated 0.99.2; all 34 production roots and tsconfig equal official 0.5.2 bytes. Fourteen Unicode width failures in context-mode reproduce on untouched fetched source/0.99.2 with equivalent padding; no target-specific width regression or double padding was found. GitHub's optional test-fixture typecheck TS2345 also reproduces on baseline. Blackhole's unchanged file loader ignores `showPreCompactionMessage: false` on both versions. These defects were not repaired outside compatibility scope.

Initial install/binding/fixture failures are recorded, including unavailable AWS transitive metadata, stale upstream catalog expectations, and temporary-path checks. Material fixture repairs preserved assertions. Required changed-behavior regressions, five patch dispositions, and final combined smoke pass. All six implementation increments passed both review roles; verified A1 was remediated and its full review gate repeated. Final reviews covered the accumulated diff and this report.

Unexecuted: interactive visual acceptance, real login/auth refresh/provider inference, live SDK subprocesses, browser/daemon connection, Windows/macOS execution, real index rebuilds, and real-session migration. CodeGraph validation is Linux x64; existing extraction-25 indexes need separately authorized rebuilds for extraction-27 fixes. No global CodeGraph CLI update occurred.

## Reproduction, isolation, and later integration

Pi 1.0.1 removed published shrinkwrap. Exact tested graph: `RUN/runtime/package-lock.json`, SHA-256 `93226cc5e318b28174ba6388fefb93c0bbf9699743a41ef7a7810f338d7e63e8`; graph/inventories/entrypoint hashes: `RUN/reports/f-final-integrity.json`. Keep the runtime manifest, both locks, verified archives, patch helpers, and local dependency lock together. An exact Pi pin alone does not reproduce this graph. Compatible AWS pins address unavailable registry metadata. Harness's stale legacy-scope peers use isolated npm aliases to exact target artifacts; tests bind the target host, not an older bundled Pi. No force or legacy-peer bypass occurred.

Execution tests use sanitized environments, fake providers/transports, disposable sessions/indexes, private RUN-backed temporary storage, warming off, and `bwrap --unshare-net`. Lifecycle scripts were inspected and disabled. Copies/links do not point to writable original or live packages. Installs preserved sibling patches and existing dependency bytes/mtimes. All changes remain unstaged.

Original before/after snapshots verify unchanged HEAD, branch, status, index hash, and all **24,110** protected original/deployed/global hashes. The live CLI/global manifest remain **0.99.2**. No stage, commit, push, stash, reset, integration, deployment, active package-cache update, or live upgrade ran.

Later steps, **not executed**: review this compatibility diff against current master while preserving its local-only route removal; separately authorize integration and exact package/core installation from the tested graph; apply the four remaining patches only through an approved deployment procedure; recheck actual entrypoints and sibling patches; restart while idle; perform visual/provider/browser acceptance only with approval. Copying tracked settings alone does not deploy patched package bytes or upgrade Pi. Leave this worktree and RUN available for review.
