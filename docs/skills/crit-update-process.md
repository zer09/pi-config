# Updating Crit skills

Purpose: keep the local `crit` and `crit-cli` skills aligned with the installed `crit` CLI while preserving Pi review-loop behavior, hosted-service safety, and OpenAI skill-creator conventions.

## Source of truth

- Upstream repository: https://github.com/tomasz-tomczyk/crit
- Approved and reviewed release: [v0.21.0](https://github.com/tomasz-tomczyk/crit/releases/tag/v0.21.0), published `2026-09-28T08:17:57Z`.
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
2. Check `command -v crit`, `crit --version`, and `crit --help`. Confirm the selected binary identifies itself as inline code review; some Linux systems install an unrelated CRIU Image Tool at `/usr/bin/crit`. Record the original binary hash and unrelated working-tree changes without copying secrets.
3. Use the `gh-cli` skill and authenticated `gh` for read-only release metadata, tag resolution, and exact-commit source retrieval. Compare `integrations/pi/skills/crit*`, release notes, CLI help, both local roots, and linked references. Pin the approved tag/commit, not `main` or `latest`.
4. When a binary upgrade is authorized, download only the official platform artifact and checksum manifest into a temporary directory. Verify GitHub's asset digests and the manifest entry before executing the candidate. Check Linux amd64 architecture. Do not use a pipe-to-shell installer or `crit install`, which could replace local overlays.
5. Run only offline version/help checks in an empty temporary HOME and working directory, without inherited credentials. In v0.21.0, [cmd/crit/cli_dispatch.go:210-243](https://github.com/tomasz-tomczyk/crit/blob/b519778c90087adad030d06eda272d21aa591910/cmd/crit/cli_dispatch.go#L210-L243) handles `--help`, `--version`, and an immediate subcommand `--help` before product handlers. Recheck that dispatch before using subcommand help on another version. Never call a product action merely for validation.
6. Stage the verified executable with mode 0755 in `~/.local/bin/`, verify that copy, then atomically rename it over the authorized user-local binary. Recheck PATH selection, installed version/hash, and the untouched system Crit hash. Do not restart/stop daemons or migrate review state.
7. Apply only runtime-relevant skill changes. Reapply routing, concise-root, correctness, completion, and action-gate overlays. Update source provenance only after an actual upstream review. For next-round details, compare [session_reconnect.go:24-53](https://github.com/tomasz-tomczyk/crit/blob/b519778c90087adad030d06eda272d21aa591910/internal/session/session_reconnect.go#L24-L53) with [plan_cli.go:75-105](https://github.com/tomasz-tomczyk/crit/blob/b519778c90087adad030d06eda272d21aa591910/internal/session/plan_cli.go#L75-L105).
8. Validate both skills:

```bash
for skill in crit crit-cli; do
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "agent/skills/$skill" || exit 1
done
```

9. Run all Local Skill validators. Check YAML, exact skill tokens, short-description ranges, dependencies/explicit-only metadata, local links and anchors, root sizes, and `git diff --check`. Scan the scoped changes for artifacts, secrets, literal home paths, and unintended paths. Reapply the invariant and slimming checklists after the sync.
10. Statically review representative cases: reading comments must not write; requested replies must not resolve; pull must not push; dry-run must not post. A generic review or just-written plan must not launch Crit. A current-URL request must not publish. Organization sharing must keep the requested visibility and deployment. Non-default unpublish must not leak the delete token. Finished rounds must preserve approval and next-round identity. These checks do not prove live model/browser behavior.
11. Do not exercise comments, replies, resolution, pull, push (including dry-run), share, unpublish, auth, state/configuration commands, or interactive reviews during maintenance validation. Do not stage, commit, or push unless separately instructed.
