# Updating Crit skills

Purpose: keep the local `crit` and `crit-cli` skills aligned with the installed `crit` CLI while preserving Pi review-loop behavior, hosted-service safety, and OpenAI skill-creator conventions.

## Source of truth

- Upstream repository: https://github.com/tomasz-tomczyk/crit
- Reviewed release: `v0.18.4` (`0b9c5461de2d0e6fd1a4a342947874d20b4c7c74`)
- Installed CLI: `crit v0.18.4`
- Local skills:
  - `agent/skills/crit/` for the interactive human review loop.
  - `agent/skills/crit-cli/` for programmatic comments, share/unpublish, GitHub PR sync, and review JSON interpretation.

## Local invariants

Before and after updates, apply [local-skill-update-invariants.md](local-skill-update-invariants.md) and [skill-slimming-process.md](skill-slimming-process.md). Upstream remains input, not final truth. Local-only safety or slimming work does not change the reviewed release or upstream SHA.

### Routing and runtime shape

- Keep descriptions concise and intent-specific, without arbitrary local description caps or command catalogs.
- `crit-cli` owns local/programmatic review data, comment authoring and replies, sharing/unpublishing, and GitHub sync. Interactive foreground review belongs to explicit `$crit`, not a generic request to review.
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
| `crit pull` | GitHub read plus local review-file write; require a request for that sync and its target. |
| `crit push` | GitHub post; require explicit instruction for that exact hosted action, PR target, and review event. A dry-run does not authorize a later push. |
| `crit share` | Publication; require explicit instruction for the exact files/included comments, destination, and visibility. |
| `crit unpublish` | Deletion of remote shared state; require explicit instruction for the exact shared review/files. |

Do not infer hosted write authority from a read, local comment write, pull, or dry-run. Clarify missing targets or visibility before hosted writes. Do not expose credentials or persisted delete tokens.

### Correctness and completion

Preserve `--author 'Pi'`, single-quoted bodies, file-on-disk line numbers, session/plan disambiguation, line/file/review scope, quote/anchor/drift semantics, and reading replies before acting. Preserve atomic bulk JSON, its per-entry resolution gate, and file-based input for multi-paragraph bodies.

Preserve output relay, terminal-only QR output, organization visibility defaults and overrides, inclusion of comments when sharing, and persisted-token unpublish behavior. End after the requested operation and relevant read-only confirmation; report the result and target. Stop on missing authority, ambiguous sessions/targets, or unavailable CLI/authentication rather than substituting a broader action.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Check `command -v crit`, `crit --version`, and `crit --help`. Confirm the selected binary identifies itself as inline code review; some Linux systems install an unrelated CRIU Image Tool at `/usr/bin/crit`.
3. For an upstream sync, compare installed behavior and upstream `integrations/pi/skills/crit*` against the local roots and linked runtime references. Use the `gh-cli` skill and authenticated `gh` for GitHub reads. Avoid `crit comment --help` unless current root help confirms that form is side-effect free.
4. Apply only runtime-relevant changes. Reapply the routing, concise-root, correctness, completion, and action-gate overlays above. Update source provenance only after an actual upstream review.
5. Validate both skills:

```bash
for skill in crit crit-cli; do
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "agent/skills/$skill" || exit 1
done
```

6. Run all Local Skill validators. Parse changed YAML, check exact skill tokens, short-description ranges, dependencies/explicit-only metadata, changed links, and the scoped diff. Compare root line counts as a diagnostic, not proof of behavior.
7. Statically review near misses: reading comments must not write; a comment request must not resolve; a request to pull must not push; a dry-run must not post; share and unpublish each need their own exact-action authorization. Check that explicit `$crit` remains separate. Do not exercise hosted actions to validate these gates.
8. Commit only when explicitly requested.
