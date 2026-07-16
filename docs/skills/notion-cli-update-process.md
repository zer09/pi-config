# Retired notion-cli skill

Status: retired during the skill slimming pass; superseded by the active combined `notion` skill.

## Decision

`notion-cli` was removed because the local `ntn` CLI output alone was not a good fit for routine agent workflows. A later explicit request installed `agent/skills/notion/`, which keeps the CLI as a self-documenting execution layer and adds slim workflow guidance from Notion's Claude plugin.

Do not reinstall the standalone `notion-cli` skill alongside `notion` unless the user explicitly requests the narrower duplicate. Maintain the active skill through `notion-update-process.md`.

## Former source of truth

- Upstream repository: https://github.com/makenotion/skills
- Former upstream path: `skills/notion-cli/SKILL.md`
- Last upstream main commit checked locally before retirement: `423af2bf546cd0354e5cc871017251945d9ad14f`
- Former local command source: installed `ntn` CLI help and docs commands.

## Reinstall checklist

If the standalone skill is explicitly requested later:

1. Read `docs/skills/README.md` and `docs/skills/local-skill-update-invariants.md`.
2. Load `skill-creator`.
3. Fetch upstream runtime content from `makenotion/skills` and inspect local `ntn` behavior through Context Mode.
4. Preserve hosted-service mutation gates: Notion API writes, page creates/updates, comments, file uploads, worker deploys, worker execution, login, and logout require exact explicit user instruction.
5. Do not print or document token values. Refer to `NOTION_API_TOKEN` by name only.
6. Keep `SKILL.md` concise and limit frontmatter to `name` and `description`.
7. Add `agents/openai.yaml` with `default_prompt` mentioning `$notion-cli`.
8. Resolve the name/trigger overlap with the active `notion` skill before installation.
9. Add this skill back to `docs/skills/README.md` active update documents if it is reinstalled.
10. Validate with the repository's `agent/skills/skill-creator/scripts/quick_validate.py`.
