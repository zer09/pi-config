# Genkit Middleware (`genkit_middleware`)

A collection of useful middleware for Genkit Dart to enhance your agent's capabilities. Register plugins when initializing Genkit:

```dart
import 'package:genkit/genkit.dart';
import 'package:genkit_middleware/genkit_middleware.dart';

void main() {
  final ai = Genkit(
    plugins: [
      FilesystemPlugin(),
      SkillsPlugin(),
      ToolApprovalPlugin(),
    ],
  );
}
```

## Filesystem Middleware
Allows the agent to list, read, write, and search/replace files within a restricted root directory.

```dart
final response = await ai.generate(
  prompt: 'Check the logs in the current directory.',
  use: [
    filesystem(rootDirectory: '/path/to/secure/workspace'),
  ],
);
```

**Tools Provided:**
- `list_files`, `read_file`, `write_file`, `search_and_replace`

## Skills Middleware
Injects specialized instructions (skills) into the system prompt from `SKILL.md` files located in specified directories.

```dart
final response = await ai.generate(
  prompt: 'Help me debug this issue.',
  use: [
    skills(skillPaths: ['/path/to/skills']),
  ],
);
```

**Tools Provided:**
- `use_skill`: Retrieve the full content of a skill by name.

## Tool Approval Middleware
Intercepts tool execution for specified tools and requires explicit approval. Returns `FinishReason.interrupted`.

For the resolved SDK with restart builders, `.restart(payload)` nests approval under `metadata.resumed`; a top-level metadata flag does not approve the tool. Approve only the reviewed pending operation and target. Middleware approval does not replace application authorization.

```dart
final response = await ai.generate(
  prompt: 'Delete the database.',
  use: [
    // Require approval for all tools EXCEPT those below
    toolApproval(approved: ['read_file', 'list_files']),
  ],
);

if (response.finishReason == FinishReason.interrupted) {
  final interrupt = response.interrupts.first;
  
  // Ask user for approval
  final isApproved = await askUser();

  if (isApproved) {
    final resumeResponse = await ai.generate(
      messages: response.messages, // Pass history
      toolChoice: ToolChoice.none, // Prevent immediate re-call
      interruptRestart: [
        interrupt.restart({'tool-approved': true}),
      ],
    );
  }
}
```
