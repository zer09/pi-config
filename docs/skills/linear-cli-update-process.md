# Updating the Linear CLI skill

Purpose: keep `agent/skills/linear-cli` aligned with the installed Linear CLI and pinned upstream sources without weakening local safety rules.

## Local invariants and classification

Follow [the maintenance README](README.md), [local invariants](local-skill-update-invariants.md), and [slimming process](skill-slimming-process.md) before and after an update.

Classification remains **make it slim**. Keep the root and template as a compact router with exact mutation gates, reference-first discovery, direct-bash full-response routing, Markdown body-file guidance, and hosted-mutation guard handling. Do not replace them with the upstream root or its command catalog.

The description and `agents/openai.yaml` remain unchanged. Linear resource requests belong here; GitHub operations belong to `gh-cli`. An update request authorizes neither hosted mutations nor unrelated package upgrades. The installed-skill inventory decision is unchanged.

## Current 3.1.0 alignment, prepared but not deployed

The installed and captured latest package is already `@schpet/linear-cli@3.1.0`. This increment updates the skill, not the global installation. Bun remains the deployment owner: `~/.bun/bin/linear` points to the Bun global package's `run-linear.js`, which launches `node_modules/.bin_real/linear`. No global package command, installer, auth/config/keyring operation, or workspace action ran.

### Exact source and private executable

- Repository: https://github.com/schpet/linear-cli
- Release: `v3.1.0`, published `2026-10-22T19:43:12Z`.
- Tag commit and release target: `02571d34be662e5487204841fb80bf23ed79b4f0`, resolved with authenticated `gh`.
- Official npm metadata: https://registry.npmjs.org/@schpet%2flinear-cli/3.1.0
- npm archive: https://registry.npmjs.org/@schpet/linear-cli/-/linear-cli-3.1.0.tgz
- npm SHA-1: `e2e3ac0371f0da23adbdcce2153ee3df3b761614`.
- npm integrity: `sha512-5vYKu38lCmoQ09UzktNoAmH/VSa9YqrnGZkXWq0T9tG5QnoG6HT0w2uc3uAsnbNvOrSOJKpZNa9GtT9HrAXZdg==`.
- The previously verified npm archive SHA-256 is `42fb53c2cb38aaf2c2b1c95273f878923a47774bc49d739f917e2434beb549db`; the release lists the same digest for its npm artifact.
- Official release source: https://github.com/schpet/linear-cli/releases/download/v3.1.0/source.tar.gz
- Source archive SHA-256: `c288405be2d6d90b5c0bec8e0df3ce7721070192b67b60a46c3094f4894f6dfb`.
- Native release archive: https://github.com/schpet/linear-cli/releases/download/v3.1.0/linear-x86_64-unknown-linux-gnu.tar.xz
- Native archive SHA-256: `bf7712097ce6a01e8a379de8357eca66d5748050201d336ba787b6ad3687f3e7`.
- Extracted executable SHA-256: `c75bbcdf08aaf89731a3cd2672f940ac5ac9e142c8a132f86fd0ccf2da223628`, identical to the read-only installed executable.

Release source and native archives were downloaded through authenticated `gh` into the private run directory. Both archive digests matched GitHub's asset digests. Existing npm metadata, extraction, and SRI verification were reused. No moving branch or installer execution supplied provenance. License and third-party notices remain with the private source/native artifacts; no upstream runtime code was imported into the skill.

### Contracts and retained overlays

3.0 rewrites the CLI in Rust. Inspect `crates/linear-cli/src/main.rs`, `cli/mod.rs`, and `app.rs` before help: parsing exits for help/version before configuration, credentials, or command dispatch. The npm launcher can download a missing executable and create its installation directory, so maintenance invokes only the verified native executable.

