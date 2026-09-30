---
name: firebase-basics
description: "Configure Firebase CLI login, project selection, local initialization, and app config files. Use for CLI setup or google-services.json / GoogleService-Info.plist configuration, not application user sign-in; use firebase-auth-basics for app authentication."
---

# Firebase Basics

Use this skill for Firebase CLI setup and login, project selection, local initialization, app config files, and cross-product setup routing. Authentication here means CLI login, not application user sign-in.

## Hosted service safety

- Read-only project inspection, local code edits, local config edits, and emulator use are allowed.
- Project creation, app registration, service enablement, deploys, database creation, rule publishing, data writes, billing/quota changes, credential rotation, and other hosted mutations require exact user instruction for the action and target.
- `firebase login`, `firebase logout`, and active project changes alter local state. Run them only when the user asks or agrees.
- Never print or commit tokens, service account JSON, private keys, OAuth credentials, or user-specific credential paths.

## Select the task

- Inspect existing `firebase.json`, `.firebaserc`, app config files, package scripts, and platform folders before choosing setup actions. Reuse the configured project and app identities.
- Dependency-only and existing-config tasks do not require CLI authentication, CLI download/install, initialization, or live account/project inspection. Read-only discovery is optional when the requested task needs remote facts, not a prerequisite for local maintenance.
- Use the installed or repository-pinned CLI only when needed. Resolve repository scripts/local binaries without an auto-downloading runner; ask before download/install. Prefer an explicit `--project <PROJECT_ID>` over changing the active project.
- Load only the relevant reference before its setup work:
  - [Local environment and optional agent tooling](references/local-env-setup.md)
  - [CLI help and command selection](references/firebase-cli-guide.md)
  - [Selective service initialization](references/firebase-service-init.md)
  - [Web](references/web_setup.md), [Android](references/android_setup.md), [iOS](references/ios_setup.md), or [Flutter](references/flutter_setup.md)
- Initialize only the exact requested product and identified project. A local setup request does not authorize project creation, app registration, or service enablement. Stop before unapproved hosted prompts.
- Agent setup/refresh guides under `references/setup/` and `references/refresh/` apply only to separately requested agent tooling changes. Read the local-environment gate first; do not automatically install a full skill suite, CLI, plugin, or MCP server.

## Completion

Complete the requested local files and run the narrowest available project checks. Fix failures caused by the change. Do not deploy as validation or install missing tooling to make a check pass. Emulator checks can require downloads or live services; use existing offline checks where possible. Report missing tools, unrun checks, and separately gated hosted setup as deferred.

## Routing reminders

- Use `firebase-auth-basics` for application user sign-in and Firebase Authentication flows.
- Use `firebase-firestore` for Firestore databases, rules, queries, and indexes.
- Use `firebase-hosting-basics` for Hosting Classic.
- Use `firebase-app-hosting-basics` for App Hosting.
- Use `firebase-data-connect` for Data Connect / SQL Connect.
- Use `firebase-ai-logic-basics` for Firebase AI Logic and Gemini client SDK work.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
