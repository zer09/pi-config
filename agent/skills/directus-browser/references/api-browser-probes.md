# Directus browser-context API probes

Last reviewed: 2026-09-30
Sources: `official-sources.md` -> API docs, security docs, and Directus 12 breaking changes.

Use this for read-only inspection through the logged-in browser session. Default to UI-first operation for mutations.

## Allowed by default

After the root's per-task Browser Harness gate, use same-origin, logged-in, read-only `GET` requests from `browser_execute_js` with `credentials: "include"`. A GET that triggers a flow is not a read-only probe.

If a probe returns 401/403, fall back to Studio UI. Do not extract tokens from cookies, localStorage, or sessionStorage. Directus 12.4+ can return `COLLECTION_INACTIVE` (403) for inactive collections; do not treat denied access as a missing resource or reactivate it without an exact request.

## Generic helper

```js
return await (async () => {
  const path = '/server/info';
  const response = await fetch(path, { credentials: 'include' });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { path, ok: response.ok, status: response.status, body };
})();
```

## Common read probes

- `/server/info` — server/project info available to current user.
- `/server/specs/oas` — OpenAPI spec for the current project/user permissions; required before schema API writes.
- `/users/me` — current authenticated user.
- `/permissions/me` — current user's effective permissions by collection/action.
- `/collections` — collection metadata.
- `/fields` or `/fields/{collection}` — field metadata.
- `/relations` — relation metadata.
- `/items/{collection}?limit=10` — sample items in a collection.
- `/files?limit=10` — sample file metadata.
- `/flows?limit=10` — flows visible to current user.
- `/roles` — roles, if allowed.
- `/policies` — policies, if allowed.
- `/permissions` — permission rules, if allowed.

## Probe design

- Keep limits low unless the user asks for bulk reads.
- Request only fields needed for the task when possible.
- Avoid reading sensitive collections unless the user asked for them.
- Treat `null` field values in API results as either real data or restricted-by-permissions.
- Do not persist API responses containing private data into repo files.

## Mutation gate

Do not perform API writes (`POST`, `PATCH`, `DELETE`) unless the user explicitly authorizes API-based mutation for the endpoint/action and payload shape. For schema writes, also ask whether to use Studio UI or authenticated API first; if API is chosen, use `schema-api-mutations.md`.

For authorized API writes:

1. Show the endpoint/action and payload shape before execution.
2. Prefer a small/single-record operation before any bulk operation.
3. Verify via fresh read, network response, or UI state.
4. Do not expose tokens or cookies in logs, docs, or final answers.
