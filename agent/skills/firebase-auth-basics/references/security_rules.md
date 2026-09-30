# Authentication in Firestore Security Rules

Use `request.auth` for Firebase Authentication identity in Firestore rules. Use [firebase-firestore](../../firebase-firestore/SKILL.md) for requested rule implementation and edition-specific guidance. Route reviews to [firebase-security-rules-auditor](../../firebase-security-rules-auditor/SKILL.md); audits are read-only and do not authorize fixes, live bypass attempts, or deployment. These examples do not cover Cloud Storage rules.

## Identity is not authorization

`request.auth != null` establishes sign-in, not permission to read every document. Check ownership or trusted roles and validate allowed fields, types, and size limits. Do not trust a client-writable profile field as an admin authority.

For UID-keyed documents, compare the path variable with `request.auth.uid`. For field-based ownership, creation checks the proposed data; reads/deletes check stored data; updates check both and keep ownership immutable.

## Field-based ownership example

This example models private notes containing only `owner_uid` and `body`. Adapt the schema to the intended access model rather than copying a blanket authenticated rule. Only explicitly requested public access may relax the owner boundary.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /notes/{noteId} {
      function signedIn() {
        return request.auth != null;
      }
      function ownsExisting() {
        return signedIn() && resource.data.owner_uid == request.auth.uid;
      }
      function validNote(data) {
        return data.keys().hasAll(['owner_uid', 'body']) &&
          data.keys().hasOnly(['owner_uid', 'body']) &&
          data.owner_uid is string && data.owner_uid.size() <= 128 &&
          data.body is string && data.body.size() <= 2000;
      }
      allow create: if signedIn() && validNote(request.resource.data) &&
        request.resource.data.owner_uid == request.auth.uid;
      allow get, delete: if ownsExisting();
      allow list: if ownsExisting() && request.query.limit <= 50;
      allow update: if ownsExisting() && validNote(request.resource.data) &&
        request.resource.data.owner_uid == resource.data.owner_uid;
    }
  }
}
```

Rules are not filters. A collection query must constrain `owner_uid` to the authenticated user's UID and include a limit of at most 50. Test unauthenticated access, another user's data, ownership changes, missing/extra fields, oversized values, and queries without the required filter or limit. Use available local tests or supported emulation; do not exercise live bypasses or deploy as validation.

## Token properties

Firebase-verified `request.auth.token` can contain `email`, `email_verified`, `name`, and custom claims. Check `request.auth != null` before accessing claims. An email-verification check supplements ownership and validation; it does not grant access by itself. Custom claims must come from a trusted privileged process, not client input. Setting claims requires explicit user instruction for the exact user and target project/environment.

Rule publishing requires explicit user instruction for the exact project, database, and rules. State assumptions and untested behavior; local checks are not a security guarantee.
