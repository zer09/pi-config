# Firebase CLI Help

Use the installed or repository-pinned Firebase CLI only when needed. Resolve a repository pin through an existing script or local binary; do not use an auto-downloading runner. If the CLI is absent, report it and ask before download/install. Examples below use `firebase` for the selected executable.

Dependency-only and existing-config tasks do not require CLI authentication or live account/project inspection. Help does not need login or a selected project.

## Discover only the needed commands

Firebase CLI 15.32.0 uses grouped help. Root help lists namespaces; expand the relevant namespace, then the leaf command:

```bash
firebase --version
firebase --help
firebase apps --help
firebase apps:sdkconfig --help
```

`firebase projects --help` similarly lists project commands. Keep the colon in leaf names, such as `apps:sdkconfig`, rather than treating them as space-separated subcommands. Check the selected CLI's help because a repository pin can differ from the global version.

## Setup command details

- Global `--project <alias_or_project_id>` selects a project for that invocation without changing the active project. Prefer the known project ID when an alias is ambiguous.
- `apps:sdkconfig [platform] [appId]` accepts `ANDROID`, `IOS`, or `WEB` case-insensitively. Supply the intended App ID and project instead of triggering interactive app discovery. Optional `--out <file>` writes config to the chosen local path; preserve existing files.
- `apps:create` takes a platform and optional display name. Android uses `--package-name`; iOS uses `--bundle-id`. These are not substitutes for the Firebase App ID used by config retrieval.
- `login --no-localhost` is for an authorized login without local browser access. Login, logout, and active-project changes require user request or agreement.

Help describes capabilities, not permission to execute them. Project creation, app registration, and service enablement need separate explicit authorization for the exact action and target. Local initialization needs the exact requested product and project; use the gated platform or [service reference](firebase-service-init.md). Never deploy as validation.

The CLI can initialize config storage, logs, and update checks even for help/version. For offline maintenance proofs, inspect startup and use the network/credential/config isolation in the [update process](../../../../docs/skills/firebase-skills-update-process.md#cli-installation-and-isolated-help), not the user's project or home.
