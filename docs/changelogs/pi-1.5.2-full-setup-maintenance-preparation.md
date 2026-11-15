# Pi 1.5.2 full active-setup maintenance preparation

Status: **Ready with limitations.** Both final accumulated reviews pass. **Prepared in a separate worktree, not deployed.** This readiness applies to the prepared candidate only; it does not authorize installation, integration, restart, or real-account use.

## Baseline and locations

The original checkout is `$HOME/.pi`, on `master` at `d96d3167cdf483f26eaea999e3cdd558a4590921`. Fetched `origin/master` matched that commit, with no local-only divergence. The actual Bun-owned executable reports **Pi 1.4.0**; its version was checked separately from Git. The existing unstaged settings difference only expands the prompts array and removes the final newline. It was not imported or overwritten.

```bash
RUN="$HOME/worktree/pi-config-1.5.2-zwmPnH"
WORKTREE="$RUN/worktree"
ORIGINAL="$HOME/.pi"
```

The candidate branch is `maintenance/pi-config-1.5.2-zwmPnH`, still based on the same commit, with all changes unstaged. `RUN/runtime` contains the separately verified 1.5.2 runtime. `RUN/graph-baseline/agent/npm` preserves the unchanged-package target graph. `RUN/graph-candidate/agent/npm` contains the selected package graph. Downloads, private CLI candidates, synthetic state, caches and evidence remain outside tracked source under RUN. The user approved model-backed maintenance delegates with existing routing and Fastlane off; that approval did not authorize paid search or live application/provider acceptance.

