---
name: firebase-hosting-basics
description: Skill for working with Firebase Hosting (Classic). Use this when you want to deploy static web apps, Single Page Apps (SPAs), or simple microservices. Do NOT use for Firebase App Hosting.
---

# Firebase Hosting Basics

Use Firebase Hosting Classic for static sites, SPAs, and simple microservices. For framework-backed App Hosting, use `firebase-app-hosting-basics` instead.

## Hosted service safety

- Local config edits, builds, emulator use, and read-only inspection are allowed.
- Deploys, site creation, target changes, channel creation, rewrites to live services, custom domain changes, and rollback actions require exact user instruction.
- Confirm the Firebase project, hosting site, deploy target, channel, and public/build directory before any hosted mutation.
- Never print or commit credentials, tokens, service account JSON, or secret env values.

## Workflow

1. Inspect existing `firebase.json`, `.firebaserc`, build output directories, package scripts, and hosting targets.
2. Load the smallest relevant reference:
   - [configuration](references/configuration.md)
   - [deploying](references/deploying.md)
3. Verify installed Firebase CLI help for exact flags:

```bash
firebase --help
firebase hosting:sites:list --help
firebase hosting:sites:list --project <project-id>
firebase emulators:start --only hosting
```

4. Validate local builds and Hosting emulator behavior before drafting deploy commands.
5. For deploys, prefer a checklist or command draft first unless the user already asked for the exact deploy target.

## Configuration reminders

- Keep Hosting Classic and App Hosting configuration separate.
- Check rewrites, redirects, headers, cache settings, and SPA fallback behavior before deploy.
- Do not change production targets or custom domains as part of unrelated code work.
- Keep emulator logs, deploy output, and CLI help bounded; capture only relevant excerpts or save verbose output to temp files.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
