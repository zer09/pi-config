# Local Claude Bridge patch

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
