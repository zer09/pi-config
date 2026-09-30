# Local skill and CLI maintenance

Completed 2026-10-01. Compared current upstream sources, selectively applied relevant changes, and preserved local routing, compact skill roots, metadata, and authorization rules. The approved scope covered 36 of the 38 installed Local Skills. Outpour was TODO-only; Impeccable was excluded pending future removal.

## Installed CLI and package updates

These are the accepted installed versions, not a claim about releases published after the recorded source checks.

| CLI or package | Accepted version | Maintenance record |
| --- | --- | --- |
| `posthog-pp-cli` | `2026.9.1` | [PostHog](../skills/pp-posthog-update-process.md) |
| `klaviyo-pp-cli` | `2026.9.3` | [Klaviyo](../skills/pp-klaviyo-update-process.md) |
| `pi-browser-harness` | `0.11.0` | [Browser Harness](../skills/pi-browser-harness-update-process.md) |
| `gh` | `2.101.0` | [GitHub CLI](../skills/gh-cli-update-process.md) |
| `crit` | `0.21.0` | [Crit](../skills/crit-update-process.md) |
| `@schpet/linear-cli` | `2.6.0` | [Linear](../skills/linear-cli-update-process.md) |
| `ntn` | `0.23.11` | [Notion](../skills/notion-update-process.md) |
| `notebooklm-mcp-cli` (`nlm`) | `0.13.0` | [NotebookLM](../skills/nlm-skill-update-process.md) |
| `@playwright/cli` | `0.1.22` | [Playwright](../skills/playwright-cli-update-process.md) |
| `firebase-tools` | `15.32.0` | [Firebase](../skills/firebase-skills-update-process.md) |
| `uv` and `uvx` | `0.12.21` | [Astral](../skills/astral-python-tools-update-process.md) |
| Ruff | `0.16.9` | [Astral](../skills/astral-python-tools-update-process.md) |
| ty | `0.0.84` | [Astral](../skills/astral-python-tools-update-process.md) |

Kept Browser Harness's `skills: []` package filter so the local consent skill remains authoritative. Preserved the Cargo-owned uv installation and uv-managed Ruff/ty tools. After a stalled delegate build was stopped, the parent completed the Astral installations. Slow builds and installations became parent-owned; delegates handled source comparisons, skill edits, and reviews. Unrelated model-setting changes were not included in the staged maintenance scope.

## Selective runtime changes

- **Printing Press:** synchronized both skills and command references. Writes with ambiguous outcomes require inspection before a separately authorized retry. Klaviyo deployment/launch guidance checks the local HTML QA verdict and findings, not exit status alone.
- **Browser Harness:** adopted stable snapshot references, isolated URL-reader behavior, timeout outcome checks, and current script APIs. Preserved per-task setup consent, manual login, and exact write authorization. Playwright retained isolated task sessions and updated source-derived command contracts.
- **GitHub, Crit, Linear, Notion, and NotebookLM:** refreshed command/data references and provenance without granting new hosted-write authority. GitHub URL normalization rejects malformed/control-character inputs and separates user-controlled arguments from flags. Crit distinguishes persisted and flattened comment scopes. Notion rejects incomplete page content as a replacement source. NotebookLM uses individually confirmed Studio actions rather than unsafe batch/pipeline recipes and documents conditional download-root selection.
- **Firebase:** selectively compared all eight skills at `firebase/agent-skills` commit `daaf0e1577b2d4ac23cfa9d31f421178ef229735`. Basics, Auth, Firestore, AI Logic, and Data Connect received relevant changes. App Hosting, Hosting Classic, and the Firestore rules auditor were intentional runtime no-ops. Changes include parameter-based optional-field validation, selected database targets, identity-loss listener cleanup, explicit authorized Enterprise realtime settings, current client SDK guidance, and generated Data Connect operation APIs.
- **Genkit:** verified the replacement origin through Firebase's pointer, canonical repository identity, and explicit README mappings. Compared all 79 runtime source files across JS, Go, Dart, and Python at `genkit-ai/skills` commit `cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6`. Added compact agent/prompt/middleware guidance and relevant API corrections. Kept beta/experimental APIs conditional on the resolved SDK; no dependency upgrades or blanket flow migrations were required. Historical absence from the Firebase repository remains recorded, but no longer defines the current source mapping.
- **PostgreSQL:** adopted the warning that session-level `SET` on PgBouncer transaction-pooling port `6432` can leak state across clients. Use direct port `5432` or transaction-scoped `SET LOCAL` when appropriate. MySQL remained unchanged after comparison.
- **Directus:** refreshed official documentation through `12.4.1`. Schema guidance treats only HTTP `404` as absence; HTTP `403` can indicate denied access or an inactive collection. Preserved UI-first writes, Browser Harness consent, manual login, and exact mutation authorization.

