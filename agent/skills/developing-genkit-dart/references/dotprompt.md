# Dotprompt: Genkit Dart

Use this guide only with a resolved SDK that supports these APIs. The [pinned source](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-dart/references/dotprompt.md) has deeper examples. Keep the project's provider, model IDs, dependencies, and prompt layout.

## Load, call, stream, render

`Genkit(promptDir: './prompts', plugins: [...])` loads `.prompt` files from the selected directory; `promptDir: null` disables automatic loading. `ai.prompt(name, variant: ...)` returns a `Future<ExecutablePrompt>`. Await loading, then pass input positionally, not as `input:`.

These fragments reuse an initialized `ai` and existing prompt files. Call/stream require authorization for any hosted work; render does not generate, but template helpers can still have side effects.

```dart
final greeting = await ai.prompt('greeting');
final response = await greeting({'name': 'World', 'style': 'cheerful'});
final rendered = await greeting.render({'name': 'World', 'style': 'casual'});
// Inspect rendered.model / rendered.messages without logging sensitive content.
final story = await ai.prompt('story');
final stream = story.stream({'subject': 'a robot'});
await for (final chunk in stream) {
  // Deliver chunk.text to the authorized caller.
}
```

`render` returns `GenerateActionOptions`. Variants use `<name>.<variant>.prompt`; partials use `_<name>.prompt` and `{{> name param=value}}`.

## Schemas and tool-loop fields

Register named JSON Schema maps with `ai.defineSchema('Recipe', schemaMap)` before referring to `Recipe` in frontmatter. Code-defined prompts use generated Schemantic schemas such as `Recipe.$schema`; see [Schemantic](schemantic.md).

Example frontmatter for a project with the named schema and tool already registered:

```prompt
---
input:
  schema:
    food: string
output:
  schema: Recipe
  format: json
tools:
  - lookupRecipe
maxTurns: 20
returnToolRequests: false
use:
  - name: retry
    config:
      maxRetries: 2
---
{{role "system"}}
Suggest a recipe using the approved lookup tool.
{{role "user"}}
Make a recipe for {{food}}.
```

Set the model through the project's existing default or frontmatter. `tools` names must resolve to registered tools. `toolChoice`, `maxTurns`, and `returnToolRequests` keep generation semantics; returning tool requests does not execute them. `use` accepts middleware names or `{name, config}` maps. Register core `RetryPlugin()` in the existing plugin array before resolving `retry`; bound retries and tool side effects.

With compatible [experimental agents](agents.md), `ai.definePromptAgent(promptName: 'recipe', promptInput: {...}, store: ...)` uses the `.prompt` file and its tool/middleware fields. Keep stable preamble inputs; do not migrate existing flows just to use this API.
