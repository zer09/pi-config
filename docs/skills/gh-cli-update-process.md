# Updating the gh-cli skill

## Installation method (since 2026-11-21)

`gh` comes from the openSUSE package (`zypper`, package `gh`, repository openSUSE-Tumbleweed-Oss) at `/usr/bin/gh`. It was 2.105.0 when the switch was made. The earlier hand-copied `~/.local/bin/gh` was removed (its backup was later deleted), and `gh auth status` still succeeds because authentication lives in `~/.config/gh`. Update the CLI with the system (`sudo zypper up gh`), then regenerate references from the installed `gh`. Do not copy release binaries into `~/.local/bin` again: that directory precedes `/usr/bin` on `PATH` and would shadow the package. The binary-download and copy steps below are historical.

## Pi 1.5.2 installation

The prepared official gh 2.103.3 binary is now installed at its existing user-local path and passes a network-denied native version check. No GitHub product/write/login action ran. The refreshed manuals and authorization rules remain unchanged. See the [installation record](../changelogs/pi-1.5.2-full-setup-installation.md); older preparation facts below remain historical.

## Pi 1.6.0 maintenance: prepared 2.105.0 (not installed)

The live `~/.local/bin/gh` remains 2.103.3. Official [v2.105.0](https://github.com/cli/cli/releases/tag/v2.105.0), published 2026-11-18, tag commit `e1219499a578b69e3437adaa31cd60614e23c802`, is prepared under `RUN/cli/gh/native/gh` (mode 0755). The archive `gh_2.105.0_linux_amd64.tar.gz` SHA-256 `79e7ab5db738c48777b696e374f8b428f0647debfb424f44d2f426370407fe2f` and checksum manifest SHA-256 `4597138ea96e474c68001370c0a4955ff4834ba603c53900de6ebbef4cb0bed9` match the release-asset digests; the archive matches its manifest entry. Candidate binary SHA-256: `fa7cff06d4db9eee98e00b10ac93beebfe1822109ac04a6cbbf9d806c21d0073`.

Release review (2.104.0, 2.105.0): no auth/credential-format or hosted-write default change. `gh repo delete` now requires `--accept-cascading-deletion-of-private-forks` with `--yes` non-interactively when private forks would be deleted (stricter). 2.105.0 adds the preview `gh event` family (`listen`, `subscription create/list/view/delete`); `listen` creates or reuses a server-side subscription and blocks, so `references/index.md` gates it and subscription create/delete as hosted writes. The pflag 1.1.0 bump renders boolean flags as `--flag[=true|false]` and realigns flag columns, so 241 existing pages changed text; only 11 changed beyond that rendering (`api`, `auth setup-git`, `cache delete`, root help, `help environment`, `help reference`, `pr`, `pr view`, `repo delete`, `run view`, `run watch`). Four help topics are identical; seven `event` pages are new; none were removed. The root, description, UI metadata and URL normalizer are unchanged.

Purpose: keep `agent/skills/gh-cli/SKILL.md` as a small runtime router, keep `references/index.md` as the command-family map, and keep exact command syntax in one reference file per command or subcommand.

## Local invariants

Before and after regenerating local command references, apply `local-skill-update-invariants.md`. Generated command content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

Preserve the local GitHub URL normalization rule: when a user supplies a GitHub HTTPS repository URL such as `https://github.com/zer09/pi-config`, the runtime skill must route through authenticated `gh` instead of web/HTTPS browsing. Normalize obvious URLs from memory to `OWNER/REPO` for `gh --repo OWNER/REPO ...` and to `git@github.com:OWNER/REPO.git` when using `gh repo clone` or Git remote operations. Keep `scripts/normalize_github_url.py` as the deterministic fallback parser for ambiguous or complex GitHub HTTPS and SSH URL shapes, and keep its compact JSON output limited to one primary `gh.argv` plus top-level `references` for valid routes.

## Sources

- Manual root: https://cli.github.com/manual/
- Command index: https://cli.github.com/manual/gh
- Local generator source: built-in `gh help` output from the verified official GitHub CLI. The current comparison used the prepared `gh version 2.105.0 (2026-11-17)` candidate, not the live binary. Earlier generation used 2.95.0, 2.96.0, 2.97.0, 2.101.0, and 2.103.3; unchanged pages retain their earlier attribution after a complete command-tree comparison found identical normalized help text.

## Prepared candidate and provenance (S3)

The 2.103.3 candidate is **prepared in a separate worktree, not deployed**. The live `~/.local/bin/gh` remains 2.101.0 with user-local ownership. The skill remains `make it slim`; its root, description, UI metadata, URL normalizer, and local routing/safety rules are unchanged.

- Official release: https://github.com/cli/cli/releases/tag/v2.103.3, published 2026-10-26.
- Exact tag commit: `63837fb778d6a39f02be0ce76ff89f2bc8d74bdc`.
- Linux amd64 artifact: https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_linux_amd64.tar.gz.
- Published checksums: https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_checksums.txt.
- Archive SHA-256: `4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d`.
- Checksum-manifest SHA-256: `f756e7859d90dbb5e85aae5194206c37da220bec9bac23d3d659078a8e766fdc`.
- Candidate binary SHA-256: `b768184570b12536be4ac1528893f6340d1c6a7b40b56ad45bca9cd0e87ad34d`.
- Candidate location: `RUN/reports/s3/native/gh`, mode 0755. Later deployment requires separate authorization and must preserve the `~/.local/bin/gh` owner/path; `/usr/bin/gh` is not a deployment target.

Authenticated installed `gh` performed only the exact upstream tag read and release-asset downloads in a separate network-enabled phase. Both downloaded files matched the recorded GitHub asset digests and sizes; the archive also matched its exact checksums-manifest entry before extraction or execution. No installer, build, manager change, live replacement, auth/config change, or extension update ran.

Candidate execution used only `--version` and `help` in an OS network-denied namespace, with no real HOME, keyring, credentials, aliases, or extensions. Empty `GH_CONFIG_DIR` and `XDG_DATA_HOME`, disabled notifiers/telemetry/prompts/colors, read-only source/native inputs, and RUN-only scratch kept the capture separate from installed state. Normalization changed only portable home/config/data paths, trailing line whitespace, and the final newline. Full commands, timings, artifact evidence, and protected-state results are recorded in `RUN/reports/s3/handoff.md` and its linked logs.

The new issue-artifact help and changed authentication help are factual references, not permission to use those features. In particular, help now documents automatic refresh by `auth status` and `auth token` unless `--no-refresh` is supplied. No account/auth command or hosted product action was exercised, and no new auth policy was adopted.

## Historical approved CLI upgrade and provenance (2026-09-29)

The 2026-09-29 update replaced only `~/.local/bin/gh`, selected by PATH, from 2.97.0 to 2.101.0. The skill remains `make it slim`; its trigger intent, hosted-write gate, and metadata are unchanged.

- Official release: https://github.com/cli/cli/releases/tag/v2.101.0, published 2026-09-15.
- Linux amd64 artifact: https://github.com/cli/cli/releases/download/v2.101.0/gh_2.101.0_linux_amd64.tar.gz.
- Published checksums: https://github.com/cli/cli/releases/download/v2.101.0/gh_2.101.0_checksums.txt.
- Archive SHA-256: `9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8`.
- Checksum-manifest SHA-256, also matched to the release API asset digest: `f8bbc37fc5568a6a162d1a67b1e9c1afa9139f7b5a46dcde4a57bdaa0db33b60`.
- Installed binary SHA-256: `ea857a3f0f7d4276cf5848b236542c5048e2eaa7bdd1b6ddec238f8793e74bff`.

Future CLI upgrades require explicit approval for the target version and installation path. Download the archive and checksum manifest with `gh release download <tag> --repo github.com/cli/cli` into a temporary directory. Verify both downloaded files against their GitHub release-asset digests, and verify the archive against its exact entry in the published manifest before extraction or execution. Copy the verified binary to a temporary file beside `~/.local/bin/gh`, set mode 0755, compare the copy, and rename it atomically over the approved path. Verify `command -v gh` and `gh --version` afterward. Do not replace `/usr/bin/gh` or change authentication, tokens, extensions, repositories, or hosted state.

## Extension boundary: gh stack

`gh extension list`, `gh stack --version`, and `gh stack --help` identified [github/gh-stack](https://github.com/github/gh-stack) v0.1.1. Its help advertises stack management, remote operations, navigation, and utilities. It is an installed extension, not a missing built-in command page.

Keep extension-generated help out of the core references and comprehensive `gh help reference` snapshot. Use the installed extension's own `--help` at runtime, as directed by `references/index.md`. The core inventory includes the built-in `gh extension` management family, but not commands listed under `EXTENSION COMMANDS`. Neither the historical update nor S3 upgraded or changed gh-stack. The skill mentions this installed extension for separate help discovery; core help capture and the URL normalizer do not depend on it. S3 did not execute or load the extension or run extension discovery. Any future stored extension reference needs a separate namespace and explicit extension source/version attribution, not the core CLI generator version.

## File model

- `agent/skills/gh-cli/SKILL.md`: frontmatter, operating rules, minimal local examples, and reference navigation. Keep it token-friendly.
- `agent/skills/gh-cli/references/index.md`: compact command-family map, runtime route, extension boundary, and reference path rules for discovery.
- `agent/skills/gh-cli/references/gh.md`: root `gh help` from isolated configuration without installed extensions or custom aliases.
- `agent/skills/gh-cli/references/<command>.md`: top-level command manual, for example `references/auth.md`.
- `agent/skills/gh-cli/references/<command>/<subcommand>.md`: subcommand manual, for example `references/auth/login.md` and `references/pr/create.md`.
- `agent/skills/gh-cli/references/help/<topic>.md`: `gh help <topic>` pages, not command pages.
- `agent/skills/gh-cli/scripts/normalize_github_url.py`: single-argument, network-free parser for GitHub HTTPS and SSH URLs. It emits compact JSON with one primary `gh.argv` and top-level `references` entries that point back into `agent/skills/gh-cli/references/`.
- `agent/skills/gh-cli/scripts/test_normalize_github_url.py`: offline regression tests for route output, referenced files, malformed URLs, control characters, and slash-ref ambiguity.
- `agent/skills/gh-cli/agents/openai.yaml`: UI metadata only. Regenerate if SKILL.md trigger intent changes.

## Update workflow for a future agent

1. Load the `skill-creator` and `gh-cli` skills, then read this file.
2. Check the official manual and exact approved CLI version: `gh --version`, https://cli.github.com/manual/, and https://cli.github.com/manual/gh. For a prepared candidate, use its explicit executable path, verify release provenance before execution, and do not replace the installed binary. Treat the approved executable's help as authoritative if the live manual has moved ahead.
3. Capture core help with empty temporary `GH_CONFIG_DIR` and `XDG_DATA_HOME` directories. Disable update checks, telemetry, colors, and prompting with `GH_NO_UPDATE_NOTIFIER=1`, `GH_NO_EXTENSION_UPDATE_NOTIFIER=1`, `GH_TELEMETRY=false`, `NO_COLOR=1`, and `GH_PROMPT_DISABLED=1`. Clear inherited tokens, host/repo overrides, debug logging, and forced-TTY settings from the capture process without changing user configuration. Walk all `* COMMANDS` sections recursively, except `EXTENSION COMMANDS`, and capture every root `HELP TOPICS` entry. Include the default `co` alias; do not create duplicate pages for alternate command spellings in `ALIASES` sections.
4. Save root help to `references/gh.md`. For each command path, write exactly one reference file using this mapping:
   - `gh auth` -> `agent/skills/gh-cli/references/auth.md`
   - `gh auth login` -> `agent/skills/gh-cli/references/auth/login.md`
   - `gh codespace ports forward` -> `agent/skills/gh-cli/references/codespace/ports/forward.md`
5. Keep generated reference files self-contained: source URL, generator version, summary, subcommand links, and full `gh help ...` manual text. Normalize machine-expanded home paths and isolated data/config paths to their portable `~/...` defaults. Strip trailing line whitespace and use one final newline. Compare the complete normalized text, not only command names. Refresh changed pages and their attribution; preserve identical pages. Add missing pages and remove obsolete generated pages only after checking for local edits and symlinks.
6. Update `SKILL.md` only with compact routing guidance, and update `references/index.md` with command-family entries. Do not paste full manual text into `SKILL.md`.
7. Preserve the GitHub mutation gate, secret-protection rules, and HTTPS-repository-URL normalization rule in `SKILL.md`.
8. Preserve `scripts/normalize_github_url.py`; when adding URL kinds, return one primary argv array rather than shell strings, avoid alternate argv fields such as `clone_argv`, and include the exact top-level `references/...` files an agent should read before running `gh`.
9. Keep this central update process linked from `SKILL.md`; do not add a duplicate update-process file inside the skill bundle.
10. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/gh-cli` when PyYAML is not already installed. Run all Local Skill validators and the metadata/link checks from the local invariants.
11. Run `uv run python -B ~/.pi/agent/skills/gh-cli/scripts/test_normalize_github_url.py`. The suite covers HTTPS and both SSH repo forms, PRs, issues, discussions, comments/reviews, commits, action runs, releases, comparisons, blobs, trees, fallback routes, and slash-ref ambiguity. Valid results have exactly top-level `references` and `gh.argv`, with no `gh.references` or `clone_argv`. Invalid results use unsupported JSON and exit 2. Tests block network/process calls and cover every ASCII control character, raw and percent-decoded, including HTTPS path parameters and SSH query/fragment inputs. Malformed authorities must not raise parser exceptions. Compile Python files with `PYTHONPYCACHEPREFIX` set to a temporary directory, not the skill folder.
12. Verify exact set equality between the recursively discovered pages, reference files, and inventory below. Check index families, subcommand links, source/version attribution, `git diff --check`, and artifact/secret/home-path scans. Compare protected binary/config/extension and unrelated-file fingerprints to the pre-update state. Do not stage, commit, push, or mutate hosted services as part of validation.

## Current inventory (prepared 2.105.0)

The core snapshot contains 252 help pages: root help, 243 command/alias pages, and eight help topics. The 2.103.3 to 2.105.0 comparison changed 241 existing pages, preserved four help topics, and added seven `event` pages. The 2.103.3 record follows.

The 2.103.3 snapshot contained 245 help pages: root help, 236 command/alias pages, and eight help topics. The complete comparison against the existing 2.101.0-verified snapshot changed 23 existing manuals, preserved 215 pages byte-for-byte, and added seven issue-artifact pages. No generated page was removed. The default `co` alias is included; alternate spellings in `ALIASES` sections have no duplicate pages. The comprehensive core reference independently matches all 236 command/alias paths.

### Validation record (S3, prepared only)

- All 245 complete normalized manuals, all 244 child/topic links, source/version attribution, index families, and the inventory below matched the isolated candidate capture.
- The target validator and all 39 canonical Local Skill validators passed through offline uv using the existing prepared Python/PyYAML environment. No validator dependencies were installed.
- The existing eight offline URL-normalizer tests passed, including the 396 control-character cases. CLI-entrypoint and temporary-cache compilation checks passed; normalizer source and tests are unchanged.
- Metadata, local links, portable paths, secret patterns, runtime artifacts, and scoped `git diff --check` passed. Fingerprints preserved unrelated candidate source, Git identity/index, live binaries, auth/config, extensions, and protected original/graph inputs.
- Static semantic review preserved authenticated GitHub routing, HTTPS/SSH normalization, bounded read output, exact hosted-write authorization, token redaction, and selective reference loading. No model evaluation, extension execution, product/account call, or live deployment ran.

### Historical comparison (2.101.0)

The 2.101.0 core snapshot contained 238 help pages: root help, 229 command/alias pages, and eight help topics. The 2.97.0 to 2.101.0 comparison changed 15 existing manuals and left 222 identical. No built-in command or topic was added or removed. That update stored root help explicitly and strengthened malformed-authority and decoded-control rejection without changing valid URL routes.

### Historical validation record (2026-09-29)

- Target validator and all 38 Local Skill validators passed, including frontmatter and `agents/openai.yaml` checks.
- A fresh recursive capture matched all 238 normalized manuals. The comprehensive reference independently listed all 229 command/alias pages. All 237 child links, index families, and inventory entries matched.
- Eight offline normalizer tests passed, including 396 control-character cases. The CLI entrypoint smoke test and `py_compile` passed; bytecode stayed in a temporary cache.
- Markdown links, source/version attribution, portable paths, secret-pattern scans, artifact scans, and `git diff --check` passed.
- Fingerprints confirmed that `/usr/bin/gh`, gh authentication/configuration, extension files, Git index/HEAD, and unrelated tracked files did not change.
- Manual routing review preserved GitHub data/command triggers and distinguished Linear, browser interaction, local review, and skill-authoring intents. No model-agent evaluations or hosted operations were run.

### Root help

- `gh help` -> `references/gh.md`

## Current generated command references

- `gh agent-task` -> `references/agent-task.md`
- `gh agent-task create` -> `references/agent-task/create.md`
- `gh agent-task list` -> `references/agent-task/list.md`
- `gh agent-task view` -> `references/agent-task/view.md`
- `gh alias` -> `references/alias.md`
- `gh alias delete` -> `references/alias/delete.md`
- `gh alias import` -> `references/alias/import.md`
- `gh alias list` -> `references/alias/list.md`
- `gh alias set` -> `references/alias/set.md`
- `gh api` -> `references/api.md`
- `gh attestation` -> `references/attestation.md`
- `gh attestation download` -> `references/attestation/download.md`
- `gh attestation trusted-root` -> `references/attestation/trusted-root.md`
- `gh attestation verify` -> `references/attestation/verify.md`
- `gh auth` -> `references/auth.md`
- `gh auth login` -> `references/auth/login.md`
- `gh auth logout` -> `references/auth/logout.md`
- `gh auth refresh` -> `references/auth/refresh.md`
- `gh auth setup-git` -> `references/auth/setup-git.md`
- `gh auth status` -> `references/auth/status.md`
- `gh auth switch` -> `references/auth/switch.md`
- `gh auth token` -> `references/auth/token.md`
- `gh browse` -> `references/browse.md`
- `gh cache` -> `references/cache.md`
- `gh cache delete` -> `references/cache/delete.md`
- `gh cache list` -> `references/cache/list.md`
- `gh co` -> `references/co.md`
- `gh codespace` -> `references/codespace.md`
- `gh codespace code` -> `references/codespace/code.md`
- `gh codespace cp` -> `references/codespace/cp.md`
- `gh codespace create` -> `references/codespace/create.md`
- `gh codespace delete` -> `references/codespace/delete.md`
- `gh codespace edit` -> `references/codespace/edit.md`
- `gh codespace jupyter` -> `references/codespace/jupyter.md`
- `gh codespace list` -> `references/codespace/list.md`
- `gh codespace logs` -> `references/codespace/logs.md`
- `gh codespace ports` -> `references/codespace/ports.md`
- `gh codespace ports forward` -> `references/codespace/ports/forward.md`
- `gh codespace ports visibility` -> `references/codespace/ports/visibility.md`
- `gh codespace rebuild` -> `references/codespace/rebuild.md`
- `gh codespace ssh` -> `references/codespace/ssh.md`
- `gh codespace stop` -> `references/codespace/stop.md`
- `gh codespace view` -> `references/codespace/view.md`
- `gh completion` -> `references/completion.md`
- `gh config` -> `references/config.md`
- `gh config clear-cache` -> `references/config/clear-cache.md`
- `gh config get` -> `references/config/get.md`
- `gh config list` -> `references/config/list.md`
- `gh config set` -> `references/config/set.md`
- `gh copilot` -> `references/copilot.md`
- `gh discussion` -> `references/discussion.md`
- `gh discussion comment` -> `references/discussion/comment.md`
- `gh discussion create` -> `references/discussion/create.md`
- `gh discussion edit` -> `references/discussion/edit.md`
- `gh discussion list` -> `references/discussion/list.md`
- `gh discussion view` -> `references/discussion/view.md`
- `gh event` -> `references/event.md`
- `gh event listen` -> `references/event/listen.md`
- `gh event subscription` -> `references/event/subscription.md`
- `gh event subscription create` -> `references/event/subscription/create.md`
- `gh event subscription delete` -> `references/event/subscription/delete.md`
- `gh event subscription list` -> `references/event/subscription/list.md`
- `gh event subscription view` -> `references/event/subscription/view.md`
- `gh extension` -> `references/extension.md`
- `gh extension browse` -> `references/extension/browse.md`
- `gh extension create` -> `references/extension/create.md`
- `gh extension exec` -> `references/extension/exec.md`
- `gh extension install` -> `references/extension/install.md`
- `gh extension list` -> `references/extension/list.md`
- `gh extension remove` -> `references/extension/remove.md`
- `gh extension search` -> `references/extension/search.md`
- `gh extension upgrade` -> `references/extension/upgrade.md`
- `gh gist` -> `references/gist.md`
- `gh gist clone` -> `references/gist/clone.md`
- `gh gist create` -> `references/gist/create.md`
- `gh gist delete` -> `references/gist/delete.md`
- `gh gist edit` -> `references/gist/edit.md`
- `gh gist list` -> `references/gist/list.md`
- `gh gist rename` -> `references/gist/rename.md`
- `gh gist view` -> `references/gist/view.md`
- `gh gpg-key` -> `references/gpg-key.md`
- `gh gpg-key add` -> `references/gpg-key/add.md`
- `gh gpg-key delete` -> `references/gpg-key/delete.md`
- `gh gpg-key list` -> `references/gpg-key/list.md`
- `gh issue` -> `references/issue.md`
- `gh issue artifact` -> `references/issue/artifact.md`
- `gh issue artifact create` -> `references/issue/artifact/create.md`
- `gh issue artifact delete` -> `references/issue/artifact/delete.md`
- `gh issue artifact download` -> `references/issue/artifact/download.md`
- `gh issue artifact edit` -> `references/issue/artifact/edit.md`
- `gh issue artifact list` -> `references/issue/artifact/list.md`
- `gh issue artifact view` -> `references/issue/artifact/view.md`
- `gh issue close` -> `references/issue/close.md`
- `gh issue comment` -> `references/issue/comment.md`
- `gh issue create` -> `references/issue/create.md`
- `gh issue delete` -> `references/issue/delete.md`
- `gh issue develop` -> `references/issue/develop.md`
- `gh issue edit` -> `references/issue/edit.md`
- `gh issue list` -> `references/issue/list.md`
- `gh issue lock` -> `references/issue/lock.md`
- `gh issue pin` -> `references/issue/pin.md`
- `gh issue reopen` -> `references/issue/reopen.md`
- `gh issue status` -> `references/issue/status.md`
- `gh issue transfer` -> `references/issue/transfer.md`
- `gh issue unlock` -> `references/issue/unlock.md`
- `gh issue unpin` -> `references/issue/unpin.md`
- `gh issue view` -> `references/issue/view.md`
- `gh label` -> `references/label.md`
- `gh label clone` -> `references/label/clone.md`
- `gh label create` -> `references/label/create.md`
- `gh label delete` -> `references/label/delete.md`
- `gh label edit` -> `references/label/edit.md`
- `gh label list` -> `references/label/list.md`
- `gh licenses` -> `references/licenses.md`
- `gh org` -> `references/org.md`
- `gh org list` -> `references/org/list.md`
- `gh pr` -> `references/pr.md`
- `gh pr checkout` -> `references/pr/checkout.md`
- `gh pr checks` -> `references/pr/checks.md`
- `gh pr close` -> `references/pr/close.md`
- `gh pr comment` -> `references/pr/comment.md`
- `gh pr create` -> `references/pr/create.md`
- `gh pr diff` -> `references/pr/diff.md`
- `gh pr edit` -> `references/pr/edit.md`
- `gh pr list` -> `references/pr/list.md`
- `gh pr lock` -> `references/pr/lock.md`
- `gh pr merge` -> `references/pr/merge.md`
- `gh pr ready` -> `references/pr/ready.md`
- `gh pr reopen` -> `references/pr/reopen.md`
- `gh pr revert` -> `references/pr/revert.md`
- `gh pr review` -> `references/pr/review.md`
- `gh pr status` -> `references/pr/status.md`
- `gh pr unlock` -> `references/pr/unlock.md`
- `gh pr update-branch` -> `references/pr/update-branch.md`
- `gh pr view` -> `references/pr/view.md`
- `gh preview` -> `references/preview.md`
- `gh preview prompter` -> `references/preview/prompter.md`
- `gh project` -> `references/project.md`
- `gh project close` -> `references/project/close.md`
- `gh project copy` -> `references/project/copy.md`
- `gh project create` -> `references/project/create.md`
- `gh project delete` -> `references/project/delete.md`
- `gh project edit` -> `references/project/edit.md`
- `gh project field-create` -> `references/project/field-create.md`
- `gh project field-delete` -> `references/project/field-delete.md`
- `gh project field-list` -> `references/project/field-list.md`
- `gh project item-add` -> `references/project/item-add.md`
- `gh project item-archive` -> `references/project/item-archive.md`
- `gh project item-create` -> `references/project/item-create.md`
- `gh project item-delete` -> `references/project/item-delete.md`
- `gh project item-edit` -> `references/project/item-edit.md`
- `gh project item-list` -> `references/project/item-list.md`
- `gh project link` -> `references/project/link.md`
- `gh project list` -> `references/project/list.md`
- `gh project mark-template` -> `references/project/mark-template.md`
- `gh project unlink` -> `references/project/unlink.md`
- `gh project view` -> `references/project/view.md`
- `gh release` -> `references/release.md`
- `gh release create` -> `references/release/create.md`
- `gh release delete` -> `references/release/delete.md`
- `gh release delete-asset` -> `references/release/delete-asset.md`
- `gh release download` -> `references/release/download.md`
- `gh release edit` -> `references/release/edit.md`
- `gh release list` -> `references/release/list.md`
- `gh release upload` -> `references/release/upload.md`
- `gh release verify` -> `references/release/verify.md`
- `gh release verify-asset` -> `references/release/verify-asset.md`
- `gh release view` -> `references/release/view.md`
- `gh repo` -> `references/repo.md`
- `gh repo archive` -> `references/repo/archive.md`
- `gh repo autolink` -> `references/repo/autolink.md`
- `gh repo autolink create` -> `references/repo/autolink/create.md`
- `gh repo autolink delete` -> `references/repo/autolink/delete.md`
- `gh repo autolink list` -> `references/repo/autolink/list.md`
- `gh repo autolink view` -> `references/repo/autolink/view.md`
- `gh repo clone` -> `references/repo/clone.md`
- `gh repo create` -> `references/repo/create.md`
- `gh repo delete` -> `references/repo/delete.md`
- `gh repo deploy-key` -> `references/repo/deploy-key.md`
- `gh repo deploy-key add` -> `references/repo/deploy-key/add.md`
- `gh repo deploy-key delete` -> `references/repo/deploy-key/delete.md`
- `gh repo deploy-key list` -> `references/repo/deploy-key/list.md`
- `gh repo edit` -> `references/repo/edit.md`
- `gh repo fork` -> `references/repo/fork.md`
- `gh repo gitignore` -> `references/repo/gitignore.md`
- `gh repo gitignore list` -> `references/repo/gitignore/list.md`
- `gh repo gitignore view` -> `references/repo/gitignore/view.md`
- `gh repo license` -> `references/repo/license.md`
- `gh repo license list` -> `references/repo/license/list.md`
- `gh repo license view` -> `references/repo/license/view.md`
- `gh repo list` -> `references/repo/list.md`
- `gh repo read-dir` -> `references/repo/read-dir.md`
- `gh repo read-file` -> `references/repo/read-file.md`
- `gh repo rename` -> `references/repo/rename.md`
- `gh repo set-default` -> `references/repo/set-default.md`
- `gh repo sync` -> `references/repo/sync.md`
- `gh repo unarchive` -> `references/repo/unarchive.md`
- `gh repo view` -> `references/repo/view.md`
- `gh ruleset` -> `references/ruleset.md`
- `gh ruleset check` -> `references/ruleset/check.md`
- `gh ruleset list` -> `references/ruleset/list.md`
- `gh ruleset view` -> `references/ruleset/view.md`
- `gh run` -> `references/run.md`
- `gh run cancel` -> `references/run/cancel.md`
- `gh run delete` -> `references/run/delete.md`
- `gh run download` -> `references/run/download.md`
- `gh run list` -> `references/run/list.md`
- `gh run rerun` -> `references/run/rerun.md`
- `gh run view` -> `references/run/view.md`
- `gh run watch` -> `references/run/watch.md`
- `gh search` -> `references/search.md`
- `gh search code` -> `references/search/code.md`
- `gh search commits` -> `references/search/commits.md`
- `gh search issues` -> `references/search/issues.md`
- `gh search prs` -> `references/search/prs.md`
- `gh search repos` -> `references/search/repos.md`
- `gh secret` -> `references/secret.md`
- `gh secret delete` -> `references/secret/delete.md`
- `gh secret list` -> `references/secret/list.md`
- `gh secret set` -> `references/secret/set.md`
- `gh skill` -> `references/skill.md`
- `gh skill install` -> `references/skill/install.md`
- `gh skill list` -> `references/skill/list.md`
- `gh skill preview` -> `references/skill/preview.md`
- `gh skill publish` -> `references/skill/publish.md`
- `gh skill search` -> `references/skill/search.md`
- `gh skill update` -> `references/skill/update.md`
- `gh ssh-key` -> `references/ssh-key.md`
- `gh ssh-key add` -> `references/ssh-key/add.md`
- `gh ssh-key delete` -> `references/ssh-key/delete.md`
- `gh ssh-key list` -> `references/ssh-key/list.md`
- `gh status` -> `references/status.md`
- `gh variable` -> `references/variable.md`
- `gh variable delete` -> `references/variable/delete.md`
- `gh variable get` -> `references/variable/get.md`
- `gh variable list` -> `references/variable/list.md`
- `gh variable set` -> `references/variable/set.md`
- `gh workflow` -> `references/workflow.md`
- `gh workflow disable` -> `references/workflow/disable.md`
- `gh workflow enable` -> `references/workflow/enable.md`
- `gh workflow list` -> `references/workflow/list.md`
- `gh workflow run` -> `references/workflow/run.md`
- `gh workflow view` -> `references/workflow/view.md`

## Current help topic references

- `gh help accessibility` -> `references/help/accessibility.md`
- `gh help actions` -> `references/help/actions.md`
- `gh help environment` -> `references/help/environment.md`
- `gh help exit-codes` -> `references/help/exit-codes.md`
- `gh help formatting` -> `references/help/formatting.md`
- `gh help mintty` -> `references/help/mintty.md`
- `gh help reference` -> `references/help/reference.md`
- `gh help telemetry` -> `references/help/telemetry.md`
