# Firestore Enterprise Native Mode on Android (Kotlin)

This guide walks you through using the Cloud Firestore SDK in your Android app using Kotlin. The SDK for Firestore Enterprise Native Mode is the same as the standard Cloud Firestore SDK.

### Local SDK setup

Client SDK setup does not require CLI installation, CLI initialization, provisioning, or live authentication. Backend provisioning and service enablement are separate actions that require explicit user instruction for each exact action and target project/database. Only when explicitly requested, follow the [Enterprise provisioning reference](provisioning.md).

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
    implementation("com.google.firebase:firebase-firestore")
}
```

---

### 2. Initialize Firestore

In both examples, replace `my-database-id` with the verified/configured Enterprise database ID. Initialize `db` for that database and reuse it in later operations.

In your Activity or Fragment, initialize the `FirebaseFirestore` instance:

```kotlin
import android.os.Bundle
import androidx.activity.ComponentActivity
import com.google.firebase.firestore.FirebaseFirestore

class MainActivity : ComponentActivity() {

    private lateinit var db: FirebaseFirestore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        db = FirebaseFirestore.getInstance("my-database-id")
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
import com.google.firebase.firestore.FirebaseFirestore

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val db = FirebaseFirestore.getInstance("my-database-id")
        
        setContent {
            MaterialTheme {
                Text("Firestore initialized!")
            }
        }
    }
}
```

---

### 3. Pipeline queries

Use pipelines for supported server-side joins, aggregations, or search when they fit the task. Keep standard queries for real-time listeners or offline behavior; do not rewrite an existing query solely to impose a pipeline architecture.

Verify APIs against the resolved SDK version. Inspect the matching local Maven `-sources.jar`; read `pipeline.docs.txt` for the needed stages and `expressions.docs.txt` for the selected expressions. If those files are unavailable, report the evidence gap rather than inventing APIs or upgrading dependencies. Kotlin uses `.alias(...)`, not Web's `.as(...)`.

For SDK versions that provide these APIs, a bounded search pipeline is:

```kotlin
import com.google.firebase.firestore.pipeline.Expression.documentMatches
import com.google.firebase.firestore.pipeline.Expression.score
import com.google.firebase.firestore.pipeline.SearchStage

val searchPipeline = db.pipeline()
    .collection("articles")
    .search(
        SearchStage.withQuery(documentMatches("machine learning"))
            .withSort(score().descending())
    )
    .limit(5)
```

Reuse the named `db` instance. Verify execution syntax and Security Rules support for the selected query and SDK before use. Preserve ownership filters, query ordering, and limits; do not perform unbounded client-side joins or remove access restrictions to make a query work.

### 4. Basic CRUD Operations

The operations are identical to standard Firestore. These snippets implement app behavior; use mocks or a configured emulator for checks. Executing hosted data writes requires explicit user instruction for the exact action and target project/database/documents.

#### Add Data

```kotlin
val user = hashMapOf(
    "first" to "Alan",
    "last" to "Turing",
    "born" to 1912
)

db.collection("users")
    .add(user)
    .addOnSuccessListener { documentReference ->
        Log.d(TAG, "DocumentSnapshot added with ID: ${documentReference.id}")
    }
    .addOnFailureListener { e ->
        Log.w(TAG, "Error adding document", e)
    }
```

#### Read Data

```kotlin
db.collection("users")
    .limit(50)
    .get()
    .addOnSuccessListener { result ->
        for (document in result) {
            Log.d(TAG, "${document.id} => ${document.data}")
        }
    }
    .addOnFailureListener { exception ->
        Log.w(TAG, "Error getting documents.", exception)
    }
```

#### Update Data

```kotlin
val userRef = db.collection("users").document("your-document-id")

userRef
    .update("born", 1913)
    .addOnSuccessListener { Log.d(TAG, "DocumentSnapshot successfully updated!") }
    .addOnFailureListener { e -> Log.w(TAG, "Error updating document", e) }
```

#### Delete Data

```kotlin
db.collection("users").document("your-document-id")
    .delete()
    .addOnSuccessListener { Log.d(TAG, "DocumentSnapshot successfully deleted!") }
    .addOnFailureListener { e -> Log.w(TAG, "Error deleting document", e) }
```
