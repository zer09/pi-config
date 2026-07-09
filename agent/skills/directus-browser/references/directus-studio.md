# Directus Studio reference index

Last reviewed: 2026-07-09

Use this index first when operating Directus through `pi-browser-harness`. Then load the smallest reference needed for the task.

## Reference map

- Schema/modeling tasks: `data-model.md`
- Explicitly approved schema API mutations: `schema-api-mutations.md`
- Content records, collection pages, files, and assets: `content-and-files.md`
- Users, roles, policies, permissions, and public access: `access-control.md`
- Flows and automation: `flows.md`
- Browser-context Directus API reads: `api-browser-probes.md`
- Token, script, mutation, and AI/browser safety gates: `security.md`
- Official source URL inventory and refresh rules: `official-sources.md`

## Studio navigation model

Directus Studio is module-based. Use `browser_snapshot` to identify current labels because exact labels vary by Directus version, permissions, custom modules, and project configuration.

| Intent | Studio area | Reference |
| --- | --- | --- |
| Browse/create/update records | Content module -> collection page -> item page | `content-and-files.md` |
| Filter/search/list items | Content module -> collection page header controls | `content-and-files.md` |
| Upload/manage assets | Files module | `content-and-files.md` |
| Configure collections/fields/relationships in UI | Settings -> Data Model | `data-model.md` |
| Configure collections/fields/relationships by API | Ask UI vs API first; then use browser-context API if approved | `schema-api-mutations.md` |
| Manage users and tokens | User Directory / users module | `access-control.md`, `security.md` |
| Manage roles/policies/permissions | Settings -> Access Control / Roles / Policies | `access-control.md` |
| Manage automations | Flows | `flows.md` |
| Inspect MCP if present | Settings -> AI -> Model Context Protocol | `security.md`, `official-sources.md` |

## Browser navigation rules

- Navigate by visible labels and Directus concepts, not stored coordinates or brittle CSS classes.
- Prefer `browser_snapshot` for page structure and click targets.
- Prefer `browser_execute_js` for exact form/table/DOM values.
- Prefer Directus field data attributes when present: `data-collection`, `data-field`, `data-primary-key`.
- After saves/failures, check network responses before guessing.
- Fall back to the Studio UI when browser-context API probes return 401/403.
