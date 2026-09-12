# Provisioning Firestore Enterprise Native Mode

## Hosted service safety

Database creation and rule/index deployment require explicit user instruction for each exact action and target. A local setup request or missing database does not authorize provisioning. Select Enterprise, native access, and location explicitly; do not treat them as defaults. Inspect and preserve existing configuration. Use the project's available Firebase CLI.

## Manual Initialization

Initialize the following firebase configuration files manually. Do not use `npx
-y firebase-tools@latest init`, as it expects interactive inputs.

1.  **Identify the target**: Use an existing database, or create one only under the explicit creation gate below. Skip hosted steps for local-only work.
2.  **Create `firebase.json`**: This file contains database configuration for
    the Firebase CLI.
3.  **Create `firestore.rules`**: This file contains your security rules.
4.  **Create `firestore.indexes.json`**: This file contains your index
    definitions.

### 1. Create a Firestore Enterprise Database

Only after the user explicitly requests creation of this database, establish its project, ID, Enterprise edition, native access mode, and location. Run `firebase firestore:locations --project <project-id>` if location options are needed. Suggest colocation where relevant, but leave the provisioning decision explicit.

For that authorized target:

```bash
firebase firestore:databases:create my-database-id \
  --location="<selected-location>" \
  --edition="enterprise" \
  --firestore-data-access="ENABLED" \
  --mongodb-compatible-data-access="DISABLED" \
  --project <project-id>
```

This will create an enterprise database in the selected location with native mode enabled. A
database id is required to create an enterprise database and the database id
must not be `(default)`. If realtime updates are part of the explicitly selected provisioning configuration, use the `--realtime-updates` flag instead of the preceding command:

```bash
firebase firestore:databases:create my-database-id \
  --location="<selected-location>" \
  --edition="enterprise" \
  --firestore-data-access="ENABLED" \
  --mongodb-compatible-data-access="DISABLED" \
  --realtime-updates="ENABLED" \
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

Deploy only when the user explicitly requests the exact rule/index deployment. Confirm the project and database and select only the authorized resources. If the database is missing, stop unless its creation is separately authorized. Local validation does not require deployment.

```bash
# Rules and indexes, only if both are authorized
firebase deploy --only firestore --project <project-id>

# Rules only
firebase deploy --only firestore:rules --project <project-id>

# Indexes only
firebase deploy --only firestore:indexes --project <project-id>
```

## Local Emulation

To run Firestore locally for development and testing:

```bash
firebase emulators:start --only firestore
```

This starts the Firestore emulator, typically on port 8080. You can interact
with it using the Emulator UI (usually at http://localhost:4000/firestore).
