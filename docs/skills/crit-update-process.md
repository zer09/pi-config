# Updating Crit skills

Purpose: keep the local `crit` and `crit-cli` skills aligned with the installed `crit` CLI while preserving Pi review-loop behavior, hosted-service safety, and OpenAI skill-creator conventions.

## Source of truth

- Installed CLI: `crit`
- Local skills:
  - `agent/skills/crit/` for the interactive human review loop.
  - `agent/skills/crit-cli/` for programmatic comments, share/unpublish, GitHub PR sync, and review JSON interpretation.

## Local invariants

Before and after updates, apply `local-skill-update-invariants.md` and `skill-slimming-process.md`.

- Keep `SKILL.md` frontmatter limited to `name` and `description`.
- Keep `agents/openai.yaml` UI metadata valid with a `$crit` or `$crit-cli` default prompt.
- Preserve the interactive `crit` rule: run the foreground `crit` command and wait until the reviewer clicks Finish Review.
- Preserve the resolution rule: do not resolve comments unless the user explicitly asks.
- Use `--author 'Pi'` in examples and agent-authored replies.
- Treat `crit push`, GitHub PR review posting, and publishing shared reviews as external hosted-service mutations; require explicit user instruction for the exact action.
- Keep exact CLI examples compact; move large reference material to this doc or a runtime reference file only when it becomes necessary.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Check installed CLI behavior with `crit --help`. Do not run `crit comment --help`; current `crit` treats `--help` as a comment body and creates a review comment.
3. Compare help output against `agent/skills/crit/SKILL.md` and `agent/skills/crit-cli/SKILL.md`.
4. Apply only runtime-relevant changes; preserve local Pi review-loop and mutation gates.
5. Validate both skills:

```bash
for skill in crit crit-cli; do
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "agent/skills/$skill" || exit 1
done
```

6. Run all Local Skill validation checks before committing.
