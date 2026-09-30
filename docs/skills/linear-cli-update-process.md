# Updating the Linear CLI skill

Purpose: keep `agent/skills/linear-cli` aligned with the installed Linear CLI and pinned upstream sources without weakening local safety rules.

## Local invariants and classification

Follow [the maintenance README](README.md), [local invariants](local-skill-update-invariants.md), and [slimming process](skill-slimming-process.md) before and after an update.

Classification remains **make it slim**. Keep the root and template as a compact router with exact mutation gates, reference-first discovery, direct-bash full-response routing, Markdown body-file guidance, and hosted-mutation guard handling. Do not replace them with the upstream root or its command catalog.

The description and `agents/openai.yaml` remain unchanged. Linear resource requests belong here; GitHub operations belong to `gh-cli`. An update request authorizes neither hosted mutations nor unrelated package upgrades. The installed-skill inventory decision is unchanged.

## Pinned 2.6.0 provenance

- Repository: https://github.com/schpet/linear-cli
- Release: `v2.6.0`, published `2026-09-02T19:28:31Z`.
- Tag and checked-out commit: `196315343d2bc58f30ca5d5ab40f4eb6a449fd71`.
- Upstream runtime root: `skills/linear-cli/SKILL.md`; compare its template, references, and generator at the same commit.
- Previous recorded source: `cf349ba477e35eacd5223f2b111218d48d752e70` (`v2.4.0`). The installed package and isolated binary both reported `2.4.0` before this upgrade.
- Official npm metadata: https://registry.npmjs.org/@schpet%2flinear-cli/2.6.0
- Exact package: `@schpet/linear-cli@2.6.0`.
- npm archive: https://registry.npmjs.org/@schpet/linear-cli/-/linear-cli-2.6.0.tgz
- npm SHA-1: `6872edf0446c140ed5e2b45bba358b939011960f`.
- npm integrity: `sha512-yGf4oDbTarCGe6U244WPdeKV7Xlas5V63NhVmbdvvImE+9KkXuqissHbPsfc2zBy86/WTdaQLWykCI3nA43wzg==`.
- Linux release artifact: https://github.com/schpet/linear-cli/releases/download/v2.6.0/linear-x86_64-unknown-linux-gnu.tar.xz
- Release archive SHA-256: `bbcb9d365308bc3728a1ec9913ad1880f88c0ce68767383297e348c057f35b8d`.
- Installed native binary SHA-256: `7199b8444774fa6628ce69c7c97bc4f3043c2232b846d5bde07000de828dae22`, identical to the binary extracted from that archive.

Both npm hashes matched the downloaded archive. The release archive matched the GitHub asset digest. Source and release artifacts were fetched through authenticated `gh`, not a moving branch or a web rendering.

Upstream file SHA-256 values at the pinned commit:

| File under `skills/linear-cli/` | SHA-256 |
| --- | --- |
| `SKILL.md` | `652279efbf4e31d5da57cf727388b3b8d89a84b3ed177750dbfd2c2766f9e70e` |
| `SKILL.template.md` | `62df07cfeffb2e1522690de06e0653d1b2ce5f2c1c8e857e31856e6db2ded04c` |
| `scripts/generate-docs.ts` | `3cbf705ea6245fe4e6ac94b3fa96255c690e320caa491b20d7b9508fccc099c1` |

## Installation boundary

The approved upgrade used the existing user-local Bun global installation:

```bash
bun add --global --exact --ignore-scripts @schpet/linear-cli@2.6.0
env -i PATH=/usr/bin:/bin /usr/bin/node \
  "$HOME/.bun/install/global/node_modules/@schpet/linear-cli/install.js"
```

Before installation, compare the npm wrapper and installer sources. For this upgrade, `binary.js` and `binary-install.js` were unchanged from 2.4.0; package dependencies were also unchanged. Disable package lifecycle scripts during the Bun operation, then invoke only the reviewed Linear installer. This installer downloads the release binary; it does not invoke Linear or read its workspace configuration.

