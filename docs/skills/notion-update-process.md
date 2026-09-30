# Notion skill update process

Status: active Local Skill, classified `make it slim`.

## Purpose and local shape

The installed `notion` skill combines two official Notion sources:

- `makenotion/skills`: current `ntn` CLI discovery, authentication, pages, data sources, files, API, and workers guidance.
- `makenotion/claude-code-notion-plugin`: knowledge capture, workspace research, meeting preparation, spec/task tracking, task-board operation, and code-change documentation workflows.

`SKILL.md` remains a compact runtime router with hosted-service safety gates. Higher-level workflows live in `references/workflows.md` and load only when needed. Do not restore the plugin's duplicated tutorials, Claude-specific command names, unavailable reference links, or mandatory polling behavior.

The narrower historical `notion-cli` skill remains retired; see `notion-cli-update-process.md`.

## Sources of truth

- CLI repository: https://github.com/makenotion/skills
- CLI runtime path: `skills/notion-cli/SKILL.md`
- Last CLI commit compared: `10e976aa591995fd60c75ef13beba1a8aa827fcc`. The runtime path is unchanged from the previously integrated `423af2bf546cd0354e5cc871017251945d9ad14f`; the repository advanced five commits.
- Workflow repository: https://github.com/makenotion/claude-code-notion-plugin
- Last workflow commit compared: `9847f2aa1a15f25df35ed1fb7b4557dbb60cd651`, unchanged from the previous integration.
- Compared workflow paths: `skills/notion/{knowledge-capture,meeting-intelligence,research-documentation,spec-to-implementation}/SKILL.md`, `commands/{create-database-row,create-page,create-task,database-query,find,search}.md`, and `commands/tasks/{build,explain-diff,plan,setup}.md`.
- Both repository heads and source contents were retrieved with authenticated `gh api` at these exact commits.
- Runtime command source: isolated installed version/help output for `ntn 0.23.11`, upgraded from independently verified `0.21.9`.

## Pinned package provenance

| Evidence | Value |
| --- | --- |
| Exact package | `ntn@0.23.11`, description `Notion CLI`, MIT license, binary entry `bin/ntn` |
| Public npm metadata | https://registry.npmjs.org/ntn/0.23.11 |
| Public npm archive | https://registry.npmjs.org/ntn/-/ntn-0.23.11.tgz |
| npm SHA-512 integrity | `sha512-Bo8mphfJbLj06B4+T2R9gd0PSgwS8iPiKZGa6KWW3izbgEmy3iGCH1HvfWpD09by7y/vu1Sqy8ankKEZZj9MYA==` |
| npm SHA-1 | `e622fc1dccf422d3eda940e432af5a9ae698dd38` |
| Linux x64 binary SHA-256 | `6c3ea7173b6995186b1455a046e2530d7f6e9f1b4b80dc7429b788f06cfbda46` |
| Declared build commit | npm `gitHead`: `4038c79bfbbb0fd959db70e5d3b572903d592fec` |
| Declared CLI repository | Package README: https://github.com/makenotion/cli |
| Publisher | npm reports GitHub Actions with a GitHub trusted publisher |

The downloaded archive matched both public npm hashes before installation. Both npm registry signatures verified against the matching key from `https://registry.npmjs.org/-/npm/v1/keys`. All ten installed package files then matched that archive byte-for-byte. Registry signatures establish registry integrity, not an independent source-build audit.

The package README identifies `makenotion/cli` and the same official `ntn.dev` installation source referenced by `makenotion/skills`. Authenticated GitHub commit and tree reads for the declared build commit returned HTTP 404. The build commit is recorded as npm metadata, not independently verified source. No further source-access retries were made.

## Bun-global installation and isolation

The approved upgrade used the existing Bun-global installation, not a new installer or `ntn update`:

```bash
bun add --global --exact --ignore-scripts ntn@0.23.11
```

Bun `1.3.14` installed one package. `~/.bun/bin/ntn` still resolves to `~/.bun/install/global/node_modules/ntn/bin/ntn`. The unchanged JavaScript launcher selects the packaged platform binary and forwards arguments. The unchanged installer only copies that binary into `bin/`; lifecycle scripts stayed disabled because the existing launcher works without this copy. No lifecycle script was separately executed.

