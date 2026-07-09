# Directus access-control reference

Last reviewed: 2026-07-09
Sources: `official-sources.md` -> Access-control docs.

Use this for users, roles, policies, permissions, app/admin access, public access, and access-control API reads.

## Concepts

- User = item in `directus_users`; can represent a person, app, or service.
- Role = organizational grouping for users; roles can have policies and child roles.
- Policy = composable set of permissions assigned to users and/or roles.
- Permission = collection + action (`create`, `read`, `update`, `delete`, `share`) plus optional item rules, fields, validation, and presets.

## Permission behavior

- Directus starts users with no permissions; policies add permissions.
- Multiple policies are additive for access. Additional policies can expand field/item access.
- Item permissions use filter rules for row-level access.
- Field permissions restrict visible/writable fields per action.
- Field validation can validate values for create/update.
- Field presets can set default values for create/update.
- API responses omit or null restricted fields; treat `null` as possible real data or permission masking.

## Roles and policies

- Administrator role/policy access is unrestricted by design and cannot be partially limited.
- Policy App Access controls whether users can access the Studio.
- Policy Admin Access grants project-wide admin ability.
- Policy IP access allowlists are subtractive: if the request IP does not match, that policy is excluded.
- For Studio-only billing/licensing contexts, users with App Access or Admin Access can count as Studio users.

## Public role warning

The Public role applies to unauthenticated API requests.

Granting public collection read can expose readable items to anyone, including bots. If public access is required, prefer custom item/field rules and verify that unpublished/private content is excluded.

## Permission-change checklist

Before changing access control, state:

- target user, role, or policy;
- target collection and action;
- access level (`none`, `full`, or custom);
- item filter/rule;
- field list;
- validation and presets;
- whether App Access or Admin Access changes;
- whether Public role or unauthenticated access is affected.

## API endpoints useful for read-only inspection

Use only as browser-context GET probes unless the user explicitly authorizes API writes:

- `/users/me` — current user.
- `/permissions/me` — effective current-user permissions by collection/action.
- `/permissions/me/{collection}/{id}` — current-user permissions for a specific item.
- `/roles` — role metadata, if allowed.
- `/policies` — policy metadata, if allowed.
- `/permissions` — permission rules, if allowed.
