# Cloud Firestore in Flutter

This guide covers basic CRUD operations, type-safe data modeling, and real-time streams when using Cloud Firestore in a Flutter application via the `cloud_firestore` package.

## 1. Setup

Reuse existing app configuration and compatible pinned dependencies. Client SDK setup does not require CLI installation, CLI initialization, provisioning, or live authentication. Add the dependency only when needed for the requested local change:
```bash
flutter pub add cloud_firestore
```
Reuse FlutterFire configuration for the intended platforms. These snippets implement app behavior; use mocks or a configured emulator for checks. Executing hosted data writes requires explicit user instruction for the exact action and target project/database/documents.

Preserve ownership filters, query ordering, and limits. Do not sort a limited unsorted subset or fetch unbounded data to bypass a missing index. Prepare the needed index locally; deployment requires separate exact authorization.

---

## 2. Best Practices: Type-Safe Models

Instead of passing raw `Map<String, dynamic>` maps throughout your UI layer, define a domain model class with `fromFirestore` and `toFirestore` converters to maintain type safety.

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

class Item {
  final String id;
  final String name;
  final String ownerId;
  final DateTime createdAt;

  Item({
    required this.id,
    required this.name,
    required this.ownerId,
    required this.createdAt,
  });

  factory Item.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};
    return Item(
      id: doc.id,
      name: data['name'] as String? ?? '',
      ownerId: data['ownerId'] as String? ?? '',
      createdAt: data['createdAt'] is Timestamp 
          ? (data['createdAt'] as Timestamp).toDate() 
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'ownerId': ownerId,
      'createdAt': Timestamp.fromDate(createdAt),
    };
  }
}
```

---

## 3. The Service Layer

Encapsulate all database interactions within a dedicated service class to keep your UI code clean and testable.

### Initialization & References

Await the existing `Firebase.initializeApp(...)` before selecting the database. Reuse the intended app's FlutterFire configuration; do not initialize it again. Standard is an edition, not a database ID. Verify the project and database ID from existing configuration, then choose one construction below.

Only when the verified target is `(default)`:

```dart
final itemService = ItemService(FirebaseFirestore.instance);
```

For a named Standard database, replace `my-database-id` with the verified/configured Standard database ID:

```dart
import 'package:firebase_core/firebase_core.dart';

final itemService = ItemService(
  FirebaseFirestore.instanceFor(
    app: Firebase.app(),
    databaseId: 'my-database-id',
  ),
);
```

Inject the selected instance into the service. Every operation uses that instance, with no internal fallback to `(default)`.

```dart
class ItemService {
  final FirebaseFirestore _db;

  ItemService(FirebaseFirestore db) : _db = db;

  // Define your collection reference
  CollectionReference get _itemsRef => _db.collection('items');

  // 1. Create Data
  Future<void> createItem(Item item) async {
    try {
      await _itemsRef.add(item.toFirestore());
    } catch (e) {
      print("Error creating document: \$e");
    }
  }

  // 2. Read Data (One-Time Fetch)
  Future<List<Item>> fetchItems(String ownerId) async {
    try {
      final querySnapshot = await _itemsRef
          .where('ownerId', isEqualTo: ownerId)
          .orderBy('createdAt', descending: true)
          .limit(50)
          .get();

      return querySnapshot.docs.map((doc) => Item.fromFirestore(doc)).toList();
    } catch (e) {
      print("Error fetching documents: \$e");
      return [];
    }
  }

  // 3. Read Data (Real-Time Stream)
  Stream<List<Item>> streamItems(String ownerId) {
    return _itemsRef
        .where('ownerId', isEqualTo: ownerId)
        .orderBy('createdAt', descending: true)
        .limit(50)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((doc) => Item.fromFirestore(doc)).toList());
  }

  // 4. Update Data
  Future<void> updateItemName(String id, String newName) async {
    try {
      await _itemsRef.doc(id).update({'name': newName});
    } catch (e) {
      print("Error updating document: \$e");
    }
  }

  // 5. Delete Data
  Future<void> deleteItem(String id) async {
    try {
      await _itemsRef.doc(id).delete();
    } catch (e) {
      print("Error deleting document: \$e");
    }
  }
}
```

---

## 4. Listening to Streams in the UI (`StreamBuilder`)

Use Flutter's `StreamBuilder` to rebuild the interface reactively whenever data changes in your database collection.

```dart
StreamBuilder<List<Item>>(
  stream: itemService.streamItems(currentUser.uid),
  builder: (context, snapshot) {
    if (snapshot.hasError) {
      return const Center(child: Text('Failed to load data'));
    }

    if (snapshot.connectionState == ConnectionState.waiting) {
      return const Center(child: CircularProgressIndicator());
    }

    final items = snapshot.data ?? [];

    if (items.isEmpty) {
      return const Center(child: Text('No items found.'));
    }

    return ListView.builder(
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return ListTile(
          title: Text(item.name),
          trailing: IconButton(
            icon: const Icon(Icons.delete),
            onPressed: () => itemService.deleteItem(item.id),
          ),
        );
      },
    );
  },
);
```
