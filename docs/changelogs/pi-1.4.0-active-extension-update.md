# Active extension update on Pi 1.4.0

## Result

Installed the accepted package graph and reviewed repository files. Required offline tests, both final reviews and all five post-installation smoke suites passed. The current Pi process was not reloaded. Start a fresh Pi session to load the installed versions.

| Active package | Installed version | Local repair |
| --- | --- | --- |
| `pi-blackhole` | 0.5.15 | Percentage compaction, nullable provider headers, context-edit-aware fresh summaries and capacity |
| `pi-btw` | 0.8.0 | Restored credential-synchronization cancellation signal |
| `pi-browser-harness` | 0.13.0 | Registration tracked per receiving Pi API |
| `pi-claude-bridge` | 0.9.3 | Stock; transcript-order repair remains retired |
| `@schultzp2020/pi-cursor` | 0.5.3 | Stock; already current |

These versions match the approved registry snapshot. Custom local extensions were preserved and tested, not replaced with unrelated upstream code.

## Installation and preservation

Preparation used `~/worktree/pi-extensions-1.4.0-iZ3kXz/worktree`, branch `update/pi-extensions-1.4.0-iZ3kXz`, based on `2d4166f51b14f74173537fef4e2c962e2a707a62`. Changes were then applied unstaged to the original `master` worktree. No commit, merge, push or current-session restart occurred during this extension update.

The fresh package graph used exact manifests and locks, scripts-disabled offline installation and the supported exact Pi package installer. Guarded helpers ran only on verified disposable extractions. The live cache received those verified bytes through an atomic directory exchange, not direct helper execution against `node_modules`.

- Canonical Pi packages and required legacy aliases resolve to 1.4.0. Exact support versions remain those accepted in the task contract.
- Root npm package metadata and 131 additional existing file/link entries were preserved. No unrelated package pruning occurred.
- The test-only TypeScript link is absent from the live cache and post-installation copy.
- The concurrent `lastChangelogVersion: 1.4.0` change was preserved. Only the Blackhole and Harness package selectors changed in settings.
- Harness retains object-form `skills: []`. Browser configuration, local browser policy, Blackhole configuration, routing and global Pi installation remain unchanged.
- Retired CodeGraph and Context Mode trees, including their private dependencies, remain unchanged and excluded.
- Windows shutdown was cancelled. No shutdown command was scheduled or executed.

## Verification

The complete selected graph has 21,814 tested production files/links. The installed graph additionally preserves 131 existing entries. Installed bytes and links matched the prepared graph before and after copying for offline tests.

- Blackhole: 52 focused tests, three clean strict checks, 396 stock cut/cancellation comparisons and the repaired custom-message capacity matrix.
- Harness: 23 focused checks. Actual session replacement retains 57 registered / 53 active / 42 browser tools and 24 commands. Repeated notifications do not register duplicate tools.
- BTW: six guarded checks, six history/lifecycle/restart checks and 173 upstream tests each for stock and patched source.
- Bridge: 330 upstream tests, provider-only/refusal/rollback and encoder checks, plus five summary-ownership cases with zero Bridge SDK requests from Blackhole.
- Cursor: 141 wire tests.
- Delegated runtime: 1,632 tests across 26 files; 58-file strict check with zero diagnostics.
- Footer/startup/theme, wrapper, theme synchronization, web-search, mocked GitHub CI, aliases, Fastlane and retirement checks passed.
- Both final accumulated reviews passed without blocking findings.
- Post-installation verification ran 28 tests in five suites against an explicit disposable copy of the actual installed graph: SDK, Harness registry/headers, resume/child boundaries, unbundled CLI/RPC and bundled CLI/RPC. All passed, and the copied input remained unchanged.

Children retain five runtime entries, two catalog entries and seven active tools. Browser tools, AskClaude and retired tools do not enter children.

## Limits and retained failures

Acceptance uses fake providers, fake browser clients and synthetic sessions in network-denied disposable environments. It does not claim live browser/provider, native Claude executable or visual TUI validation.

Harness retains three unchanged upstream full-source type diagnostics, with zero new registry/public-boundary diagnostics. Bridge's previously accepted full-source strict baseline remains non-clean; required local strict boundaries pass. MCP retains its published package-root export gap; active subpaths pass. Complete Blackhole/Harness upstream suites are absent from the published archives. Blackhole's inherited `showPreCompactionMessage` loader limitation remains.

Historical failures and corrected fixtures remain recorded. The first parent post-installation copy omitted the required cache `.gitignore`; the identity check rejected that copy before package execution. A complete new copy passed without changing installed bytes or relaxing assertions. C2 also disclosed one non-sensitive tool-managed diagnostic spill outside RUN at `/tmp/pi-bash-e7c9867486a4a94c.log`.

## Evidence and backup

Use `RUN=~/worktree/pi-extensions-1.4.0-iZ3kXz`:

- Final prepared graph and acceptance: `RUN/reports/increment-c2/`.
- Passing installed-copy smoke: `RUN/reports/increment-c2/smoke-L7Egg7/`.
- Deployment preflight, exact inventories and final result: `RUN/deployment/`.
- Original npm cache: `RUN/deployment/backup/npm/`.
- Original changed repository files: `RUN/deployment/backup/repository/`.

Keep the backup until a fresh Pi session has been checked. A package reinstall can overwrite local repairs; use the version-specific guarded procedures rather than patching installed sources directly.
