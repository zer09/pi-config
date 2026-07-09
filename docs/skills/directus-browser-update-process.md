# Directus Browser skill update process

Use this Skill Maintenance Doc for the custom local `directus-browser` skill.

## Scope

- `agent/skills/directus-browser/`.
- Directus Studio browser-operation guidance backed by official Directus docs.
- Pi Browser Harness usage policy for Directus tasks when Directus MCP is unavailable or not configured.

## Classification

- Status: installed custom Local Skill.
- Action: `keep it`.
- Reason: it encodes Directus-specific Studio navigation, schema/access-control vocabulary, and safety gates for browser-driven work that are easy to get wrong without Directus MCP.

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Read this file.
5. Start with `agent/skills/directus-browser/references/official-sources.md` and re-check the official Directus docs relevant to the behavior being changed.
6. Treat official docs as source input, not final runtime text. Keep `SKILL.md` compact and keep `references/directus-studio.md` as an index/router.
7. Update the matching distilled reference files as needed:
   - `data-model.md` for collections, fields, and relationships.
   - `content-and-files.md` for records, collection pages, files, and assets.
   - `access-control.md` for users, roles, policies, and permissions.
   - `flows.md` for automation.
   - `api-browser-probes.md` for read-only browser-context API access.
   - `security.md` for token, script, API-write, and mutation gates.
   - `official-sources.md` for source inventory or refresh protocol changes.
8. Update `Last reviewed` dates on changed reference files.
9. Preserve these local invariants:
   - Browser UI is the default mutation path.
   - Same-origin Directus API calls from `browser_execute_js` are read-only by default.
   - Token extraction from cookies, localStorage, or sessionStorage is forbidden unless explicitly authorized.
   - API writes and `browser_run_script` mutations require explicit user authorization for endpoint/action and payload shape.
   - Deletes, schema changes, permission changes, and flow changes require explicit user intent and verification.
10. Update `agents/openai.yaml` if the description or default prompt becomes stale.
11. Update `docs/skills/installed-skills-trim-verdict.md` if classification or inventory changes.
12. Update `docs/config-context-cost.md` when skill catalog descriptions or installed skill inventory change materially.
13. Validate the skill and then all Local Skills.

## Validation

Run the target validator:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/directus-browser
```

Run all Local Skill validators after changes:

```bash
for skill_dir in agent/skills/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also verify:

- `SKILL.md` frontmatter only has `name` and `description`.
- `agents/openai.yaml` parses as YAML and `default_prompt` mentions `$directus-browser`.
- Changed docs do not include real Directus URLs, tokens, cookies, or user-specific paths.
- Runtime guidance still defaults to read-only for Directus API access.
- `references/official-sources.md` reflects any official Directus source changes used in the update.
- Changed reference files have current `Last reviewed` dates.