Before running the CLI, inspect the launcher, installer, and packaged executable. This release is a compiled Rust executable; symbols include config/auth/cache access and update-check functions. Do not assume version/help startup is side-effect-free. All CLI checks used Bubblewrap with:

- `--unshare-all --new-session --die-with-parent`, including an isolated network namespace.
- A cleared environment, empty temporary HOME and XDG paths, and a temporary working directory.
- Read-only mounts for `/usr` and the package only, plus isolated `/proc`, `/dev`, and temporary storage. No user HOME, auth, keyring, workspace, or repository mounts.
- `/usr/bin/node /opt/ntn/bin/ntn` as the launcher; `/opt/ntn` was the read-only package mount.

Keep isolation mandatory when startup safety cannot be established. If isolation is unavailable, stop CLI execution and report the verification limit instead of using the user's environment.

## Adopt, adapt, reject

| Source behavior | Local decision |
| --- | --- |
| Official CLI discovery and existing page/data-source commands | Retain installed help as authority. All 11 inspected help outputs were identical across `0.21.9` and `0.23.11`; no command migration was necessary. |
| Upstream `ntn pages update` wording | Reject. Installed `pages --help` exposes `edit`, not `update`; `pages edit --help` explicitly replaces content. |
| Markdown reads and edits | Clarify the existing preservation gate: inspect `unknown_block_ids` after truncated reads, never replace from incomplete content, and use API operations rather than Markdown frontmatter for property updates. |
| Self-documentation through API paths, specs, and docs | Keep task-specific discovery for authorized workspace operations. Exclude it from maintenance because discovery can fetch remote schemas/docs. |
| Upstream installation and authentication guidance | Adapt to separate installation and login/logout gates. Maintenance uses only isolated version/help, not `whoami`, credential inspection, or login. |
| Four plugin workflows and task commands | Retain the existing selective `references/workflows.md`; reviewed upstream content is unchanged. Preserve source links, target/schema checks, confidentiality, and verification. |
| Plugin companion writes, assumed destination, MCP commands, ten-second polling, and automatic diff pages | Reject automatic behavior. Each write needs exact authorization; polling requires explicit sole-channel use. Do not import tutorials, missing references, or Claude-specific tools. |
| Local routing and metadata | Preserve the description, `make it slim` classification, one `$notion` metadata token, and existing metadata fields. Do not add dependencies or restore retired `notion-cli`. |

## Routing and proportional discovery

Keep `notion` as `make it slim`. Activate it for Notion workspace reads or explicitly requested writes through official `ntn`, not a bare Notion mention in unrelated prose. Resolve exact targets and inspect only context, schemas, and allowed values that affect the operation. Load higher-level workflow recipes only for the selected task; a workflow name does not authorize companion writes.

An exact read request stays read-only. An exact write request authorizes only that action and target without redundant confirmation unless destructive or materially ambiguous. Preserve page-fetch-before-replace, deletion confirmation, schema checks, the smallest operation, verification, and token secrecy.

