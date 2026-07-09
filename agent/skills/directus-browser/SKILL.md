---
name: directus-browser
description: "Operate Directus Studio through pi-browser-harness instead of Directus MCP/API credentials. Use when asked to access, inspect, automate, or manage a Directus instance in the browser: content/items, files/assets, data model collections/fields/relationships, users, roles, policies/permissions/access control, flows/automation, AI/MCP settings, or Directus Studio troubleshooting. Loads Directus-specific navigation, safety, UI, read-only API, and script-execution guidance."
---

# Directus Browser

Use `pi-browser-harness` as a browser-operated Directus Studio driver. This skill supplies the Directus Studio mental model; the browser snapshot supplies the exact current UI.

For schema, permissions, flows, API/script use, or uncertain navigation, read `references/directus-studio.md` first, then the specific referenced file (`data-model.md`, `access-control.md`, `flows.md`, `api-browser-probes.md`, or `security.md`).

## Operating loop

1. Open the Directus URL. If unknown, ask for it.
2. If login is required, stop and ask the user to log in manually in the browser.
3. Use `browser_snapshot` first for page structure and clickable coordinates.
4. Navigate by visible labels and Directus concepts, not brittle selectors or stored coordinates.
5. Use `browser_execute_js` for precise DOM/form/table reads. Prefer Directus field data attributes when present: `data-collection`, `data-field`, `data-primary-key`.
6. After a save or a failed action, inspect `browser_network_requests`; use `browser_console` only when the UI appears broken.
7. Verify changes via saved UI state, network response, or a fresh read.
8. Use screenshots only for visual/layout confirmation.

## Directus task routing

- Content/item work -> **Content** module -> collection -> item page.
- File/assets work -> **Files** module; file metadata lives in `directus_files`; assets are served from `/assets/<file-id>`.
- Collection/field/relationship work -> **Settings -> Data Model**.
- User/token work -> **User Directory** / `directus_users`.
- Permission work -> **Settings -> Access Control / Roles / Policies**.
- Automation work -> **Flows**; treat flows as high-risk because they can run arbitrary/elevated operations.
- AI/MCP settings -> **Settings -> AI -> Model Context Protocol** when available.

## Directus vocabulary

- Collection = database table/content type.
- Item = row/record in a collection.
- Field = database column plus Directus metadata.
- Interface = Studio input/editing control for a field.
- Display = Studio rendering for a field value.
- Relationship types: M2O, O2M, M2M, M2A, Translations.
- Policy = composable set of permissions assigned to users/roles.
- Permission = collection + action rule (`create`, `read`, `update`, `delete`, `share`) with optional item/field rules, validation, and presets.

## API and script policy

Default to UI-first operation for mutations.

Allowed by default:

- Small `browser_execute_js` snippets for DOM reads.
- Same-origin, logged-in, read-only Directus `GET` requests from the browser context using `credentials: "include"`.

Example read:

```js
return await (async () => {
  const response = await fetch('/collections', { credentials: 'include' });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json().catch(() => null),
  };
})();
```

Useful read endpoints: `/server/info`, `/users/me`, `/permissions/me`, `/collections`, `/fields`, `/relations`, `/items/{collection}?limit=10`, `/files`, `/flows`, `/roles`, `/policies`, `/permissions`.

Do not by default:

- Extract tokens from cookies, localStorage, or sessionStorage.
- Ask the user for static tokens unless they explicitly choose token/API access.
- Perform API writes (`POST`, `PATCH`, `DELETE`).
- Use `browser_run_script` for mutations or bulk changes.

Use `browser_run_script` only for repetitive/bulk workflows, preferably read-only. For any API write or script mutation, require explicit user authorization for the endpoint/action and payload shape.

## Safety rules

- Default to read-only unless the user clearly asks for a change.
- Never delete items, files, fields, collections, relations, users, roles, policies, permissions, or flows unless explicitly asked for that deletion.
- Before schema, permission, or flow changes, state the intended change and get confirmation unless the user already gave an exact, unambiguous instruction.
- Treat collection names, primary key strategy, field keys, and field types as effectively irreversible/immutable after creation; confirm them before creating.
- Treat Public role permissions as dangerous: enabling public read can expose data to unauthenticated users.
- Do not save, commit, paste, or expose Directus passwords/tokens.

## Maintenance

Update this custom local skill through `docs/skills/directus-browser-update-process.md`; preserve the browser-first safety gates and read-only API defaults.
