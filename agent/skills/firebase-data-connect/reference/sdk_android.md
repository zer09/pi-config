# Android SDK

Consult this file when writing Android application code (Kotlin) that interacts with the SQL Connect backend. Reuse the existing generated connector, module/variant config, and Google services plugin. For a separate config requirement, see [Android setup](../../firebase-basics/references/android_setup.md). Client dependency work does not require CLI login, live project discovery, initialization, or backend provisioning.

### Best Practices for Agents
- **Operation compatibility**: SQL Connect stores operations on the server. Regenerate affected SDKs after local operation changes and test against the emulator. Coordinate publication before clients use changed production operations, but deploy only with explicit user instruction for that exact action. Local work does not authorize redeployment.
- **Resilient Enum Handling**: The generated SDK forces handling of unknown values by wrapping them in `EnumValue`. You must unwrap it into `EnumValue.Known` or `EnumValue.Unknown` to handle schema updates gracefully.
- **Flow Behavior**: While you can collect a Flow from a query, note that **this Flow is not updated in real-time automatically** by default. It only produces a result when a new query result is retrieved using a call to the query's `execute()` method.
- **Leverage Coroutines**: Call `.execute()` within a coroutine scope for asynchronous operations.

### Dependencies (build.gradle.kts)

Inspect existing Gradle files, version catalogs, and resolved dependencies before adding packages. Preserve compatible BoM, Kotlin, serialization, and coroutine versions. When available, inspect the selected module/variant with `./gradlew --offline -q :app:dependencyInsight --dependency firebase-dataconnect --configuration releaseRuntimeClasspath`; adjust the module/configuration to the app. If offline resolution is unavailable, report it rather than installing tooling or forcing latest versions.

For a requested dependency addition, reuse existing declarations and add only what is missing. Replace the placeholders with the project's compatible versions:

```kotlin
plugins {
    kotlin("plugin.serialization") version "<project-kotlin-version>"
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:<compatible-bom-version>"))
    implementation("com.google.firebase:firebase-dataconnect")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:<compatible-coroutines-version>")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-core:<compatible-serialization-version>")
}
```

### Initialization

Retrieve the generated connector instance:

```kotlin
import com.google.firebase.dataconnect.generated.MoviesConnector

val connector = MoviesConnector.instance

// For local development with emulator
// Defaults to correct host for Android emulator (10.0.2.2)
connector.dataConnect.useEmulator()
// Or specify a non-default port:
// connector.dataConnect.useEmulator(port = 9999)
```

### Calling Operations

#### Basic Query
```kotlin
val result = connector.listMovies.execute()
result.data.movies.forEach { movie ->
    println(movie.title)
}
```

#### Mutation
```kotlin
val newMovie = connector.createMovie.execute(
    title = "Empire Strikes Back",
    releaseYear = 1980,
    genre = "Sci-Fi",
    rating = 5
)
```

### Resilient Enum Handling
Unwrap the `EnumValue` to handle known and unknown cases safely.

```kotlin
val result = connector.listMovies.execute()

result.data.movies.forEach { movie ->
    when (val aspect = movie.aspectratio) {
        is EnumValue.Known -> println("Known aspect: ${aspect.value.name}")
        is EnumValue.Unknown -> println("Unknown aspect: ${aspect.stringValue}")
    }
}
```

### Client-Side Caching
Enable caching in `connector.yaml` to reduce requests and support offline scenarios.

```yaml
generate:
  kotlinSdk:
    outputDir: "../android"
    package: "com.google.firebase.dataconnect.generated"
    clientCache:
      maxAge: 5s
      storage: persistent # Default for Android is persistent
```

Use policies in code:
```kotlin
val queryResult = queryRef.execute(QueryRef.FetchPolicy.CACHE_ONLY)
val queryResult = queryRef.execute(QueryRef.FetchPolicy.SERVER_ONLY)
```

### Data Type Mapping Reference
- GraphQL `String` -> Kotlin `String`
- GraphQL `Int` -> Kotlin `Int` (32-bit)
- GraphQL `Float` -> Kotlin `Double` (64-bit)
- GraphQL `Boolean` -> Kotlin `Boolean`
- GraphQL `UUID` -> Kotlin `java.util.UUID`
- GraphQL `Date` -> Kotlin `com.google.firebase.dataconnect.LocalDate`
- GraphQL `Timestamp` -> Kotlin `com.google.firebase.Timestamp`
- GraphQL `Int64` -> Kotlin `Long`
- GraphQL `Any` -> Kotlin `com.google.firebase.dataconnect.AnyValue`
