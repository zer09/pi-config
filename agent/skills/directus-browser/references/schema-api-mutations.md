# Directus schema API mutations

Last reviewed: 2026-07-09
Sources: `official-sources.md` -> Schema/API docs; local finding `findings/directus-schema-api-update-guide-2026-07-09.md` distilled with project-specific hosts/paths removed.

Use this only when the user explicitly authorizes Directus schema writes. Default Directus operation remains read-only/UI-first.

## Required method choice

For any schema update request, ask which write path to use unless the user already specified it:

- Studio UI: safer for small/manual changes because warnings and validation are visible.
- Authenticated API from browser context: better for repeatable/idempotent additive changes, but higher risk and requires explicit approval.

Do not perform schema writes by UI or API until the method is chosen and the target environment/scope are clear.

## Pre-write gate

Before any schema mutation, confirm:

1. Target environment and Directus URL/origin.
2. Write method: Studio UI or authenticated API.
3. Whether content/data migration is in scope; schema and content are separate.
4. Whether the change is additive/nullable or destructive.
5. Exact collection and field names; never infer singular/plural names.

Ask again before destructive changes: deleting fields/collections/relations, changing field types, making fields required, changing existing permissions, or removing M2A allowed collections.

Safe default: additive nullable schema only.

## Required live inspection

Before API writes, inspect the live instance:

```js
await fetch('/server/info', { credentials: 'include' });
await fetch('/server/specs/oas', { credentials: 'include' });
await fetch('/collections?limit=-1', { credentials: 'include' });
await fetch('/fields?limit=-1', { credentials: 'include' });
await fetch('/relations?limit=-1', { credentials: 'include' });
await fetch('/permissions?limit=-1&fields=*', { credentials: 'include' });
```

Verify Directus version, endpoint availability, current schema, exact collection names, comparable collection patterns, and permission patterns. Use `/server/specs/oas` as the target-instance source of truth for payload/route shape.

Relation retrieve/update routes vary across docs, SDK helpers, and observed Directus 11 instances. Prefer the live OAS and/or a harmless read probe before hardcoding relation paths.

## Browser execution guidance

- Use `browser_execute_js` with bounded async IIFEs for concise schema operations.
- Split longer workflows into small chunks; large one-shot `Runtime.evaluate` calls can timeout.
- Use `browser_run_script` only for reviewed, repetitive workflows after explicit authorization.
- If using `browser_run_script`, the daemon helper is `daemon.evaluateJs`.
- Never print cookies, access tokens, refresh tokens, or secret environment values.

## Idempotent helpers

Use helpers that parse errors and check existence before writes:

```js
async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  if (!response.ok) {
    const message = parsed?.errors?.map?.((e) => e.message).join('; ') || parsed?.message || text || response.statusText;
    throw new Error(`${method} ${path} failed (${response.status}): ${message}`);
  }

  return parsed;
}

async function getMaybe(path) {
  const response = await fetch(path, { credentials: 'include' });
  if (response.status === 404 || response.status === 403) return null;
  const json = await response.json();
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status})`);
  return json.data ?? json;
}
```

Idempotency rules:

- Check `GET /collections/<collection>` before `POST /collections`.
- Check `GET /fields/<collection>` or `GET /fields/<collection>/<field>` before `POST /fields/<collection>`.
- Check existing `/relations` before `POST /relations`.
- When patching arrays, append missing values; never replace existing arrays with only new values.
- When copying permissions, check for an existing `(collection, action, policy)` row before `POST /permissions`.

## Schema mutation order

1. Create collections, including primary key fields where practical.
2. Add physical fields before relation metadata.
3. Create relation columns/foreign-key fields on the many side.
4. Create relation metadata.
5. Create alias fields explicitly when the API does not expose them automatically.
6. Patch project-specific allow-lists/interface options, such as page-builder M2A fields.
7. Copy or create permissions from comparable collections.
8. Verify authenticated schema metadata.
9. Verify public/runtime access separately when public rendering depends on it.

## Collection and field patterns

Official API endpoints:

- `POST /collections` creates collections.
- `PATCH /collections/{collection}` updates collection metadata only; collection renames are not supported.
- `POST /fields/{collection}` creates fields.
- `PATCH /fields/{collection}/{field}` updates fields.
- `DELETE /fields/{collection}/{field}` is irreversible and requires explicit deletion approval.

Prefer nullable additions to existing collections unless the user explicitly approves required-field migration.

## Relations and aliases

Official API endpoints include:

- `GET /relations`
- `POST /relations`
- `PATCH /relations/{id}` or the live-instance equivalent
- `DELETE /relations/{id}` or the live-instance equivalent

For relation work:

- Create the many-side physical relation field before relation metadata.
- M2M generally needs a junction collection plus two foreign-key fields and optional sort field.
- O2M alias fields are virtual and may need explicit alias field creation.
- M2A/page-builder structures often need extra allow-list metadata beyond base relations.

Alias examples:

- M2M alias: `type: 'alias'`, `special: ['m2m']`, `interface: 'list-m2m'`.
- O2M alias: `type: 'alias'`, `special: ['o2m']`, `interface: 'list-o2m'`.

## Page-builder M2A warning

When a project uses a Directus page-builder M2A field, adding a new block collection may require two patches:

1. Relation metadata allow-list, commonly `one_allowed_collections` on the junction item relation.
2. Studio field interface options, commonly `allowedCollections` and `allowedCollectionsForExisting` on the page field.

If only one side is patched, the API or Studio UI may still reject or hide the new block.

Always read the existing page-builder relation and field options first, append the new collection, and preserve all existing allowed collections.

## Permissions

Do not invent broad permissions from scratch. Prefer copying from a comparable existing collection with the same access pattern.

Permission workflow:

1. Fetch permissions with `/permissions?limit=-1&fields=*`.
2. Identify comparable public read and editor/admin CRUD permission rows.
3. For each new collection, create only missing rows matching the comparable policy/action pattern.
4. Avoid changing existing permissions unless explicitly requested.
5. Treat Public role read access as high risk and verify item/field rules.

## Verification

Authenticated schema verification:

- collections exist;
- fields exist and are nullable/required as intended;
- relations exist;
- alias fields have expected `special`/`interface`;
- M2A/page-builder relation and field options include the new collection;
- permission rows exist for new collections/fields.

Public/runtime verification:

Use unauthenticated requests outside the logged-in browser session when public page rendering depends on public reads. `browser_http_get` is useful because it does not inherit the browser session.

Expected for empty public-readable collections: HTTP 200 with `{"data":[]}`.

A correct authenticated schema can still fail at runtime if public read permissions are missing.
