# Firebase Android Setup Guide

## Reuse local configuration first

Dependency-only and existing-config tasks do not require CLI authentication, CLI download/install, project creation, app registration, CLI initialization, or live account/project inspection.

Inspect the app module, `applicationId`, build variants, Gradle files, and any existing `google-services.json`. Reuse the configuration for the intended app identity. A file normally belongs in the module (app-level) root, such as `app/google-services.json`; preserve intentional variant-specific locations. If configuration already exists, do not create a Firebase project or re-register the app. Check the local plugin wiring instead.

Use the installed or repository-pinned Firebase CLI only when needed. If it is absent, report it and ask before download/install. Login and active-project changes require user request or agreement. Create a local Android application only when requested.

## Google services Gradle plugin

For requested Android setup, check for `com.google.gms.google-services` in both the project-level plugin declaration and the app module. Follow the repository's Gradle DSL, version catalog, or convention plugin rather than adding duplicate declarations.

Preserve a compatible pinned plugin version. If a version must be selected or upgraded, verify it against [Google Maven metadata](https://dl.google.com/dl/android/maven2/com/google/gms/google-services/maven-metadata.xml) and the project's Gradle constraints. Do not upgrade to the latest version just to repair local configuration.

Project-level `build.gradle.kts`, when the project uses direct plugin declarations:

```kotlin
plugins {
    id("com.google.gms.google-services") version "<verified_plugin_version>" apply false
}
```

Module-level `app/build.gradle.kts`:

```kotlin
plugins {
    id("com.google.gms.google-services")
}
```

Load only the product-specific skill needed for SDK dependencies and usage. Adding this plugin does not authorize backend provisioning or service enablement.

## Optional project creation

Prefer an existing project identified by local configuration or the user. Missing config does not imply a missing Firebase project.

Only with explicit authorization for the exact project creation action and target project ID, run:

```bash
firebase projects:create <PROJECT_ID> --display-name '<DISPLAY_NAME>'
```

## Optional Android app registration

Only with explicit authorization for the exact app registration action and target project ID and Android package name, run:

```bash
firebase apps:create ANDROID '<APP_DISPLAY_NAME>' --package-name '<PACKAGE_NAME>' --project <PROJECT_ID>
```

Use the intended variant's `applicationId` as the Android package name, not the Firebase App ID. Record the returned Firebase App ID. Project creation does not authorize app registration or service enablement. Service enablement needs separate explicit authorization for the exact service and target project.

## Requested app configuration retrieval

Use the identified existing Firebase App ID and project ID. Registration is not a prerequisite. For a requested local config write, choose the app module's destination and preserve any existing file unless replacement was requested:

```bash
firebase apps:sdkconfig ANDROID <APP_ID> --project <PROJECT_ID> --out app/google-services.json
```

The CLI's `--out` writes the config without mixing progress messages into JSON. It refuses to replace an existing file in non-interactive mode. Do not delete an existing config to bypass that protection.

## Local completion

Check the configuration's package identity, module location, and plugin wiring without printing the config. Run available local Android build checks for the requested change. Do not require login, project/app listing, deployment, or a live app launch to validate dependency or existing-config changes. Report missing tools and any unapproved hosted setup as deferred.
