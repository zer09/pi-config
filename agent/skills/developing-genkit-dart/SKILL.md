---
name: developing-genkit-dart
description: "Implement or debug Genkit Dart/Flutter generation, flows, tools, schemas, and provider integrations. Use for Genkit Dart SDK code, setup, or Dart-specific API errors."
---

# Genkit Dart

## Safety and version checks

- Local code edits and checks are allowed within the requested task. Firebase/GCP mutations, deployment, provider or secret changes, and live model/API calls require explicit user instruction for the exact action. A local flow or Dev UI can still call hosted services.
- Never print, save, or commit API keys, tokens, or service credentials. Use environment variable names or `<api-key>` placeholders.
- Inspect `pubspec.yaml`, `pubspec.lock`, existing imports, and generated schemas. Preserve project versions; do not upgrade dependencies unless requested. Verify uncertain syntax against installed source, the relevant reference, or current [package documentation](https://pub.dev/packages/genkit).

## Selected references

Use Dart APIs rather than translating another Genkit SDK's syntax. Load only the relevant guide:

| Task | Reference |
| --- | --- |
| Setup or optional CLI/Dev UI | [Getting started](references/getting-started.md) |
| `Genkit()`, `generate`, `generateStream`, `embedMany`, tools, flows, remote clients | [Core framework](references/genkit.md) |
| Schemantic schema mapping, `@Schema()`, generated `$schema` types | [Schemantic](references/schemantic.md) |
| Gemini | [Google GenAI](references/genkit_google_genai.md) |
| Claude | [Anthropic](references/genkit_anthropic.md) |
| OpenAI or compatible endpoints | [OpenAI](references/genkit_openai.md) |
| Agent middleware, filesystem, skills, approval interrupts | [Middleware](references/genkit_middleware.md) |
| MCP client/server/host | [MCP](references/genkit_mcp.md) |
| On-device Chrome Prompt API | [Chrome](references/genkit_chrome.md) |
| HTTP flows through Shelf | [Shelf](references/genkit_shelf.md) |
| Firebase AI provider | [Firebase AI](references/genkit_firebase_ai.md) |

Genkit Dart schema mapping uses Schemantic. Regenerate affected schema files using the project's existing generator when definitions change; preserve generated-code conventions.

## Validation and completion

Validate affected code with available project checks, such as `dart analyze`, Flutter analysis, and focused tests. Documentation-only changes need relevant link/example checks, not an unrelated analyzer run. Use the Genkit CLI only when the task benefits from tracing, flow inspection, or the Dev UI; do not run live calls as a validation shortcut.

Finish with the requested deliverable, checks and results, and version assumptions or blocked checks. Fix in-scope regressions without expanding into dependency upgrades or hosted actions.

## Maintenance

For future updates, read the [Firebase skills update process](../../../docs/skills/firebase-skills-update-process.md).
