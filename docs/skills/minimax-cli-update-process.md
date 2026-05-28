# Retired MiniMax CLI skill

Status: retired during the skill slimming pass.

## Decision

`mmx-cli` was removed because MiniMax is a niche CLI in this setup and is not used often enough to justify a dedicated runtime skill. Future MiniMax API calls still go to an external hosted service; do not run generation, quota, config, or resource-management commands unless the user explicitly requests that exact action.

Do not update or reinstall this skill unless the user explicitly asks for a dedicated MiniMax CLI runtime skill again.

## Former source of truth

- Upstream repository: https://github.com/MiniMax-AI/cli
- Former upstream skill path: `skill/SKILL.md`
- Last upstream commit checked locally before retirement: `a6b93ba03cfaeaa19e733b45b17422af0503e541`
- Former local files:
  - `agent/skills/mmx-cli/SKILL.md`
  - `agent/skills/mmx-cli/agents/openai.yaml`

## Reinstall checklist

If reinstalling later:

1. Read `docs/skills/README.md` and `docs/skills/local-skill-update-invariants.md`.
2. Load `skill-creator` and `gh-cli`.
3. Fetch upstream runtime content from `MiniMax-AI/cli` and compare it with any local CLI behavior that matters.
4. Preserve hosted-service mutation gates. Authentication, generation, uploads, downloads, quota/config changes, and resource management require exact explicit user instruction when they create cost, change remote state, write local credentials, or download generated media.
5. Keep placeholder secrets as placeholders such as `<api-key>` or environment variable names; never document realistic token values.
6. Keep `SKILL.md` concise and limit frontmatter to `name` and `description`.
7. Add `agents/openai.yaml` with `default_prompt` mentioning `$mmx-cli`.
8. Add this skill back to `docs/skills/README.md` active update documents if it is reinstalled.
9. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/mmx-cli`.
