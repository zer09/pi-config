# Browser Harness local repair

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
- `../tests/active-package-inventory.test.mjs`: SDK startup, fake completion, reload, resume, actual tree movement/restoration, and old-loadout invariants. Tree targets differ from the current leaf because Pi treats same-leaf navigation as a no-op.
- `../tests/browser-harness-0.13.0-child-boundaries.test.mjs`: actual runtime/catalog CLI loadouts. Runtime retains five ordered entries and seven active tools, with 11 registered tools including four inactive built-ins. Catalog retains two provider entries. Neither profile loads Harness.
- `../tests/browser-harness-0.13.0-headers.test.mjs`: all four existing header groups, using fake clients and transports.

Tests require explicit isolated paths and `PI_OFFLINE=1`. C1 evidence and exact commands are under `RUN/reports/increment-c1/`. Execution uses cleared environments, network-denied bubblewrap, disposable state, and fake provider/client/transport dependencies. No real browser, daemon, profile, provider request, or live resource is needed.

Strict TypeScript 6.0.3 comparison covers 86 source roots against selected Pi 1.4.0 declarations. Stock and repaired source have the same three baseline diagnostics: missing `ws` declarations and existing details-type errors in `domains/network.ts` and `domains/tabs.ts`. The registry and public registrar boundary have zero diagnostics. This is a no-new-diagnostics result, not a clean full upstream typecheck.

C2 must independently reconstruct the full final dependency graph and run the remaining combined package and maintained local suites. Both parent-owned reviews, final installation acceptance, deployment and changelog remain outside this C1 implementation role.
