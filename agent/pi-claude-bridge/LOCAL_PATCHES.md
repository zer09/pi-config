# Local Claude Bridge patch

## 2026-10-01: isolated `pi-claude-bridge@0.9.1` on Pi 0.99.2, not deployed

The worktree pin and disposable runtime use exact Bridge `0.9.1` and exact
Claude Agent SDK `0.3.284`, the minimum version allowed by Bridge's `^0.3.284`.
The installed Linux SDK package also uses `0.3.284`. No unrelated dependency
changes. The SDK has no required dependencies; its peer ranges are unchanged.
Registry metadata and SHA-512 SRI verify the downloaded archives. Bridge SRI:
`sha512-ysKygf8sZOae+mhkKsFd567F7iZUB+1pDCYlQ2WK8h2z+7wJI//LJYofDdhZ8rv7M+k1H/BeFJ/d9w2EuN1j5A==`.
SDK SRI:
`sha512-NSoJwEq6nFSf8dtaacYx37QdGgqApI3eHFUlxclMLYi8irb6ZJwEaUnPnLUCyAyg9W/tMkgZC0GXWLRCc01I0w==`.

`reapply-transcript-order-patch-0.9.1.mjs` preserves the accepted ordering rule:
unknown sections follow all canonical built-ins, in stable relative replay order,
including after addendum deletion and re-addition. Upstream now uses Pi's public
transcript utilities. The patch leaves exact capture lookup, tool replay, and
non-system history filtering unchanged. The 0.8.0 helper and tests remain intact.

The new helper requires an explicit extracted package under the isolated
`TMPDIR`, outside the repository and `node_modules`. There is no default target.
Name, exact version, whole-source stock/patched hashes, and unlinked-file checks
run before writes. Drift rejects without changes. Reapplication preserves bytes,
mtime, and ctime. Only `src/transcript.ts` changes in the published package:

- Stock SHA-256: `ceb93d567a76d7a5ac03ef7f55c9b437c6bcb8dda2dc82253840df16eaa716f5`
- Patched SHA-256: `6489bf4e87841ee193987f9787770c7f32e5db57d8389fb47c7d9b69bdb567fd`

For a disposable stock extraction, use the helper with an explicit target:
`node agent/pi-claude-bridge/reapply-transcript-order-patch-0.9.1.mjs "$TMPDIR/isolated-package"`.
The new helper test requires `PI_CLAUDE_BRIDGE_0_9_1_TARBALL` and
`PI_BRIDGE_TEST_NODE_MODULES`; it never downloads or selects a live cache.

Focused checks pass: six helper subtests, strict stock/patched transcript type
checks against Pi 0.99.2, and the adapted real-Pi lifecycle test with four exact
capture/SDK wire turns. RUN-only copies change version pins, the helper import,
and timestamps required by public transcript replay. Existing ordering, tool,
history, and transport assertions remain active; fake transport also rejects real
auth. Runtime replacement preserves all unrelated package bytes and mtimes,
including the earlier Blackhole and BTW patches, without npm pruning.
Combined load and CLI checks pass once after the update: 14 extensions, 62 active
tools, 25 CLI commands, zero extension errors, and six expected offline-model
warnings. Tool, command, skill, and theme inventories remain unchanged.

Evidence, fixture copies, exact commands/exits, and logs remain outside the
worktree under `/home/gc/worktrees/pi-0992-20261001T105108Z-57871/`, in
`reports/bridge-*.json`, `reports/bridge-*.log`, and `reports/commands.jsonl`.
The original installation is unchanged. No live reapply, deployment, login,
provider inference, or new tool/command/resource configuration was performed.

## Historical 0.8.0 patch on Pi 0.87.1

## Unknown-section ordering

This patch targets published `pi-claude-bridge@0.8.0` with Pi `0.87.1`.
Only `agent/npm/node_modules/pi-claude-bridge/src/transcript.ts` changes.

Stock replay gives an unknown section its predecessor's rank. After an addendum
is deleted and re-added, a new extension section can sort before `cwd`. Pi's
canonical builder appends extension sections after built-ins. The difference
breaks exact prompt-capture lookup before the fourth turn reaches the SDK.

The patch gives unknown sections a shared rank after every known built-in.
Stable sorting preserves their relative replay order. Known ranks, exact capture,
tool replay, and non-system filtering stay unchanged.

## Reapply and activate

Run these commands from `/home/gc/.pi` with Node `24.18.0` or a compatible Node
version that supports `registerHooks` and `stripTypeScriptTypes`.

1. Check the patch in memory before changing the installed package:

   ```sh
   PI_CLAUDE_BRIDGE_TEST_PATCH=1 node --test agent/pi-claude-bridge/*.test.mjs
   ```

2. Apply the local helper after the checks pass:

   ```sh
   node agent/pi-claude-bridge/reapply-transcript-order-patch.mjs
   ```

   An optional positional argument selects another package root. The helper
   requires the exact package name, version, and whole-file stock SHA-256.
   Exact patched bytes are a no-op, including file timestamps. Any other source
   fails without a write, even if patch anchors still match. Do not bypass drift.

3. Check the installed source without the in-memory patch:

   ```sh
   node --test agent/pi-claude-bridge/*.test.mjs
   git diff --check
   ```

4. Restart Pi or run `/reload` while idle. Editing disk does not replace code
   already loaded by an active session. This remediation does not reload Pi.

Package reinstall or update can remove the ignored source edit. Reapply after
reinstalling stock `0.8.0`. Recheck the contract before using another bridge or Pi
version. No installation hook or package-manager setting is changed.

## Verification and limits

The helper test reads the SHA-512-pinned published `0.8.0` tarball from the local
npm content cache. `PI_CLAUDE_BRIDGE_TEST_TARBALL` can select an existing offline
copy with the same digest. A missing cache is a test failure, not a download.
Tests extract into temporary directories and simulate reinstall without npm or
install scripts. They check drift rejection, byte-idempotence, other-file hashes,
and TypeScript transformation plus module compilation.

The lifecycle regression uses real Pi, bridge, and SDK serialization with a fake
CLI transport. All four turns must succeed with exact prompt/capture matches and
four SDK requests. Temporary HOME, agent, and cache directories exclude personal
resources and credentials. Cache warming is off. Network, browser launches, and
real subprocess attempts fail the tests. No real Claude or paid inference runs.
This focused ordering coverage passes with the real Pi lifecycle and fake SDK transport.

`src/transcript.ts` SHA-256:

- Stock: `0288ae8f565921ed4449bbfd250f4e32dd0104cc347d1f414aaa9c1902b50960`
- Patched: `d4583d9739b3d9a65d0b458c6d50261a7fe8dc8a07ef5e7fce81b1a904b05427`
