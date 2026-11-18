# Pi upgrade checks

These files record the Pi 1.5.2 upgrade. They need the exact disposable target, test dependencies, synthetic state and offline runner described in the [preparation record](../../docs/changelogs/pi-1.5.2-full-setup-maintenance-preparation.md). A matching Pi version alone is not enough: some tests bind to earlier plugin versions, package inventories, or files emitted during preparation. Do not run the directory as a general test suite or substitute a live profile for a missing fixture.

For the current installation, use `node --test agent/tests/retired-*.test.mjs` from the repository root. Run the version-specific patch checks in each package's `LOCAL_PATCHES.md` when its repair changes. Earlier upgrade commands refer to the original tree; use revision `d752800` in a separate worktree when reproducing them.
