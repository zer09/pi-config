# Skill slimming process

Use this process whenever manually updating an existing skill or installing a new skill. Upstream content is input, but local safety, precise routing, useful behavior, and mixed-model compatibility decide the final shape. Apply [ADR 0020](../adr/0020-gpt-6-astra-skill-maintenance-policy.md) without weakening the existing local invariants.

## Classification

Classify every skill before or during an update:

| Action | Use when | Result |
| --- | --- | --- |
| `keep it` | The skill encodes custom/local tooling, safety-critical gates, niche/current APIs, or hard-to-reconstruct workflows. | Retain unless semantic checks, validation, or upstream drift require changes. |
| `make it slim` | The skill is useful, but routing is overbroad or the body is generic, itinerary-heavy, or duplicated in references. | Keep precise triggers, routing, safety gates, exact local commands, useful completion criteria, and reference navigation. |
| `remove it` | The skill mostly duplicates base model capability, overlaps better local tooling, or is not worth an installed runtime skill. | Remove the installed runtime skill and keep retired/reinstall notes in `docs/skills/` when useful. |

Inspect these dimensions before choosing a classification and again after applying upstream changes:

- **Description precision:** Does the shortest sufficient description identify activating intent without procedures, command catalogs, or reference lists?
- **Collisions:** Do positive triggers and adjacent-skill near misses select the intended skill rather than a broad topic match?
- **Root/router shape:** Does a multi-workflow root route to relevant details without requiring unrelated reading or duplicating long content?
- **Itinerary burden:** Does each rigid sequence or extra instruction protect correctness, safety, or supported-model compatibility?
- **Decision boundaries:** Can already-authorized, reversible local work continue while ambiguous, destructive, or hosted-service actions retain required gates?
- **Completion criteria:** Where early stopping is likely, are the deliverable, relevant checks, in-scope fixes, and real blockers clear?

A small root is not sufficient evidence of a useful skill. Preserve behavior that supported models and harnesses still need.

## Runtime shape

For retained or slimmed skills:

1. Keep `SKILL.md` compact and under 500 lines where practical.
2. Keep frontmatter limited to `name` and `description` by default; preserve intentional `disable-model-invocation: true` only for explicit-only Pi workflows.
3. Keep core workflow, mutation gates, tool routing, and useful completion criteria in `SKILL.md`. Use a minimal router with shared constraints for multi-workflow skills.
4. Move runtime details to directly linked `references/`; load only what the selected workflow needs. Keep long content in one authoritative location.
5. Keep maintenance process docs in `docs/skills/`, not inside skill folders.
6. Preserve `agents/openai.yaml` and keep `default_prompt` mentioning `$skill-name`.
7. Preserve hosted-service mutation gates and secret redaction rules. Keep gates visible before the actions they govern.
8. Keep descriptions intent-based and distinct from adjacent skills; do not impose an arbitrary local character cap.
9. Replace unnecessary itineraries with decision guidance. Retain exact commands and ordering where correctness, safety, or compatibility requires them.

## Update workflow

When updating a skill:

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read this file.
4. Read the relevant `docs/skills/*-update-process.md` file. Inspect the current skill using all six classification dimensions above.
5. Fetch or compare upstream/runtime source, including description changes and their effect on adjacent-skill routing.
6. Decide `keep it`, `make it slim`, or `remove it` using the classification table and semantic evidence.
7. Apply upstream changes only when they do not weaken local invariants. Reapply local overlays.
8. Recheck all six dimensions after the sync. If slimming, move runtime details into `references/` and keep `SKILL.md` as a router.
9. Update the relevant update-process doc if the repeatable workflow changed.
10. Update `docs/skills/installed-skills-trim-verdict.md` when the inventory/decision changes.
11. Update ADRs when a durable policy or broad classification decision changes.
12. Validate structure and behavior using the checklist below. Commit only when explicitly instructed.

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
9. Apply the semantic checks in `local-skill-update-invariants.md`: routing precision, collisions, selective loading, itinerary burden, decision boundaries, and completion.
10. Use representative cases and baseline comparisons when warranted by the change or risk. Record what was tested and any behavior not exercised; context savings alone do not establish success.
11. Commit only the logical change, and only when the user explicitly asks.
