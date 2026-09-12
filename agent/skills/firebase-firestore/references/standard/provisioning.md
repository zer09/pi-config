# Provisioning Cloud Firestore Standard

## Hosted service safety

Database creation and rule/index deployment require explicit user instruction for each exact action and target. A local setup request or missing database does not authorize provisioning. Inspect existing files and preserve their content; add only the configuration needed for the requested task. Use the project's available Firebase CLI.

## Manual Initialization

For local setup, edit the Firebase configuration files directly rather than starting an interactive initialization flow.

1.  **Create `firebase.json`**: This file configures the Firebase CLI.
2.  **Create `firestore.rules`**: This file contains your security rules.
3.  **Create `firestore.indexes.json`**: This file contains your index
    definitions.

### 1. Create `firebase.json`

Create a file named `firebase.json` in your project root with the following
content. If this file already exists, instead append to the existing JSON:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
```

This configuration targets `(default)`; it does not establish the database's existence or edition. Inspect configuration or read-only metadata before an edition-dependent task. For an existing named database, add its verified database ID. Location is a provisioning choice, not a prerequisite for local rules work.

### Explicitly requested database creation

Only when the user explicitly requests creation of this database, establish the project, database ID, Standard edition, and location. Use `firebase firestore:locations --project <project-id>` for available locations if needed. Do not choose Standard or Enterprise silently.

```bash
firebase firestore:databases:create <database-id> \
  --edition="standard" --location="<selected-location>" --project <project-id>
```

A deployment may also provision a missing database from configuration. Do not use that path without separate exact authorization for database creation and deployment. For an explicitly selected target, configuration can include:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json",
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

Deploy only when the user explicitly requests the exact rule/index deployment. Confirm the target project and database and select only the authorized resources. If the target is missing, stop unless creation is separately authorized with an explicit edition and location. Local changes do not require deployment to be complete.

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
