---
name: firebase-auth-basics
description: "Implement Firebase Authentication app sign-in, provider integration, user management, and auth-backed access rules. Not Firebase CLI login or project selection."
---

# Firebase Auth Basics

Use Firebase Authentication for sign-in, user identity, provider setup, user management, and auth-backed security rules.

## Hosted service safety

- Local code edits, emulator use, and read-only inspection are allowed within the requested task. Client SDK setup does not require CLI installation, CLI initialization, provisioning, or live authentication.
- Enabling providers, changing authorized domains, creating/updating/deleting users, setting custom claims, deploying rules, or changing auth settings requires explicit user instruction for the exact action and target project/environment. Do not run live sign-in, send email/SMS, or create users as a validation shortcut.
- Never print, save, or commit credentials, OAuth client secrets, service account keys, password values, or refresh tokens.
- Treat custom claims and admin SDK actions as privileged writes. Confirm target user IDs and environments before drafting commands.

## Selected workflow

Inspect existing app initialization, config, dependencies, platform, and requested providers first. Use `firebase-basics` only for missing app configuration or requested CLI login/project setup, not as a prerequisite for auth code. Local work can proceed without live account/project discovery; ask only when missing identity or authority affects the requested action.

Load only the relevant reference:

- [Web client SDK](references/client_sdk_web.md)
- [Android client SDK](references/client_sdk_android.md)
- [iOS client SDK](references/ios_setup.md)
- [Flutter setup](references/flutter_setup.md)
- [Auth-backed Firestore rules](references/security_rules.md)

Implement only the requested flows. Route Firestore rules audit intent to `firebase-security-rules-auditor`; its review is read-only and does not authorize fixes, live bypass tests, or deployment.

## Implementation reminders

- Keep provider configuration and redirect domains out of source when they are environment-specific.
- Handle loading, signed-out, disabled-user, provider-linking, token-expired, and permission-denied states explicitly.
- Do not assume client claims are trusted until verified by Firebase Auth or Security Rules.
- Keep emulator logs, rules test output, and generated SDK docs bounded; capture only relevant excerpts or save verbose output to temp files.

## Validation and completion

Run relevant available project checks with mocks or an already configured Auth emulator. Test signed-out, signed-in, wrong-user, and permission-denied paths when affected. Do not install tools, sign in live, enable providers, or deploy to make a local check pass.

Finish with the requested guidance or local changes, checks/results, target assumptions, and deferred hosted setup. Fix failures caused by the change within scope. Stop the affected action when authority, target identity, or required tooling is missing; report the limit without blocking unrelated authorized local work.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
