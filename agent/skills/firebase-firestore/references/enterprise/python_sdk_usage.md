# Python SDK Usage

The Python Server SDK is used for backend/server environments and utilizes
Google Application Default Credentials in most Google Cloud environments.

Initialize one client with the verified/configured Enterprise database ID and explicit project, then reuse `db`. This is application code, not a maintenance command. Do not authenticate or load credentials to validate local SDK edits. Server SDK access uses IAM rather than client Security Rules; keep application authorization checks. Executing hosted data writes requires explicit user instruction for the exact action and target project/database/documents.

```python
from google.cloud import firestore

# Use the configured target; never fall back to the default database.
db = firestore.Client(project="<project-id>", database="my-database-id")
```

### Writing Data

#### Set a Document

Creates a document if it does not exist or overwrites it if it does. You can
also specify a merge option to only update provided fields.

```python
city_ref = db.collection("cities").document("LA")

# Create/Overwrite
city_ref.set({
    "name": "Los Angeles",
    "state": "CA",
    "country": "USA"
})

# Merge
city_ref.set({"population": 3900000}, merge=True)
```

#### Add a Document with Auto-ID

Use when you don't care about the document ID and want Firestore to
automatically generate one.

```python
update_time, city_ref = db.collection("cities").add({
    "name": "Tokyo",
    "country": "Japan"
})
print("Document written with ID: ", city_ref.id)
```

#### Update a Document

Update some fields of an existing document without overwriting the entire
document. Fails if the document doesn't exist.

```python
city_ref = db.collection("cities").document("LA")
city_ref.update({
    "capital": True
})
```

#### Transactions

Perform an atomic read-modify-write operation.

```python
from google.cloud import firestore

transaction = db.transaction()
city_ref = db.collection("cities").document("SF")

@firestore.transactional
def update_in_transaction(transaction, city_ref):
    snapshot = city_ref.get(transaction=transaction)
    if not snapshot.exists:
        raise Exception("Document does not exist!")

    new_population = snapshot.get("population") + 1
    transaction.update(city_ref, {"population": new_population})

update_in_transaction(transaction, city_ref)
```

### Reading Data

#### Get a Single Document

```python
doc_ref = db.collection("cities").document("SF")
doc = doc_ref.get()

if doc.exists:
    print(f"Document data: {doc.to_dict()}")
else:
    print("No such document!")
```

#### Get Multiple Documents

Fetches all documents in a query or collection once.

```python
docs = db.collection("cities").limit(50).stream()

for doc in docs:
    print(f"{doc.id} => {doc.to_dict()}")
```

### Queries

#### Simple and Compound Queries

Use `.where()` to combine filters safely. Stack `.where()` calls for compound
queries.

```python
from google.cloud.firestore import FieldFilter

cities_ref = db.collection("cities")

# Simple equality
query_1 = cities_ref.where(filter=FieldFilter("state", "==", "CA"))

# Compound (AND)
query_2 = cities_ref.where(
    filter=FieldFilter("state", "==", "CA")
).where(
    filter=FieldFilter("population", ">", 1000000)
)
```

#### Order and Limit

Sort and limit results cleanly.

```python
query = cities_ref.order_by("name").limit(3)
```

#### Pipeline Queries

Use pipeline queries when supported by the resolved SDK and selected database. Verify the needed APIs locally before using them. Preserve ownership filters, query ordering, and limits; do not fetch unbounded data to bypass authorization or indexes.

```python
pipeline = db.pipeline().collection("users").limit(50)
for result in pipeline.execute():
    print(f"{result.id} => {result.data()}")
```