Official [`v1.5.2`](https://github.com/earendil-works/pi/releases/tag/v1.5.2) resolves to `b4afdddf44e059c67ccf5097e5317d913521b470`. It was the latest official stable release verified on November 12, 2026, not unreleased main. The official npm coding-agent archive passed SHA-512 integrity; its SHA-256 is `691bde186273b457d9d1c41d0fd47b57853b5e85ded1add1a1f6b78e66c261f4`. The target requires Node >=22.19.0; checks use Node **26.13.1** and TypeScript **6.0.3**.

## Selected packages and repairs

The software development kit (SDK) is the Pi library loaded by extensions. RPC is Pi's structured command interface for separate processes. Stock means unchanged upstream package bytes; a repair is an existing narrow local patch.

| Package | Actual installed baseline | Prepared selection | Latest compared | Decision |
| --- | --- | --- | --- | --- |
| Pi | 1.4.0, Bun global. | Exactly 1.5.2. | 1.5.2. | Prepare only; preserve Bun ownership. |
| Blackhole | 0.5.15, three repairs. | 0.5.15, identical repairs. | 0.5.18. | Hold changed compaction behavior and entrypoint/repair implications. |
| BTW | 0.8.0, cancellation repair. | 0.8.1, cancellation repair. | 0.8.1. | Select the compatible update. |
| Browser Harness | 0.13.0, registration repair. | 0.13.0, identical repair. | 0.17.0. | Hold changed tools/setup and persistent recipe journaling. |
| Claude Bridge | Stock 0.9.3. | Stock 0.9.3. | 0.12.0. | Hold session/settings changes and AskClaude separation. |
| Cursor | Not configured or loaded. | Excluded. | Not selected. | Do not restore, prune or update a retained copy. |

Blackhole retains percentage compaction, nullable provider-header deletion markers, and context-edit-aware fresh summaries/capacity handling. Its manifest selects repaired `index.ts`, not the stock bundle. BTW retains only `{ signal: ctx.signal }` in runtime credential propagation. Harness retains per-receiving-API registration with unchanged 42 browser tools. Bridge's old transcript-order repair remains retired. The 0.9.3 baseline itself lacks the later billing guard; the Bridge hold is **not** attributed to removal of a protection present in that baseline.

> Correction (2026-11-14): The preceding billing-guard statement is incorrect. Stock 0.9.3 calls `assertSendablePrompt` in `src/prompt-capture.ts`; stock 0.12 removes that protection. The user accepted its removal during the later three-extension upgrade. Historical test results above and below remain unchanged.

Guarded helpers run only on verified, canonical disposable extractions under an explicit TMPDIR, never live `node_modules`. The helpers retain checks for source, npm integrity, version, prerequisites, links, shared files and drift. Reapplication preserves bytes and mtimes. Package-manager transactions can overwrite repairs; a version marker or successful import is not installed-byte acceptance.

The baseline locks bind 287 entries and 236 installed entries to official archive metadata. Verification covered 228 installed archives; 51 uninstalled optional archives have metadata proof only. The candidate differs from the preserved baseline in eight BTW files and three manifest/lock files. Pi canonical and legacy identities resolve to 1.5.2. Registry provenance, graph identities, repair inventories and tests are retained in `RUN/reports/g1`, `g1-a1` and `p1`.

## Compatibility changes and preserved behavior

- GitHub CI, delegated-session, alias, wrapper and theme test bindings now use explicit target dependencies. Invalid explicit dependency roots do not silently fall back to globals. Production routing and supervision behavior remain unchanged.
- The scoped TypeScript prompt now correctly explains that `$ARGUMENTS` joins parsed arguments with spaces and does not preserve original quoting boundaries.
- Pi 1.5.2's schema coercion is tested against 50 actual extension/package schemas. Synthetic refinements/formats are not enforced, codecs return encoded values, and optional `$ref` null differs from ordinary optional null. Existing semantic/security checks remain essential and unchanged; captured active schemas do not depend on those synthetic features.
- Native process checks cover output bounds, missing executables, UTF-8, cancellation, timeout, escalation and RPC cleanup. A killed process can report code 0, so callers must check `killed`; tested GitHub CI/theme helpers do.
- Provider checks cover aliases and both configured proxy APIs with synthetic transports. Seventeen configured models inherit OpenAI completions; one overrides to Anthropic messages. No endpoint/account data or speculative compatibility flag was changed.
- Footer checks call the unchanged formatter against native synthetic session history before compaction, immediately afterward, and after another reply. Lifetime usage, current context and latest-assistant cache-hit semantics remain separate.
- The one private shutdown fixture now follows Pi 1.5.2's abort-before-shutdown order. It still requires cancellation, exact session ownership, stale contexts, unchanged raw history/canaries and no extra work. Historical repository fixtures and production disposal remain unchanged.

Defaults, aliases/accounts, models, routing, `max` thinking, regular TUI, themes, wrapper argv/bypass behavior, `websocket-cached`, and explicit cache warming off remain. Harness retains object-form `skills: []`. The runtime child has five ordered extensions and seven active tools; its catalog has two extensions. MCP, llama.cpp, codemode and tool-search stay disabled. CodeGraph, Context Mode and their prompt/CLIs remain retired; their source/data are preserved, not executed.

The final SDK parent loads eleven production entries, 39 local roots plus BTW's package skill, and no skill collisions. The two explicit-only local roots remain `crit` and `impeccable`. Fresh bundled/unbundled RPC parents each report 57 registered and 53 active tools, including 42 browser tools. Runtime children expose seven active tools; catalog children expose four core tools. Test-only commands/providers are not production inventory claims.

## Every local skill

There are 39 retained/classified roots: 38 maintained here and Impeccable expressly excluded. No root was added, removed or renamed. Source comparison does not mean wholesale synchronization or SDK migration. Local overlays, licenses/notices, descriptions/UI tokens, progressive disclosure, exact hosted-write authority and project package managers remain.

Source keys below identify exact compared inputs, all from authenticated GitHub/Git-blob evidence under `RUN/evidence/skills` unless noted:

| Key | Origin and exact compared source |
| --- | --- |
| OA | `openai/skills`, main `49f948faa9258a0c61caceaf225e179651397431`; mapped inputs unchanged. |
| AN | `anthropics/skills`, prior `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`, main `2c5958ecac7cee2b583967a2c4981d0f4a75c579`; mapped inputs unchanged. |
| AS | `astral-sh/agent-plugins`, prior `f3ce88a7ba830f53afd6d944c1d0278ed318e142`, main `855418fb9ebfada49a8345a5c3ada9db2cdc2419`. |
| FB | Canonical `firebase/agent-skills`, prior `daaf0e1577b2d4ac23cfa9d31f421178ef229735`, main `99954a30898bb5ddc8152ee10e124dc3b4106bf7`. All 32 differing paths have individual decisions. |
| GK | `genkit-ai/skills`, prior `cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6`, main `baeb82a31be2b88e2331002e48de678fc340164c`. All 83 current mapped files compared; not a Firebase origin. |
| MP | `mattpocock/skills`, prior `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, main `5863806dd4e15c63174bee4e7515a4256792ecfa`. |
| DB | `planetscale/database-skills`, prior `73b20b7eb64716d8c7100c054f0677c0c6e77e30`, main `f6ed002d03084cb39c01d1d58904d47a36f5322a`; mapped inputs unchanged. |
| SH | `softaworks/agent-toolkit`, main `3027f20f3181758385a1bb8c022d4041dfb4de84`; mapped inputs unchanged. |
| IL | `crafter-station/skills`, main `f0fe474d76ed3f04113664095ff1b9e9844e8020` still lacks the path. Retain last-containing snapshot `24d77ce6365072c1699a20928e57a971abaa10f2`; no invented move. |
| NT | `makenotion/skills` remains `10e976aa591995fd60c75ef13beba1a8aa827fcc`. Workflow source advances from `9847f2aa1a15f25df35ed1fb7b4557dbb60cd651` to `016c74ffc568920a385186fb9d2d9d2801e0be09`. |
| AD | Released `@firecrawl/anydoc` 0.2.4, source `261fc257d17c3eab0f673be31c408fd9fdc2171a`. Current main `e7178e099b6bf9171e2c52b832cbdb4134b69112` changes two unreleased CLI/library files, not the skill or package version; do not patch the release from main. |
| PP | Printing Press release ledgers and designated inputs at `mvanhorn/printing-press-library`, current main `e1f4193b2471a8e39c48d801697f761e20e1d94b`. Exact component decisions appear below. |
| Local | Repository-owned behavior, checked against its actual helper/tool contract, not an invented upstream version. |

| Local root | Input | Outcome and retained scope |
| --- | --- | --- |
| `convert-documents-to-markdown` | AD/local wrapper. | No-op runtime; 0.2.4 remains pinned. Local-first/OCR opt-outs, privacy, replay and output safeguards remain. |
| `crit` | Released Crit 0.23.2. | Root unchanged and explicit-only; CLI candidate prepared, not installed. |
| `crit-cli` | Released Crit 0.23.2. | Update existing command/review/share guidance; preserve exact mutation gates and deletion-token handling. |
| `developing-genkit-dart` | GK. | Source compared; hold Dart 1.0 APIs without consumer pins/schemas. |
| `developing-genkit-go` | GK. | Source compared; hold SDK/module-path migration and optional catalogs. |
| `developing-genkit-js` | GK. | Close one missing example fence; retain pins, optional CLI and held SDK additions. |
| `developing-genkit-python` | GK. | Source compared; hold 0.13 dependency/API migration without consumer evidence. |
| `directus-browser` | Local/Browser Harness. | No-op; retain UI-first exact writes, same-origin reads, setup/profile/login boundaries. No Studio call. |
| `figma` | OA. | No-op mapped source; preserve setup/context-only routing and separate setup authority. |
| `figma-create-design-system-rules` | OA. | No-op; preserve rule-authoring boundary, not ordinary implementation. |
| `figma-implement-design` | OA. | No-op; preserve supplied-node/context/screenshot/assets and reuse/completion contract. |
| `firebase-ai-logic-basics` | FB. | No-op existing workflows; hold TTS and version-dependent App Check/provider additions. |
| `firebase-app-hosting-basics` | FB/CLI 15.36.0. | Correct existing commands/secrets and guard hidden service enablement before backend list/get. |
| `firebase-auth-basics` | FB. | No-op; retain ownership/schema/query/config/domain gates and resolved SDK checks. |
| `firebase-basics` | FB/CLI 15.36.0. | Existing local overlays already cover applicable changes; contracts accept the explicit current version. |
| `firebase-data-connect` | FB. | No-op; retain local name, SQL Connect scope, schemas and exact deployment gates. |
| `firebase-firestore` | FB. | No-op; retain edition/named-database/creation/rules/index/query limits; hold new vector APIs. |
| `firebase-hosting-basics` | FB. | No-op; preserve static/SPA scope and exact publication targets. |
| `firebase-security-rules-auditor` | FB. | No-op; retain read-only Firestore audit scope, not new Storage scope/dependencies. |
| `gh-cli` | Official gh 2.103.3 help. | Refresh 23 manuals and add seven artifact manuals; preserve authenticated gh and write authority. |
| `grill-with-docs` | MP. | No-op; keep one material question, evidence-first bounded planning and explicit documentation authority. No mandatory extra delegates. |
| `impeccable` | Excluded. | Unchanged, including its existing explicit-only classification; no helpers executed. |
| `improve-codebase-architecture` | MP. | No-op; preserve domain/ADR grounding, candidate pause and read-only scope. Fresh-context wording adds no required runtime change. |
| `intent-layer` | IL. | Retained snapshot; three existing measurement helpers pass syntax and synthetic local checks. |
| `linear-cli` | Installed 3.1.0/source help. | Update grammar and generated references; preserve full unfiltered native issue reads and exact mutation authority. |
| `mysql` | DB. | No-op; preserve production/destructive gates and proportional diagnosis. |
| `nlm-skill` | Release 0.16.2, `a73d3bebfed0fba428b73d2e768c8e0be0495390`. | Correct bounded recovery, uncertain-write retries, account/session scope and sync guidance; retain unsafe batch/pipeline bans. |
| `notion` | NT/ntn 0.23.29. | Selectively update four existing workflows and version; preserve privacy, exact writes, fetch/preserve/delete and no companion writes. |
| `outpour-mcp` | Local/official guide. | Active maintained no-op, not TODO-only. Existing 229 tests pass on Node 26; public guide fetched, no live MCP catalog or ministry access. |
| `pi-browser-harness` | Local/package 0.13.0. | No-op; preserve per-task consent, profile/header/account/login and exact action boundaries. |
| `playwright-cli` | CLI 0.1.24. | Correct existing raw/snapshot guidance and exact dependency contract; retain owned isolated sessions and Browser Harness routing. |
| `postgres` | DB. | No-op; preserve database/production gates; no generic-app or Data Connect routing expansion. |
| `pp-klaviyo` | PP. | Retain installed 2026.9.3 and current safety overlays; hold 2026.11.7 credential/cache/platform changes. |
| `pp-posthog` | PP. | No-op; selected 2026.10.1 ledger and nine designated source inputs remain unchanged. |
| `ruff` | AS/0.17.4. | Selective current guidance; preserve manager and unsafe-fix authority. |
| `session-handoff` | SH. | No-op; preserve explicit create/load boundaries, private-data handling and read-only resume checks. |
| `skill-creator` | OA/AN/local overlay. | No-op mapped sources; preserve unified capable-model policy and proportional evaluation. No model benchmark. |
| `ty` | AS/0.0.101. | Correct obsolete rule naming and selected current guidance without a binary change. |
| `uv` | AS/0.13.7. | Selective current guidance; preserve project-manager, mutation/install/migration and offline boundaries. |

The MP changes add fresh-context wording and affirmative-question phrasing; they do not justify mandatory exploration/delegation or changing the local bounded workflows. GK migration/catalog additions remain explicit holds, not silently relabeled as current SDK acceptance. Eleven local runtime roots change; descriptions/UI and the 39-root classification remain unchanged. Details and adopted/held paths are in the existing [skill maintenance records](../skills/README.md).

## Actual CLI and helper units

Paths below are owner locations, not commands executed during preparation. All candidate checks use synthetic HOME/configuration and OS network denial. Version/help/schema checks do not establish account or hosted behavior.

| Consumer | Actual executable/package and owner | Prepared candidate and tested contract |
| --- | --- | --- |
| Pi wrapper | `$HOME/.pi/agent/bin/pi` calls Node and Bun-owned `$HOME/.bun/bin/pi`, installed coding-agent 1.4.0. | Exact 1.5.2 SDK/bundled/unbundled runtime under RUN. Wrapper settings/argv/auth-management bypass tested without login. Bun installation remains pending. |
| Node / npm runner | nvm Node 26.13.1; `npx` belongs to npm 12.2.2 in that prefix. | Same Node used throughout. Wrapper argv and offline behavior tested; native AnyDoc adapter bypasses npm retrieval, so fresh npm resolution is not claimed. |
| Linear | `$HOME/.bun/bin/linear`, Bun-owned `@schpet/linear-cli` 3.1.0. | Verified private native copy; help/command generation and existing contracts pass. No upgrade needed. Cached Deno 2.7.9 is used only for the existing generator checks. |
| Notion | `$HOME/.bun/bin/ntn`, Bun-owned ntn 0.23.29. | Verified private native package; twelve static version/help forms pass. No upgrade needed; closed-source/reproducible-build limits remain. |
| NotebookLM | `$HOME/.local/bin/nlm` and `notebooklm-mcp`, uv tool 0.16.2. | Exact wheel/sdist/installed RECORD and 14 existing contracts pass. Help schemas run without callbacks; only version's update checker is mocked. Current receipt remains unpinned and unchanged. |
| Playwright | nvm npm-global `playwright-cli`, `@playwright/cli` 0.1.24. | Exact private closure: playwright/core `1.66.0-alpha-1794252756000`, the stable CLI's own pins. Eight contracts and 34 static calls pass; no browser/download/session action. |
| Firebase | nvm npm-global `firebase`, firebase-tools 15.36.0. | Exact root plus installed-byte private closure, twenty static calls and existing contracts pass. Root engine accepts Node 26; `superstatic` excludes it. Emulator/server acceptance is not claimed. |
| gh / GitHub CI | User-local `$HOME/.local/bin/gh` 2.101.0. | Official 2.103.3 at `RUN/reports/s3/native/gh`, checksum-verified; manuals/normalizer/help controls pass. Install remains pending. CI uses mocked gh contracts, not real workflow operations. |
| Crit roots | User-local `$HOME/.local/bin/crit` 0.21.0, not system CRIU. | Official 0.23.2 at `RUN/reports/s4/native/crit`, verified artifact and twelve static probes. Install remains pending. |
| uv / uvx | Cargo-owned uv/uvx 0.13.7. | Private copied binary/current guidance; existing fixture checks pass. No Cargo install/build or manager change. |
| Ruff / ty | uv-managed Ruff 0.17.4 and ty 0.0.101. | Private copies and seventeen native fixture cases pass. No tool upgrade or environment sync. |
| Document conversion | Wrapper invokes pinned `@firecrawl/anydoc@0.2.4` through npx; no global AnyDoc executable. | Verified root/Linux x64 GNU native archives at `RUN/reports/local-audit/cli/anydoc`; nine version/help/local conversion/error/wrapper checks pass. No upload or hosted OCR. |
| Printing Press PostHog | User-local `posthog-pp-cli` 2026.10.1. | Byte-identical private binary, seven static/help/build-info checks. Embedded clean VCS commit `986b1df61eb325952a0a9fe0fed98c8bdd64e740`; no API/sync/doctor. |
| Printing Press Klaviyo | User-local `klaviyo-pp-cli` 2026.9.3. | Byte-identical private binary, six static/help/build-info checks and existing preflight regression. Binary omits VCS revision, so exact build-source attestation is limited. No customer read/cache/write. |
| Outpour | Repository-owned Node headless helper, no npm CLI installation. | 229 existing mocked cases plus syntax pass. Exact endpoint/key/redirect/financial/contact/write limits remain; no real key, MCP request or schema discovery. |
| Browser support | Retained Harness 0.13.0 and its locked dependencies. | Actual parent registration/reload and lazy disconnected initialization pass. Chrome/Windows/profile/daemon interaction is unperformed, not upgraded. |
| Claude Bridge support | SDK and Linux x64 package 0.3.309 in the selected cache; no custom executable override. | Package provenance and fake SDK/query/serialization contracts pass. Native Claude executable/product version and live authentication are untested; no unrelated global Claude upgrade. |
| Genkit | No active global `genkit` executable/package consumer found. | Absent/project-scoped. Keep installed/project-pinned selection; do not install one for maintenance. |
| Database/Figma/Directus tools | Task/project-specific SDK, MCP or browser capabilities, not a selected global CLI upgrade. | Preserve existing managers and explicit setup authority. No database, MCP setup or Studio call is made. |

The separate npm-global `@posthog/cli` manifest reports 0.19.3 and has no runtime consumer in `pp-posthog`; its 0.20.0 registry result does not authorize an unrelated upgrade. System shell/file tools remain OS-owned and are exercised only by existing local helpers; no system package update is selected.

Klaviyo's official release ledger identifies **2026.11.7**, source `33f9f600c1cb2c06f751a0c18cb6b645adae2f31`, stamped build commit `1d0f487fb308e46275a10cb714de6061f8e3c258`. Exact released source, not only newer main, changes credential/config relocation and platform cache/session handling. That migration is held; no source build, relabeled old binary or untested install is presented as an upgrade. The held source also hardens credential routing from untrusted configuration; the retained binary does not gain that protection. Help success does not certify real credential routing. Review that migration before future credentialed use rather than treating this hold as a security endorsement. Preserve environment-only keys, absent base-URL override, explicit customer-cache consent and exact write/send authority.

## Acceptance ledger and limits

Execution uses OS network denial, cleared environments, synthetic providers/transports/state and read-only protected inputs. Downloads are separate authorized source/package reads. This table distinguishes retained reviewed evidence from the final fresh check; counts are not summed across duplicate or nested runs.

| Area | Evidence and result |
| --- | --- |
| Graph/repair construction | G1/G1-a1/P1 archive, lock, whole-package, drift/refusal/idempotence and loaded-entry evidence passes. |
| Tool validation | C2: eleven tests, 50 actual schemas, runtime/security guards; no blanket builder migration. |
| Processes | C3-fixes: 24 target checks, including real native Linux process/RPC behavior and measured escalation. |
| Prompts/read | C4: 22 checks, including 42 actual template expansions and native read behavior. Optional BTW SSH remains inactive/untested. |
| Delegated runtime | C5-fix: 1,642 existing tests and 58-file strict check pass. Earlier failed run remains failed. No protocol/source change afterward warrants another full rerun. |
| CI/alias/proxy/Bridge/theme | C1/C6/C7 retained target tests and strict checks pass; proxy tests use 28 injected requests, Bridge uses fake queries, wrapper/theme use synthetic platform results. |
| BTW | P1: six port plus six historical cases; 177 upstream cases each stock/patched; three production-file strict checks and actual patched-entry fake-provider execution pass. |
| Blackhole | S10 plus S10-fix: retained 51 cases plus one fresh corrected shutdown pass. Three target strict/header checks pass across 136 production files. Original S10 remains a failed 51/52 run. |
| Other active strict checks | Web-search 27 roots, Fastlane three, footer nineteen and the previously reviewed CI/alias/Bridge/theme/delegated programs pass. |
| Harness strict | Stock and repaired source reproduce the same three diagnostics across 86 non-page roots; registry/public boundary introduce zero. This is not a clean whole-Harness typecheck. |
| Skill/CLI increments | S1-S9 targeted existing contracts, static/native checks and all 39 validators pass, including the final App Hosting safety correction. Validators are not model-compliance tests. |
| Remaining helpers | Existing Outpour 229, document-wrapper 41 and Klaviyo preflight cases pass unchanged. Twenty-nine existing-command checks cover native conversion, Printing Press help/build info and Intent Layer helpers. |
| Final combined setup | Fresh selected-graph SDK plus bundled/unbundled RPC passes three checks with six RPC child processes and 17,338 binding records, cache warming off and no unexpected transport/process/private/retired access. Both 29,842-entry graphs and all 1,368 then-current source entries retain bytes/links/mtimes. |

The final combined driver reuses C8 helpers with only report/selected-graph/BTW-version bindings. Its first attempt omitted the unchanged RPC probe, so SDK checks passed but RPC failed with `Extension path does not exist`. Copying that existing probe completed the fixture; the next complete run passes. Both logs remain. The shutdown correction ran only its one existing case; it did not rerun the combined check or expand testing.

App Hosting's exact source shows backend list/get can silently enable `firebaseapphosting.googleapis.com`. Root and command reference now require non-enabling evidence that it is already enabled in the exact project, or exact authority to enable that service there. Disabled/unknown state without authority stops before invocation. Those commands cannot serve as their own preflight. The focused existing check fails before and passes after the correction; both independent reviews pass.

Remaining limitations are material:

- Harness retains missing `ws` declarations and two optional-details type diagnostics, identical stock/repaired. Firebase's installed `superstatic@10.0.0` declares Node `20 || 22 || 24`; the broader engine diagnostic remains failed on Node 26. No emulator/server compatibility is accepted.
- Private proxy endpoints, real provider credentials/billing, live Claude, service accounts, browser/Directus/Figma/MCP behavior, real Windows and visual TUI acceptance are unperformed. No auth, browser, hosted write or paid model benchmark is authorized here.
- Bridge remains trusted-repository-only. The provider wrapper does not sandbox Claude Code/project hooks; ADR 0010's external Claude-session retention exception remains. Settings/session behavior changes in newer Bridge are not silently adopted.
- A full interactive host may write `extensionChangelogVersions`. The synthetic wrapper tests do not prove otherwise. `lastChangelogVersion` is not advanced manually; preparation leaves it 1.4.0.
- Some CLI proof is help/source/installed-byte proof, not independent registry-signature or reproducible-build proof. Firebase transitive archives lack independent lock-backed registry verification; Klaviyo's installed binary lacks embedded VCS identity. Unchanged upstream PostHog store-test failures remain historical, not relabeled green.
- An earlier investigation role edited without authority; its work was recovered before accepted implementation. Earlier failed/interrupted roles and corrected attempts remain failed evidence, with user-approved continuation. Required increment reviews now have completed passing replacements/corrections. No failure is erased by a later pass.
- Three previously accepted target tests retain four machine-local guard lines for the original installation. The process guard is fixed to this test host (`agent/tests/pi-1.5.2-process-lifecycle.test.mjs:44`). Prompt/read isolation has the same portability limit (`agent/tests/pi-1.5.2-prompt-read-contracts.test.mjs:16-35`). Tool-validation bindings also reject this host's live roots (`agent/tests/pi-1.5.2-tool-validation.test.mjs:18`). Those accepted files remain unchanged under the shutdown-only scope; no portability refactor was added. New documentation and skill changes introduce no literal private home paths.
- Several diagnostic outputs triggered automatic harness-managed `/tmp/pi-bash-*` captures, including a parent over-wide metadata projection. These are disclosed exceptions to strict RUN-only tool-output containment, not test writes or source changes. They contain non-sensitive diagnostics and were not manually read, deleted or treated as accepted evidence. Execution caches/state/logs remain RUN-backed.

No provider token/full-context benchmark was run. Skill descriptions/UI and global/delegated instructions remain unchanged; requested skill/reference and prompt-body text changed. Historical context-cost numbers remain historical, not current measured totals.

## Review, Git and original-state handoff

All accepted increments and corrections have two completed passing read-only reviews; failed roles remain failed historical evidence. Reviewers inspect retained evidence rather than rerun suites. Final accumulated review-a and review-b both completed with PASS and no blocking findings. Both recommend ready with limitations; they inspected retained evidence without rerunning suites. Procedural diagnostic deviations and automatic output spills are disclosed, not described as fully compliant containment.

The final source-path/hash manifest, NUL path list, SHA-256 checklist and unstaged diff summary are under `RUN/reports/final/`. They include intended new source files as well as tracked edits, not private reports or caches. The staged diff is empty. No stage, unstage, commit, push, merge, reset, stash, clean, deployment, global update, shell/PATH-file edit or restart occurred.

Original-state captures preserve `master`, HEAD, the original index SHA-256 `dd77f4131ccfc0eb93c52b57b18c3823338efbbfa16420399ee26f773cb545c7`, status including the formatting-only settings edit, 2,726 untracked paths and all 1,155 protected hashes. Candidate index bytes retain the user-approved `bcdbebe05f1ad9d06be557ae236fb1080a210703e774a214ff6c0bf0e1a84d2d`. The fresh comparison after both final reviews passes all 1,155 protected hashes with unchanged HEAD, branches, indexes and status.

## Later integration: unexecuted procedure

**Every command in this section is unexecuted and requires new explicit authorization for its Git, software-install, cache-cutover or restart action.** Preparation does not grant it. Retain RUN until integration and rollback decisions finish.

1. Review the manifest/diff and limitations. Recheck original state, executable owners, current branches/HEADs and concurrent changes. Do not silently overwrite the existing original settings edit. Obtain the user's decision for preserving that formatting change before source integration. Stop on unreviewed divergence, staged work or new live software changes; never auto-stash/reset/clean.
2. Only after separate staging/commit/merge authorization, verify the exact manifest and stage only its reviewed paths. Do not merge the current branch as-is: it has no new commit yet. The following block also requires a clean, user-resolved original tracked working tree and a reviewed fast-forward relationship.

```bash
cd "$WORKTREE"
test -z "$(git diff --cached --name-only)"
sha256sum --check "$RUN/reports/final/source-sha256.txt"
git add --pathspec-from-file="$RUN/reports/final/source-paths.z" --pathspec-file-nul
git commit -m "Prepare Pi 1.5.2 active setup maintenance"
CANDIDATE_COMMIT=$(git rev-parse HEAD)
git -C "$ORIGINAL" merge --ff-only "$CANDIDATE_COMMIT"
```

3. Obtain a maintenance window. Finish active parent/child/BTW sessions gracefully; do not reload mixed versions or force-kill work. Freeze other Bun/global-tool changes. Before changing software, save exact bytes, links, modes, ownership, manifests and locks for the Bun global installation and Pi entry, the complete installed npm cache with its repairs, both user-local gh/Crit binaries and current non-secret settings. Keep private auth/models/real sessions in place; never copy credentials into this report or restore stale OAuth tokens. If backup metadata contains sensitive material, use a user-approved encrypted backup rather than a plaintext or redacted non-restorable copy. Stop if safe, complete backup is unavailable.
4. Preserve owners. First stage the Bun transaction in a throwaway private prefix and inspect its actual resolutions against the verified 1.5.2 SDK/support graph. A fresh Bun global transaction is not validated by this preparation's npm-built test graph. Stop on dependency/byte drift rather than silently approving it. After that check and explicit installation authorization, the owner-preserving runtime operation is:

```bash
bun add --global --exact --ignore-scripts @earendil-works/pi-coding-agent@1.5.2
```

5. Prepare a byte-verified copy of `RUN/graph-candidate/agent/npm` beside the live cache, not on top of it. The package cache is the payload, not the graph's synthetic settings/models/session files. Confirm no writable live links, correct permissions, selected pins, SDK resolution and complete sibling repairs. With all Pi processes stopped, rename the old live `agent/npm` to a distinct retained sibling and rename the verified pending cache into place. Keep the external pre-change backup too. Check each rename; on a partial cutover, restore the retained sibling before any restart. Do not invoke an installer afterward that overwrites repaired bytes or run a helper directly on live packages.
6. After separate authorization, install only the two prepared user-local CLI binaries at their existing owners. Backups and verification must precede these replacements; do not touch system CRIU or change PATH.

```bash
install -m 0755 "$RUN/reports/s3/native/gh" "$HOME/.local/bin/gh"
install -m 0755 "$RUN/reports/s4/native/crit" "$HOME/.local/bin/crit"
```

All other selected CLI versions are already installed; do not migrate their managers or run bulk updates. Klaviyo 2026.11.7, the three held extension upgrades, unused official PostHog CLI and project SDK migrations stay held.

### Fresh-process verification after authorized integration

Run `command -v pi`, resolve the wrapper/Bun entry, and run `pi --version` from a fresh process; it must report 1.5.2. Check actual installed canonical/legacy SDK versions, selected package entry hashes and all repair fingerprints, not only settings pins. Verify gh 2.103.3 and Crit 0.23.2 at their existing user-local paths with isolated version/help, without login/product commands.

Repeat the existing synthetic SDK and bundled/unbundled RPC check with bindings and read-only mounts explicitly set to the **actual installed** Bun SDK and cache paths, a fresh RUN-owned report/HOME and empty synthetic credentials/models. Its allowed SDK roots, package resolution and entry hashes must match the post-install software. Do not run the unchanged preparation launcher against its old private graph and call that installed acceptance. Deployment-time binding adaptation must preserve the existing network/private/retired/process guards; stop rather than weakening them. Require no extension errors, the same parent/tool/skill/child inventories, reload/resume/tree/compaction/cleanup behavior, cache warming off and correct footer semantics.

Only with separate interactive-start approval, start regular TUI from a trusted repository and inspect wrapper/theme/argv behavior without sending a model prompt or opening a browser. Check settings changes, including possible host `extensionChangelogVersions`; reject unexpected default/account/resource changes. Real provider, proxy, Claude, Windows and visual acceptance remain separate explicit actions. Starting a process is not permission for them.

### Rollback after separately authorized deployment

Stop the new processes gracefully first and preserve any new sessions/history. Restore exact pre-change Bun-global software, manifest/lock and Pi-entry link bytes from the verified backup, not merely a new `bun add` of version 1.4.0. Restore the retained old npm-cache sibling, or its complete backup, including all installed Blackhole/BTW/Harness repairs and stock Bridge bytes. Do not rely on a package reinstall to restore patches. Restore gh 2.101.0 and Crit 0.21.0 from their original byte/mode/owner backups at the same paths; do not alter system packages, Cargo/uv tools or unrelated Bun packages.

Source rollback requires separate user-approved reversal of the integration commit while preserving unrelated edits; do not reset, clean or overwrite later work. If a Git revert is chosen, its staging/commit effects also need explicit authority. Restore only authorized non-secret settings differences. Leave current credentials and real sessions intact unless the user separately authorizes a secure recovery operation; stale OAuth backup tokens can lose login.

Verify the restored live executable reports 1.4.0 and all old installed-package hashes/owners match the backup. Start a fresh 1.4.0 session for rollback verification. **Compatibility of 1.5.2-created sessions with 1.4.0 was not tested**; never silently resume, downgrade, convert or delete them. Any concurrent software/source change or incomplete backup stops automatic rollback for user review.
