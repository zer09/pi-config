# Browser Harness local repair

Only the `0.19.1` recipe snapshot helper is maintained. The historical `0.13.0` registration helper and tests mentioned below remain at revision `d752800`; upstream supplies that repair. Do not reapply it.

## 0.19.1 with recipe snapshot repair installed on Pi 1.5.2

The installed cache contains the exact reviewed four-source recipe-snapshot repair and all 43 browser tools. Actual installed-file SDK and bundled/unbundled RPC checks pass. The package skills filter, profile configuration and local consent rules stay unchanged. No browser or daemon was launched. See the [installation record](../../docs/changelogs/three-extension-upgrade-installation.md). Preparation sections below are historical.

## Historical preparation: 0.19.1 with recipe snapshot repair

Increment B initially prepared the complete stock npm package privately. Its registry evidence records latest 0.19.1 and gitHead `fdbf178c8ffd9359c43763a807c411e89ba15af3`. The archive integrity is `sha512-Uztbfgcuo6meeXamMcA9OB9JQD7se/Scn14rEgf0z3T4tupgpMlek9mVDad5DsQ0jy+vQaz5DgKxX/hmp0UDMQ==`. Verification B1 then proved that stock could replay a parsed replacement while approving different bytes reread from its pathname. The revised candidate carries only the guarded recipe snapshot repair below. Original stock acceptance and the failing proof remain historical evidence, not repaired acceptance. Upstream 0.14.1 supplies per-API registration; the 0.13.0 registration helper remains historical and must never run on 0.19.1.

The private exact-version reconciliation changes only Harness and adds acorn 8.19.0. The B1 repair preserves all manifests, locks and dependencies. The existing yaml 2.9.0 satisfies the new dependency and remains unchanged. Bridge 0.12.0 and its dependency closure, repaired Blackhole 0.5.15, BTW 0.8.1 and Pi 1.5.2 remain byte-identical to increment A. The live cache still has repaired Harness 0.13.0. This preparation changes no live package, settings, profile or background preference.

Broad stock-package checks remain local upgrade evidence rather than maintained repository tests. The upgrade's acceptance checks covered 43 unique built-ins, removal of `browser_fill`, the replacement `browser_type` contract, recipes, all four header groups, contributions/retry/client closures and real Pi session replacement. Disconnected startup stays lazy with a real client and fake transport. The actual loader preserves package `skills: []` and the local skill. Increment D now verifies the unchanged policy's five ordered runtime entries with seven active tools and two catalog entries with four core tools, with no Harness or package skills in either child. The final parent SDK and both RPC builds retain 43 browser tools across the full lifecycle; 58 tools are registered, 54 are active, and 25 production extension commands load. See the [combined preparation record](../../docs/changelogs/three-extension-upgrade-preparation.md).

The user accepts upstream persistence and setup behavior, not browser-operation authorization for an agent:

- New journal paths use 0700 directories and 0600 files. Exact password-field values are blanked, but ordinary values, URLs and observed page changes can persist. Header values are not captured. Pruning removes files idle for more than 30 days, not entries older than 30 days; appending extends retention, including older entries in that file.
- Unapproved project recipes fail closed without a UI. Approval tracks exact bytes and parameter values that steer origins or local paths. `confirmAndSave` can write and trust a project recipe noninteractively without a confirmation dialog. Replays can repeat writes without model review between steps.
- Explicitly called setup can launch a closed browser without confirmation in a noninteractive context with a saved profile pin and an available display. Tests inject installed-browser, launch, discovery and daemon dependencies. A synthetic old profile file without `background` loads with `background: false`; foreground remains the default.

Local per-task setup consent, chosen-profile/account, manual-login and hosted-write gates remain authoritative. The local reference changes only stale text-entry routes and adds a concise recipe/journal caution. Root, metadata, classification and package skill filtering remain unchanged.

Original preparation evidence remains under `RUN/b/`; the independent stock failure remains under `RUN/verification-b1/`. Remediation commands, failures, controls, complete fingerprints and final results are under `RUN/b1/`. Strict TypeScript 6.0.3 checks compare all 120 repaired source roots with stock against exact Pi 1.5.2. Repaired candidate and archive reproduce the same three upstream diagnostics: TS7016 for missing `ws` declarations, and TS2322 in `domains/network.ts:44` and `domains/tabs.ts:112`. Focused registration, setup, journal, recipe, header and typing files report no diagnostics; the public contract adds none. This is not a clean whole-package typecheck. No browser, daemon, provider, real profile or live model test runs. The repaired final graph passes all 49 focused Harness checks again and the combined smoke; parent reviews and live cutover remain pending.

### Guarded 0.19.1 recipe snapshot repair

`reapply-recipe-snapshot-patch-0.19.1.mjs` changes only `src/recipes/store.ts`, `trust.ts`, `run-tool.ts` and `command.ts`. The loader hashes original raw bytes before approval. Approval checks that digest, displays and scopes parameters from the matching parsed recipe, and stores that digest. Replay uses the same parsed recipe. A missing or changed file refuses before approval. Comments, newline forms and even different invalid UTF-8 bytes retain distinct identities. Both the actual tool and slash command approve before browser readiness checks.