`~/.bun/bin/linear` remains a symlink to the Bun global package's `run-linear.js`. The wrapper and native binary reported `linear 2.6.0` inside isolation. All 14 unrelated top-level global package versions remained unchanged, with 851 packages in the global listing before and after. Do not inspect or modify Linear auth, keyring, or configuration files to verify an upgrade.

## Source comparison decisions

| Area | Decision |
| --- | --- |
| 2.5.0 document changes | Adopt all six attachment-target flags and target-resolution help. Add a compact root warning that document creation needs exactly one attachment target. |
| 2.6.0 Markdown guidance | Generate `references/markdown.md`. Route mentions and collapsible sections there. Preserve plain-URL mentions, team-first lookup, and confirmation before a workspace-wide people search. |
| Other 2.6.0 help | Adopt PR template flags, body-writing hints, and member URL descriptions through generated references. |
| Runtime-only changes | Record upstream changes to status ordering, comment identity/edit metadata, and dotenv handling. Do not claim workspace-level behavior was tested. |
| Upstream root/template | Reject broad `allowed-tools`, duplicated command catalogs, live-help-first discovery, schema-to-file filtering, piped API responses, and token-based curl examples. Preserve the compact local root/template and all local gates. |
| Generator | Preserve reference-first index text, terminal right-padding cleanup, failure-before-write behavior, curated-reference preservation, and standalone formatting flags. Replace only `@std/path` with Deno's built-in `node:path` import so standalone checks and generation need no remote import map. |
| Curated reference and eval | `organization-features.md` matches upstream unchanged. Preserve the existing draft-only eval unchanged; add deterministic mocked generator and safety tests. |

## Offline help boundary

Do not assume that `--help` or `--version` avoids startup reads. At the pinned commit, `src/config.ts` eagerly loads environment/configuration files, and `src/credentials.ts` eagerly loads credentials and can populate a keyring cache before argument parsing.

Before each invocation route, inspect the wrapper, startup imports, and generator. For maintenance, allow only `--version`, `--help`, and source-only/mock checks. Never execute command actions, including auth token output, login/logout, config, schema/API calls, or workspace reads and writes. Do not access existing Linear credential/configuration files.

This update used Bubblewrap with:

- `--unshare-all --die-with-parent`, so no external network or host IPC is available.
- A cleared environment, no `HOME` or XDG/auth variables, and an empty temporary working directory.
- Only system runtime files, the verified binary, and explicit generator inputs mounted. Neither the user home nor workspace/configuration directories were mounted.
- `LINEAR_IGNORE_ENV_FILE=1` and `NO_COLOR=1` for 2.6.0.
- A temporary `linear` wrapper that accepted only a sole `--version` or command words ending in `--help`.
- A temporary Deno 2.7.9 binary, matching upstream `mise.toml`; no additional global runtime installation.

The local generator ran inside that sandbox with only the skill directory writable and Deno's cache in temporary storage:

```bash
deno run --no-config --no-lock --no-remote --cached-only \
  --allow-read=/skill --allow-write=/skill \
  --allow-run=/tools/linear,/tools/deno \
  /skill/scripts/generate-docs.ts
```

These paths are sandbox mounts, not host paths. Inspect the generator and establish the isolation before using this command. Do not run it unsandboxed against an authenticated CLI. For the npm-wrapper version check, mount the global packages under a directory named `node_modules` so Node can resolve hoisted dependencies.

All Linear CLI output used direct `bash`, never Context Mode. GitHub/source comparisons and offline diagnostics used Context Mode. No live models, Linear workspace API calls, hosted mutations, or Crit operations were used.

## Repeatable update workflow

