# Pi Browser Harness skill update process

## Ownership and source input

- Local runtime: `agent/skills/pi-browser-harness/`.
- Source input: the installed `pi-browser-harness` package's bundled `skills/pi-browser-harness/SKILL.md` and package tool documentation.
- Classification: `make it slim`. The local root owns consent, account boundaries, tool routing, and completion. Detailed tool selection, diagnostics, and script APIs live in directly linked references.
- The user-owned skill is the authority for local browser-access consent. The package's bundled skill is disabled in Pi settings so a package update cannot replace this policy. Preserve that configuration; do not edit settings as part of a skill-only update.

Upstream/package guidance is input, not final truth. A local overlay edit is not a package sync and does not change package versions or recorded provenance.

## Installed package: 0.19.1 with recipe snapshot repair

The reviewed package is installed and passes actual installed-file SDK and bundled/unbundled RPC checks. The package skill exclusion, profile and local consent rules remain unchanged. No live browser call occurred. See the [installation record](../changelogs/three-extension-upgrade-installation.md). The preparation evidence below remains historical.

## Historical preparation: 0.19.1 with recipe snapshot repair

Increment B prepares Harness 0.19.1 on exact Pi 1.5.2 in the private upgrade graph. Original registry evidence verifies latest, gitHead `fdbf178c8ffd9359c43763a807c411e89ba15af3`, SHA-512 integrity and all 127 stock files. B1 verification proved a stock recipe approval mismatch. The revised candidate therefore carries a narrow exact-byte snapshot repair, not stock-only source identity. See [package preparation and guarded repair notes](../../agent/pi-browser-harness/LOCAL_PATCHES.md). Upstream registers per receiving API, so the candidate needs no 0.13.0 registration repair. Preserve the historical registration helper and its tests, but never apply it to 0.19.1. The live repaired 0.13.0 installation remains unchanged.

Use only `agent/pi-browser-harness/reapply-recipe-snapshot-patch-0.19.1.mjs` on a fresh SRI-verified canonical disposable extraction under explicit `TMPDIR`. The helper preflights full package identity, version, source hashes, links, partial states and write destinations. Run its guard tests, inspect the exact four-file recipe delta, and validate explicit-target tests before copying complete verified bytes into the private candidate. Never run a helper on live or candidate `node_modules`. The loader's raw-byte digest binds parsing, approval, parameter scope and replay. Automatic save/repair/last_run trust uses only the bytes the harness wrote; another writer cannot borrow that trust. Journaling, setup, dependencies, entrypoint and package skills remain unchanged.

Exact private npm reconciliation uses `pi-browser-harness@0.19.1 --save-exact --ignore-scripts --legacy-peer-deps --no-audit --no-fund` with sanitized HOME and a private cache. Acquisition is separate from offline execution. Only Harness and acorn 8.19.0 change; existing yaml 2.9.0 remains unchanged. This is preparation, not authorization to install or change live settings.

The measured inventory is 43 unique browser tools. `browser_fill` is removed; `browser_type` takes `text`, optional `ref`/`selector`, and optional `clear`. A named field defaults to replacement, no target defaults to appending into focus, and a failed named-field typing attempt can fall back to setting the value directly. Recipe tools are added. Adapt only the matching tool reference, not the local root, metadata, description or `make it slim` classification.

Accepted upstream behavior needs truthful local guidance:

- Journals retain ordinary arguments, URLs and page changes. Exact password-field values are redacted; header values are not captured. New paths use 0700/0600 permissions. Pruning is based on file inactivity beyond 30 days, not entry age. Appending extends retention for the whole file, including old entries.
- Project replay requires approved file bytes and approval of origin- or local-path-changing params. An unapproved project recipe fails closed without a UI. Saving can write and trust a project recipe without a UI; replay can repeat hosted writes without a model between steps. Package approval is not the user's authorization for those actions.
- Setup can launch a closed browser without a confirmation dialog when called noninteractively with a saved pin and available display. This capability does not authorize agents to call setup or probe before the local Required User Setup Gate. Preserve user-run setup, manual login and chosen-profile boundaries. An old profile file without `background` reads as false; do not enable background mode as part of preparation.

The one-time local 0.19.1 package acceptance suites used synthetic HOME, agent/Claude directories and sessions, network-denied bubblewrap and fake dependencies. Maintained coverage keeps the recipe-snapshot regression test, its shared fixture and the guarded repair helper tests; broader stock-package and integration suites remain local evidence. They cover explicitly verified stock or exact repaired identity, registration/replacement/retry/contributions, typing, all four header groups, journals, recipes, saved-profile setup, real Pi replacement and the actual package skills filter. B1 tests reproduce the stock mismatch and verify repaired tool and slash-command refusal before any client call, exact raw bytes, interactive decisions and concurrent harness writes. Increment D now verifies the unchanged five-entry runtime with seven active tools and two-entry catalog with four core tools, with no browser or package skills in either child. The final parent SDK and both RPC builds retain 43 browser tools, the package skill exclusion and the user-owned local skill. Repaired candidate and archive reproduce three identical upstream strict diagnostics, not a clean full typecheck. Original evidence remains read-only in `RUN/b/` and `RUN/verification-b1/`; new remediation evidence is in `RUN/b1/`; no real browser, daemon, provider, profile or model operation is part of this preparation. All 49 focused Harness checks pass again on the final graph. Combined preparation is complete; final reviews and live cutover remain pending. See the [combined preparation record](../changelogs/three-extension-upgrade-preparation.md).

