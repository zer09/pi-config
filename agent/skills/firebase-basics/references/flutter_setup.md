# Flutter & Firebase Setup Guide

This guide covers local Flutter dependencies and optional Firebase configuration. Dependency-only and existing-config tasks do not require CLI authentication, CLI download/install, project creation, app registration, or CLI initialization. Reuse existing `lib/firebase_options.dart` and platform config files.

## Prerequisites

1. **Flutter SDK**: Use the existing SDK for requested Flutter work. If it is absent, report it and ask before download/install.

   **Optional installation, only after user agreement:**
   1. **Determine Architecture**: Check if you are on Intel (`x64`) or Apple Silicon (`arm64`) using `uname -m`.
   2. **Download SDK**: Fetch the latest stable SDK from the [Flutter Archive](https://docs.flutter.dev/install/archive?tab=macos).
   3. **Extract**: Unzip the SDK to a permanent directory (e.g., `~/development/flutter`).
   4. **Update PATH**: Add the `bin` folder to your shell configuration (e.g., `~/.zshrc`).
      ```bash
      echo 'export PATH="$PATH:$HOME/development/flutter/bin"' >> ~/.zshrc
      source ~/.zshrc
      ```
   5. **Verify**: Run `flutter doctor` to ensure the SDK is correctly linked and initialized.

2. **Firebase CLI**: Needed only for tasks that use the CLI, not client dependency work. Use the installed or repository-pinned Firebase CLI. If it is absent, report it and ask before download/install.
   - Check the available version with `firebase --version` only when needed.
   - Login and active-project changes require user request or agreement.

3. **FlutterFire CLI**: Needed only for the optional configuration branch below. Use an existing installed or repository-pinned CLI. If it is absent, report it and ask before download/install.
   - Only after the user requests or agrees to this CLI installation, run `dart pub global activate flutterfire_cli`.
   - For an existing installation, check whether `~/.pub-cache/bin` is in PATH before changing shell configuration.

## Step 1: Create a Flutter Project
Only for a requested new local Flutter project, run:
```bash
flutter create my_awesome_app
cd my_awesome_app
```

## Step 2: Optional Firebase configuration and app registration
Reuse existing configuration for the identified apps. An existing project ID alone does not authorize app registration. If a Firebase project must be created, handle that separately through the gated branch in [Web setup](web_setup.md).

This command can register apps and generate `lib/firebase_options.dart`. Require explicit authorization for the exact configuration and app registration actions and target project, platforms, and app identifiers (Android package name, iOS bundle ID, or web app). Only then run:

```bash
flutterfire configure --project=<PROJECT_ID> --platforms=<PLATFORMS>
```

Limit platform selection to the authorized targets. Project creation and service enablement require separate explicit authorization for each exact action and target. Stop before prompts for unapproved hosted changes. Without authorization, complete local dependency/code work and report missing configuration or registration as deferred.


## Step 3: Initialize Firebase in Code
Add the `firebase_core` package and initialize it in your `main.dart`.

1. Add the dependency:
```bash
flutter pub add firebase_core
```

2. Update `lib/main.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  runApp(const MyApp());
}
```

## Step 4: Add Firebase Services
For a requested client dependency addition:

1. Add the service package: `flutter pub add cloud_firestore`
2. Reuse existing platform configuration. Adding a dependency does not authorize app registration or service enablement; handle required configuration changes through the optional branch above.
3. Import and use the package in your code.

## Step 5: Important Gotchas & Platform Specifics

### 1. Changed App Identifiers
A changed iOS bundle identifier or Android `applicationId` can require different platform config files and `firebase_options.dart`. Reuse configuration for the intended app identity where available. If registration is required, use the separately authorized optional branch above; a local rename does not authorize hosted changes.

### 2. Platform-Specific Build Requirements
- **Android**: Adding Firebase often requires a higher `minSdkVersion` (commonly `21` or `23`) than the platform default. Be prepared to update `android/app/build.gradle` automatically when installing certain plugins.
- **iOS**: Always check if there is a `Podfile` in the `/ios` directory whenever native services (like `cloud_firestore`) are added. If there is, run `pod install`. Failing to do this will cause Xcode build errors. Note that Flutter is moving towards Swift Package Manager (SPM), and FlutterFire supports SPM, so a `Podfile` may not exist if the project only uses SPM dependencies.

### 3. Web CORS Best Practices
When testing Firebase features locally on Chrome, requests to Google servers can sometimes get blocked by CORS policies. Avoid relying on `--disable-web-security` flags as it promotes bad security practices. Instead, run the app on localhost with a specific port, and ensure `localhost` is added to your Firebase Auth "Authorized Domains".
  ```bash
  flutter run -d chrome --web-hostname=localhost --web-port=5000
  ```

### 4. Elaborating on `WidgetsFlutterBinding.ensureInitialized()`
In your `main.dart`, this call is mandatory before `Firebase.initializeApp()`. 
*Why?* Because Firebase initialization requires communication across Flutter's native iOS/Android method channels. `ensureInitialized()` guarantees the Fluter engine is fully booted up and ready to handle these native platform calls before `runApp()` executes.
