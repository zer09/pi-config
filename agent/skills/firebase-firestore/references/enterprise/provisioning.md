# Provisioning Firestore Enterprise Native Mode

## Hosted service safety

Database creation and rule/index deployment require explicit user instruction for each exact action and target. A local setup request or missing database does not authorize provisioning. Select Enterprise, native access, and location explicitly; do not treat them as defaults. Inspect and preserve existing configuration. Use the project's available Firebase CLI.

## Manual Initialization

For requested local setup, edit only the needed configuration fields instead of starting interactive initialization.

1.  **Identify the target**: Use an existing database, or create one only under the explicit creation gate below. Skip hosted steps for local-only work.
2.  **Create `firebase.json`**: This file contains database configuration for
    the Firebase CLI.
3.  **Create `firestore.rules`**: This file contains your security rules.
4.  **Create `firestore.indexes.json`**: This file contains your index
    definitions.

### 1. Create a Firestore Enterprise Database

Only with explicit authorization for the exact creation action and target project/database, establish its ID, Enterprise edition, native access mode, location, and realtime setting. Run `firebase firestore:locations --project <project-id>` if location options are needed. Suggest colocation where relevant, but leave the provisioning decision explicit.

CLI 15.32.0 defaults realtime updates to enabled when Enterprise Firestore data access is enabled. Set `<authorized-realtime-setting>` to exactly `ENABLED` or `DISABLED`, as explicitly authorized for that target. If the realtime choice or exact creation authorization is missing, stop before creation.

A database ID is required and must not be `(default)`. For that authorized target:

```bash
firebase firestore:databases:create my-database-id \
  --location="<selected-location>" \
  --edition="enterprise" \
  --firestore-data-access="ENABLED" \
  --mongodb-compatible-data-access="DISABLED" \
  --realtime-updates="<authorized-realtime-setting>" \
  --project <project-id>
```

### 2. Create `firebase.json`

Create a file named `firebase.json` in your project root with the following
content (match `database` and `location` to the selected target). For local-only work, configuration does not create a hosted database. If this file already exists, merge the needed fields without replacing existing settings:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json",
    "edition": "enterprise",
    "dataAccessMode": "FIRESTORE_NATIVE",
    "database": "my-database-id",
    "location": "<selected-location>"
  }
}
```

### 2. Create `firestore.rules`

Create a file named `firestore.rules`. A good starting point (locking down the
database) is:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

*See [security_rules.md](security_rules.md) for how to write actual rules.*

### 3. Create `firestore.indexes.json`

Create a file named `firestore.indexes.json` with an empty configuration to
start:

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

*See [indexes.md](indexes.md) for how to configure indexes.*

## Explicitly authorized deployment

Deploy only with explicit authorization for the exact rule/index action and target project/database. Confirm the existing database, Enterprise edition, native access mode, and selected resources. If the target is missing, stop; create it through the preceding creation gate only if separately authorized with the exact project, database ID, edition, access mode, and location. Do not use deployment to create it implicitly. Service enablement also needs separate exact authorization. Local validation does not require deployment.

Use a reviewed config containing only the authorized database and resource files, with an explicit `database` value. Set `<single-database-config>` to that file; preserve the original multi-database config. In CLI 15.32.0, `firestore:rules` and `firestore:indexes` can select every configured database, and preparation can create the first config entry before database filtering. A `--only` selector alone is not sufficient isolation.

```bash
# Rules and indexes, only if both are authorized
firebase deploy --only firestore --project <project-id> --config <single-database-config>

# Rules only
firebase deploy --only firestore:rules --project <project-id> --config <single-database-config>

# Indexes only
firebase deploy --only firestore:indexes --project <project-id> --config <single-database-config>
```

## Local Emulation

To run Firestore locally for development and testing:

```bash
firebase emulators:start --only firestore
```

This starts the Firestore emulator, typically on port 8080. You can interact
with it using the Emulator UI (usually at http://localhost:4000/firestore).
