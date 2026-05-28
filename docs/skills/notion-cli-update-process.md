# Retired notion-cli skill

Status: retired during the skill slimming pass.

## Decision

`notion-cli` was removed because the local `ntn` CLI output was not a good fit for routine agent workflows. Notion remains an external hosted service, so future Notion writes still require exact explicit user instruction even without this runtime skill.

Do not update or reinstall this skill unless the user explicitly asks for a dedicated Notion CLI runtime skill again.

## Former source of truth

- Upstream repository: https://github.com/makenotion/skills
- Former upstream path: `skills/notion-cli/SKILL.md`
- Last upstream main commit checked locally before retirement: `423af2bf546cd0354e5cc871017251945d9ad14f`
- Former local command source: installed `ntn` CLI help and docs commands.

## Reinstall checklist

If reinstalling later:

1. Read `docs/skills/README.md` and `docs/skills/local-skill-update-invariants.md`.
2. Load `skill-creator`.
3. Fetch upstream runtime content from `makenotion/skills` and inspect local `ntn` behavior through Context Mode.
4. Preserve hosted-service mutation gates: Notion API writes, page creates/updates, comments, file uploads, worker deploys, worker execution, login, and logout require exact explicit user instruction.
5. Do not print or document token values. Refer to `NOTION_API_TOKEN` by name only.
6. Keep `SKILL.md` concise and limit frontmatter to `name` and `description`.
7. Add `agents/openai.yaml` with `default_prompt` mentioning `$notion-cli`.
8. Add this skill back to `docs/skills/README.md` active update documents if it is reinstalled.
9. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/notion-cli`.
