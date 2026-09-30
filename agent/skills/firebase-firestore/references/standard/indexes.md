# Firestore Indexes Reference

Indexes allow Firestore to ensure that query performance depends on the size of
the result set, not the size of the database.

## Index Types

### Single-Field Indexes

In Standard Edition, Firestore **automatically creates** a single-field index
for every field in a document (and subfields in maps). * **Support**: Simple
equality queries (`==`) and single-field range/sort queries (`<`, `<=`,
`orderBy`). * **Behavior**: You generally don't need to manage these unless you
want to *exempt* a field.

### Composite Indexes

A composite index stores a sorted mapping of all documents based on an ordered
list of fields. * **Support**: Complex queries that filter or sort by **multiple
fields**. * **Creation**: These are **NOT** automatically created. You must
define them manually or via the console/CLI.

## Automatic vs. Manual Management

### What is Automatic?

*   Indexes for simple queries.
*   Merging of single-field indexes for multiple equality filters (e.g.,
    `where("state", "==", "CA").where("country", "==", "USA")`).

### When Do I Need to Act?

If you attempt a query that requires a composite index, the SDK will throw an
error containing a **direct link** to the Firebase Console to create that
specific index.

**Example Error:**

> "The query requires an index. You can create it here:
> https://console.firebase.google.com/project/..."

## Query Support Examples

| Query | Index |
| --- | --- |
| `where("a", "==", 1)` | Automatic single-field |
| `where("a", ">", 1).orderBy("a")` | Automatic single-field |
| `where("a", "==", 1).where("b", "==", 2)` | Merged single-field |
| `where("a", "==", 1).where("b", ">", 2)` | Composite |
| `where("a", ">", 1).where("b", ">", 2)` | Composite; verify query constraints |
| `where("tags", "array-contains", "news").where("active", "==", true)` | Composite |

## Best Practices & Exemptions

You can **exempt** fields from automatic indexing to save storage or strictly
enforce write limits.

### 1. High Write Rates (Sequential Values)

*   **Problem**: Indexing fields that increase sequentially (like `timestamp`)
    limits the write rate to ~500 writes/second per collection.
*   **Solution**: If you don't query on this field, **exempt** it from simple
    indexing.

### 2. Large String/Map/Array Fields

*   **Problem**: Indexing limits (40k entries per doc). Indexing large blobs
    wastes storage.
*   **Solution**: Exempt large text blobs or huge arrays if they aren't used for
    filtering.

### 3. TTL Fields

*   **Problem**: TTL (Time-To-Live) deletion can cause index churn.
*   **Solution**: Exempt the TTL timestamp field from indexing if you don't
    query it.

## Management

### Config files

Your indexes should be defined in `firestore.indexes.json` (pointed to by
`firebase.json`).

```json
{
  "indexes": [
    {
      "collectionGroup": "cities",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "country", "order": "ASCENDING" },
        { "fieldPath": "population", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

### Explicitly authorized deployment

Index deployment requires explicit authorization for the exact action and target project/database. Verify the database exists and confirm its edition/access mode. A missing target does not authorize database creation. For local work, validate the index configuration without deployment.

Before deployment, apply the [single-database config and creation gates](provisioning.md#explicitly-authorized-deployment). `<single-database-config>` must contain only the authorized existing database and resource files; a broad config can affect other databases even with an index-only selector.

```bash
firebase deploy --only firestore:indexes --project <project-id> --config <single-database-config>
```
