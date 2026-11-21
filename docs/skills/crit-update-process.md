# Updating Crit skills

## Installation method (since 2026-11-21)

Crit is installed with Go, one of upstream's documented methods, pinned to a release tag:

```bash
GOBIN="$HOME/.local/bin" go install github.com/tomasz-tomczyk/crit/cmd/crit@v0.24.0
```

`GOBIN` must stay `~/.local/bin`: `/usr/bin/crit` is CRIU's unrelated `crit` and precedes `~/go/bin` on `PATH`, so a default `go install` would be shadowed. A `go install` build prints `crit dev` as its version; check the module version with `go version -m ~/.local/bin/crit`. Homebrew is the other official option but its formula lagged at 0.23.3. The earlier hand-copied binary and a stale `~/go/bin/crit` 0.23.2 were removed. The binary-download and copy steps below are historical.

## Pi 1.5.2 installation

The prepared official Crit 0.23.2 binary is now installed at its existing user-local path and passes a network-denied native version check. System CRIU remains untouched. No product, share, login or foreground review action ran. See the [installation record](../changelogs/pi-1.5.2-full-setup-installation.md); older preparation facts below remain historical.

## Pi 1.6.0 maintenance: v0.24.0 candidate prepared, not installed

Official [v0.24.0](https://github.com/tomasz-tomczyk/crit/releases/tag/v0.24.0), published `2026-11-20T12:47:20Z`, resolves directly to commit `f28f95bea6aa3a37e1a05ca0293a35a474ce93a3` (`immutable: false`). Reviewed release notes for v0.23.3 and v0.24.0 and the source diff from `4458cce`. `crit-linux-amd64` (24899849 bytes) has SHA-256 `f58dbcc865a0c310845faeb88bde11f8d90b5ca811ac7d9f5384c9e51e3b0499`, and `checksums.txt` has `42463a4abbcb22a4937118726ea8c5067d3f55cab9008f479fb86e1d89df5def`. Both match GitHub's digests, and the binary matches the manifest. The candidate is staged under the private RUN prefix only. The live `~/.local/bin/crit` remains v0.23.2.

Early dispatch is unchanged in [cli_dispatch.go:228-259](https://github.com/tomasz-tomczyk/crit/blob/f28f95bea6aa3a37e1a05ca0293a35a474ce93a3/cmd/crit/cli_dispatch.go#L228-L259): root `--help`/`--version` and immediate subcommand `--help` return before product handlers. Network-denied `--version`, root help and eleven subcommand help checks pass. Compared with v0.23.2, help differs only for `pull`/`push` (`--viewed`), `pr`/`mr` (the number is now optional and defaults to the current branch's PR/MR), and `preview` (Excalidraw). The new `languages` and `remote_images` config keys add settings and change no credential, keyring or cache format. Remote images are now blocked by default. Hosted defaults stay the same.

Adopted: the GitHub-only, opt-in `--viewed` flag for `pull`/`push` in the CLI reference, plus a root gate note that `push --viewed` changes PR viewed state and needs its own request. Upstream Pi `crit-cli` (blob `c88983fcef2d767ef17a902ab24d04b156639b7a`) now uses author `Pi`, matching the local overlay. Upstream `crit` (`317158a…`) and `crit-story` (`038d204…`) are unchanged, so the local `crit` root stays unchanged and explicit-only. Rejected: Excalidraw/language/UI features and bare `--pr`/`--mr` inference as maintenance guidance. Interactive `$crit` still passes the user's explicit arguments through.

Purpose: keep the local `crit` and `crit-cli` skills aligned with the verified Crit candidate and deployed baseline while preserving Pi review-loop behavior, hosted-service safety, and OpenAI skill-creator conventions.

## Deployed baseline and historical source review

- Upstream repository: https://github.com/tomasz-tomczyk/crit
- Historical deployed release: [v0.21.0](https://github.com/tomasz-tomczyk/crit/releases/tag/v0.21.0), published `2026-09-28T08:17:57Z`.
- Exact tag commit: `b519778c90087adad030d06eda272d21aa591910`. GitHub resolves `refs/tags/v0.21.0` directly to this commit; `target_commitish: main` is not the source pin.
- Installed PATH-selected CLI: `~/.local/bin/crit`, reporting `crit v0.21.0 (2026-09-28, b519778)` and `Inline code review for AI agent workflows`.
- Replaced version: `v0.18.4`, commit `0b9c5461de2d0e6fd1a4a342947874d20b4c7c74`. The unrelated `/usr/bin/crit` CRIU Image Tool was not replaced.
- Local skills:
  - `agent/skills/crit/` for the interactive human review loop.
  - `agent/skills/crit-cli/` for programmatic comments, share/unpublish, GitHub PR/GitLab MR sync, and review JSON interpretation.

### Binary and source provenance

The official Linux amd64 artifact is a standalone ELF executable, not an archive. Downloaded with read-only `gh release download` from `tomasz-tomczyk/crit` at `v0.21.0`:

| Release asset | Bytes | SHA-256 from GitHub release metadata |
|---|---:|---|
| `crit-linux-amd64` | 21041417 | `cfaaaa4aa291ef208739b48d1fa0ef2a33b1101c20794491153b50024d800c66` |
| `checksums.txt` | 512 | `de09a7b5179145ba9e5c1e94fe5fb7d8f0b5917e9eb2db4bedf588e393265e45` |

Both downloaded assets matched their official SHA-256 digests. The binary also matched its `checksums.txt` entry. After offline version/help checks, a mode-0755 candidate in the destination directory was checked again and atomically renamed to `~/.local/bin/crit`. The installed hash matches the artifact hash above. GitHub marks this release `immutable: false`; retain the commit and digests, not just the tag name.

Compared the exact commit's `integrations/pi/skills/crit*` sources, fetched through `gh api`, against both local roots and the CLI reference:

| Upstream source at the pinned commit | Git blob SHA |
|---|---|
| [crit/SKILL.md](https://github.com/tomasz-tomczyk/crit/blob/b519778c90087adad030d06eda272d21aa591910/integrations/pi/skills/crit/SKILL.md) | `3e2bebd84b948d329afae58f58e9c0a595cea191` |
| [crit-cli/SKILL.md](https://github.com/tomasz-tomczyk/crit/blob/b519778c90087adad030d06eda272d21aa591910/integrations/pi/skills/crit-cli/SKILL.md) | `1f33ee08010943eb1ad7a44b78a15c8842e2b47a` |
| [crit-story/SKILL.md](https://github.com/tomasz-tomczyk/crit/blob/b519778c90087adad030d06eda272d21aa591910/integrations/pi/skills/crit-story/SKILL.md) | `6cc3fe1fa2800677fd8f24e0ce0ba9b5afea5a1e` |

No installer-generated skill overwrite was used. Both existing `agents/openai.yaml` files remain unchanged and valid.

### Adopt, adapt, reject

| Upstream evidence | Decision |
|---|---|
| `crit` now explicitly rejects generic review requests | Adopt intent; adapt invocation to local `$crit` / `/skill:crit`. Retain `disable-model-invocation: true`. |
| Finish prompts can embed unresolved JSON; stderr carries approval | Adopt. Do not require a stdout file path or the old literal `Next round:` label. Empty output does not mean approval. |
| Next-round commands use session identity | Adapt: preserve the printed command, including `--session`. Keep foreground blocking, the 3600-second timeout, and reconnect-on-timeout behavior. |
| Plan next-round commands omit input | Adapt: retain `crit plan --name <slug>` and supply the revised plan file/content. The source still requires file or stdin input. |
| `--mr` and provider-aware `pull`/`push` | Adapt with the same exact-action gates. GitHub uses `gh`; GitLab uses `glab`. Reject the upstream claim that `gh` alone covers both. Do not install/authenticate either as a side effect. |
| `--public-url` requires network acknowledgment even on loopback | Adopt the warning. Keep loopback plus a trusted tunnel; require explicit exposure consent. Do not configure a tunnel during an update. |
| `--share-url`, `share_targets`, and empty `CRIT_SHARE_URL` | Adapt with exact destination selection and secret/delete-token protection. Document CLI override precedence; never change auth/configuration to resolve ambiguity. |
| v0.21.0 preview-sharing fixes | Adopt reference details: `--preview` is publication, honors organization/visibility/QR options, and preserves the original HTML path. No share was executed to validate this. |
| Upstream `Hermes` attribution, `user-invocable: false`, generic plan/"review" routing, automatic replies, and URL-to-share shortcut | Reject. Keep `Pi`, local frontmatter, explicit-only interactive routing, requested local writes, and separate hosted-action gates. |
| New `crit-story` sibling | Compared but not installed. Story authoring/agent execution is outside this two-skill increment. |
| Pierre renderer, paired Shiki themes, Markdown display settings, comment/base-switch fixes, and internal cleanups in v0.21.0 notes | Binary changes only. Do not import UI instructions, change settings, or launch a browser for validation. |

Classifications remain `crit`: `keep it`; `crit-cli`: `make it slim`. The installed-skill inventory and maintenance index do not change.

## Prepared v0.23.2 candidate, not deployed

The maintenance candidate is **prepared in a separate worktree, not deployed**. Parent-captured official metadata selects [v0.23.2](https://github.com/tomasz-tomczyk/crit/releases/tag/v0.23.2), published `2026-10-31T13:10:17Z`. Authenticated `gh` resolves the exact tag directly to commit `4458cced170c23dde92070c12758f5942048359a`; no moving branch is the source pin.

| Official asset | Bytes | Verified SHA-256 |
|---|---:|---|
| `crit-linux-amd64` | 23757065 | `10aa756a3146362be3a349cc8223955e23a1cd6daa0abbb13dd500741f793a90` |
| `checksums.txt` | 512 | `f3c249e6e7e264f7d4ffc7d590faf61ff05eb357fb4bed47a5f0f4fb8d89202c` |

Both assets match GitHub's recorded digests; the binary also matches the manifest entry. The standalone ELF amd64 candidate is mode 0755 under `RUN/reports/s4/native/crit`, with the same binary hash. It reports `crit v0.23.2 (2026-10-31, 4458cce)`. The selected live `~/.local/bin/crit` remains the historical v0.21.0 native binary. Future deployment must preserve that user-local owner/path; the unrelated system `/usr/bin/crit` remains untouched.

The exact commit's source archive was retrieved through authenticated `gh`; selected source bytes match its recursive Git tree. Compared both local roots and their runtime reference against these exact integration roots:

| Pinned upstream source | Git blob SHA |
|---|---|
| [crit/SKILL.md](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/integrations/pi/skills/crit/SKILL.md) | `317158a8214df4095021d082ce7d3aaa4f54a26b` |
| [crit-cli/SKILL.md](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/integrations/pi/skills/crit-cli/SKILL.md) | `62de61a18789298bcfb6bfc62a0999ac252d292c` |
| [crit-story/SKILL.md](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/integrations/pi/skills/crit-story/SKILL.md) | `038d2045897547bd902be46bcd671689904cfa3e` |

Selective adoption is limited to correctness warnings in the existing CLI reference:

- Legacy reviews missing `share_base_url` do not use the current/default deployment when the origin cannot be identified. Explicit rebinding requires a configured target and a separately authorized publication; its local binding can persist even if the upload fails. Bound reviews reject a different deployment ([target resolution and binding](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/internal/share/cli.go#L391-L478)).
- Unpublish returns on unresolved targets before clearing share state, retaining the delete token. This is an incomplete deletion, not permission to clear state or try another destination ([unpublish](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/internal/share/cli.go#L662-L714)).
- Existing review/file/line authoring examples do not apply to live/HTML preview sessions. Do not import the new page-pin workflow merely to correct this boundary ([comment scope](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/internal/comment/comment_cli.go#L34-L54)).
- `request-changes` requires `-m` / `--message`; the existing exact-event authorization still applies ([push parsing](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/internal/forge/cli.go#L211-L219)).

Foreground blocking, 3600-second timeouts, printed next-round commands, session/plan identity and finish/approval output remain compatible and unchanged. Both roots, descriptions, UI/dependency metadata, classifications and author `Pi` remain unchanged. Reject upstream generic-review routing, automatic replies and URL-to-publication shortcuts. Story remains uninstalled. New custom CSS, page-pin/quote options, daemon behavior and other UI features are not maintenance adoption.

Validation uses OS-network-denied bwrap, an empty HOME/cwd and cleared environment, with source/native inputs read-only. Only verified native `--version`, root `--help` and immediate subcommand `--help` run. Both target validators, all 39 Local Skill validators, source/static semantic checks, links/metadata/secrets/artifacts and scoped preservation pass using existing offline Python/PyYAML. No product action, browser, daemon, installer, auth/configuration change, source build, upstream action test or model evaluation runs. Private commands, timings, source evidence, the corrected archive-selection rejection and limits are recorded in `RUN/reports/s4/handoff.md`; final combined acceptance remains separate.

## Local invariants

Before and after updates, apply [local-skill-update-invariants.md](local-skill-update-invariants.md) and [skill-slimming-process.md](skill-slimming-process.md). Upstream remains input, not final truth. Local-only safety or slimming work does not change the reviewed release or upstream SHA.

### Routing and runtime shape

- Keep descriptions concise and intent-specific, without arbitrary local description caps or command catalogs.
- `crit-cli` owns local/programmatic review data, comment authoring and replies, sharing/unpublishing, and GitHub/GitLab sync. Interactive foreground review belongs to explicit `$crit`, not a generic request to review.
- Preserve `disable-model-invocation: true` on `crit` so it remains an explicit `/skill:crit` workflow; this is a supported Pi extension, not portable Agent Skills frontmatter.
- Preserve the interactive `crit` rule: run the foreground command and wait until the reviewer clicks Finish Review. Do not remove this intentional pause.
- Keep `agents/openai.yaml` valid, with the exact `$crit` or `$crit-cli` token in its default prompt and a 25–64 character short description. Preserve intentional dependencies and explicit-only metadata.
- Keep the `crit-cli` root limited to action boundaries, task routing, key correctness rules, completion, and maintenance. Load only the relevant sections of directly linked runtime references.
- Keep long schemas, JSON examples, and command catalogs in [commands and review data](../../agent/skills/crit-cli/references/commands-and-review-data.md), not duplicated in roots or maintenance docs. Preserve useful niche details and exact CLI syntax when moving content.
- Classify `crit-cli` as `make it slim`: tool-specific syntax remains useful, but the root need not carry the full CLI/JSON reference.

### Action gates

Keep these gates visible in the root before commands. References and UI prompts must not bypass them:

| Action | Gate |
|---|---|
| Read review data, status, comments | Read-only; no reply, resolution, or sync as a side effect. |
| `crit comment` and replies | Local review mutations; require a user request for that write. |
| Resolution, including `--resolve` and JSON `resolve` | Never resolve without explicit user request, even after fixing the issue. |
| `crit pull` | GitHub/GitLab read plus local review-file write; require a request for that sync and its PR/MR and local review target. |
| `crit push` | GitHub/GitLab post; require explicit instruction for that exact hosted action, PR/MR target, and review event. A dry-run does not authorize a later push. |
| `crit share` | Publication; require explicit instruction for the exact files/included comments, destination, and visibility. |
| `crit unpublish` | Deletion of remote shared state; require explicit instruction for the exact shared review/files and deployment. |

Do not infer hosted write authority from a read, local comment write, pull, or dry-run. Clarify missing targets or visibility before hosted writes. Do not expose credentials or persisted delete tokens.

### Correctness and completion

Preserve `--author 'Pi'`, single-quoted bodies, file-on-disk line numbers, session/plan disambiguation, line/file/review scope, quote/anchor/drift semantics, and reading replies before acting. Preserve atomic bulk JSON, its per-entry resolution gate, and file-based input for multi-paragraph bodies.

Preserve output relay, terminal-only QR output, organization visibility defaults and overrides, inclusion of comments when sharing, and persisted-token unpublish behavior. End after the requested operation and relevant read-only confirmation; report the result and target. Stop on missing authority, ambiguous sessions/targets, or unavailable CLI/authentication rather than substituting a broader action.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Inspect `command -v crit`, the resolved path/owner and original binary hash without running a live product action. Use accepted installed-version evidence or a private verified copy for version/help checks. Confirm the selected binary is inline code review; some Linux systems install an unrelated CRIU Image Tool at `/usr/bin/crit`. Record unrelated working-tree changes without copying secrets.
3. Use the `gh-cli` skill and authenticated `gh` for read-only release metadata, tag resolution, and exact-commit source retrieval. Compare `integrations/pi/skills/crit*`, release notes, CLI help, both local roots, and linked references. Pin the approved tag/commit, not `main` or `latest`.
4. When a binary upgrade is authorized, download only the official platform artifact and checksum manifest into a temporary directory. Verify GitHub's asset digests and the manifest entry before executing the candidate. Check Linux amd64 architecture. Do not use a pipe-to-shell installer or `crit install`, which could replace local overlays.
5. Inspect startup/init and early help dispatch before executing any candidate check. In v0.23.2, [cmd/crit/cli_dispatch.go:223-253](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/cmd/crit/cli_dispatch.go#L223-L253) handles root `--help`, `--version`, and immediate subcommand `--help` before product handlers. Recheck that dispatch for every selected release. Use an empty HOME/cwd, cleared environment and OS network denial, with source/native inputs read-only and no real review/config/keyring/browser access. Never call a product action merely for validation.
6. For preparation, stage the verified executable with mode 0755 only under the isolated RUN prefix and verify the copy. Do not replace or rename over the live binary. Any later deployment requires separate explicit authorization and must preserve the `~/.local/bin/crit` user-local owner/path and untouched system Crit. Do not restart/stop daemons or migrate review state during maintenance.
7. Apply only runtime-relevant skill changes. Reapply routing, concise-root, correctness, completion, and action-gate overlays. Update source provenance only after an actual upstream review. For next-round details, compare [session_reconnect.go:24-53](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/internal/session/session_reconnect.go#L24-L53) with [plan_cli.go:75-105](https://github.com/tomasz-tomczyk/crit/blob/4458cced170c23dde92070c12758f5942048359a/internal/session/plan_cli.go#L75-L105).
8. Validate both skills:

```bash
for skill in crit crit-cli; do
  PYTHONDONTWRITEBYTECODE=1 UV_PYTHON_DOWNLOADS=never uv run --no-project --offline --with pyyaml python -B agent/skills/skill-creator/scripts/quick_validate.py "agent/skills/$skill" || exit 1
done
```

Use an existing cached Python/PyYAML environment. If `--with pyyaml` is not cached but an existing prepared environment contains it, select that interpreter explicitly with `--python <prepared-venv>/bin/python` instead of resolving `--with`. Do not download or install validator dependencies. Run validation under the same OS network denial.

9. Run all Local Skill validators. Check YAML, exact skill tokens, short-description ranges, dependencies/explicit-only metadata, local links and anchors, root sizes, and `git diff --check`. Scan the scoped changes for artifacts, secrets, literal home paths, and unintended paths. Reapply the invariant and slimming checklists after the sync.
10. Statically review representative cases: reading comments must not write; requested replies must not resolve; pull must not push; dry-run must not post. A generic review or just-written plan must not launch Crit. A current-URL request must not publish. Organization sharing must keep the requested visibility and deployment. Non-default unpublish must not leak the delete token. Finished rounds must preserve approval and next-round identity. These checks do not prove live model/browser behavior.
11. Do not exercise comments, replies, resolution, pull, push (including dry-run), share, unpublish, auth, state/configuration commands, or interactive reviews during maintenance validation. Do not stage, commit, or push unless separately instructed.
