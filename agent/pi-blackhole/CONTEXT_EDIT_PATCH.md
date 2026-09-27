# Local context-edit compaction repair

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
