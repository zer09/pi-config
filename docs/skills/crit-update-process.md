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

Before and after updates, apply `local-skill-update-invariants.md` and `skill-slimming-process.md`.

- Preserve `disable-model-invocation: true` on the interactive `crit` skill so it remains an explicit `/skill:crit` workflow; this is a supported Pi extension, not portable Agent Skills frontmatter.
- Keep `agents/openai.yaml` UI metadata valid with a `$crit` or `$crit-cli` default prompt.
- Preserve the interactive `crit` rule: run the foreground `crit` command and wait until the reviewer clicks Finish Review.
- Preserve the resolution rule: do not resolve comments unless the user explicitly asks.
- Use `--author 'Pi'` in examples and agent-authored replies.
- Treat `crit push`, GitHub PR review posting, and publishing shared reviews as external hosted-service mutations; require explicit user instruction for the exact action.
- Keep exact CLI examples compact; move large reference material to this doc or a runtime reference file only when it becomes necessary.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Check `command -v crit`, `crit --version`, and `crit --help`. Confirm the selected binary identifies itself as inline code review; some Linux systems install an unrelated CRIU Image Tool at `/usr/bin/crit`.
3. Compare installed behavior and upstream `integrations/pi/skills/crit*` against `agent/skills/crit/SKILL.md` and `agent/skills/crit-cli/SKILL.md`. Avoid `crit comment --help` unless current root help confirms that form is side-effect free.
4. Apply only runtime-relevant changes; preserve local Pi review-loop and mutation gates.
5. Validate both skills:

```bash
for skill in crit crit-cli; do
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "agent/skills/$skill" || exit 1
done
```

6. Run all Local Skill validation checks before committing.
