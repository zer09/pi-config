# Local context-edit compaction repair

## Current isolated preparation: Blackhole 0.5.15 with Pi 1.4.0

The three `-0.5.15.mjs` helpers are isolated preparation, not a live deployment. Settings, package pins and configuration bytes remain unchanged. Apply percentage, nullable-header and context-edit helpers in that order to an explicit canonical disposable extraction under `TMPDIR`. The helpers refuse repository, `node_modules`, linked, shared, wrong-version, drifted and partial targets before writing. The manifest selects patched `./index.ts`; the published bundle remains stock.

The context helper changes only `src/hooks/before-compact.ts`. It applies the public Pi projection to normal and early unobserved fresh-summary inputs. Fresh summaries remain message-only. The separate capacity view also applies selected active custom-message omissions and replacements. Omitted custom entries retain their raw IDs/order as zero-content anchors so tail slicing and pressure cuts remain valid. Raw branch entries still own source IDs, references, recall, coverage and OM ledger operations. Previous summaries and existing OM content are not redacted. No-edit cuts retain stock 0.5.15 behavior, including its later minimal split-turn cut.

Hook SHA-256 values:

- Stock: `8bf4a1eeb40fe2016b911aaa1b0f178d9a53da594644bbe0f7e69cdf0e83afaa`
- Repaired patched hook: `b9f771eb57d8d0580ced08553a5241d72c478f9b0632db21e8b0873381fdc823`
- Repaired context helper: `6d3b7a30473eb5f2a697544203c3f3991da36b038c77426fb3cbb5b367368da8`
- Superseded pre-remediation hook: `6dbbf1f056cc828d5b154141d42f5ff0243ecee60628b374856faf3cd8ea07e1`

The repaired focused complete-chain suite passes 52 tests and three strict typechecks against exact Pi 1.4.0. The eight context groups include 396 stock cut/cancel comparisons, active/latest/off-branch edits, omitted boundaries, actual fresh summaries and append segments, source-index gaps, conversion drops, tool pairing, raw synthetic JSONL/recall, previous summaries and OM preservation. Pressure tests exercise three bridges, twelve cancellations and three preferred-tail results. The four adapted historical settled/queued/replacement/shutdown fixtures retain their lifecycle assertions.

B1 remediation corrects the earlier capacity view, which left custom messages raw. Public Pi omission/growth controls now match canonical projected-stock decisions in all eight combinations, with eight matching no-edit controls. A 20,011-character omission now permits compaction (projected context 176 tokens). Growth from five to 20,017 characters now cancels (otherwise 5,181 tokens), against capacity 900. Retained custom boundary anchors, latest edits, off-branch exclusion and raw history/ID/ledger preservation also pass. The test comparator now projects custom content instead of leaving it raw. Earlier B success claims did not cover this defect.

Repaired evidence, fresh roots and exact commands: `/home/gc/worktree/pi-extensions-1.4.0-iZ3kXz/reports/increment-b/remediation-b1/`. Pre-remediation B roots and logs remain historical reproduction evidence. Tests use cleared environments, disposable state and network denial. Optional unobserved and pressure settings appear only in synthetic fixtures, not user configuration. Upstream supersession, decision capture and reflection timestamps remain stock. The inherited `showPreCompactionMessage` loader limitation remains. Combined package reconciliation and deployment are deferred.

## Historical isolated port: Blackhole 0.5.12 with Pi 1.1.0

The new `reapply-context-edit-compaction-patch-0.5.12.mjs` retains this repair's exact transformations. Stock 0.5.12 still has the hook bytes recorded below. Its version-specific prerequisites pin the complete percentage and nullable-header ports before the hook changes. Apply the three `-0.5.12.mjs` helpers in that order to an explicit disposable extraction under `TMPDIR`, never an installed `node_modules` target. The manifest selects patched `index.ts`.

The isolated target SDK passed the existing context-edit fixture mode, including 162 unedited cut/cancel comparisons, active/latest/off-branch edits, both tail policies, checkpoint preservation, raw references, fresh summaries, raw recall, and unchanged prior JSONL. All four existing settled/queued/replacement/shutdown fixtures also passed in RUN-adapted copies with their assertions intact. The repair still changes only fresh compaction input. It does not rewrite raw history or earlier memory.

See `LOCAL_PATCHES.md` for the three-patch SRI, guards, worker checks, package suite, and baseline quiet-setting limit. Evidence is under `/home/gc/worktrees/pi-config-1.1.0-UkWvry/reports/blackhole-b-*`. This is preparation, not live deployment.

## Historical 0.5.8 repair

This increment targets `pi-blackhole@0.5.8` with Pi `0.87.1`.
It changes only the installed `src/hooks/before-compact.ts`.
The existing percentage and nullable-header helpers remain unchanged.

## Behavior

