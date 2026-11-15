# Three-extension upgrade prepared on Pi 1.5.2

## Status: historical preparation; installation completed

Both final accumulated reviews passed, and the reviewed packages are now installed and verified. See the [installation record](three-extension-upgrade-installation.md) for actual installed-file checks, retained rollback data and the manual restart boundary. The custom process-scanning installer below was unnecessary and was not used. Installation used normal-user directory replacement without sudo. Earlier preparation and failed reports remain historical evidence.

The following table records the installation baseline and prepared selection.

| Package | Baseline | Prepared |
| --- | --- | --- |
| Blackhole | 0.5.15, three repairs. | 0.5.18, the same three repairs; `./index.ts` entry. |
| Browser Harness | 0.13.0, registration repair. | 0.19.1, four-source recipe snapshot repair. Upstream replaces the old registration repair. |
| Claude Bridge | Stock 0.9.3. | Stock 0.12.0; SDK/Linux 0.3.321 and cc-session-io 0.4.1. |

Exact canonical/legacy Pi 1.5.2, repaired BTW 0.8.1 and unrelated prior package bytes remain unchanged. The complete final cache contains 280 installed packages, 23,307 files and 20 links. Full and hidden locks match installed versions; 76 optional records remain uninstalled.

The Blackhole complete 147-file identity is `94240a11a1ac5c5a7c0fc69c7c4ccf3d0fef48ec28ced64d6f592f54c8665ea9`. The Harness complete 127-file identity is `bdbd68882202b36e31459d3eef0de5431300e505f8904f48dfebc675ba6e0748`. These identities hash JSON of sorted `[relativePath, sha256]` pairs. See the [Blackhole](../../agent/pi-blackhole/LOCAL_PATCHES.md), [Harness](../../agent/pi-browser-harness/LOCAL_PATCHES.md) and [Bridge](../../agent/pi-claude-bridge/LOCAL_PATCHES.md) records for repair fingerprints and retained evidence.

## Integrated acceptance

The one-time local acceptance launcher requires explicit canonical package, runtime and fresh output directories. It never discovers global installations. It mounts input bytes read-only, denies network access through bubblewrap, clears the environment, disables cache warming, and uses separate synthetic HOME, agent/Claude directories, settings, credentials, models, sessions, caches and temporary storage. Guards allow only the selected Pi CLI children and finite fake replies, and reject private, retired, network, browser, daemon and unapproved process access.

The same four integration tests pass with the candidate runtime and with the actual installed canonical Pi runtime. Both bundled and unbundled RPC builds pass. SDK and RPC checks cover startup, fake turns, reload, new/resume, real tree movement/restoration, compaction and graceful shutdown, with zero extension errors or unexpected boundary operations. The parent loads 11 extensions, 58 registered tools, 54 active tools, 43 browser tools and 25 production extension commands. All 58 actual schemas are captured; ten representative normal/invalid cases use Pi's real argument validation. This does not claim TypeBox refinements beyond host behavior.

The unchanged delegated policy supplies five ordered runtime extensions and two catalog extensions. Runtime keeps seven active tools; catalog keeps four core tools. Neither loads browser, Blackhole, AskClaude or retired tools or package skills. Selected skill metadata stays separate from full skill bodies until explicit native skill expansion. Parent Harness package skills stay excluded, the user-owned browser skill stays loaded, and BTW's existing parent skill remains available. The 39 local skill roots and metadata are unchanged.

The changed wrapper's 17 tests, Bridge's ten focused checks and Harness's 49 checks pass against the final graph. Blackhole's fresh final 64 focused checks remain valid without a broad unrelated rerun. Blackhole strict production checks pass. Bridge retains 11 and Harness retains three identical upstream strict diagnostics; neither is a clean whole-package typecheck.

## Accepted changes and limits

Upstream Harness journals and pinned-profile noninteractive setup remain accepted capabilities, not permission to bypass local per-task browser access, chosen-profile/account, manual-login or exact hosted-write rules. Recipe approval binds parsed content to its original byte digest; automatic trust covers only bytes written by Harness. The old registration helper is retired for 0.19.1.

Bridge's ordering repair remains retired. The user accepts removal of the prompt-billing guard, user-only ordinary Claude settings, and the default output style. Trusted-only delegation, project-config refusal, user-hook/inherited-environment exposure, private pointer metadata and retained external Claude sessions remain documented in [ADR 0010](../adr/0010-delegated-child-resource-isolation.md). The provider-only wrapper forwards only `on` and `registerProvider`; `getAllTools` returns a fresh empty list locally.

Blackhole preserves 65%, the 180,000-token fallback, fixed budgets, `sessionFallback: true` and `midRunCompaction: "off"`. Core compaction remains enabled. The ignored pre-compaction-message switch retains effective upstream behavior; there is no fourth repair. Theme/footer/fastlane, routing, thinking, transport, exclusions and cache warming remain unchanged. No real provider, Claude, browser, daemon, profile, billing, Windows or visual acceptance occurred.

## Historical cutover utility, not used for installation

The private `RUN/d2/cutover.mjs` procedure replaces the prepared operational artifact without changing `RUN/d` history. It is not a public installer and has not run against real paths in D2. It checks accepted original/final complete inventories, settings bytes and the Git index before mutation. Only three package tokens change; formatting, newline and changelog-history keys remain intact. It uses complete same-filesystem directory renames, retains the old cache and settings backup under a unique private rollback transaction, and records exact identities in a durable journal. It never runs npm or a patch helper on live paths or copies synthetic state into the live setup.

All 19 original disposable-tree checks and 47 focused metadata checks pass in a network- and PID-isolated sandbox. They cover dry-run preservation, rename/settings interruptions, interrupted recovery, drift refusal, non-clobbering destinations, writer metadata, stale locks and synthetic permission failures. Unchanged integration, wrapper, Bridge and Harness results are reused only after current source, candidate and canonical runtime hashes match their accepted evidence. Existing runtime CLI permission differences from the candidate are recorded, not changed. Recovery refuses newer edits and ambiguous states. A utility lock does not exclude uncooperative writers.

When ordinary inspection receives EACCES or EPERM, the private utility can request a fixed read-only metadata collector through `/usr/bin/sudo -n -- /usr/bin/node`. The collector inspects only the specified same-user PID, checks UID and process start time before and after inspection, and returns numeric cwd/descriptor accounting for the exact package roots. It never reads argv, environment or session contents and never returns unrelated process paths. Missing authentication, unavailable commands, malformed or incomplete output, descriptor failures and identity changes refuse clearance. Installer operations, inventories, backups, settings and renames remain unprivileged. D2 tests mock every privileged invocation; no actual privileged fallback ran.

The private utility's all-process inspection requirement caused an unnecessary request for sudo. That requirement was discarded, and this utility was not used. Neither Pi nor these extension upgrades require privileged installation. The actual installation retained exact old cache/settings bytes, replaced the verified cache as the normal user and passed installed-file acceptance. No privileged collector, sudoers change, permission change or process termination occurred.

The launcher and supporting integration fixtures remain local upgrade evidence, not maintained repository tests. The private run's `installed-check-vRcfpj/` directory retains the exact installed-file command, results and boundary evidence. The repository keeps focused tests for the local Blackhole repairs, Harness recipe-snapshot repair and Claude Bridge wrapper.

The user completed a full manual restart after installation. The installation record documents the post-restart check and retained evidence; no custom cutover journal is claimed.
