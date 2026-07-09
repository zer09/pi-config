# Custom local skills update process

Use this Skill Maintenance Doc for Custom Local Skills whose source of truth is this Pi Config rather than a single upstream skill.

## Current scope

- Any new custom Local Skill with no dedicated upstream source.
- `directus-browser` is a custom Local Skill with its own update process in `directus-browser-update-process.md`.

Retired custom skills:

- `context-watcher`: retired during the old pasted-skills re-setup. Do not restore unless the user explicitly asks for a broad orchestration runtime skill again.
- `codegraph`: removed as a standalone Local Skill. CodeGraph remains available through Pi's native graph-first tools and global/project guidance.
- `edge-case-analysis`: removed during the skill slimming pass because the base model can perform this generic reasoning workflow without a runtime skill.
- `codebase-memory-mcp`: replaced by CodeGraph. See `../adr/0002-codegraph-replaces-codebase-memory-mcp.md`.

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

1. Confirm why global/project instructions and the native CodeGraph/browser/shell tools are insufficient.
2. Keep it compact; do not restore large routing manuals wholesale.
3. Preserve external hosted-service mutation gates, private GitHub routing, large-output handling, and graph-first CodeGraph guidance.
4. Keep CodeGraph details in a runtime reference file rather than duplicating them in `SKILL.md`.
5. Validate the skill and update this document plus `installed-skills-trim-verdict.md`.

## CodeGraph capability rules

CodeGraph is a native graph-first capability, not a standalone Local Skill in this setup.

- Do not recreate `agent/skills/codegraph/` unless the user explicitly reverses the retirement decision.
- Keep `codegraph init`, `codegraph index`, `codegraph sync`, and `codegraph uninit` deliberate local index mutations; ask or require explicit authorization when setup/indexing/freshness/deletion is not directly requested.
- Use optional `projectPath` for worktrees, multi-repo tasks, and repos outside the session root.
- Keep `.codegraph/` ignored in repositories where indexes are initialized.
- Remove stale examples that describe tools or parameters not present in the current MCP schema.

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

- All `SKILL.md` frontmatter contains only `name` and `description`.
- All Local Skills have `agents/openai.yaml`.
- All `agents/openai.yaml` files parse as YAML.
- No new hosted-service write paths omit the External Hosted Service Mutation Gate.
- No user-specific home paths or realistic secret-looking values are introduced.
