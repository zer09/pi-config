# Firebase Web Setup Guide

## 1. Reuse existing configuration
Dependency-only and existing-config tasks do not require CLI authentication, CLI download/install, project creation, app registration, or CLI initialization. Inspect the app's existing Firebase configuration and dependencies first.

Use the installed or repository-pinned Firebase CLI only when needed. If it is absent, report it and ask before download/install. Login and active-project changes require user request or agreement.

### Optional: Create a Firebase Project
Only with explicit authorization for the exact project creation action and target project ID, run:

```bash
firebase projects:create <PROJECT_ID> --display-name '<DISPLAY_NAME>'
```

### Optional: Register a Web App
Only with explicit authorization for the exact web app registration action and target project ID and app nickname, run:

```bash
firebase apps:create web my-web-app --project <PROJECT_ID>
```

Record the returned App ID. Project creation does not authorize app registration or service enablement. Service enablement needs separate explicit authorization for the exact service and target project.

## 2. Installation
For a requested dependency addition, install the Firebase SDK via npm:

```bash
npm install firebase
```

## 3. Initialization
For requested client initialization, reuse the existing config in `firebase.js` (or `firebase.ts`). If config retrieval is needed, use the identified existing app and project:

```bash
firebase apps:sdkconfig web <APP_ID> --project <PROJECT_ID>
```

Copy the output config object into your initialization file:

```javascript
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "API_KEY",
  authDomain: "PROJECT_ID.firebaseapp.com",
  projectId: "PROJECT_ID",
  storageBucket: "PROJECT_ID.firebasestorage.app",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID",
  measurementId: "G-MEASUREMENT_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { app };
```

## 4. Using Services
Import specific services as needed (Modular API):

```javascript
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { app } from "./firebase"; // Import the initialized app

const db = getFirestore(app);

async function getUsers() {
  const querySnapshot = await getDocs(collection(db, "users"));
  querySnapshot.forEach((doc) => {
    console.log(`${doc.id} => ${doc.data()}`);
  });
}
```
