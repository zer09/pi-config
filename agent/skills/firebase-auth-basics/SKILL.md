---
name: firebase-auth-basics
description: Guide for setting up and using Firebase Authentication. Use when an app requires user sign-in, user management, or secure data access using auth rules.
---

# Firebase Auth Basics

Use Firebase Authentication for sign-in, user identity, provider setup, user management, and auth-backed security rules.

## Hosted service safety

- Local code edits, emulator use, and read-only inspection are allowed.
- Enabling providers, changing authorized domains, creating/updating/deleting users, setting custom claims, deploying rules, or changing production auth settings requires exact user instruction.
- Never print or commit credentials, OAuth client secrets, service account keys, password values, or refresh tokens.
- Treat custom claims and admin SDK actions as privileged writes. Confirm target user IDs and environments before drafting commands.

## Workflow

1. Identify the platform, sign-in providers, and whether this is client SDK, Admin SDK, emulator, or rules work.
2. Verify existing Firebase app initialization and project selection. Use `firebase-basics` if setup is unclear.
3. Load the smallest relevant reference:
   - [Web client SDK](references/client_sdk_web.md)
   - [Android client SDK](references/client_sdk_android.md)
   - [Flutter setup](references/flutter_setup.md)
   - [Security rules](references/security_rules.md)
4. Add only the auth flows needed: sign-in, sign-out, auth state listener, token refresh, route guards, or user profile handling.
5. When security rules depend on auth, validate both unauthenticated and authenticated paths. Use `firebase-security-rules-auditor` after editing Firestore rules.
6. Prefer Firebase Auth emulator for tests and local verification.

## Implementation reminders

- Keep provider configuration and redirect domains out of source when they are environment-specific.
- Handle loading, signed-out, disabled-user, provider-linking, token-expired, and permission-denied states explicitly.
- Do not assume client claims are trusted until verified by Firebase Auth or Security Rules.
- Use Context Mode for long emulator logs, rules test output, or generated SDK docs.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