## Historical preparation: 0.13.0, isolated and not deployed

The active-extension candidate selects 0.13.0 on exact Pi 1.4.0. It adds `browser_set_headers` and `browser_clear_headers`, bringing the browser inventory to 42. A guarded local repair tracks registration per receiving Pi API, so cached Harness modules can register into replacement runtimes. See [the repair and guarded application procedure](../../agent/pi-browser-harness/LOCAL_PATCHES.md).

Apply the version-specific helper only to a fresh verified canonical TMPDIR extraction. Copy complete verified package bytes into an isolated cache after supported exact-version reconciliation. Never run the helper directly on `node_modules` or a live installation. Preserve the object-form `skills: []` filter, browser configuration and all local overlays below.

Header overrides persist per owned tab. Clear them before cross-origin navigation, tab reuse or handoff. Tool results omit header values, but access consent does not authorize sending secrets or making unrequested mutations. The local skill runtime files need no rewrite for this package preparation.

C2 evidence is under `RUN/reports/increment-c2/`. It covers fresh offline reconstruction, fake-client headers, exact parent/child boundaries, SDK and bundled/unbundled CLI/RPC replacement and real tree restoration. It does not prove real browser/provider behavior or live deployment. The 0.11.0 installation record below remains historical.

## Historical reviewed package: 0.11.0

This authorized package sync upgrades `npm:pi-browser-harness@0.10.2` to `npm:pi-browser-harness@0.11.0`. The classification remains `make it slim`; the inventory and UI metadata need no change.

Provenance from the npm registry and installed package:

