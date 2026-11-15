# Three-extension upgrade installed on Pi 1.5.2

Installed and verified on 2026-11-14. The user completed a full manual Pi restart on 2026-11-15. No automatic restart or `/reload` occurred.

## Installed packages

- Blackhole is 0.5.18 with the three reviewed repairs and the `./index.ts` entrypoint.
- Browser Harness is 0.19.1 with the reviewed recipe-snapshot repair and 43 tools. Upstream supplies the old registration repair.
- Claude Bridge is stock 0.12.0 with Claude Agent SDK/Linux 0.3.321 and cc-session-io 0.4.1. The historical ordering repair stays retired and AskClaude remains absent.
- Pi remains 1.5.2 and cancellation-repaired BTW remains 0.8.1.

## Installation and verification

The assistant replaced the whole prepared package cache using normal-user directory renames, retained the old cache, and edited only the three package declarations in `agent/settings.json`. Formatting, changelog-history keys, unrelated settings, profiles, Blackhole configuration and Git index remain unchanged. No sudo, privileged metadata collector, package script, live patch helper or custom cutover utility ran. The unnecessary process-scanning prerequisite was discarded rather than treated as a Pi requirement.

The installed cache matches the exact reviewed final inventory. Its SHA-256 identity is `b5056f6e88e15df238732a3610a000688aa06bd3816189793143dffe399ec999`. The retained cache matches the original identity `6866ea37ae5ec92c598816c37a9ec5e1c7779eeecee3b8db5e54467d7f4ceff0`.

All four one-time integration checks passed against the actual installed extension files and actual canonical Pi runtime. The checks cover complete repair identities, SDK lifecycle and footer behavior, delegated resource isolation, and bundled/unbundled RPC lifecycle parity. They use synthetic state, fake provider replies and OS network denial. Seven process-boundary records contain zero unexpected operations.

The parent registers 58 tools, activates 54 tools, includes 43 browser tools and exposes 25 production extension commands. Runtime children retain five extension entries and seven active tools; catalog children retain two entries and four active tools. The browser package's `skills: []` filter and the user-owned browser skill remain intact.

## Retained evidence and limits

The private run is `$HOME/.pi-extension-upgrade-Jts5jY`. Its `installed-Y2VAAo/` directory retains the complete old npm cache, original settings and original index. Its `installed-check-vRcfpj/` directory retains the successful installed-file command, four-test output and boundary evidence. Earlier preparation and failed attempts remain historical evidence, not successful installation transactions. The one-time integration launcher, broad stock-package checks and their supporting fixtures remain local rather than committed. The repository retains focused tests for the Blackhole repairs, Harness recipe-snapshot repair and Claude Bridge wrapper.

No real browser, daemon, Claude account, paid provider request, billing, Windows or visual acceptance ran. Bridge's eleven and Harness's three unchanged upstream strict diagnostics remain disclosed. Blackhole's three repairs, 65% policy, 180,000-token fallback, fixed worker budgets and configuration remain intact. The ignored pre-compaction-message switch retains upstream behavior. User-approved journaling, setup and billing-guard changes remain as documented in the preparation record.

The post-restart check confirmed a new parent Pi process, the three installed extension versions and availability of the new Browser Harness tools. This check does not establish real browser or provider acceptance.

At installation, all source and configuration changes remained unstaged; no commit or push occurred.
