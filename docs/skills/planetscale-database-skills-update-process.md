# Updating PlanetScale database skills

Purpose: keep database skills aligned with `planetscale/database-skills` while preserving local database safety gates and OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/planetscale/database-skills
- Current upstream commit checked locally: `af0ce0cfb65cca4cc21d18ca0d9cf270ca99d488`

| Local skill | Upstream path |
| --- | --- |
| `mysql` | `skills/mysql/SKILL.md` plus references |
| `postgres` | `skills/postgres/SKILL.md` plus references |

## Local safety rule

Database guidance can affect production data. Reads, schema review, query analysis, local tests, and dry-run planning are allowed. Destructive operations such as drops, truncates, deletes, migrations, replication changes, privilege changes, data backfills, or production writes require explicit user instruction for the exact action.

## Slimming policy

These skills are intentionally slim. Keep `SKILL.md` focused on triggers, destructive-operation gates, evidence-based workflow, fast guidance, local reference navigation, PlanetScale hosting notes, and the maintenance pointer. Keep detailed examples, command catalogs, and database internals in `references/` instead of the runtime skill.

Preserve relative links to local `references/` files so the runtime skill remains usable without fetching raw GitHub URLs.

## Routing and proportional discovery

Both skills remain `make it slim`. Route MySQL/InnoDB database design, query/index/transaction tuning, and operational diagnosis to `mysql`; route PostgreSQL database work to `postgres`. An incidental database mention or ordinary application code using a database does not activate either specialist skill. Firebase Data Connect connector, schema, and SDK work stays in its product workflow unless PostgreSQL-level design or diagnosis is needed.

Inspect or ask only for version, workload, scale, hosting, and change-window inputs that materially affect the answer. A conceptual question does not require an operational checklist. Preserve stated assumptions, selected references, evidence-driven checks for proposed changes, exact production/destructive gates, rollback, rollout order, and verification.

Keep each metadata prompt aligned with exactly one matching `$mysql` or `$postgres` token. A local routing-only pass does not change the upstream SHA.

## Update workflow

1. Load `skill-creator`, `gh-cli`, and the relevant database skill, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode, for example:

```bash
gh api repos/planetscale/database-skills/contents/skills/mysql/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders, including references.
4. Copy upstream runtime changes only when they improve the compact local workflow and do not weaken local destructive-operation safety, relative reference navigation, or OpenAI skill-creator rules.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Regenerate or update `agents/openai.yaml` when a skill description changes or the default prompt becomes stale.
7. Update the upstream commit SHA in this file when source content changes.
8. Validate both database skills:

```bash
for skill in mysql postgres; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

9. Scan changed files for literal home paths and secret values before committing.