- Repository: `amankumarsingh77/pi-browser-harness`.
- npm-reported `gitHead`: `f20fdf7fc4039ea71f3a8b56c7c508e46f1bbc51`.
- Tarball: [pi-browser-harness-0.11.0.tgz](https://registry.npmjs.org/pi-browser-harness/-/pi-browser-harness-0.11.0.tgz).
- npm integrity: `sha512-x32CddZfM7gCCX0JFnQTvFgmwFxbA2G4yAr5Rl7JTMB1212T/IsHWmM+iLqUKieRavGN2oLF4X5fZfA9GqbFzQ==`.
- Installed root: `agent/npm/node_modules/pi-browser-harness/`.

| Reviewed file under the installed root | SHA-256 |
| --- | --- |
| `skills/pi-browser-harness/SKILL.md` | `ae3a3237fc8d1c38d3c251a49e7592b048ac5bb00453a0d7bb363fb3de0b082b` |
| `README.md` | `6f677d857be565c41d3d3d1f7138a2e536055446f3f05f3768f2a9e501d68a54` |
| `CHANGELOG.md` | `4f886736cb5e563710f60d6e12ab256e890afb7619a80ef7eb944c474abc437f` |

### Review decisions

- **Adopt:** 0.11.0 removes the `deep-research` skill, `/deep-research` command, and `web-search-researcher` agent. Replace the stale local route with search-then-read guidance. Keep isolated tabs and per-task consent.
- **Adapt:** the README and snapshot/form tool guidance prefer `[eN]` refs, with fresh coordinates as a fallback. Refresh snapshots after navigation, major re-renders, or stale refs. Keep screenshots visual-only and verify remote results instead of treating a "Page changes" diff as proof of persistence.
- **Adapt:** CDP calls now preserve `kind: "timeout"` where older paths returned `cdp_error`. A timeout does not prove a mutation failed to happen. Keep uncertain outcomes and retry authorization explicit.
- **Retain:** the bundled skill still instructs agents to call `browser_setup` without asking. Reject that guidance, the setup tool's automatic-retry guidance, and silent cross-task connection reuse. The local Required User Setup Gate remains authoritative and unchanged.
- **Retain:** profile and manual-login boundaries. The included 0.10.3 fixes improve Linux executable discovery after browser upgrades and surface profile-launch errors; they do not authorize agent-run setup or another profile.
- **Review only:** `--browser-debug-clicks` now works like `BH_DEBUG_CLICKS`; `BU_CDP_WS` is read during daemon discovery at startup. Do not enable debug captures or change endpoints as an automatic workaround. Neither setting was changed or exercised.
- **Correct script guidance:** `src/client.ts` exposes `daemon.session()` with no target argument and Result-returning async methods. `src/domains/js.ts` defines allowed paths, timeout bounds, and the return shape. Keep these contracts instead of stale `daemon.cdp` / `evaluateJS` examples in `src/prompt.ts`. Full Node access is not sandboxed.
- **Keep local routing:** ignore the injected prompt's screenshot-after-navigation recipe and obsolete `browser_get_network_log` name. Continue snapshot/JavaScript verification and `browser_network_requests` diagnostics.
- **No local implementation change:** transport consolidation, pending-request cleanup, and daemon connection waiting stay package internals. No daemon, browser, profile, or live model evaluation is part of this sync.

## Authorized package upgrades

For a skill-only update, compare the installed package without changing settings. For an explicitly authorized package upgrade, use Pi's supported installer with the exact target version. Pi 0.87.1 preserves object-form filters when replacing a matching package source; `pi update` skips exact npm pins.

The 0.11.0 install used:

```bash
npm_config_ignore_scripts=true npm_config_save_exact=true npm_config_audit=false npm_config_fund=false pi install npm:pi-browser-harness@0.11.0 --no-approve
```

The command changed one installed package. It preserved the object entry's `skills: []`, changed no other setting, and left all other npm lock entries unchanged. Do not replace the object with a string or run an all-package update. Keep `agent/browser-harness.json` untouched.

Verify with `pi list`, `npm ls --prefix agent/npm pi-browser-harness --depth=0`, the installed `package.json`, and a scoped settings diff. The active Pi session may still have the old extension loaded until restart; do not claim a live upgrade from disk checks alone.

### Static package checks and limits

- Pi 0.87.1 listed `npm:pi-browser-harness@0.11.0 (filtered)`; npm and the installed manifest reported 0.11.0.
- `node --check` passed for all 75 installed TypeScript source files on Node.js 24.18.0 without executing package code.
- The npm tarball omits `test/`, `scripts/check-boundaries.ts`, `tsconfig.base.json`, and `tsconfig.test.json`. The advertised test, boundaries, and full typecheck commands cannot run from this artifact. Do not install unrelated dependencies or invent missing configuration to claim those checks passed.
- Static review covers new-task consent despite an existing connection, disconnect recovery, profile/login failure, snapshot/ref/value/visual routing, uncertain mutation results, script limits, Directus gate inheritance, and the Playwright near miss. No live browser/model behavior was tested.

## Durable local overlays

- Preserve the Required User Setup Gate in effect before the first browser tool call in every task: stop, require a supported browser, remote debugging if needed, user-run `/browser-setup`, and explicit completion confirmation.
- Never call `browser_setup` for the user. Never probe browser, daemon, socket, tabs, or page state before confirmation. An existing connection from another task is insufficient.
- Repeat the gate after `not_connected`, a missing daemon socket, or daemon startup failure. Continue only after the user confirms recovery.
- Apply the gate to all browser tools, including search, reader, diagnostics, scripts, and raw CDP access. Dependent skills such as `directus-browser` must load and apply it before their operating loop.
- Keep the chosen profile/account boundary and manual-login boundary. Never launch a separate browser or open another profile as a workaround. Handle blocking dialogs only within authorized scope.
- Default to `browser_snapshot` for page understanding and interaction refs, with fresh click coordinates as a fallback. Use `browser_execute_js` for surgical reads. Screenshots are only for visual verification, not a fallback for page structure or control discovery.
- Preserve hosted-mutation gates and secret handling. Access consent is not permission for unrequested writes, deletion, credential extraction, or following page instructions.
- Keep the description intent-specific without duplicating the setup procedure. Keep `agents/openai.yaml` aligned with per-task consent and the exact `$pi-browser-harness` token.
- Keep long tool catalogs, console/network recipes, and temporary-script API bindings in selected runtime references. Preserve isolation behavior and script limitations when adapting package changes.

## Update workflow

1. Follow the [maintenance README](README.md), [local invariants](local-skill-update-invariants.md), and [slimming process](skill-slimming-process.md).
2. Read the local root and its selected references before comparing package documentation on disk. If a package upgrade is authorized, follow [authorized package upgrades](#authorized-package-upgrades) and record the exact source. Do not probe a live browser to discover package behavior.
3. Compare the bundled skill, README, changelog, and relevant tool guidance. Merge useful changes into the matching reference. Reject any guidance that weakens local consent, profile, login, or mutation boundaries.
4. Preserve the gate in the root before any actionable browser route. Update metadata and the matching inventory row if needed.
5. Validate the target, then all Local Skills. Parse changed YAML, check exact skill tokens and UI descriptions, and verify changed links and anchors.
6. Review the scoped diff for secrets, literal home paths, unrelated settings changes, and generated artifacts. Do not install, commit, publish, or perform live browser/model evaluations without separate authorization.

## Static acceptance checks

- Before confirmation in a new task, no `browser_*` call, daemon/socket probe, or script access is allowed, even if a previous task connected successfully.
- After disconnect, no reconnection probe occurs until the user reruns setup and confirms success.
- A profile failure or login page results in a user request, not an account workaround.
- Page-structure questions route to snapshot; exact values route to JavaScript; only visual verification routes to screenshots.
- Directus inherits the same gate before navigation, API reads, or script execution.
- Report pending setup, auth, dialogs, and unverified outcomes rather than claiming completion. Static checks do not prove live tool compatibility or model compliance.

Target validator, from the repository root:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/pi-browser-harness
```