1. Load `skill-creator` and `gh-cli`. Read the governing maintenance documents and inspect local changes.
2. Fetch official npm metadata for the exact approved version. Resolve the matching GitHub tag with `gh api` and clone that tag through `gh repo clone` into a new temporary directory.
3. Verify the commit, npm integrity, release artifact digest, wrapper/installer source, runtime source, template, references, and generator. Never fetch a moving `main` as release provenance.
4. Treat a CLI upgrade as a separate change requiring explicit approval. Use the existing installation mechanism and preserve unrelated packages and auth/configuration.
5. Establish the offline boundary before any version/help invocation. Use mocks or source inspection when safe isolation is unavailable; do not test against a real workspace.
6. Update the slim template, including the bundled-reference version. Regenerate with the local generator, not an upstream root replacement.
7. Confirm that `SKILL.md` matches its template after reference navigation expands. Compare every generated help block with the pinned upstream references and confirm that every discovered command is represented. Exclude shell completions deliberately; aliases remain in parent help.
8. Preserve exact-mutation approval, token secrecy, Markdown body files, reference-first discovery, direct-bash complete responses, no Context Mode recovery, and unchanged-command authorization retries within 10 minutes.
9. Run the checks below and the canonical all-skill validation. Scan scoped changes for secrets, literal home paths, broken links, and generated artifacts. Record provenance, decisions, and limits here.
10. Stop after the assigned checks pass. Do not stage, commit, push, deploy, or change unrelated skill families without a separate instruction.

## Checks and recorded results

From the repository root:

```bash
bun test agent/skills/linear-cli/scripts/generate-docs.test.ts
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/linear-cli
deno check --no-config --no-lock --no-remote agent/skills/linear-cli/scripts/generate-docs.ts
deno fmt --no-config --prose-wrap=never --no-semicolons --check agent/skills/linear-cli
git diff --check -- agent/skills/linear-cli docs/skills/linear-cli-update-process.md
```

Use the isolated temporary Deno binary when Deno is not installed. The tests execute the real generator with an in-memory `Deno` mock. They do not spawn Linear, contact a model, or inspect credentials.

Recorded results for this increment:

- **12 offline tests passed**, with 268 assertions: nested discovery/aliases, completion exclusion, deterministic ordering, failure-before-write, missing-template handling, formatting failure, curated-reference preservation, and local formatting/index overlays.
- Tests also check complete bundled-help reachability and round-trip generation, root/template synchronization, the original draft-only eval, exact mutation gates, full-response routing, body files, token secrecy, hosted-guard authorization, and new 2.6.0 syntax.
- **16 command families and 91 help blocks** generated from the installed binary. All 16 family references match pinned upstream after terminal right-padding normalization. The curated organization reference also matches. `commands.md` deliberately retains local reference-first guidance.
- Target validation and **all 38 Local Skill validations passed**, including YAML/frontmatter, metadata, exact `$skill-name` prompt tokens, short-description bounds, and local links.
- Deno typecheck passed. Formatting passed for all 24 supported files in the skill. The root remains 112 lines; the template remains 97 lines.
- The original eval SHA-256 remains `c35c08fa413919616bdba0052f749c280f82ab25106cf7cfa7757959c9056b08`.
- Scoped diff, maintenance-link, artifact, secret-pattern, and literal-home-path checks passed. No downloads, caches, logs, or test outputs were added to the skill tree.

During verification, a test parser initially treated required option names as command words; its command-name regex was corrected. A wrapper check initially mounted packages under the wrong directory name; using `node_modules` fixed resolution. Context Mode could not execute the shell-loop validator because of its environment prefix, so all validators ran through the same Python `validate_skill` function instead. These failures were local check setup issues, not workspace operations.

## Limits and deferred scope

These checks prove local structure, source/help consistency, generation, and deterministic safety contracts. They do not prove model adherence, real-workspace behavior, credential migration, or runtime-only API fixes. No live eval/model runs, schema/API retrieval, auth operations, or workspace mutations were performed.

The classification, inventory, routing settings, other skill families, prior increments, and future updates remain outside this increment. No Git staging, commit, push, or hosted transition is authorized by this process.
