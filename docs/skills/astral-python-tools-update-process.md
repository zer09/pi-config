# Updating Astral Python tool skills

Purpose: keep the Astral Python tooling skills aligned with `astral-sh/claude-code-plugins` while preserving local OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/astral-sh/claude-code-plugins
- Current upstream commit checked locally: `f3ce88a7ba830f53afd6d944c1d0278ed318e142`

| Local skill | Upstream path |
| --- | --- |
| `uv` | `plugins/astral/skills/uv/SKILL.md` |
| `ruff` | `plugins/astral/skills/ruff/SKILL.md` |
| `ty` | `plugins/astral/skills/ty/SKILL.md` |

## Local files

- `agent/skills/uv/`: uv usage guidance.
- `agent/skills/ruff/`: Ruff usage guidance.
- `agent/skills/ty/`: ty usage guidance.
- Each skill has local `agents/openai.yaml` UI metadata.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/astral-sh/claude-code-plugins/contents/plugins/astral/skills/uv/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders.
4. Copy upstream runtime changes unless they conflict with local Pi routing or OpenAI skill-creator rules.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Preserve local Python tooling policy in project rules: use `uv`, prefer `uv run`, use `ruff` for lint/format, and use `ty` for type checking.
7. Regenerate or update `agents/openai.yaml` if a skill description changes.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate all Astral skills:

```bash
for skill in uv ruff ty; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

10. Scan changed files for literal home paths and secret values before committing.
