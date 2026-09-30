# Web SDK Usage (Enterprise Native Mode)

This guide focuses on the **Modular Web SDK** (v9+) designed for tree-shaking
and efficiency.

--------------------------------------------------------------------------------

## 1. Initialization

Client SDK setup does not require CLI installation, CLI initialization, provisioning, or live authentication. Reuse existing app config and initialization; use `firebase-basics` only for missing app configuration. Replace `my-database-id` with the verified/configured Enterprise database ID. Initialize that Firestore instance, then reuse `db` in later operations.

These snippets implement app behavior. Use mocks or a configured emulator for checks. Executing hosted data writes requires explicit user instruction for the exact action and target project/database/documents. Preserve ownership filters, query ordering, and limits; do not broaden reads to work around a rules or index failure.

```javascript
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  // Reuse the project's existing app configuration.
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "my-database-id");
```

--------------------------------------------------------------------------------

## 2. Decision Framework: Pipelines vs. Standard Queries

Use pipelines for supported server-side joins, aggregations, or search when they fit the task. Keep standard queries for real-time listeners or offline behavior; do not rewrite existing queries solely to impose a pipeline architecture.

Check the resolved SDK's declarations before using pipeline APIs. Current upstream points to `pipelines.d.ts` under `node_modules/@firebase/firestore/dist/`; locate the file in the installed version rather than assuming that layout. Read only the relevant stages and expression declarations. Verify Security Rules support for the selected query. Report missing API evidence without upgrading dependencies or making live calls.

--------------------------------------------------------------------------------

## 3. Pipeline Examples

### Relational Joins Pattern

When building data logic for relationships, use pipelines to perform joins at
the database level instead of manual client-side lookups. - Use `.define()` to
bind alias parameters. - Invoke `.addFields()` incorporating a new subquery
linking the documents.

```javascript
import { execute, field, variable } from "firebase/firestore/pipelines";

// Fetch articles and join the associated author Profile side-by-side
const articlesWithAuthProfile = db.pipeline().collection("articles")
  .define(field("authorUid").as("author_id"))
  .addFields(
    db.pipeline().collection("users")
      .where(field("__name__").documentId().equal(variable("author_id")))
      .select(field("displayName"), field("avatarUrl"), field("handle"))
      .toScalarExpression()
      .as("author")
  )
  .limit(50);
const snapshot = await execute(articlesWithAuthProfile);
```

### Full-Text Search

Leverage the database-native `.search()` stage for high-performance text
lookups.

```javascript
import { execute, documentMatches, score } from "firebase/firestore/pipelines";
// Execute full-text search within pipeline
const searchPipeline = db.pipeline()
  .collection("articles")
  .search({
    query: documentMatches("machine learning"),
    sort: score().descending()
  })
  .limit(5);
const results = await execute(searchPipeline);
```

--------------------------------------------------------------------------------

## 4. Real-Time Listener & Document Operations

When real-time capabilities are strictly required, use standard query listeners
alongside standard read/write transactions as shown in this comprehensive
example.

```javascript
import { collection, query, where, limit, onSnapshot, doc, updateDoc, addDoc } from "firebase/firestore";

// 1. Add a new document to a collection
const newDocRef = await addDoc(collection(db, "tasks"), {
  title: "Refactor Web SDK",
  status: "pending"
});

// 2. Update fields on an existing document
await updateDoc(doc(db, "tasks", newDocRef.id), {
  priority: "high"
});

// 3. Establish a real-time listener on a compound query
const q = query(collection(db, "tasks"), where("status", "==", "pending"), limit(50));

const unsubscribe = onSnapshot(q, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === "added") {
        console.log("Added Task: ", change.doc.id, change.doc.data());
    }
    if (change.type === "modified") {
        console.log("Updated Task: ", change.doc.id, change.doc.data());
    }
    if (change.type === "removed") {
        console.log("Removed Task: ", change.doc.id, change.doc.data());
    }
  });
});
```
