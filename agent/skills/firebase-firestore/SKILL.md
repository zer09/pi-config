---
name: firebase-firestore
description: "Design Cloud Firestore models, client queries, rules, and indexes; inspect databases or provision an explicitly requested database. Use for Firestore implementation and database operations. Use firebase-security-rules-auditor for rules audits."
---

# Cloud Firestore Database and Operations

## Hosted service safety

- Read-only inspection, local code/config edits, and emulation are allowed within the requested task. Database creation, data writes, rule/index deployment, deletion, and other hosted mutations require explicit user instruction for that exact action.
- A missing database is not permission to create one. Code, rules, modeling, and read-only tasks can finish without provisioning or deployment.
- Never print, save, or commit credentials, tokens, service account keys, or private keys.

## Target and edition

Inspect `firebase.json`, `.firebaserc`, SDK initialization, and existing rules/indexes first. For guidance where edition does not affect the answer, state assumptions and continue without live CLI discovery.

When the live target or edition affects provisioning, rules, indexes, or query behavior, identify the project, database ID, edition, and relevant access mode from existing configuration and, when needed, read-only CLI metadata. Ask only if the material choice remains ambiguous. Use the project's available Firebase CLI; do not install or upgrade it just for discovery.

```bash
firebase firestore:databases:list --project <project-id>
firebase firestore:databases:get <database-id> --project <project-id>
```

Route by the reported `STANDARD` or `ENTERPRISE` edition. Native access mode alone does not establish the edition. The Enterprise references below cover native access; verify support before applying them to another access mode.

If no database exists, report that finding and continue the authorized local task. Only after an explicit database-creation request, establish the database ID, edition, access mode, and location as a separate provisioning decision. Do not default to Enterprise. Use `firebase firestore:locations --project <project-id>` when location options are needed, then follow the selected provisioning reference.

## Selected references

Load only the task and edition references needed:

| Task | Standard edition | Enterprise edition with native access |
| --- | --- | --- |
| Local setup or explicitly authorized provisioning | [Provisioning](references/standard/provisioning.md) | [Provisioning](references/enterprise/provisioning.md) |
| Security Rules | [Rules](references/standard/security_rules.md) | [Rules](references/enterprise/security_rules.md) |
| Data model | Existing project model and SDK guide | [Data model](references/enterprise/data_model.md) |
| Client SDK | [Web](references/standard/web_sdk_usage.md), [Android](references/standard/android_sdk_usage.md), [iOS](references/standard/ios_setup.md), [Flutter](references/standard/flutter_setup.md) | [Web](references/enterprise/web_sdk_usage.md), [Python](references/enterprise/python_sdk_usage.md), [Android](references/enterprise/android_sdk_usage.md), [iOS](references/enterprise/ios_setup.md), [Flutter](references/enterprise/flutter_setup.md) |
| Indexes | [Indexes](references/standard/indexes.md) | [Indexes](references/enterprise/indexes.md) |

## Validation and completion

For code changes, run the relevant available project checks. For rules, test allowed and denied paths with local rules tests or supported emulation. For indexes, validate config and query compatibility; emulator success does not prove production index behavior or edition parity. Do not deploy as a validation shortcut.

Finish with the requested guidance or local changes, checks and results, target/edition assumptions, and any unverified behavior. Fix failures caused by the change within scope. Report missing evidence or tooling without provisioning a service to unblock local work.

## Maintenance

For future updates, read the [Firebase skills update process](../../../docs/skills/firebase-skills-update-process.md).
