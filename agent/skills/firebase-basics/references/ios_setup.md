# Firebase iOS Setup Guide

# ⛔️ CRITICAL RULE: STATE MANAGEMENT (OBSERVATION VS COMBINE) ⛔️

When writing or updating SwiftUI code, you **MUST** prioritize the modern Swift **Observation framework (`@Observable` macro and `@State`)** as your default approach.
 
However, it is acceptable to use **Combine** (`ObservableObject`, `@Published`, `@StateObject`, `@EnvironmentObject`) under the following conditions:
- The user explicitly asks you to use Combine.
- There are strong signals in the existing codebase that the project is heavily relying on Combine. 

If neither of those conditions are true, default to the Swift 5.9+ Observation framework.

# ⛔️ CRITICAL RULE: INITIALIZATION ORDER ⛔️

When using SwiftUI, you **MUST** ensure `FirebaseApp.configure()` is called **BEFORE** any Firebase-dependent state objects are initialized. 

- **UNSAFE (CRASH):** Declaring a `@State` (for `@Observable`) or `@StateObject` (for Combine) property in the root `App` struct if its initializer touches Firebase. Property initializers run *before* the `App.init()` body, meaning the object's `init()` will fire before Firebase is configured.
- **SAFE:** Initialize Firebase in `App.init()` and pass your state objects into the sub-views (like `ContentView`), or use `onAppear` for delayed setup.

Failing to follow this will result in a fatal crash: `Default FirebaseApp is not configured`.

## 1. Reuse existing configuration
Dependency-only and existing-config tasks do not require CLI authentication, CLI download/install, project creation, app registration, or CLI initialization. Read the Xcode project (`.pbxproj` or `Info.plist`) to identify the bundle ID and reuse its existing `GoogleService-Info.plist`.

Use the installed or repository-pinned Firebase CLI only when needed. If it is absent, report it and ask before download/install. Login and active-project changes require user request or agreement.

For requested config retrieval, use the identified existing App ID and project ID:

```bash
firebase apps:sdkconfig IOS <APP_ID> --project <PROJECT_ID>
```

Save the requested config as `GoogleService-Info.plist` in the Xcode project folder. Remove non-XML CLI output headers and link the file to the main application target. Preserve existing configuration unless its replacement is requested.

### Optional: Create a Firebase Project
Only with explicit authorization for the exact project creation action and target project ID, run:

```bash
firebase projects:create <PROJECT_ID> --display-name '<DISPLAY_NAME>'
```

### Optional: Register the iOS App
Only with explicit authorization for the exact app registration action and target project ID and iOS bundle ID, run:

```bash
firebase apps:create IOS '<APP_DISPLAY_NAME>' --bundle-id '<BUNDLE_ID>' --project <PROJECT_ID>
```

Project creation does not authorize app registration or service enablement. Service enablement needs separate explicit authorization for the exact service and target project.

## 2. Installation (Automated via Swift Package Manager CLI)
Do not use raw text parsing, sed, or Ruby scripts (like `xcodeproj` gem) to modify `.pbxproj` files directly.

Instead, use the **`xcode-project-setup`** skill. 
Load that skill using your tools to securely execute its native Swift package setup script. That skill handles installing the required SPM packages and safely linking the `GoogleService-Info.plist` file.

> **💡 TIP: ALWAYS USE THE LATEST SDK VERSION**
> To ensure access to the latest features and security fixes, always check for the most recent version of the Firebase iOS SDK at [https://github.com/firebase/firebase-ios-sdk/releases](https://github.com/firebase/firebase-ios-sdk/releases) and use that version when adding the SPM dependency.

## 3. Initialization
Configure the shared `FirebaseApp` instance. You can do this either in a modern SwiftUI `App` structure or a traditional `AppDelegate`.

### SwiftUI (Modern - SAFE PATTERN)
```swift
import SwiftUI
import FirebaseCore

@main
struct YourApp: App {
  // ⛔️ FATAL CRASH: @State private var auth = AuthManager()
  // property initializers run before init(), causing FirebaseApp not configured error
  @State private var authManager: AuthManager

  init() {
    // ✅ SAFE: This runs FIRST
    FirebaseApp.configure()
    
    // ✅ SAFE: Initialize state ONLY AFTER Firebase is configured
    _authManager = State(initialValue: AuthManager())
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environment(authManager)
    }
  }
}
```

### AppDelegate (Traditional / UIKit)
```swift
import UIKit
import FirebaseCore

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    // ✅ SAFE: Always the first line in didFinishLaunching
    FirebaseApp.configure()
    return true
  }
}
```