| Area | Alignment or retained boundary |
| --- | --- |
| Help and generation | Clap puts descriptions before `Usage:` and adds a recursive `help` command. Adapt only those two generator seams. Retain deterministic sorting, alias handling for older fixtures, right-padding normalization, completion exclusion, failure-before-write, curated preservation, standalone imports, and reference-first navigation. |
| Command library | Generate 17 families and 106 help blocks, including the new `template` family, delegate flags, and comment resolve/unresolve help. These are factual command references, not adoption of new workflows or permission to mutate. Every block matches the pinned upstream reference after right-padding normalization. |
| Root corrections | `issue list` is canonical, with `mine` retained as an alias and explicit assignee filters available. `--no-pager` now covers long views and comment lists too. `--limit` accepts a positive number or `all`, not `0`; list JSON is an entity array and view JSON an object. Preserve team verification, sorting, document attachment targets, and inline-image guidance. |
| Curated reference | Retain the organization reference and its existing recipes. Correct only the obsolete `label list --workspace` example to `--workspace-only`; `--workspace` now selects a named credential globally. Do not import upstream's additional project-update recipes. |
| Markdown and text input | Preserve file-based Markdown guidance, plain-URL mentions, team-first lookup, and confirmation before a workspace-wide people search. Source inspection confirms body/description/content file flags accept `-` for stdin, read through EOF, strip a leading BOM and trailing whitespace, and reject a required empty body. |
| API and schema | Preserve heredoc queries with variables and non-null markers. Source confirms the API takes one document or stdin, coerces variables, and paginates one connection. Schema uses batched introspection and prints SDL by default, with JSON/output-file options. The local initial-read rule still forbids redirecting or filtering the initial API/schema response. |
| Exits | Source and root help distinguish success `0`, failure `1`, usage `2`, not found `3`, authentication `4`, unavailable `5`, and cancellation `130`. An unavailable mutation may already have taken effect; these notes do not authorize a retry. |
| Safety and metadata | Preserve exact hosted-write authority, token secrecy, direct-bash complete responses, hard-truncation recovery with Linear, and unchanged-command guard retries within 10 minutes. The description, UI metadata, draft-only eval, classification, and inventory remain unchanged. |

Schema, query, stdin, body-file, JSON, and exit behavior were checked against released implementation and existing upstream mock-test source, not by invoking command actions. No Rust build, new test suite, CLI wrapper project, live API proof, or model inference is part of this increment.

### Current isolation and checks

Use a cleared environment and Bubblewrap `--unshare-all --die-with-parent`. Hide the actual home and expose only system runtimes, read-only source/native inputs, and explicit private generated outputs/caches/temp/logs. Leave `HOME`, XDG, auth, keyring, completion, and proxy variables unset; set `LINEAR_IGNORE_ENV_FILE=1` and `NO_COLOR=1`. A private guard accepts only a sole `--version` or command words ending in `--help`. Never invoke schema/API, auth, config, resource actions, or browser/download workflows to test maintenance.

The existing Deno 2.7.9 executable was copied privately from the prepared cache. Generation ran twice into a private skill copy with the existing permission-limited command below; native file edits then applied the verified generated bytes to the candidate. Bun 1.3.14 ran the existing tests. Python 3.13.16 and PyYAML 6.0.3 were bound read-only from the prepared environment and invoked through offline uv with an explicit interpreter, without downloads.

Current recorded results:

- The existing 12 offline generator/safety tests pass with 311 assertions. Only the existing version-specific test was extended; help extraction and the draft signature assertion were adapted to Clap's format.
- All 17 family references match 106 pinned upstream help blocks after right-padding normalization. Generated source bytes and expanded root/template navigation agree.
- Target validation and all 39 canonical Local Skill validations pass, including metadata and links. Impeccable receives structural validation only; none of its scripts or dependencies run.
- Deno typecheck and formatting checks pass. The root remains 114 lines and the template 98 lines.
- The draft-only eval retains SHA-256 `c35c08fa413919616bdba0052f749c280f82ab25106cf7cfa7757959c9056b08`. UI metadata is unchanged. Scoped link, artifact, secret-pattern, and literal-home-path checks pass.

Private command, exit, timing, source-contract, and corrected check-setup records accompany this increment under `reports/s1/handoff.md` in the run directory. These results prove source/help alignment and local safety contracts, not live workspace behavior, credential migration, or model adherence. Final combined acceptance, other skills/CLIs, deployment, and parent-wide provenance tables remain separate work.

## Historical 2.6.0 provenance

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

## Historical 2.6.0 installation boundary

These commands record the earlier approved upgrade, not an instruction to repeat it during current maintenance. The approved upgrade used the existing user-local Bun global installation:

```bash
bun add --global --exact --ignore-scripts @schpet/linear-cli@2.6.0
env -i PATH=/usr/bin:/bin /usr/bin/node \
  "$HOME/.bun/install/global/node_modules/@schpet/linear-cli/install.js"
```

Before installation, compare the npm wrapper and installer sources. For this upgrade, `binary.js` and `binary-install.js` were unchanged from 2.4.0; package dependencies were also unchanged. Disable package lifecycle scripts during the Bun operation, then invoke only the reviewed Linear installer. This installer downloads the release binary; it does not invoke Linear or read its workspace configuration.

