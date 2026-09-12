# Configuration Reference

## Hosted service safety

Reads and requested local edits, compile, SDK generation, and emulation are allowed. Deployment, Cloud SQL migration, database creation, data writes, service enablement, and Firebase project mutations require explicit user instruction for each exact action and target. Initialization can offer provisioning; stop before any unrequested hosted action. Login or active-project changes require the user's request or agreement. Never print, save, or commit credentials or tokens.

Use the project's available Firebase CLI in the examples below. Do not install or upgrade it automatically. These commands are alternatives for the selected task, not a sequence to run in full.

## Contents
- [Project Structure](#project-structure)
- [dataconnect.yaml](#dataconnectyaml)
- [connector.yaml](#connectoryaml)
- [Firebase CLI Commands](#firebase-cli-commands)
- [Emulator](#emulator)
- [Deployment](#deployment)

---

## Project Structure

```
project-root/
├── firebase.json           # Firebase project config
└── dataconnect/
    ├── dataconnect.yaml    # Service configuration
    ├── schema/
    │   └── schema.gql      # Data model (types, relationships)
    └── connector/
        ├── connector.yaml  # Connector config + SDK generation
        ├── queries.gql     # Query operations
        └── mutations.gql   # Mutation operations (optional separate file)
```

---

## dataconnect.yaml

Main SQL Connect service configuration:

```yaml
specVersion: "v1"
serviceId: "my-service"
location: "us-central1"
schemaValidation: "STRICT" # or "COMPATIBLE"
schema:
  source: "./schema"
  datasource:
    postgresql:
      database: "fdcdb"
      cloudSql:
        instanceId: "my-instance"
connectorDirs: ["./connector"]
```

| Field | Description |
|-------|-------------|
| `specVersion` | Always `"v1"` |
| `serviceId` | Unique identifier for the service |
| `location` | GCP region (us-central1, us-east4, europe-west1, etc.) |
| `schemaValidation` | Deployment mode: `"STRICT"` (must match exactly) or `"COMPATIBLE"` (backward compatible) |
| `schema.source` | Path to schema directory |
| `schema.datasource` | PostgreSQL connection config |
| `connectorDirs` | List of connector directories |

### Cloud SQL Configuration

```yaml
schema:
  datasource:
    postgresql:
      database: "my-database"      # Database name
      cloudSql:
        instanceId: "my-instance"  # Cloud SQL instance ID
```

---

## connector.yaml

Connector configuration and SDK generation:

```yaml
connectorId: "default"
generate:
  javascriptSdk:
    outputDir: "../web/src/lib/dataconnect"
    package: "@myapp/dataconnect"
  kotlinSdk:
    outputDir: "../android/app/src/main/kotlin/com/myapp/dataconnect"
    package: "com.myapp.dataconnect"
  swiftSdk:
    outputDir: "../ios/MyApp/DataConnect"
```

### SDK Generation Options

| SDK | Fields |
|-----|--------|
| `javascriptSdk` | `outputDir`, `package` |
| `kotlinSdk` | `outputDir`, `package` |
| `swiftSdk` | `outputDir` |
| `nodeAdminSdk` | `outputDir`, `package` (for Admin SDK) |

---

## Firebase CLI Commands

### Initialize SQL Connect

Inspect existing files before an authorized local initialization. Select only the needed service, connector, and SDK configuration. Do not accept Cloud SQL creation, service enablement, or other hosted mutation prompts without explicit user instruction for that exact action. Validate the local template and generated SDK after initialization.

```bash
firebase init dataconnect --project <project-id>
```

Changing the active project is optional and requires the user's request or agreement:

```bash
firebase use <project-id>
```

### Local Development

Write the schema and authorized operations, compile them, generate the affected SDKs, and build the consuming app as the task requires. Emulator setup is described below.

```bash
# Validate schema and operations
firebase dataconnect:compile

# Generate SDKs
firebase dataconnect:sdk:generate

# Watch only when iterative generation is needed
firebase dataconnect:sdk:generate --watch
```

---

## Emulator

### Start Emulator

```bash
firebase emulators:start --only dataconnect
```

Default ports:
- SQL Connect: `9399`
- PostgreSQL: `9939` (local PostgreSQL instance)

### Emulator Configuration (firebase.json)

```json
{
  "emulators": {
    "dataconnect": {
      "port": 9399
    }
  }
}
```

### Connect from SDK

```typescript
// Web
import { connectDataConnectEmulator } from 'firebase/data-connect';
connectDataConnectEmulator(dc, 'localhost', 9399);

// Android
connector.dataConnect.useEmulator("10.0.2.2", 9399)

// iOS
connector.useEmulator(host: "localhost", port: 9399)


```

### Seed Data

Create seed data files and import:

```bash
# Export current emulator data
firebase emulators:export ./seed-data

# Start with seed data
firebase emulators:start --only dataconnect --import=./seed-data
```

---

## Deployment

### Explicit Authorization and Target

Deployment and Cloud SQL migration require explicit user instruction for each exact action. Confirm the project, service, connector, database, and requested scope. Read-only schema comparison is not migration permission. Local implementation can finish with deployment deferred.

Test locally and review the production SQL diff for breaking changes before any authorized deployment:

```bash
# Read-only comparison against the selected live target
firebase dataconnect:sql:diff --project <project-id>

# Deploy the service only when that exact deployment is authorized
firebase deploy --only dataconnect --project <project-id>

# Or deploy only the authorized connector
firebase deploy --only dataconnect:connector-id --project <project-id>
```

### Schema Migrations

SQL Connect generates PostgreSQL migrations. Apply a migration only after explicit user instruction for that exact migration and review of its SQL diff:

```bash
firebase dataconnect:sql:migrate --project <project-id>
```

### Breaking Changes

Some schema changes require special handling:
- Removing required fields
- Changing field types
- Removing tables

Do not use `--force` as a validation fix or default. It bypasses confirmation of breaking changes. Only when the user explicitly authorizes the exact breaking migration or deployment and its consequences, the selected command can include `--force`:

```bash
firebase dataconnect:sql:migrate --project <project-id> --force
# Alternative for an explicitly authorized deployment with breaking changes
firebase deploy --only dataconnect --project <project-id> --force
```

### CI/CD Integration

Adding or running a deployment job requires explicit user instruction for that exact automation or hosted action. Use the CI system's protected approval and credential configuration. Do not print tokens or put credentials in source. This example assumes an available authenticated CLI and an explicitly configured target:

```yaml
# GitHub Actions example for an authorized deployment job
- name: Deploy SQL Connect
  run: firebase deploy --only dataconnect --project <project-id>
```

---

## VS Code Extension

Install "Firebase SQL Connect" extension for:
- Schema intellisense and validation
- GraphQL operation testing
- Emulator integration
- SDK generation on save

### Extension Settings

```json
{
  "firebase.dataConnect.autoGenerateSdk": true,
  "firebase.dataConnect.emulator.port": 9399
}
```