Missing tooling/authentication is a blocker, not permission to install or log in. Persistent CLI installation and login/logout require user request/agreement, separate from workspace read authority. Do not run a curl installer or start login automatically. Keep exactly one `$notion` token in the metadata prompt and preserve dependency metadata. A routing-only pass does not change source commits or the reviewed CLI version.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Use authenticated `gh` to verify exact upstream commits and compare the source paths above with `agent/skills/notion/`.
3. Before an authorized package upgrade, record the installed version, launcher target, global manifest/lock entries, unrelated package fingerprints, and existing repository changes. Verify the exact public npm archive integrity and review package startup and lifecycle scripts.
4. Use only isolated `--version` and static command `--help` through Context Mode. Do not run `whoami`, auth commands, API path help, `api ls`, `--spec`, `--docs`, workspace reads/writes, workers, or browser actions during maintenance. Do not read or change user auth/config. Product-route discovery is not an offline check.
5. Upgrade only the approved version through the existing Bun-global mechanism above. Compare installed files with the verified archive, check isolated version/help, and prove unrelated global packages and repository changes remain intact. Retain only runtime-relevant syntax/procedures; preserve database/data-source distinctions.
6. Reconcile upstream workflow changes into `references/workflows.md`. Preserve capability while compressing repeated templates into short structures and selection rules.
7. Preserve the external hosted-service mutation gate: creating/editing/trashing pages, changing properties/comments, uploading files, deploying/executing workers, and every other Notion write require an exact explicit user request. Preserve the separate user request/agreement gate for persistent CLI installation and login/logout.
8. Preserve the rule that `ntn pages edit` replaces page content: fetch first, retain unrequested content, and require confirmation before `--allow-deleting-content` or non-interactive trashing.
9. Do not print or document token values. Refer to `NOTION_API_TOKEN` by name only.
10. Keep `SKILL.md` frontmatter to `name` and `description`, retain `agents/openai.yaml`, and keep its default prompt aligned with `$notion`.
11. Record source provenance, decisions, checks, and limits here. Update the maintenance index or installed-skill inventory only when their entry or classification changes; neither changed in this increment.
12. Run target and all-skill validation from `local-skill-update-invariants.md`; also check links, YAML, secret/home-path scans, and generated artifacts.

## Slimming invariants

- Keep simple CRUD/search/file/worker routing in `SKILL.md` without loading workflow references.
- Keep only workflow-specific, non-obvious procedures in `references/workflows.md`.
- Prefer self-documenting CLI help over copied API schemas or command catalogs.
- Do not add scripts unless a repeated deterministic operation proves necessary.
- Do not add the hosted Notion MCP as a dependency unless Pi is deliberately configured to expose and authenticate it.

## Increment 7 acceptance evidence

- Package checks: exact `0.21.9` baseline and `0.23.11` installed version; verified npm archive/signatures; all ten installed files matched; launcher target preserved.
- Offline CLI checks: `--version`, `--help`, `pages --help`, `pages {get,create,edit,trash} --help`, `datasources --help`, `datasources {resolve,query} --help`, `api --help` without a path, and `files --help`. All 12 checks exited zero for the prior, candidate, and installed package. Only version output changed.
- Preservation checks: 67,307 unrelated package-file fingerprints, 14 unrelated Bun-bin entries, and 3,775 out-of-scope repository files unchanged. Global manifest and lock changes were limited to `ntn`. All 14 unrelated top-level versions remained unchanged, including Linear `2.6.0`; Bun still listed 851 packages. Git index unchanged.
- Target validator: `uv run --offline --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/notion` passed.
- All-skill validation: the invariant-document loop with `uv run --offline --with pyyaml python -B` passed for all 38 Local Skills, including frontmatter, metadata YAML, prompt tokens, description lengths, and local Markdown links.
- Offline static contracts: 14 temporary `unittest` cases passed. Cases cover unchanged routing, selective loading, exact write authority, target/schema/duplicate checks, fetch/preserve/delete/yes gates, truncated content, current edit syntax, maintenance isolation, separate setup gates, secrecy, completion, unchanged workflows/metadata, and retired-skill absence. No permanent helper was needed for this instruction-only sync.
- Final hygiene: changed Markdown links and all 31 maintenance-index targets resolved. Credential/home-path/Python-example scans, the skill-artifact scan, and scoped `git diff --check` passed. The root remains 55 lines; workflow recipes and metadata are byte-for-byte unchanged.
- Semantic comparison: workspace-read and exact-write intents retain their routes; a bare Notion mention does not activate workspace operations. Simple CRUD does not require workflow recipes. A spec-read request does not authorize tasks, statuses, comments, or companion pages. Completion still requires operation verification. These are static/manual checks, not live-model compliance tests.

No workspace behavior, authentication, API schemas, worker behavior, browser flow, or live models were exercised. No Notion credentials/configuration, Pi settings/routing, prior increments, or other skill families were changed. Future families remain deferred.