[Grouped Firebase/Genkit evidence](../skills/firebase-skills-update-process.md), [database evidence](../skills/planetscale-database-skills-update-process.md), and [Directus evidence](../skills/directus-browser-update-process.md) retain source inventories, selective decisions, checks, and limits.

## Verified no-ops and retained snapshots

- The three Figma skills, `skill-creator`, and `session-handoff` needed no runtime source changes after their documented comparisons. Maintenance records were refreshed; ownership and safety overlays remained intact.
- `grill-with-docs` and `improve-codebase-architecture` remained unchanged because upstream changes were incompatible or immaterial to local read-only planning rules.
- The uv, Ruff, and ty roots remained unchanged because their upstream skill source was unchanged. CLI versions and maintenance provenance advanced separately.
- Intent Layer remains a retained local snapshot because its verified upstream path is absent. No replacement or retirement was inferred.

Source records: [OpenAI/Figma](../skills/openai-skills-update-process.md), [skill-creator](../skills/skill-creator-update-process.md), [session-handoff](../skills/agent-toolkit-skills-update-process.md), [Matt Pocock](../skills/mattpocock-skills-update-process.md), and [Intent Layer](../skills/intent-layer-update-process.md).

## Inventory and context attribution

- Reconciled [38 actual installed roots](../skills/installed-skills-trim-verdict.md): 37 existing classifications and one blank/deferred Outpour row. Preserved all 26 retired rows. Removed seven absent package-workflow rows from the installed inventory without restoring skills or retiring extensions.
- Refreshed [only the current Skills attribution and its leading notice](../config-context-cost.md#skills). Pi `0.87.1` exposes 36 automatic catalog entries after excluding explicit-only Crit and Impeccable. Outpour's catalog presence does not mean maintenance acceptance.
- Offline `tiktoken 0.13.0` / `o200k_base` measurement: 3,187 isolated entry tokens plus a 74-token framing/BPE residual gives 3,261 tokens for the canonical catalog block. Full provider calibration and tool/context totals were not rerun; other measurements remain historical.
- Added Python bytecode/test-cache ignore rules and removed task-owned cache artifacts during the approved cleanup. Later inherited ignored caches were preserved rather than deleted blindly.

## Validation and limits

All completed increments passed their review gates. The final three independent reviews found no material blockers. The final parent rerun passed all 38 structural validators and 39 offline regression tests: 18 Auth/Firestore, 14 NotebookLM, and seven Playwright tests. Earlier targeted command, parser, metadata, link, secret, artifact, and preservation checks remain recorded in the maintenance documents. Whitespace checks passed, and staging preserved unrelated working changes.

Structural validation does not establish live SDK, provider, model, browser, or authenticated product behavior. Native SDK compilation and production security of inherited schematic examples remain unverified. Notion's registry integrity was verified, but its declared build commit was unavailable; source-build equivalence was not established. The Browser Harness tarball omitted some upstream validation inputs, and a running Pi process can retain an earlier loaded extension until restart.

An earlier incorrect Crit command briefly started a local session. Its runtime artifacts remain untouched; inspection or deletion still needs explicit authorization. The failed Astral build was safely stopped before the parent completed installation. These incidents are not represented as successful checks or a completely product-action-free session.

Outpour endpoint credential safety, `call` JSON argument parsing, maintenance integration, and offline tests remain deferred in the [maintenance TODO](../skills/README.md#deferred-maintenance). Impeccable was neither updated nor removed. No commit, push, deployment, or hosted-service mutation was included in this maintenance.
