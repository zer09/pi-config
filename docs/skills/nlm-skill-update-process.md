# Updating the nlm-skill skill

Keep `agent/skills/nlm-skill` aligned with the published NotebookLM CLI and MCP package while preserving the compact local router and safety overlays.

## Local invariants

Apply [local skill invariants](local-skill-update-invariants.md) and the [slimming process](skill-slimming-process.md) before and after a sync. Classification remains `make it slim`; the installed-skill decision did not change. Upstream is input, not permission to replace local behavior.

## Pi 1.6.0 recheck: 0.16.5

Rechecked on 2026-11-21 in a separate maintenance worktree. The uv-owned installation already reports `notebooklm-mcp-cli 0.16.5`, the latest stable release; no install or upgrade is needed.

| Item | Exact current provenance |
| --- | --- |
| Release | [Official v0.16.5](https://github.com/jacob-bd/gemini-notebook-mcp-cli/releases/tag/v0.16.5), annotated tag `ede25c33e384b7576477729df967148ab7d7590c`, commit `3850c2b9a24834487b91bd3eb1751e018342e1c2`; v0.16.3 has release notes in `docs/releases/` but no GitHub release object |
| Wheel | `notebooklm_mcp_cli-0.16.5-py3-none-any.whl`, SHA-256 `3c33cac11a47f59179ab170e6e06135b3aaf44c5153b5a469b6bd11157aee94f` |
| Sdist | `notebooklm_mcp_cli-0.16.5.tar.gz`, SHA-256 `ec845d537d310e9d4865467dd11ea64a55b3569b867355f370b582abe910ad1c` |

Both archives match PyPI digests; all 145 wheel `RECORD` hashes verify; all 145 non-RECORD wheel files match the installed distribution byte for byte, and all 141 packaged `notebooklm_tools` files match the tag source. The 0.16.2...0.16.5 diff changes manual-login cookie parsing (Copy-as-cURL `-b`/`--cookie`, `.google.com` preference in `login --file` imports), the Typer 0.29 storage-choice prompt, and a service-layer import boundary. Packaged `SKILL.md`/`AGENTS_SECTION.md` change only their version strings. No command, option, write default, credential-storage format, batch or pipeline behavior changed; the stricter local restrictions stay. Only the reference version markers moved to 0.16.5.

A private wheel-pinned `uv tool install` candidate under the run directory rendered all 215 Typer command/group help schemas without callbacks, and the version callback reported 0.16.5 with only `check_for_updates` mocked, inside bwrap with network denial, an empty HOME and no user state. The focused 14-test contract suite passes against the 0.16.5 source. No login, profile, notebook, MCP server or browser action ran.

## Historical 0.16.2 preparation

Reviewed on 2026-11-13 in a separate maintenance worktree, not deployed. The installed/latest distribution is already `notebooklm-mcp-cli 0.16.2`; no install, upgrade, uninstall, sync, profile/auth operation, MCP server, browser, or product call ran. Keep uv ownership, the existing receipt requirement, both executable names, UI metadata, MCP dependency `notebooklm-mcp`, and classification `make it slim` unchanged.

| Item | Exact current provenance |
| --- | --- |
| Repository and release | [Official v0.16.2](https://github.com/jacob-bd/gemini-notebook-mcp-cli/releases/tag/v0.16.2), also returned by authenticated GitHub latest-release lookup |
| Tag commit | `a73d3bebfed0fba428b73d2e768c8e0be0495390` |
| Packaged skill source | `src/notebooklm_tools/data`; all eight skill/reference files compared with exact 0.13.0 source |
| Distribution | [notebooklm-mcp-cli 0.16.2](https://pypi.org/project/notebooklm-mcp-cli/0.16.2/), Python `>=3.11` |
| Wheel | `notebooklm_mcp_cli-0.16.2-py3-none-any.whl`, SHA-256 `3f89d3b15e472230a345bd87bf922f6c76f3635e49bc365780bc72f2fe8362d3` |
| Sdist | `notebooklm_mcp_cli-0.16.2.tar.gz`, SHA-256 `5502467ff1f876c62b6c4e32f6d5cddbbc069c1174895f2cd0998f7502f0c407` |
| Git archive SHA-256 observed | `888baea9b27e9064566b119ee3a03bff7889449052a6e2aff1ec9437d99cfb91` |
| Existing owner and receipt | uv tool environment; requirement `notebooklm-mcp-cli` is currently unpinned, not the historical exact 0.13.0 requirement |
| Entry points | `nlm = notebooklm_tools.cli.main:cli_main`; `notebooklm-mcp = notebooklm_tools.mcp.server:main` |

The PyPI archive hashes match the parent's November 12 metadata. All 384 Git archive files match the resolved commit's blob IDs. All 139 wheel runtime/data files match Git source and sdist; `pyproject.toml` also matches sdist. Wheel `RECORD` verifies all packaged members. All 143 non-RECORD wheel files match the installed distribution, and all 147 hashed installed `RECORD` entries verify, including launchers and uv metadata. Installed symlinks/launcher imports and `INSTALLER=uv` establish the current owner. The historical installation below is not a claim about today's unpinned receipt. There is still no distribution rename; a connection alias never authorizes changing ownership or MCP dependency metadata.

Adopt only corrections for existing workflows:

- Distinguish retryable reads and pre-send connection failures from uncertain writes; never add automatic mutation retries. Automatic browser recovery has a per-process/profile cooldown and failure budget, not an elapsed-time login policy.
- Correct the headless opt-out description: it blocks browser refresh, not explicitly requested `--http-only` recovery. HTTP-only validates before saving, cannot renew browser-dependent cookies or revive fully expired login, and is not an automatic fallback. Preserve same-profile recovery and secret boundaries.
- Explain the process-wide MCP session override and saved-default distinction. Keep explicit CLI/profile preference, no automatic switching, exact local-profile gates, account disclosure and single-user gateway isolation. Do not install a profile workflow or assume one account per chat.
- Correct source URL retrieval and sync reporting: unknown freshness is not fresh; default sync selects confirmed stale, syncable sources only. Sync and export remain separately authorized.
- Note current login proof, best-effort notebook count and credential-storage prompts without adopting storage conversion/repair commands or setup automation. Preserve the compact router, root description, selected Studio guides, confirmation and cinematic preview, one-shot chat, scoped downloads, opt-outs and ZIP-versus-hosted-upload boundaries.

Hold new collections, experimental source search, alias tools, chat deletion/save tools, storage-command catalogs, health-monitor additions, scheduled refresh, third-party research and other optional features. The released MCP batch file and pipeline step executor are byte-identical to 0.13.0: batch Studio still ignores both confirmation values, and mutation pipelines still lack granular gates. Retain the stricter local restrictions; no upstream bug-fix claim or workaround relaxation is warranted.

S6 validation uses private source/wheel copies, a read-only prepared Python 3.13.16/PyYAML 6.0.3 environment, cleared environment, hidden real HOME/keyring/browser state and bwrap OS network denial. All 215 current Typer command/group help schemas render using each command's own context class without callbacks. The version callback reports 0.16.2 with only `cli.utils.check_for_updates` mocked at the documented seam; its latest-version message is not evidence. The `cli_main` wrapper is not invoked because successful exit can inspect credential-storage notices; its final TTY update hook also needs isolation. Existing AST/extracted-function regressions pass all 14 tests before and after adaptation, with no test changes. Target/all 39 validators, metadata, exact prompt token, links/anchors, artifact/secret hygiene and scoped preservation pass. These checks prove selected source/help contracts, not live auth, Google behavior, storage migration, UI, hosted uploads or model compliance. Private `reports/s6/handoff.md` records exact commands, failures, timings and preservation scope for this maintenance run; other families and final combined acceptance remain deferred.

## Historical 0.13.0 source and installation

Verified on 2026-09-29:

| Item | Exact provenance |
| --- | --- |
| Repository | https://github.com/jacob-bd/gemini-notebook-mcp-cli |
| Published release | [v0.13.0](https://github.com/jacob-bd/gemini-notebook-mcp-cli/releases/tag/v0.13.0) |
| Tag commit | `a7ace144d70f9a150e0951198d7014519cc6e970` |
| Runtime skill directory | `src/notebooklm_tools/data` |
| Python distribution | [notebooklm-mcp-cli 0.13.0](https://pypi.org/project/notebooklm-mcp-cli/0.13.0/) |
| Wheel | `notebooklm_mcp_cli-0.13.0-py3-none-any.whl` |
| Wheel SHA-256 | `4378b242f77d48280214f6564660e80d3f4b0cbee23710269cf63c7fd13a6c44` |
| Sdist | `notebooklm_mcp_cli-0.13.0.tar.gz` |
| Sdist SHA-256 | `32bbf131e7a413af47f7851a37d03223d4a61b9c126f636f654f780520e3e518` |
| Git source archive SHA-256 observed | `bcb8344f7af6232248b5c88e5b4205dca8b994dcc716efb764fb5c79f07e013d` |
| Persistent uv requirement | `notebooklm-mcp-cli==0.13.0`, upgraded from `0.10.1` |
| Executables | `nlm`, `notebooklm-mcp` |

The exact tag's `pyproject.toml`, PyPI metadata, wheel metadata, and installed receipt agree on the distribution name. **There is no Python package rename at 0.13.0.** The setup wizard can rename old MCP connection keys `notebooklm-mcp` or `notebooklm` to `gemini-notebook-mcp`. This is not a reason to uninstall the distribution, change UI dependency metadata, or modify working client configuration.

Integrity verification compared downloaded archives with PyPI SHA-256 values and checked wheel `RECORD` entries. All 302 source archive files matched the Git tree's blob IDs at the commit. All 124 packaged runtime/data files matched that source; sdist runtime files and `pyproject.toml` also matched. After installation, 126 runtime/data/metadata/entry-point files matched the verified wheel. The Git blob comparison is the source-integrity check; an archive's transport hash alone is not provenance.

The former local record `0.9.6` / `fd8bec48b51dc500e4e11a8a93c99d01d58675ee` was stale relative to installed `0.10.1`. That sync replaced the record and updated the adapted AGENTS section marker to `0.13.0`; it did not claim the old installed binary was `0.9.6`. The current marker now reflects the reviewed 0.16.2 source.

## Local file model

- `SKILL.md`: intent trigger, exact authorization boundaries, MCP-first/task-based choice, selected-reference routing, key correctness, and completion. Keep it compact; do not copy the upstream command catalog into the root.
- `references/command_reference.md`: adapted command guidance checked against installed help and exact source. Include relevant options omitted from upstream's reference, such as Interactive report commands.
- `references/workflows.md`: optional sequences with per-action authorization, not blanket permission to run every step.
- `references/troubleshooting.md`: proportionate recovery, secret boundaries, quota windows, download paths, and setup changes.
- `references/remote-mcp.md`: loopback, authenticated HTTPS gateway, account isolation, and server-host paths.
- `references/studio-prompting-guide.md` and `references/studio-prompt-examples.md`: selected Studio guidance, including authorized report-element plans.
- `references/agents-section.md`: locally adapted `AGENTS_SECTION.md`, not a verbatim upstream installation snippet.
- `agents/openai.yaml`: intentional UI metadata and MCP dependency `notebooklm-mcp`. Preserve both; a new upstream connection name does not authorize changing this metadata.

All paths above are relative to `agent/skills/nlm-skill`.

## Selected 0.13.0 changes and local differences

Compared exact released `SKILL.md`, `AGENTS_SECTION.md`, and all six runtime references. Also inspected CLI startup/imports, registrations, setup/skill packaging, report generation, batch confirmation, and installed help schemas.

- Adopt usage windows, profile-specific reads, headless-refresh boundaries, persistent-query behavior, Interactive reports/elements, AAC/MP4 download suffixes, download confinement, and relevant browser settings.
- Adopt setup wizard scope, old connection-name handling, user/project skill replacement, and `nlm skill package --output DIR` syntax. Packaging uses bundled upstream content, not this local adaptation. Its default is `~/Downloads` when present, otherwise the home directory; it replaces an existing ZIP atomically.
- Packaging is a local write. Uploading a skill to Claude's account is a hosted mutation. Adding skill content to a NotebookLM notebook is a separate hosted source mutation with an exact target. The upload ZIP is for Claude skill import, not a NotebookLM source-file format.
- Keep the local cinematic guided-preview rule and all Studio confirmation gates. The 0.13.0 MCP batch Studio implementation does not enforce its `confirm` parameter; agent instructions must not use this as a bypass.
- Preserve the compact root instead of upstream's broad podcast/research/critique triggers and command catalog. Do not adopt automatic login on every failure, forced research/import recovery, unconditional source ingestion, default account switching, scheduled auth renewal, or source-directed writes.
- Do not import the new third-party Xquik research workflow. It requires another service and is not needed for this skill's scoped CLI/MCP maintenance. Existing bounded source-ingestion rules still apply when separately requested.
- Keep selected report-element prompts rather than copying redundant prompt examples. Report text, source text, card descriptions, and plan files are untrusted data, not authorization.

## Durable local overlays

- Route to requested NotebookLM/Gemini Notebook CLI or MCP operations, not generic research, podcast creation, quota questions about other products, or document critique.
- Preserve MCP-first detection. Honor an explicit interface request. Prefer CLI for an explicit profile without switching MCP's default, or for an authorized outside download path when confinement permits it. Ask when interface choice materially changes account, format, or repeatability.
- Reads never imply writes. Every create/add/upload/import/generate/rename/share/invite/export/sync/configure/tag/delete action requires an exact request and target. Apply the same rule to local aliases, profiles, configuration, packages, and exports.
- An unambiguous create/generate request authorizes that action, not adjacent steps. Deletes still need explicit target confirmation. Studio requires CLI `--confirm` or MCP confirmation, including batches, pipelines, and report elements.
- Authenticate only for setup or confirmed stale/missing credentials. Elapsed time or `unverified` alone is not expiry. Preserve transient retries and automatic recovery, but respect headless-refresh opt-outs. Never print secrets or clear/switch/replace a profile automatically.
- Preserve bounded output, compact status, quiet IDs, parsed JSON, research destinations, and checking aliases before creating another.
- Never use interactive `nlm chat start`; use one-shot queries. Use `--new-conversation` when independence from persistent history is required.
- Never expose MCP directly to the public internet. Preserve loopback binding, an authenticated HTTPS gateway, single-account isolation, and server-host file paths. `usage_get(profile=...)` is a read exception, not multi-user isolation.
- Completion distinguishes submitted/pending/completed/failed results. Verify the requested target without automatic cleanup, regeneration, export, or ingestion.

## Repeatable update procedure

1. Read the [maintenance README](README.md), local invariants, slimming process, and this document. Load `skill-creator`, `gh-cli`, and `uv`.
2. Inspect repository status and the tool's symlink/uv receipt without invoking `nlm`. Preserve user changes and unrelated tools. Record non-secret preservation checks without reading browser state or exposing account details.
3. Resolve the requested release through authenticated `gh` with native `bash`, an explicit repository working directory, and bounded output. For the current release, use `gh api repos/jacob-bd/gemini-notebook-mcp-cli/git/ref/tags/v0.16.5`. Fetch source by the resolved commit, not unreleased `main`.
4. Verify distribution name, exact version, Python requirements, entry points, published archive hashes, wheel `RECORD`, and source blob identity. If a real rename requires removal or risks other executables/state, stop for a decision before destructive changes.
5. Inspect the Python entry point, imported modules, root callback, and exit/update hooks before running any version/help check. In 0.16.2 through 0.16.5, `--version` calls `cli.utils.check_for_updates`, which can contact PyPI and create a cache. `cli_main` can inspect storage notices after successful exit and check updates in its final TTY hook. None is an inherently offline check; do not invoke the wrapper just to render help.
6. If persistent installation is explicitly authorized, use uv's existing distribution mechanism with an exact requirement. The approved form is `uv --no-config tool install 'notebooklm-mcp-cli==0.16.5' --python <existing-interpreter> --default-index https://pypi.org/simple --no-build`. Do not use `--force`, uninstall, `upgrade --all`, or run setup as part of the upgrade. Compare installed package bytes with the verified wheel afterward.
7. Use a network-isolated sandbox for installed help/version inspection. Give it an empty HOME/config/data directory, cleared environment, read-only package/runtime mounts, and bytecode/cache paths outside the repository. Do not mount user credentials or browser state. Mock the version update checker; ignore its "latest version" message as evidence when offline.
8. Render installed command help from Typer command schemas without invoking product callbacks. Use the command's own context class; modern Typer may not share the separately installed Click classes. Source/mock checks are the fallback when isolation is unavailable.
9. Compare exact released skill files and relevant runtime source with local references. Adapt only applicable changes. Keep root frontmatter to `name` and `description`; track version/SHA here and in the AGENTS marker, not extra root metadata.
10. Do not run `nlm setup`, `doctor`, login/auth/profile operations, notebook/source queries, the MCP server, or any product operation for maintenance validation. Do not upload a ZIP or replace this local skill through the upstream installer. No browser, NotebookLM/Google, model, or hosted mutation tests belong in this maintenance pass.
11. Reapply local overlays and run the checks below. Stop after the requested increment passes. Do not stage, commit, push, or change settings/routing unless separately authorized.

## Validation

Target validator:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --offline --no-project --python <prepared-interpreter> python -B \
  agent/skills/skill-creator/scripts/quick_validate.py agent/skills/nlm-skill
```

All Local Skill validators:

```bash
for skill_dir in agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  PYTHONDONTWRITEBYTECODE=1 uv run --offline --no-project --python <prepared-interpreter> python -B \
    agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Use a prepared dependency environment if offline resolution is unavailable; do not install or run product clients to satisfy document validation.

Run the [focused command regressions](tests/test_nlm_command_contract.py) against the verified source tree:

```bash
PYTHONDONTWRITEBYTECODE=1 uv --no-config run --offline --no-project \
  --no-python-downloads --python <prepared-interpreter> python -B docs/skills/tests/test_nlm_command_contract.py \
  --source /path/to/verified/source/src/notebooklm_tools
```

The suite parses source AST and executes only extracted functions with fake dependencies. It never imports the product package or invokes its CLI. Coverage is limited to `share`, `export`, `slides`, `batch`, `pipeline`, `chat`, and `chats` examples, chat registration/prose, runnable MCP batch/pipeline restrictions, and download-root precedence; it is not a complete shell parser.

Required checks:

- Validate target/all skills, YAML, frontmatter, exact `$nlm-skill` prompt, UI description length, and intentional MCP metadata.
- Resolve Markdown links and anchors in changed files, including this process and the AGENTS snippet.
- Compare documented commands with exact source signatures: reject unknown leaf subcommands, unknown options, missing arguments, incorrect option arity, missing required options, and unsupported enum values. Reject unsafe runnable recipes even when their syntax is valid. The earlier 209 rendered command/group schemas and 105 matching prefixes were discovery evidence, not sufficient command acceptance. The focused suite checks leaf signatures and aliases for its seven families, chat registration and inline alias claims, export type and slide format/length enums, and confirmation restrictions.
- Test source-extracted functions with fake clients/services only. The historical 0.13.0 sync passed nine isolated static/mock tests for report read/status/confirmation, unknown outcomes, batch confirmation limitations, package names, and skill ZIP content/default behavior. No ZIP was built or uploaded during validation.
- Review representative boundaries: status does not import research; stale sources do not sync; report reads/plans do not generate; generation does not ingest missing sources; a clear generation request needs no repeated approval; deletes stop for explicit confirmation; setup/package requests do not authorize hosted uploads or account changes.
- Run scoped `git diff --check` and review the diff. Scan changed files for secrets, literal home paths, stale version claims, and accidental artifacts. Keep caches, downloads, source archives, and test output outside the repository.
- Recheck unrelated uv tools, tool entry points, non-browser auth/profile/config state, UI metadata, and Git index preservation. Do not hash or inspect browser state as an optional extra check.

Historical Increment 8 remediation acceptance: the initial focused regression failed on 13 invalid or unsafe documented examples and the presentation format assertion. The first documentation fix passed all 10 tests. The remaining-findings regression ran 14 tests and failed on the inline `nlm chat list` alias and all three unconditional download defaults before the follow-up fix. After the follow-up fix, all 14 tests passed. Negative controls reject the old sharing/export/slides syntax, unknown options/enums, missing required arguments, batch Studio, and generating pipeline recipes, including invented confirmation flags. Source AST verifies that `chat` registers `configure`/`start` and `chats` registers `list`; negative controls reject `nlm chat list` in prose and fenced examples. Fake calls verify that MCP batch Studio ignores both confirmation values, direct MCP Studio stops without confirmation, and pipeline mutation steps lack granular gates. Fifteen download-root cases execute the extracted resolver with pure fake paths and a private environment mapping: configured values are stripped and expanded; unset, empty, and whitespace-only values use the existing Downloads directory or fall back to application storage when Downloads is missing or not a directory. No product imports or user filesystem access occur in these fake calls. This supersedes prefix-only acceptance for the remediated command families.

These checks establish local structure, syntax, provenance, isolation, and selected control-flow behavior. They do not establish live authentication, NotebookLM/Google behavior, wizard UI behavior, hosted uploads, model compliance, or CDN availability.
