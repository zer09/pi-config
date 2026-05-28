---
name: firebase-app-hosting-basics
description: Deploy and manage web apps with Firebase App Hosting. Use this skill when deploying Next.js/Angular apps with backends.
---

# Firebase App Hosting Basics

Use Firebase App Hosting for framework-backed web apps such as Next.js or Angular. Do not confuse it with Firebase Hosting Classic.

## Hosted service safety

- Reads, local config edits, local builds, and emulation are allowed.
- Creating backends, connecting repos, changing rollout settings, setting secrets, changing service accounts, enabling services, upgrading billing plans, or deploying requires exact user instruction.
- Confirm the Firebase project, backend ID, region, branch, and rollout target before any hosted mutation.
- Never print or commit secret values. Refer to Firebase secrets and environment variables by name only.

## Workflow

1. Determine whether the app needs App Hosting or Hosting Classic. Use App Hosting for supported full-stack frameworks and server backends; use `firebase-hosting-basics` for static sites, SPAs, and simple hosting.
2. Before backend or deploy guidance, verify the Firebase project is already on the Blaze plan. App Hosting requires Blaze; if the project is on Spark or the billing plan is unknown, stop at a checklist and do not propose enabling billing unless the user explicitly asks.
3. Inspect existing files before editing: `firebase.json`, `.firebaserc`, app hosting config files, package scripts, and framework config.
4. Load references only as needed:
   - [configuration](references/configuration.md)
   - [cli commands](references/cli_commands.md)
   - [emulation](references/emulation.md)
5. Use `firebase --help` and specific colon-form subcommand help, such as `firebase apphosting:backends:list --help`, for exact flags before syntax-sensitive guidance.
6. Validate locally with the project build, framework checks, and App Hosting emulator guidance when possible.
7. For deploy or backend changes, provide a dry-run/checklist first unless the user explicitly requested the exact command.

## Command reminders

```bash
firebase --version
firebase --help
firebase apphosting:backends:list --help
firebase apphosting:backends:list --project <project-id>
firebase emulators:start --only apphosting
```

Verify each command against installed Firebase CLI help before running it.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