Save, repair and `last_run` writes return the digest of the serialized bytes the harness wrote. Automatic trust uses that digest, never another pathname reread. A failed write returns no snapshot to trust. Successful harness writes still need no extra approval; the existing parameter-origin and local-path scope rules remain unchanged. This is a narrow source-identity repair, not a browser sandbox or additional authorization.

Apply the new helper only to a fresh SRI-verified extraction under an explicit canonical disposable `TMPDIR`. Never apply it to live or candidate `node_modules`. It preflights all 127 files, source hashes, exact version, canonical paths, links, isolation and every write destination. It rejects drift and partial repairs without changing bytes or mtimes. An exact repeated application preserves bytes and mtimes. Review the exhaustive stock delta and run the helper guards and explicit-target tests before copying the complete exact package into the private candidate. The source entrypoint, package skills filter, journaling and setup code stay unchanged.

| Complete package identity | SHA-256 |
| --- | --- |
| Stock, 127 sorted `[relativePath, sha256]` pairs | `78b72214d79ae3880f36a5a220c94e445154ab7d9ead11d5c3089c7f30dbaa7e` |
| Exact repaired package, same inventory format | `bdbd68882202b36e31459d3eef0de5431300e505f8904f48dfebc675ba6e0748` |

`reapply-recipe-snapshot-patch-0.19.1.test.mjs` covers SRI, full inventory, every file's drift/omission/link refusal, partial states, write preflight, reinstall and idempotence. `../tests/browser-harness-0.19.1-recipe-snapshot.test.mjs` reproduces B1 against stock and tests repaired tool/command refusal with zero client calls, interactive decisions, exact bytes, parameter behavior and concurrent automatic writes. The shared fixture accepts only the explicitly selected verified stock or exact repaired identity. All 31 existing Harness checks remain in the final suite. No candidate is installed live by this preparation.

## Pi 1.5.2 installed

The live cache retains 0.13.0 with per-receiving-API registration, all 42 tools and the skills filter. Installed bytes and fresh SDK/RPC checks pass without launching a browser. The three upstream type diagnostics and untested visual/Windows behavior remain limitations. See the [installation record](../../docs/changelogs/pi-1.5.2-full-setup-installation.md). Earlier preparation facts remain unchanged below.

## Pi 1.5.2 full-setup preparation, not deployed

Retain 0.13.0 and the unchanged per-receiving-API repair. Actual selected-graph SDK and bundled/unbundled RPC loading preserves all 42 browser tools across reload/resume/tree operations with lazy disconnected startup. The `skills: []` filter, settings and consent/profile/header boundaries remain unchanged. Version 0.17.0 stays held because it changes tools/setup and persistent recipe behavior.

Stock and repaired source reproduce the same three upstream strict diagnostics on exact Pi 1.5.2; registry/public-boundary diagnostics remain zero. This is not a clean whole-source typecheck or browser/Windows acceptance. See the [full preparation record](../../docs/changelogs/pi-1.5.2-full-setup-maintenance-preparation.md) and `RUN/reports/s10`. No helper ran on a live package and no browser/daemon was launched.

## C2 combined preparation, not deployed

C2 reconstructs a fresh offline graph and applies the accepted helper only to canonical TMPDIR source. All 99 package files are verified before and after copying into the isolated cache. The sole production delta remains `src/registry.ts`; the published source entrypoint and 42 tools remain unchanged.

The C2 graph passes the 23 focused guard/registry/header/SDK/CLI/child tests and the combined bundled/unbundled CLI/RPC matrix. Parent inventories remain 57 registered / 53 active / 42 browser with 24 commands across reload, same-process resume, real tree movement and restoration. Children retain five ordered runtime entries, two catalog entries and seven active tools, with no browser tools. Tests use fake clients, denied transports and synthetic sessions.

`browser_set_headers` overrides persist per owned tab. Clear overrides with `browser_clear_headers` before cross-origin navigation, reuse or handoff. Header values do not appear in successful tool results; this does not make arbitrary header use safe. These upstream tool instructions do not alter local access consent, setup, profile, account, login, secret-handling or mutation policy. Keep package `skills: []` and `agent/browser-harness.json` unchanged.

Exact commands, complete inventories and the reusable explicit-target offline smoke are in `RUN/reports/increment-c2/`. The identical three stock/repaired upstream strict diagnostics remain explicit; registry and public-boundary diagnostics remain zero. Parent-owned reviews, live deployment and installed-byte acceptance remain separate. The user cancelled shutdown; no Windows power operation is authorized. The C1 record below is historical preparation evidence.

## pi-browser-harness 0.13.0: per-runtime registration

Prepared and tested in an isolated C1 target. This document does not record live deployment or final integration acceptance.

Stock `src/registry.ts:101-132` shares one registered-name Set across receiving Pi APIs. Pi 1.4.0 can reuse the cached Harness factory after replacing the runtime. The replacement API then receives none of the 42 browser tools.

