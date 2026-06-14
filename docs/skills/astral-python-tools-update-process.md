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

- `agent/skills/uv/`: compact uv command routing and local Python tooling policy.
- `agent/skills/ruff/`: compact Ruff lint/format workflow with formatting-churn safeguards.
- `agent/skills/ty/`: compact ty type-checking workflow with docs-verification guidance for advanced flags.
- Each skill has local `agents/openai.yaml` UI metadata.

## Slimming policy

These skills are intentionally slim. Keep `SKILL.md` focused on triggers, preferred invocation, safety/scoping rules, core commands, docs links, and the maintenance pointer. Do not restore long migration tables or broad command catalogs unless the user explicitly asks for a more detailed runtime skill.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/astral-sh/claude-code-plugins/contents/plugins/astral/skills/uv/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders.
4. Copy upstream runtime changes only when they improve the compact local workflow and do not conflict with local Pi routing, OpenAI skill-creator rules, or token-footprint goals.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Preserve local Python tooling policy in project rules: use `uv`, prefer `uv run`, use `ruff` for lint/format, and use `ty` for type checking.
7. Preserve the scoped-fix safeguards in `ruff` and the docs-verification warning for advanced `ty` flags.
8. Regenerate or update `agents/openai.yaml` if a skill description changes.
9. Update the upstream commit SHA in this file when source content changes.
10. Validate all Astral skills:

```bash
for skill in uv ruff ty; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

11. Scan changed files for literal home paths and secret values before committing.