`~/.bun/bin/linear` remains a symlink to the Bun global package's `run-linear.js`. The wrapper and native binary reported `linear 2.6.0` inside isolation. All 14 unrelated top-level global package versions remained unchanged, with 851 packages in the global listing before and after. Do not inspect or modify Linear auth, keyring, or configuration files to verify an upgrade.

## Historical 2.6.0 source comparison decisions

| Area | Decision |
| --- | --- |
| 2.5.0 document changes | Adopt all six attachment-target flags and target-resolution help. Add a compact root warning that document creation needs exactly one attachment target. |
| 2.6.0 Markdown guidance | Generate `references/markdown.md`. Route mentions and collapsible sections there. Preserve plain-URL mentions, team-first lookup, and confirmation before a workspace-wide people search. |
| Other 2.6.0 help | Adopt PR template flags, body-writing hints, and member URL descriptions through generated references. |
| Runtime-only changes | Record upstream changes to status ordering, comment identity/edit metadata, and dotenv handling. Do not claim workspace-level behavior was tested. |
| Upstream root/template | Reject broad `allowed-tools`, duplicated command catalogs, live-help-first discovery, schema-to-file filtering, piped API responses, and token-based curl examples. Preserve the compact local root/template and all local gates. |
| Generator | Preserve reference-first index text, terminal right-padding cleanup, failure-before-write behavior, curated-reference preservation, and standalone formatting flags. Replace only `@std/path` with Deno's built-in `node:path` import so standalone checks and generation need no remote import map. |
| Curated reference and eval | `organization-features.md` matches upstream unchanged. Preserve the existing draft-only eval unchanged; add deterministic mocked generator and safety tests. |

## Historical 2.6.0 offline help boundary

The current 3.1.0 boundary is described above. Do not assume that `--help` or `--version` avoids startup reads. At the pinned commit, `src/config.ts` eagerly loads environment/configuration files, and `src/credentials.ts` eagerly loads credentials and can populate a keyring cache before argument parsing.

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
2. Fetch official npm metadata for the exact approved version. Resolve the matching GitHub tag with `gh api`. Fetch the exact release source/native archives through authenticated `gh`, or clone the resolved tag into a new temporary directory. Verify release source and archive digests; never use a moving branch.
3. Verify the commit, npm integrity, release artifact digest, wrapper/installer source, runtime source, template, references, and generator. Never fetch a moving `main` as release provenance.
4. Treat a CLI upgrade as a separate change requiring explicit approval. Preserve its existing owner and unrelated packages/auth/configuration. When the installed version is already current, stage the exact native artifact privately without running a global package command or installer.
5. Establish the offline boundary before any version/help invocation. Use mocks or source inspection when safe isolation is unavailable; do not test against a real workspace.
6. Update the slim template, including the bundled-reference version. Regenerate with the local generator, not an upstream root replacement.
7. Confirm that `SKILL.md` matches its template after reference navigation expands. Compare every generated help block with the pinned upstream references and confirm that every discovered action command is represented. Exclude shell completions and Clap's recursive `help` command deliberately. Hidden aliases may remain supported in source without appearing in help.
8. Preserve exact-mutation approval, token secrecy, Markdown body files, reference-first discovery, direct-bash complete responses, no Context Mode recovery, and unchanged-command authorization retries within 10 minutes.
9. Run the checks below and the canonical all-skill validation. Scan scoped changes for secrets, literal home paths, broken links, and generated artifacts. Record provenance, decisions, and limits here.
10. Stop after the assigned checks pass. Do not stage, commit, push, deploy, or change unrelated skill families without a separate instruction.

## Checks and historical 2.6.0 results

From the repository root:

```bash
bun test agent/skills/linear-cli/scripts/generate-docs.test.ts
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/linear-cli
deno check --no-config --no-lock --no-remote agent/skills/linear-cli/scripts/generate-docs.ts
deno fmt --no-config --prose-wrap=never --no-semicolons --check agent/skills/linear-cli
git diff --check -- agent/skills/linear-cli docs/skills/linear-cli-update-process.md
```

Use the isolated temporary Deno binary when Deno is not installed. The tests execute the real generator with an in-memory `Deno` mock. They do not spawn Linear, contact a model, or inspect credentials.

Historical results for the 2.6.0 increment:

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