`reapply-runtime-registration-patch-0.13.0.mjs` changes only that bookkeeping. Repaired `src/registry.ts:104-105,128-137` uses `WeakMap<ToolRegistrar, Set<string>>`. Each receiving API gets its own registered-name Set. The shared registry, contribution names, insertion order, atomic duplicate rejection, and mark-after-success loop remain unchanged. Repeated calls on one API preserve the original tool closures and client bindings. Late contributions reach each API on its next registration call. Failed registrations remain retryable.

The published `./src/index.ts` entrypoint, factory, tool defaults, header tools, settings, and package dependencies remain unchanged. Keep the Harness package's `skills: []` filter and existing browser consent and profile rules.

## Guarded application

1. Extract the verified `pi-browser-harness@0.13.0` archive into a new disposable directory below an explicitly set canonical `TMPDIR`.
2. Run `node reapply-runtime-registration-patch-0.13.0.mjs "$TMPDIR/extraction/package"` with the actual extracted path.
3. Verify the resulting complete source fingerprints before copying bytes into a separate isolated installation.

Do not run the helper on an installed package, repository target, stock reference, or live cache. The helper has no default target. It refuses noncanonical paths, targets outside `TMPDIR`, repository targets, `node_modules`, linked files or directories, hard-linked files, unexpected files, missing files, empty directories, wrong versions, partial repairs, and source drift. It preflights all 99 artifact files before writing the single registry file. An exact second application preserves bytes and mtimes.

Artifact identity:

| Item | Identity |
| --- | --- |
| Archive SRI | `sha512-RP0AK9RZJkkse4fQ4TQ1Tip5mAZVYAE2fmstowiGz4oT4mLlnbY8ecvXhEybiAgkTiIhHMLXSKE9T6imWi3cng==` |
| Complete stock manifest SHA-256 | `c8833eb4ef6ca35a5502e2961cf643257c25fb0c5f75fe2d5bdad34599a151e7` |
| Stock registry SHA-256 | `3c89a038bff1bbac37122630869e6b07479b072abb4a680cb7e25d9c5460da41` |
| Repaired registry SHA-256 | `eac2aa3a71ed2dac0caf32ca65952c3f27fcdca300206cdb91a3cddd9d5f8299` |
| Unchanged index SHA-256 | `ac44cc18027b7960039be5200198cb3fe219285f3835646c713e9becd1596a95` |

The complete manifest hash covers UTF-8 `JSON.stringify` of all 99 `[relativePath, sha256]` pairs, sorted by path using code-unit order. The helper reverses only the complete intended registry transformation in memory before verifying this identity. No manifest file from the target controls verification.

## Focused acceptance

- `reapply-runtime-registration-patch-0.13.0.test.mjs`: SRI, full identity, every file's drift/omission/link refusal, first application, byte/mtime idempotence, partial-state refusal, unsafe targets, and write preflight.
- `../tests/browser-harness-0.13.0-registration.test.mjs`: 42 built-ins on two APIs, repeated notifications, both contribution orderings, cold replacement, atomic duplicates, actual `defineBrowserTool` client closures, and registration retry.
- `../tests/browser-harness-0.13.0-lifecycle.test.mjs`: actual selected Pi 1.4.0 CLI/RPC same-process resume, fresh/stale API identity, repeated replacement notifications, both headers, and unchanged 24 production commands. The stock control fails only the healthy inventory assertion. The repair retains 57 registered / 53 active / 42 browser tools.
- The Pi 1.4.0 inventory snapshot is historical (`git show a64a72c:agent/tests/active-package-inventory.test.mjs`). Its maintained successor checks that old sessions keep current tools after reload, tree navigation and resume, without pinning package-wide tool counts: `node --test agent/tests/retired-session-tools.test.mjs`.
- `../tests/browser-harness-0.13.0-child-boundaries.test.mjs`: actual runtime/catalog CLI loadouts. Runtime retains five ordered entries and seven active tools, with 11 registered tools including four inactive built-ins. Catalog retains two provider entries. Neither profile loads Harness.
- `../tests/browser-harness-0.13.0-headers.test.mjs`: all four existing header groups, using fake clients and transports.

Tests require explicit isolated paths and `PI_OFFLINE=1`. C1 evidence and exact commands are under `RUN/reports/increment-c1/`. Execution uses cleared environments, network-denied bubblewrap, disposable state, and fake provider/client/transport dependencies. No real browser, daemon, profile, provider request, or live resource is needed.

Strict TypeScript 6.0.3 comparison covers 86 source roots against selected Pi 1.4.0 declarations. Stock and repaired source have the same three baseline diagnostics: missing `ws` declarations and existing details-type errors in `domains/network.ts` and `domains/tabs.ts`. The registry and public registrar boundary have zero diagnostics. This is a no-new-diagnostics result, not a clean full upstream typecheck.

C2 must independently reconstruct the full final dependency graph and run the remaining combined package and maintained local suites. Both parent-owned reviews, final installation acceptance, deployment and changelog remain outside this C1 implementation role.
