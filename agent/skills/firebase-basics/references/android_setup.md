# 🛠️ Firebase Android Setup Guide

---
## Local setup
Dependency-only and existing-config tasks do not require CLI authentication, CLI download/install, project creation, app registration, or CLI initialization. Inspect the Android app module and reuse its existing `google-services.json`.

Use the installed or repository-pinned Firebase CLI only when needed. If it is absent, report it and ask before download/install. Login and active-project changes require user request or agreement.
---

## 0. Create an Android application
Create a local Android application only when the user requests one.

## 1. Optional: Create a Firebase Project
Only with explicit authorization for the exact project creation action and target project ID, run:

```bash
firebase projects:create <PROJECT_ID> --display-name '<DISPLAY_NAME>'
```

## 2. Optional: Register Your Android App
Only with explicit authorization for the exact app registration action and target project ID and Android package name, run:

```bash
firebase apps:create ANDROID '<APP_DISPLAY_NAME>' --package-name '<PACKAGE_NAME>' --project <PROJECT_ID>
```

Project creation does not authorize app registration or service enablement. Service enablement needs separate explicit authorization for the exact service and target project.

## 3. Existing app configuration
For a requested config retrieval, use the identified existing App ID and project ID. Registration is not a prerequisite:

```bash
firebase apps:sdkconfig ANDROID <APP_ID> --project <PROJECT_ID>
```

Save the config as `app/google-services.json` only within the requested local setup. Preserve existing configuration unless its replacement is requested.
---
## Verification
Validate local changes with the available Android build checks. Only when needed to verify an authorized registration, inspect the identified project's apps with `firebase apps:list --project <PROJECT_ID>`.

---
