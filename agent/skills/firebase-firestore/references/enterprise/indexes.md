# Firestore Indexes Reference

Indexes helps to improve query performance. Firestore Enterprise edition does
not create any indexes by default. By default, Firestore Enterprise performs a
full collection scan to find documents that match a query, which can be slow and
expensive for large collections. To avoid this, you can create indexes to
optimize your queries.

## Index Structure

An index consists of the following:

*   a collection ID.
*   a list of fields in the given collection.
*   an order, either ascending or descending, for each field.

### Index Ordering

The order and sort direction of each field uniquely defines the index. For
example, the following indexes are two distinct indexes and not interchangeable:

*   Field name `name` (ascending) and `population` (descending)
*   Field name `name` (descending) and `population` (ascending)

### Index Density

Dense indexes: By default, Firestore indexes store data from all documents in a
collection. An index entry will be added for a document regardless of whether
the document contains any of the fields specified in the index. Non-existent
fields are treated as having a NULL value when generating index entries.

Sparse indexes: To change this behavior, you can define the index as a sparse
index. A sparse index indexes only the documents in the collection that contain
a value (including null) for at least one of the indexed fields. A sparse index
reduces storage costs and can improve performance.

### Unique Indexes

You can use unique index option to enforce unique values for the indexed fields.
For indexes on multiple fields, each combination of values must be unique across
the index. The database rejects any update and insert operations that attempt to
create index entries with duplicate values.

## Query Support Examples

| Query | Index to consider |
| --- | --- |
| `where("a", "==", 1)` | Single-field on `a` |
| `where("a", ">", 1).orderBy("a")` | Single-field on `a` |
| `where("a", "==", 1).where("b", "==", 2)` | Single-field on `a` and `b` |
| `where("a", "==", 1).where("b", ">", 2)` | Composite on `a` and `b` |
| `where("a", ">", 1).where("b", ">", 2)` | Composite on `a` and `b` |
| `where("tags", "array-contains", "news").where("active", "==", true)` | Composite on `tags` and `active` |

If no indexes is present, Firestore Enterprise will perform a full collection
scan to find documents that match a query.

## Management

### Config files

Your indexes should be defined in `firestore.indexes.json` (pointed to by
`firebase.json`).

Define a dense index:

```json
{
  "indexes": [
    {
      "collectionGroup": "cities",
      "queryScope": "COLLECTION",
      "density": "DENSE",
      "fields": [
        { "fieldPath": "country", "order": "ASCENDING" },
        { "fieldPath": "population", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

Define a sparse-any index:

```json
{
  "indexes": [
    {
      "collectionGroup": "cities",
      "queryScope": "COLLECTION",
      "density": "SPARSE_ANY",
      "fields": [
        { "fieldPath": "country", "order": "ASCENDING" },
        { "fieldPath": "population", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

Define a unique index:

```json
{
  "indexes": [
    {
      "collectionGroup": "cities",
      "queryScope": "COLLECTION",
      "density": "SPARSE_ANY",
      "unique": true,
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

Index deployment requires explicit authorization for the exact action and target project/database. Verify the database exists and confirm its Enterprise edition/native access mode. A missing target does not authorize database creation. For local work, validate the index configuration without deployment.

Before deployment, apply the [single-database config and creation gates](provisioning.md#explicitly-authorized-deployment). `<single-database-config>` must contain only the authorized existing database and resource files; a broad config can affect other databases even with an index-only selector.

```bash
firebase deploy --only firestore:indexes --project <project-id> --config <single-database-config>
```
