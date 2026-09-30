# Firebase Auth & Google Sign-In for Flutter

When integrating Firebase Authentication and Google Sign-In into Flutter apps targeting cross-platform environments (like Mobile + Web), you must navigate several breaking changes introduced in `google_sign_in` 7.x+ and some platform-specific quirks.

Reuse existing Firebase initialization and pinned dependencies. Client SDK setup does not require CLI installation, CLI initialization, provisioning, or live authentication. Provider enablement, domain changes, and live user creation require explicit user instruction for the exact action and target project/environment. Use mocks or a configured emulator for checks.

## 1. `google_sign_in` 7.2.0 API Changes
- **Method Renamed**: The `signIn()` method is deprecated/removed and has been replaced with `authenticate()`.
- **Token Separation**: The `GoogleSignInAuthentication` object no longer packages both identity and authorization tokens together. Initial authentication now only provides the `idToken`. If an `accessToken` is required for Google APIs, you must explicitly request server authorization separately.

## 2. Initialization & Web Hang/Crash Pitfalls 
- **Initialization Requirement**: In 7.x, you must call `await GoogleSignIn.instance.initialize();` globally before using the plugin.
- **Web Client ID Constraint**: On Flutter Web, if you call `initialize()` without passing a `clientId` argument OR specifying the `<meta name="google-signin-client_id" ... />` tag in `web/index.html`, the Dart Web Debug Service (DWDS) and the app will throw an assertion error and **hang infinitely**, resulting in a blank screen.
- **Common Workaround**: If you intend to use Firebase Auth's `signInWithPopup(GoogleAuthProvider())` for the web, you can conditionally skip the local `GoogleSignIn` package initialization entirely:
  ```dart
  import 'package:flutter/foundation.dart' show kIsWeb;

  if (!kIsWeb) {
    await GoogleSignIn.instance.initialize();
  }
  ```

## 3. Web Logout Crashes
- If you bypassed `GoogleSignIn` initialization on the web (as demonstrated above), you cannot call its `signOut()` method later. Attempting to execute `await GoogleSignIn.instance.signOut();` during the user's logout flow on the Web platform evaluates against an uninitialized context or unsupported environment, crashing the app.
- **Solution**: Conditionally separate the logout logic for Web to rely entirely on `FirebaseAuth`:
  ```dart
  if (!kIsWeb) {
      await GoogleSignIn.instance.signOut();
  }
  await FirebaseAuth.instance.signOut();
  ```

## 4. Firestore queries for user data

Preserve ownership filters, ordering, and limits when querying user data. Do not fetch an unbounded collection or sort a limited unsorted subset to bypass a missing composite index. Use `firebase-firestore` for edition-aware query/index work; index deployment needs separate exact authorization.

## 5. Robust `AuthService` Boilerplate
Here is a comprehensive `AuthService` implementation that properly handles the initialization and platform differences between Flutter Web and Mobile:

```dart
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  // Await this once before sign-in or sign-out; constructors cannot await it.
  Future<void> initialize() async {
    if (!kIsWeb) {
      await GoogleSignIn.instance.initialize();
    }
  }

  // Stream to listen to auth state changes
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  // Get current user
  User? get currentUser => _auth.currentUser;

  // Google Sign-In
  Future<UserCredential?> signInWithGoogle() async {
    try {
      if (kIsWeb) {
        // Web uses popup to avoid DWDS hangs and manual client ID config
        GoogleAuthProvider authProvider = GoogleAuthProvider();
        return await _auth.signInWithPopup(authProvider);
      } else {
        // Mobile uses standard flow
        final GoogleSignInAccount googleUser = await GoogleSignIn.instance.authenticate();
        final GoogleSignInAuthentication googleAuth = googleUser.authentication;
        
        final AuthCredential credential = GoogleAuthProvider.credential(
          idToken: googleAuth.idToken,
        );
        
        return await _auth.signInWithCredential(credential);
      }
    } catch (e) {
      // Show a safe error state without logging credentials or provider responses.
      return null;
    }
  }

  // Sign out
  Future<void> signOut() async {
    try {
      if (!kIsWeb) {
        await GoogleSignIn.instance.signOut();
      }
      await _auth.signOut();
    } catch (e) {
      // Show a safe error state without logging credentials or provider responses.
    }
  }
}
```

Create the service after Firebase initialization, then `await authService.initialize()` before exposing its sign-in/sign-out actions. In 7.x, cancellation is reported as an exception; map it to a cancelled UI state rather than assuming a null account.

## 6. Web authorized domains

For popup failures with `auth/unauthorized-domain`, follow the [Web troubleshooting guidance](client_sdk_web.md#troubleshooting-authunauthorized-domain). Domain changes remain gated; a Flutter Web port change does not require adding a port to the authorized-domain entry.
