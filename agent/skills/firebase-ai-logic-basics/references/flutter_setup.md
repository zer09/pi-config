# Flutter Setup for Firebase AI Logic

This guide covers how to integrate Firebase AI Logic (Gemini API) into your Flutter applications.

Reuse existing Firebase configuration, initialization, and dependencies. For a separate configuration requirement, use [Flutter setup](../../firebase-basics/references/flutter_setup.md). Client code changes do not require CLI login, initialization, or service enablement. `flutterfire configure` produces client configuration; it does not enable the AI service. Any registration or service enablement requires explicit authorization for the exact action and project. Use installed or repository-pinned tooling; ask before download/install or upgrades.

> [!NOTE]
> `firebase_vertexai` has been replaced by `firebase_ai`. Always use `firebase_ai` for new projects.

## Installation

For a requested client dependency addition, add only missing packages to `pubspec.yaml`. Preserve compatible resolved versions; these versions are examples, not an upgrade requirement:

```yaml
dependencies:
  flutter:
    sdk: flutter
  firebase_core: ^4.0.0
  firebase_auth: ^6.0.0
  firebase_ai: ^3.0.0
```

Run `flutter pub get` to install the packages.

## Initialization

Initialize Firebase and sign in (anonymously or via authenticated user) before using AI Logic.

```dart
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_ai/firebase_ai.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  await FirebaseAuth.instance.signInAnonymously();
  runApp(const MyApp());
}
```

## Usage

Use `FirebaseAI.googleAI` for the **Gemini Developer API**.

> [!IMPORTANT]
> **Model Selection:** Replace `<supported-model>` with a model supported by the chosen provider and feature in the [model documentation](https://firebase.google.com/docs/ai-logic/models.md.txt).

> [!IMPORTANT]
> **Choose the Right API Provider:** Use `FirebaseAI.googleAI` (Gemini Developer API) as the default for prototyping and standard use. Use the Agent Platform Gemini API, formerly Vertex AI Gemini API, only for enterprise scalability or data-residency requirements. The Gemini Developer API usually does not require Blaze billing, but Agent Platform does.

### Text Generation

```dart
import 'package:firebase_ai/firebase_ai.dart';
import 'package:firebase_auth/firebase_auth.dart';

Future<String> generateText(String prompt) async {
  final googleAI = FirebaseAI.googleAI(auth: FirebaseAuth.instance);

  final model = googleAI.generativeModel(model: '<supported-model>');

  final response = await model.generateContent([Content.text(prompt)]);
  return response.text ?? 'No response';
}
```

### Chat Session

```dart
final chat = model.startChat(history: [
  Content.text('Hello, I am a user.'),
  Content.model([TextPart('Hello! How can I help you today?')]),
]);

final response = await chat.sendMessage(Content.text('What is CBT?'));
```
