---
name: firebase-data-connect
description: "Build Firebase Data Connect / SQL Connect schemas, authorized operations, realtime updates, and generated SDK integrations. Use for implementation or configuration of this Firebase product, not general PostgreSQL work."
---

# Firebase SQL Connect

Firebase Data Connect was renamed to **Firebase SQL Connect**. Both names in these references identify the same product. Keep the local skill folder `firebase-data-connect` and the product's `dataconnect/` configuration paths.

## Hosted service safety

- Reads, local edits, emulation, compilation, and SDK generation are allowed within the requested local task. Deploys, Cloud SQL migrations, database/data writes, Firebase project mutations, service enablement, and other hosted mutations require explicit user instruction for the exact action and target.
- Initialization is not blanket provisioning permission. Inspect existing configuration first; keep an authorized local init local. Stop before prompts that create hosted resources, enable services, or change project state without exact authorization. Login and active-project changes also require the user's request or agreement.
- Never print, save, or commit credentials, tokens, service account keys, or private keys. Configure test clients for the local emulator rather than a live backend.

## Operation strategy

Prefer operations built from the generated GraphQL schema for schema enforcement and type-safe SDKs. Use Native SQL when a required database feature is not expressible through those operations, such as PostGIS, window functions, or specialized aggregations. Technical need is sufficient; the user need not explicitly say “Native SQL.”

Native SQL returns generic `Any` shapes for selection operations. Validate those results at the application boundary and preserve operation authorization. Follow the parameter, identifier, and statement restrictions in [Native SQL](reference/native_sql.md).

## Selected workflow and references

Inspect `firebase.json`, `.firebaserc`, `dataconnect.yaml`, `connector.yaml`, schemas, operations, and generated SDK configuration for the task. Match the available project CLI/version rather than installing or upgrading tooling automatically. Load only the relevant references:

| Task | Reference |
| --- | --- |
| Tables, columns, relationships, types | [Schema](reference/schema.md) |
| CRUD, filters, pagination, upserts, transactions | [Operations](reference/operations.md) |
| Operation authorization, row checks, redaction | [Security](reference/security.md) |
| Polling, event-driven refresh, subscriptions | [Realtime](reference/realtime.md) |
| PostgreSQL-specific operations | [Native SQL](reference/native_sql.md) |
| Vector and full-text search | [Advanced features](reference/advanced.md) |
| Local layout, YAML, init, emulation, or explicitly authorized deployment | [Configuration and CLI](reference/config.md) |
| Generated client integration | [Web](reference/sdk_web.md), [Android](reference/sdk_android.md), [iOS](reference/sdk_ios.md), [Flutter](reference/sdk_flutter.md), [Admin Node](reference/sdk_admin_node.md) |
| Complete schemas and reusable patterns | [Examples](examples.md), [Templates](templates.md) |

## Local validation and completion

Review affected user-defined and generated schemas, including `.dataconnect/schema/main/`. Use the project's available Firebase CLI for local checks:

```bash
firebase dataconnect:compile
firebase dataconnect:sdk:generate
```

Compile affected schemas/operations; regenerate affected SDKs and run relevant application checks. Test authorization and operation behavior against local emulation where available. A production operation change needs coordinated publication, but local implementation does not authorize deployment.

Finish with the requested local deliverable, validation results, and any compatibility assumptions or blocked checks. Fix failures caused by the change within scope. Report any required future hosted action separately; do not execute it without exact authorization.

## Maintenance

For future updates, read the [Firebase skills update process](../../../docs/skills/firebase-skills-update-process.md).
