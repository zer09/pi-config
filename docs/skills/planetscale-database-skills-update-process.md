# Updating PlanetScale database skills

Purpose: keep database skills aligned with `planetscale/database-skills` while preserving local database safety gates and OpenAI skill-creator conventions.

## Source of truth

- Upstream repository: https://github.com/planetscale/database-skills
- Current upstream commit checked locally: `b156f4ca73c03d0350438bfd042331aaef6eec77`

| Local skill | Upstream path |
| --- | --- |
| `mysql` | `skills/mysql/SKILL.md` plus references |
| `postgres` | `skills/postgres/SKILL.md` plus references |

## Local safety rule

Database guidance can affect production data. Reads, schema review, query analysis, local tests, and dry-run planning are allowed. Destructive operations such as drops, truncates, deletes, migrations, replication changes, or production writes require explicit user instruction for the exact action.

## Update workflow

1. Load `skill-creator`, `gh-cli`, and the relevant database skill, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/planetscale/database-skills/contents/skills/mysql/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders, including references.
4. Copy upstream runtime changes unless they weaken local destructive-operation safety or conflict with OpenAI skill-creator rules.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Regenerate or update `agents/openai.yaml` when a skill description changes.
7. Update the upstream commit SHA in this file when source content changes.
8. Validate both database skills:

```bash
for skill in mysql postgres; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

9. Scan changed files for literal home paths and secret values before committing.
