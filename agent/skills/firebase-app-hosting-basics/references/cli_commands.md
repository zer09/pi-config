# App Hosting CLI Commands

Use the installed or repository-pinned Firebase CLI; ask before download/install or upgrades. Verify command help with network/credential/config isolation because help initializes local state.

Reads do not authorize changes. Before any mutation, require explicit user instruction for the exact action and target project, backend, region, branch/commit, secret, or service-account owner as applicable. Verify Blaze billing without enabling it. Missing resources do not authorize creation; stop the affected hosted action. Initialization and backend/secret setup can enable services, register apps, or change IAM permissions; each additional hosted action needs exact authorization.

## Initialization

### `firebase init apphosting --project <project-id>`

- **Purpose**: Interactive command that sets up App Hosting in your local project.
Use this command only for requested initialization and stop before unapproved hosted prompts.
Alternatively, edit the requested local `firebase.json` and `apphosting.yaml` files.

- **Effect**:
  - Detects your web framework.
  - Creates/updates `apphosting.yaml`.
  - Can optionally create a backend if one doesn't exist.

## Backend Management

`apphosting:backends:list` and `apphosting:backends:get` can silently enable `firebaseapphosting.googleapis.com` before reading. Before either command, require verified non-enabling evidence that this exact service is already enabled in the exact target project, or explicit user authority to enable this exact service in that project. If the service is disabled or its state is unknown without that authority, stop before invocation. Never use list/get themselves as the preflight. Authentication, `silent=true`, billing, backend, or general-read authority does not authorize service enablement.

### `firebase apphosting:backends:list --project <project-id>`

- **Purpose**: Lists all backends in the current project.

### `firebase apphosting:backends:get <backend-id> --project <project-id>`

- **Purpose**: Shows details for a specific backend.

### `firebase apphosting:backends:delete <backend-id> --project <project-id>`

- **Purpose**: Deletes a backend and its associated resources.

### `apphosting:rollouts:list` availability

In CLI 15.36.0 this command is registered only under the `internaltesting` experiment. Stock `firebase apphosting:rollouts:list --help` falls back to root help with exit 0, which does not prove command availability. Do not enable experiments to bypass this limit.

## Secrets Management

App Hosting uses Cloud Secret Manager to securely handle sensitive environment variables (like API keys).

### `firebase apphosting:secrets:set <secret-name> --project <project-id>`

- **Purpose**: Creates or updates a secret in Cloud Secret Manager and makes it available to App Hosting.
- **Behavior**: Prompts for the secret value (hidden input). Never print or save secret values in source, command arguments, or reports. Do not use `--force` to bypass authorization for secret creation, grants, or YAML changes.

### `firebase apphosting:secrets:grantaccess <secret-name> --backend <backend-id> --project <project-id>`

- **Purpose**: Grants the App Hosting service account permission to access the secret.
- **Note**: Often handled automatically by `secrets:set`, but useful for debugging permission issues or granting access to existing secrets.

## Automated deployment via GitHub (CI/CD)

Use rollouts for an existing GitHub-connected backend, not local-source deployment with `firebase deploy`. A local edit or failed lookup does not authorize backend creation, repository linking, or a rollout.

### `firebase apphosting:rollouts:create <backend-id> --project <project-id>`

- **Purpose**: Manually triggers a new rollout (deployment).
- **Options**:
  - `--git-branch <branch>`: Deploy the latest commit from a specific branch.
  - `--git-commit <commit-hash>`: Deploy a specific commit. This is mutually exclusive with `--git-branch`.
- **Use Case**: Useful for redeploying without code changes, or rolling back to a specific commit.

### `firebase apphosting:backends:create --project <project-id>`

- **Purpose**: Creates a new App Hosting backend only after exact creation authorization. Interactive setup can link a GitHub repository and set rollout policy; do not treat it as read-only discovery. Use `--app` for an identified existing web app; omitting it can register an app and needs separate authorization.
- **Options**:
  - `--app <webAppId>`: The ID of an existing Firebase web app to associate with the backend.
  - `--backend <backendId>`: The ID of the new backend. Required with `--non-interactive`.
  - `--primary-region <location>`: The primary region for the backend. Required with `--non-interactive`; do not change an authorized region to work around quota.
  - `--root-dir <rootDir>`: The root directory for the backend. If omitted, defaults to the root directory of the project.
  - `--service-account <service-account>`: The service account used to run the server. If omitted, defaults to the default service account.
