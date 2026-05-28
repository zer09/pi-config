# Skill slimming process

Use this process whenever updating an existing skill or installing a new skill. The goal is repeatable: upstream content is input, but local Pi safety, routing, token footprint, and OpenAI skill compatibility decide the final shape.

## Classification

Classify every skill before or during an update:

| Action | Use when | Result |
| --- | --- | --- |
| `keep it` | The skill encodes custom/local tooling, safety-critical gates, niche/current APIs, or hard-to-reconstruct workflows. | Retain as-is unless validation or upstream drift requires changes. |
| `make it slim` | The skill is useful, but much of the body is generic, tutorial-like, or duplicated in references. | Keep only triggers, routing, safety gates, exact local commands, and reference navigation in `SKILL.md`. |
| `remove it` | The skill mostly duplicates base model capability, overlaps better local tooling, or is not worth an installed runtime skill. | Remove the installed runtime skill and keep retired/reinstall notes in `docs/skills/` when useful. |

## Runtime shape

For retained or slimmed skills:

1. Keep `SKILL.md` compact and under 500 lines where practical.
2. Keep frontmatter limited to `name` and `description`.
3. Keep core workflow, mutation gates, tool routing, and reference navigation in `SKILL.md`.
4. Move command catalogs, long examples, troubleshooting matrices, API details, and generated/manual content to `references/` or `docs/skills/`.
5. Keep maintenance process docs in `docs/skills/`, not inside skill folders.
6. Preserve `agents/openai.yaml` and keep `default_prompt` mentioning `$skill-name`.
7. Preserve hosted-service mutation gates and secret redaction rules.

## Update workflow

When updating a skill:

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read this file.
4. Read the relevant `docs/skills/*-update-process.md` file.
5. Fetch or compare upstream/runtime source.
6. Decide `keep it`, `make it slim`, or `remove it` using the classification table.
7. Apply upstream changes only when they do not weaken local invariants.
8. If slimming, move long-lived details into `references/` and keep `SKILL.md` as a router.
9. Update the relevant update-process doc if the repeatable workflow changed.
10. Update `docs/skills/installed-skills-trim-verdict.md` when the inventory/decision changes.
11. Update ADRs when a durable policy or broad classification decision changes.
12. Validate and commit the logical change.

## Install workflow

When installing a new skill:

1. Classify the proposed skill before adding it.
2. If it would be `remove it`, do not install it unless the user explicitly wants that workflow available.
3. If it is `keep it` or `make it slim`, install as a Local Skill under `agent/skills/<skill-name>/`.
4. Apply the runtime shape rules above before validation.
5. Add or update the relevant `docs/skills/*-update-process.md` file so future updates can repeat the install/update path.
6. Add a row to `docs/skills/installed-skills-trim-verdict.md` if it belongs in the installed-skill inventory.

## Inventory location

The tracked inventory lives at `docs/skills/installed-skills-trim-verdict.md`.

Do not commit `scratch/` files. The scratch directory is temporary and may be ignored or cleaned. If a scratch inventory becomes durable enough to preserve, move it into `docs/skills/` before committing.

## Validation checklist

After each skill update/install/removal:

1. Run the target skill validator.
2. Run all local skill validators when local skill files changed.
3. Check all Local Skills still have valid `agents/openai.yaml`.
4. Check local markdown links in changed files.
5. Scan changed files and staged diff for literal home paths and secret-like values.
6. Check for generated caches or runtime artifacts in skill folders.
7. Confirm `docs/skills/README.md` references any new update-process or policy docs.
8. Confirm `docs/skills/installed-skills-trim-verdict.md` has no stale status for changed skills.
9. Commit only the logical change.
