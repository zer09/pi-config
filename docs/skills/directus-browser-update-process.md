# Directus Browser skill update process

Use this Skill Maintenance Doc for the custom local `directus-browser` skill.

## Scope

- `agent/skills/directus-browser/`.
- Directus Studio browser-operation guidance backed by official Directus docs.
- Pi Browser Harness usage policy for Directus tasks when Directus MCP is unavailable or not configured.

## Classification

- Status: installed custom Local Skill.
- Action: `keep it`.
- Reason: it encodes Directus-specific Studio navigation, schema/access-control vocabulary, and safety gates for browser-driven work that are easy to get wrong without Directus MCP. Keep the niche root unless further slimming is justified.

## Routing and Browser Harness overlay

- Keep the description focused on Directus Studio inspection/management through the user-authorized Browser Harness, not an enumeration of every Directus surface.
- Before the root operating loop, explicitly load and apply `$pi-browser-harness` and its per-task Required User Setup Gate. Preserve the [Browser Harness update-process overlays](pi-browser-harness-update-process.md).
- Require a supported running browser, debugging if needed, user-run `/browser-setup`, and explicit completion confirmation before any browser tool or state probe. Never call `browser_setup` for the user. Repeat the gate after disconnect.
- Directus does not bypass consent, profile/account selection, manual login, dialog handling, or Browser Harness safety. Same-origin GET probes and scripts inherit this gate too.
- Keep snapshot as the default, surgical JavaScript reads, and screenshots only for visual verification. Preserve Directus vocabulary, task routing, OAS inspection, UI-first mutations, and fresh verification.
- Keep `agents/openai.yaml` aligned with the description and exact `$directus-browser` token. Local routing changes do not constitute an upstream sync or a new review of official source versions.

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Read this file.
5. Start with `agent/skills/directus-browser/references/official-sources.md` and re-check the official Directus docs relevant to the behavior being changed.
6. Treat official docs as source input, not final runtime text. Keep `SKILL.md` compact and keep `references/directus-studio.md` as an index/router.
7. Update the matching distilled reference files as needed:
   - `data-model.md` for collections, fields, and relationships.
   - `schema-api-mutations.md` for explicitly approved API-based schema writes.
   - `content-and-files.md` for records, collection pages, files, and assets.
   - `access-control.md` for users, roles, policies, and permissions.
   - `flows.md` for automation.
   - `api-browser-probes.md` for read-only browser-context API access.
   - `security.md` for token, script, API-write, and mutation gates.
   - `official-sources.md` for source inventory or refresh protocol changes.
8. Update `Last reviewed` dates on changed reference files.
9. Preserve these local invariants:
   - Browser Harness consent applies before the operating loop and before UI/API/script access.
   - Browser UI is the default mutation path; reads never authorize writes.
   - Same-origin Directus GET calls from `browser_execute_js` use the logged-in browser context with `credentials: "include"` and are read-only by default.
   - Token extraction from cookies, localStorage, or sessionStorage is forbidden unless explicitly authorized.
   - API writes and `browser_run_script` mutations require explicit user authorization for endpoint/action and payload shape.
   - Schema updates require asking whether to use Studio UI or authenticated API unless the user already specified the method.
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
- Static near miss: a Directus inspection request or existing login does not bypass per-task Browser Harness confirmation, authorize writes/deletes, or permit token extraction.
- Directus loads `$pi-browser-harness` before the operating loop, inherits disconnect recovery, and keeps screenshots visual-only.
- Runtime guidance still defaults to read-only for Directus API access. Exact delete requests and schema/permission/flow confirmation gates remain intact; an exact unambiguous change instruction needs no repeated approval.
- Changed Markdown links and anchors resolve. Do not connect to Directus or call browser tools during static maintenance validation; live checks require separate authorization.
- Schema API mutation guidance requires explicit approval, live `/server/specs/oas` inspection, and idempotent/additive defaults.
- `references/official-sources.md` reflects any official Directus source changes used in the update.
- Changed reference files have current `Last reviewed` dates.
