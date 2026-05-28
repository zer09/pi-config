---
name: firebase-basics
description: Provides foundational setup, authentication, and project management workflows for Firebase using the Firebase CLI. Use when checking Firebase CLI version, initializing a Firebase environment, authenticating, setting active projects, or setting up google-services.json or GoogleService-Info.plist files.
---

# Firebase Basics

Use this skill for Firebase CLI setup, project selection, local initialization, app config files, and cross-product setup routing.

## Hosted service safety

- Read-only project inspection, local code edits, local config edits, and emulator use are allowed.
- Project creation, service enablement, deploys, database creation, rule publishing, data writes, billing/quota changes, credential rotation, and other hosted mutations require exact user instruction.
- `firebase login`, `firebase logout`, and active project changes alter local state. Run them only when the user asks or agrees.
- Never print or commit tokens, service account JSON, private keys, OAuth credentials, or user-specific credential paths.

## Workflow

1. Inspect the project before initializing: existing `firebase.json`, `.firebaserc`, app config files, package scripts, platform folders, and emulator config.
2. Verify CLI state with read-only commands:

```bash
firebase --version
firebase login:list
firebase projects:list
firebase use
```

3. Load references only as needed:
   - [local environment setup](references/local-env-setup.md)
   - [Firebase CLI guide](references/firebase-cli-guide.md)
   - [service initialization](references/firebase-service-init.md)
   - [Web setup](references/web_setup.md), [Android setup](references/android_setup.md), [iOS setup](references/ios_setup.md), [Flutter setup](references/flutter_setup.md)
   - Agent setup/refresh guides under `references/setup/` and `references/refresh/`
4. Initialize only the products needed by the current task. Do not add hosting, functions, Firestore, Auth, or other products just because `firebase init` offers them.
5. After local config changes, run the narrowest validation available: build, lint, emulator checks, rules tests, or CLI dry runs.

## Routing reminders

- Use `firebase-auth-basics` for Authentication flows.
- Use `firebase-firestore` for Firestore databases, rules, queries, and indexes.
- Use `firebase-hosting-basics` for Hosting Classic.
- Use `firebase-app-hosting-basics` for App Hosting.
- Use `firebase-data-connect` for Data Connect / SQL Connect.
- Use `firebase-ai-logic-basics` for Firebase AI Logic and Gemini client SDK work.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