`buildOwnCut()` still selects Blackhole's raw live window. It then uses the public
`@earendil-works/pi-coding-agent` root `buildSessionProjection()` export to apply
selected `context_edit` entries to editable messages before choosing the cut.
Omissions remove fresh summary input. Replacements keep the raw source ID and
message metadata. An omitted cut boundary resolves to the next unomitted message.

Unedited cut/cancel behavior, both tail policies, system/tool checkpoints and raw
`#N` references remain unchanged. This does not add `custom_message` or
`branch_summary` contributions. Previous summaries and observational memory remain
on their existing paths. Raw recall and stored history are not redacted.

**Limit:** this repairs fresh compaction input, not content already copied into
summaries or observational memory. It does not change background memory workers.

## Reapply

Run from `/home/gc/.pi` after reinstalling the exact package version:

```bash
node agent/pi-blackhole/reapply-compact-after-percent-patch.mjs
node agent/pi-blackhole/reapply-nullable-provider-headers-patch.mjs
node agent/pi-blackhole/reapply-context-edit-compaction-patch.mjs
```

All helpers accept an optional package directory. The new helper requires the
source entrypoint enabled by the percentage patch. It rejects another package
name/version, partial patches and any whole-file drift before writing. A second
application is byte-identical. Restart Pi or run `/reload` to activate the hook in
an already running process. This increment did not reload the active session.

Stock hook SHA-256:
`910e44fc74934293e0317eb914ac4ea94976e820043ff4dae0bde915ca5337ab`

Patched hook SHA-256:
`0898de0d68af964968087a18741c69b4211dc5289d7c685422c8e632fcbbcf1b`

## Verification

These commands passed from `/home/gc/.pi`:

```bash
node --test agent/pi-blackhole/reapply-context-edit-compaction-patch.test.mjs
node --test agent/pi-blackhole/reapply-local-patches.test.mjs
node /home/gc/.bun/install/global/node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --esModuleInterop --allowImportingTsExtensions --strict --types node --typeRoots /home/gc/.pi/agent/npm/node_modules/@types /home/gc/.pi/agent/npm/node_modules/pi-blackhole/index.ts
```

The new test obtains clean stock with `npm pack --offline --ignore-scripts`, using
empty npm configuration paths. It applies all three local patches, hashes every
package file, repeats all three helpers, and simulates reinstalling clean stock.
It also verifies rejection without writes for version drift, stock/patched source
drift, a partial patch and an inactive source entrypoint.

The isolated fixture child uses Pi's public extension loader and the actual hook
and compiler. It has a temporary HOME/agent directory, no inherited provider
environment, `cacheWarming: "off"`, and blocked network calls. Checks include:

- 162 stock cut/cancel comparisons.
- Omission, replacement, latest selected edit and off-branch edit exclusion.
- Both tail policies, split-turn and omitted cut boundaries.
- Retained, self-ID, sentinel, orphan and nested compactions.
- System/tool checkpoints and partial tool-call replacement.
- Raw source ID gaps, actual summary `#N` references and excluded entry types.
- Previous summary, observational memory, raw recall and synthetic stored JSONL.

The same fixture child passed against the installed package after application:

```bash
env -i PATH=/home/gc/.nvm/versions/node/v24.18.0/bin:/home/gc/.bun/bin:/usr/bin:/bin HOME=/tmp/blackhole-context-edit-proof-7S3WQ4/installed-smoke PI_CODING_AGENT_DIR=/tmp/blackhole-context-edit-proof-7S3WQ4/installed-smoke/agent PI_BLACKHOLE_PACKAGE_ROOT=/home/gc/.pi/agent/npm/node_modules/pi-blackhole node /home/gc/.pi/agent/pi-blackhole/reapply-context-edit-compaction-patch.test.mjs --fixtures /home/gc/.pi/agent/npm/node_modules/pi-blackhole /tmp/blackhole-context-edit-proof-7S3WQ4/stock/package /tmp/blackhole-context-edit-proof-7S3WQ4/installed-smoke
```

A source bundle also passed against the byte-identical isolated patched package:

```bash
/home/gc/.pi/agent/npm/node_modules/.bin/esbuild /tmp/blackhole-context-edit-proof-7S3WQ4/typed/package/index.ts --bundle --platform=node --format=esm --target=es2022 --packages=external --outfile=/tmp/blackhole-context-edit-proof-7S3WQ4/typed/bundle.mjs
```

The published package omits its tsconfig and upstream tests. `tsup` was unavailable,
so verification used explicit TypeScript 6.0.3 options and the available esbuild,
not the package's `npm run build`. No dependencies were fetched.

Installed-package hashes before/after application showed only the hook changed.
The second installed application changed no bytes. Existing local helpers,
`LOCAL_PATCHES.md` and Blackhole config retained their initial hashes. The real
`cacheWarming` setting stayed `"off"`. No providers, original sessions or credentials
were accessed. No Git staging, commits, pushes or hosted changes were made.
