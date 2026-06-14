# Retired refine-linear-task skill

Status: retired during the skill slimming pass.

## Decision

`refine-linear-task` was removed because Linear issue refinement is strong base-model capability and overlaps with the remaining `linear-cli` workflow plus normal writing/research practices.

Do not update or reinstall this skill unless the user explicitly asks for a dedicated Linear task-refinement runtime skill.

## Former source of truth

- Upstream repository: https://github.com/Uniswap/ai-toolkit
- Upstream branch: `next`
- Former upstream skill directory: `packages/plugins/uniswap-integrations/skills/refine-linear-task`
- Former upstream runtime file: `SKILL.md`
- Last upstream `next` commit checked locally before retirement: `c4c6369f7e15e6e247f18be0e1f7c17e71bd1c38`

## Reinstall checklist

If reinstalling later:

1. Read `docs/skills/README.md` and `docs/skills/local-skill-update-invariants.md`.
2. Load `skill-creator`, `gh-cli`, and `linear-cli`.
3. Fetch upstream through authenticated `gh` CLI in Context Mode/RTK.
4. Keep local Linear mutation gates: hosted Linear writes require explicit user authorization.
5. Keep `SKILL.md` concise and limit frontmatter to `name` and `description`.
6. Add `agents/openai.yaml` with only UI metadata unless assets are intentionally required.
7. Add this skill back to `docs/skills/README.md` active update documents if it is reinstalled.
8. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/refine-linear-task`.
