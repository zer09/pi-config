# Firebase Authentication on Android (Kotlin)

This guide walks you through using Firebase Authentication in your Android app using Kotlin DSL (`build.gradle.kts`) and Kotlin code.

### 1. Local SDK setup

Client SDK setup does not require CLI installation, CLI initialization, provisioning, or live authentication. Inspect the app module, `applicationId`, build variant, existing `google-services.json`, and Google services Gradle plugin first. Reuse matching config and plugin wiring; load [Android app configuration](../../firebase-basics/references/android_setup.md) only when those need attention. Missing config does not authorize project creation or app registration.

Provider enablement and authorized-domain changes are separate hosted actions requiring explicit user instruction for the exact action and target project/environment. Implement the client flow without performing those actions or testing live sign-in.

### 2. Add Dependencies

Preserve a compatible pinned BoM, version catalog, and convention plugins. Add only the requested dependency. If the resolved SDK version matters, inspect local Gradle metadata or use the existing wrapper with the actual module and variant:

```bash
./gradlew --offline -q :app:dependencyInsight --dependency firebase-auth --configuration releaseRuntimeClasspath
```

If the wrapper or dependency is not cached, report the limit rather than downloading it for a check. When a new version is needed, verify compatibility using [Google Maven BoM metadata](https://dl.google.com/dl/android/maven2/com/google/firebase/firebase-bom/maven-metadata.xml) and [Auth metadata](https://dl.google.com/dl/android/maven2/com/google/firebase/firebase-auth/maven-metadata.xml); do not force the latest version.

In your module-level `build.gradle.kts` (usually `app/build.gradle.kts`), reuse the existing BoM declaration or add a verified compatible version:

```kotlin
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:<compatible_bom_version>"))

    // Add the dependency for the Firebase Authentication library
    // When using the BoM, you don't specify versions in Firebase library dependencies
    implementation("com.google.firebase:firebase-auth")
}
```

---

### 3. Initialize FirebaseAuth

In your Activity or Fragment, initialize the `FirebaseAuth` instance:

```kotlin
import android.os.Bundle
import androidx.activity.ComponentActivity
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.auth

class MainActivity : ComponentActivity() {

    private lateinit var auth: FirebaseAuth

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        auth = Firebase.auth
    }
}
```

#### Jetpack Compose (Modern)

Initialize inside a `ComponentActivity` using `setContent`:

```kotlin
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import com.google.firebase.Firebase
import com.google.firebase.auth.auth

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val auth = Firebase.auth
        
        setContent {
            MaterialTheme {
                Text("Auth initialized!")
            }
        }
    }
}
```

---

### 4. Check Current Auth State

You should check if a user is already signed in when your activity starts:

```kotlin
public override fun onStart() {
    super.onStart()
    // Check if user is signed in (non-null) and update UI accordingly.
    val currentUser = auth.currentUser
    if (currentUser != null) {
        // User is signed in, navigate to main screen or update UI
    } else {
        // No user is signed in, prompt for login
    }
}
```

---

### 5. Sign Up New Users (Email/Password)

These snippets implement app behavior, not commands to execute during maintenance. Use mocks or a configured emulator for checks. Live user creation requires explicit user instruction for the exact action and target project/environment.

Use `createUserWithEmailAndPassword` to register new users:

```kotlin
fun signUpUser(email: String, password: String) {
    auth.createUserWithEmailAndPassword(email, password)
        .addOnCompleteListener(this) { task ->
            if (task.isSuccessful) {
                // Sign up success, update UI with the signed-in user's information
                val user = auth.currentUser
                // Navigate to main screen
            } else {
                // If sign up fails, display a message to the user.
                Toast.makeText(baseContext, "Authentication failed.", Toast.LENGTH_SHORT).show()
            }
        }
}
```

---

### 6. Sign In Existing Users (Email/Password)

Use `signInWithEmailAndPassword` to log in existing users:

```kotlin
fun signInUser(email: String, password: String) {
    auth.signInWithEmailAndPassword(email, password)
        .addOnCompleteListener(this) { task ->
            if (task.isSuccessful) {
                // Sign in success, update UI with the signed-in user's information
                val user = auth.currentUser
                // Navigate to main screen
            } else {
                // If sign in fails, display a message to the user.
                Toast.makeText(baseContext, "Authentication failed.", Toast.LENGTH_SHORT).show()
            }
        }
}
```

---

### 7. Sign Out

To sign out a user, call `signOut()` on the `FirebaseAuth` instance:

```kotlin
auth.signOut()
// Navigate to login screen
```
