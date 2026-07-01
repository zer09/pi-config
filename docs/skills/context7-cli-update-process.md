# Retired Context7 CLI skill

Status: retired during the 2026-07 skill-footprint cleanup.

## Decision

`context7-cli` was removed because current-doc lookup can use normal research tools, while Context7 setup and skill-management workflows are not frequent enough in this setup to justify a dedicated runtime skill.

Context7 still touches local and hosted state when used. `ctx7 login`, `ctx7 logout`, `ctx7 setup`, `ctx7 remove`, `ctx7 upgrade -y`, `ctx7 skills install`, `ctx7 skills remove`, and `ctx7 skills generate` require exact explicit user instruction because they can change local auth state, config, installed skills, packages, or remote state. Never print or document Context7 API keys, OAuth tokens, cookies, or generated config secrets.

Do not update or reinstall this skill unless the user explicitly asks for a dedicated Context7 CLI runtime skill again.

## Former source of truth

- Upstream repository: https://github.com/upstash/context7
- Former upstream skill path: `skills/context7-cli/SKILL.md`
- Last upstream commit checked locally before retirement: `7e956e594584db4b1b66a3a4a07781e92b4d7e45`
- Upstream default branch checked locally before retirement: `master`
- Local CLI version checked locally during slimming: `0.4.4`

Former local files:

- `agent/skills/context7-cli/SKILL.md`
- `agent/skills/context7-cli/references/docs.md`
- `agent/skills/context7-cli/references/setup.md`
- `agent/skills/context7-cli/references/skills.md`
- `agent/skills/context7-cli/agents/openai.yaml`

## Reinstall checklist

If reinstalling later:

1. Read `docs/skills/README.md`, `docs/skills/local-skill-update-invariants.md`, and `docs/skills/skill-slimming-process.md`.
2. Load `skill-creator` and `gh-cli`.
3. Fetch upstream runtime content from `upstash/context7` and compare it with current local `ctx7 --help` behavior.
4. Reclassify the skill using the slimming process; reinstall only if the user needs a recurring dedicated `ctx7` workflow.
5. Preserve mutation gates for auth, setup/remove, upgrade, skill install/remove/generate, and any remote-state or credential-writing command.
6. Keep placeholder secrets as placeholders such as `<api-key>` or environment variable names; never document realistic token values.
7. Keep `SKILL.md` concise and limit frontmatter to `name` and `description`.
8. Move command details, setup notes, and long examples into `references/`.
9. Add `agents/openai.yaml` with `default_prompt` mentioning `$context7-cli`.
10. Update `docs/skills/README.md`, `docs/skills/installed-skills-trim-verdict.md`, and ADR 0001 if the skill is restored.
11. Validate with `uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/context7-cli`.
