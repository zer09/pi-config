# Cloud Firestore on Android (Kotlin)

This guide walks you through using Cloud Firestore in your Android app using Kotlin.

### Local SDK setup

Client SDK setup does not require CLI installation, CLI initialization, provisioning, or live authentication. Backend provisioning and service enablement are separate actions that require explicit user instruction for each exact action and target project/database. Only when explicitly requested, follow the [Standard provisioning reference](provisioning.md).

Inspect the app module, `applicationId`, build variant, existing `google-services.json`, and Google services Gradle plugin first. Reuse matching config and wiring; load [Android app configuration](../../../firebase-basics/references/android_setup.md) only when those need attention. Missing config does not authorize creation or registration.

 ---

### 1. Add Dependencies

Preserve a compatible pinned BoM, version catalog, and convention plugins. Add only the requested dependency. If the resolved version matters, inspect local Gradle metadata or use the existing wrapper with the actual module and variant:

```bash
./gradlew --offline -q :app:dependencyInsight --dependency firebase-firestore --configuration releaseRuntimeClasspath
```

If the wrapper or dependency is not cached, report the limit rather than downloading it for a check. When a new version is needed, verify compatibility using [Google Maven BoM metadata](https://dl.google.com/dl/android/maven2/com/google/firebase/firebase-bom/maven-metadata.xml) and [Firestore metadata](https://dl.google.com/dl/android/maven2/com/google/firebase/firebase-firestore/maven-metadata.xml); do not force the latest version.

In your module-level `build.gradle.kts` (usually `app/build.gradle.kts`), reuse the existing BoM declaration or add a verified compatible version:

```kotlin
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:<compatible_bom_version>"))

    // Add the dependency for the Cloud Firestore library
    // When using the BoM, you don't specify versions in Firebase library dependencies
    implementation("com.google.firebase:firebase-firestore")
}
```

---

### 2. Initialize Firestore

Use the configured database ID. `Firebase.firestore` selects `(default)` only; for a named Standard database use `FirebaseFirestore.getInstance("my-database-id")` and reuse that instance.

In your Activity or Fragment, initialize the `FirebaseFirestore` instance:

```kotlin
import android.os.Bundle
import androidx.activity.ComponentActivity
import com.google.firebase.Firebase
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.firestore

class MainActivity : ComponentActivity() {

    private lateinit var db: FirebaseFirestore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        db = Firebase.firestore
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
import com.google.firebase.firestore.firestore

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val db = Firebase.firestore
        
        setContent {
            MaterialTheme {
                Text("Firestore initialized!")
            }
        }
    }
}
```

---

### 3. Add Data

These snippets implement app behavior. Use mocks or a configured emulator for checks. Executing hosted data writes requires explicit user instruction for the exact action and target project/database/documents. Preserve ownership filters, query ordering, and limits; do not broaden reads to work around a rules or index failure.

Add a new document with a generated ID using `add()`:

```kotlin
// Create a new user with a first and last name
val user = hashMapOf(
    "first" to "Ada",
    "last" to "Lovelace",
    "born" to 1815
)

// Add a new document with a generated ID
db.collection("users")
    .add(user)
    .addOnSuccessListener { documentReference ->
        Log.d(TAG, "DocumentSnapshot added with ID: ${documentReference.id}")
    }
    .addOnFailureListener { e ->
        Log.w(TAG, "Error adding document", e)
    }
```

Or set a document with a specific ID using `set()`:

```kotlin
val city = hashMapOf(
    "name" to "Los Angeles",
    "state" to "CA",
    "country" to "USA"
)

db.collection("cities").document("LA")
    .set(city)
    .addOnSuccessListener { Log.d(TAG, "DocumentSnapshot successfully written!") }
    .addOnFailureListener { e -> Log.w(TAG, "Error writing document", e) }
```

---

### 4. Read Data

Read a single document using `get()`:

```kotlin
val docRef = db.collection("cities").document("SF")
docRef.get()
    .addOnSuccessListener { document ->
        if (document != null && document.exists()) {
            Log.d(TAG, "DocumentSnapshot data: ${document.data}")
        } else {
            Log.d(TAG, "No such document")
        }
    }
    .addOnFailureListener { exception ->
        Log.d(TAG, "get failed with ", exception)
    }
```

Read multiple documents using a query:

```kotlin
db.collection("cities")
    .whereEqualTo("capital", true)
    .limit(50)
    .get()
    .addOnSuccessListener { documents ->
        for (document in documents) {
            Log.d(TAG, "${document.id} => ${document.data}")
        }
    }
    .addOnFailureListener { exception ->
        Log.w(TAG, "Error getting documents: ", exception)
    }
```

---

### 5. Update Data

Update some fields of a document using `update()` without overwriting the entire document:

```kotlin
val washingtonRef = db.collection("cities").document("DC")

// Set the "isCapital" field to true
washingtonRef
    .update("capital", true)
    .addOnSuccessListener { Log.d(TAG, "DocumentSnapshot successfully updated!") }
    .addOnFailureListener { e -> Log.w(TAG, "Error updating document", e) }
```

---

### 6. Delete Data

Delete a document using `delete()`:

```kotlin
db.collection("cities").document("DC")
    .delete()
    .addOnSuccessListener { Log.d(TAG, "DocumentSnapshot successfully deleted!") }
    .addOnFailureListener { e -> Log.w(TAG, "Error deleting document", e) }
```
