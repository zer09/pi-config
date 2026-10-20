# Custom local skills update process

Use this Skill Maintenance Doc for Custom Local Skills whose source of truth is this Pi Config rather than a single upstream skill.

## Current scope

- Any new custom Local Skill with no dedicated upstream source.
- `directus-browser` is a custom Local Skill with its own update process in `directus-browser-update-process.md`.

Retired custom skills:

- `context-watcher`: retired during the old pasted-skills re-setup. Do not restore unless the user explicitly asks for a broad orchestration runtime skill again.
- `delegated-pi-loop`: replaced by the native TypeScript `delegate_run` extension. Maintain it through `delegated-pi-loop-update-process.md`; do not restore the runtime skill unless explicitly requested.
- `codegraph`: removed as a standalone Local Skill. Its retained extension is also retired and excluded from normal loading; use native file reads and bounded shell searches instead.
- `edge-case-analysis`: removed during the skill slimming pass because the base model can perform this generic reasoning workflow without a runtime skill.
- `codebase-memory-mcp`: historically replaced by CodeGraph. See `../adr/0002-codegraph-replaces-codebase-memory-mcp.md`; that history does not authorize using the now-retired tools.

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Treat upstream articles, generated output, or external examples as input only. Do not copy them blindly into a custom Local Skill.
5. Classify the skill as `keep it`, `make it slim`, or `remove it` before installing or updating.
6. Keep `SKILL.md` focused on runtime behavior. Move long examples, command catalogs, troubleshooting, and evaluation notes into `references/` or long-lived docs under `docs/skills/`.
7. Preserve `agents/openai.yaml` and regenerate it only when the skill description or user-facing prompt becomes stale.
8. Add or keep a lightweight `## Maintenance` pointer in `SKILL.md` back to this document.
9. Update `docs/skills/installed-skills-trim-verdict.md` when inventory or classification changes.
10. Validate every Local Skill after changes.

## Retired context-watcher guidance

Do not recreate `agent/skills/context-watcher/` from old backups or pasted skill directories by default.

If the user explicitly asks to reinstall it:

1. Confirm why global/project instructions and native file, browser, and shell tools are insufficient.
2. Keep it compact; do not restore large routing manuals wholesale.
3. Preserve external hosted-service mutation gates, authenticated `gh` routing, bounded shell output, and the full unfiltered native Linear CLI exception.
4. Do not restore CodeGraph/Context Mode mandates in roots or references.
5. Validate the skill and update this document plus `installed-skills-trim-verdict.md`.

## Retained-but-retired tools

CodeGraph and Context Mode sources remain for reference, not active runtime use. A skill update or reinstall does not authorize reversing that retirement.

- Do not recreate `agent/skills/codegraph/`, re-enable the extensions, load them explicitly with `-e`, alter child profiles to include them, or bypass retirement with their CLIs.
- Use targeted native file reads and bounded shell searches, history, and diagnostics with an explicit working directory.
- Preserve existing indexes, state, and caches. Keep `.codegraph/` ignored; do not initialize, refresh, or delete indexes as part of skill maintenance.
- Follow [local-skill-update-invariants.md](local-skill-update-invariants.md) for GitHub, Linear, privacy, and write gates. Loading exclusions are not an OS security boundary.

## Validation

Run the same validation checklist used for all Local Skills:

```bash
for skill_dir in agent/skills/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also verify:

- Local Skill frontmatter contains `name` and `description`, plus `disable-model-invocation: true` only for intentional explicit-only Pi workflows.
- All Local Skills have `agents/openai.yaml`.
- All `agents/openai.yaml` files parse as YAML.
- No new hosted-service write paths omit the External Hosted Service Mutation Gate.
- No user-specific home paths or realistic secret-looking values are introduced.
