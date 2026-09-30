# Dotprompt in Genkit JS

`.prompt` files combine YAML frontmatter with a Handlebars template. Reuse the project's prompt directory and registered schemas. Genkit defaults to `./prompts`; `promptDir` changes the directory, and `promptDir: null` disables automatic loading.

Calling or streaming a prompt can invoke a hosted model and its tools. Require exact authorization for live calls, provider/secret changes, and hosted mutations. Rendering alone does not generate model output; inspect custom helpers for side effects before using them in a local check.

## Named schemas and files

Register named schemas before rendering or calling a prompt that references them. Import `z` from `genkit` and describe structured fields:

```ts
import { z } from 'genkit';

ai.defineSchema('Recipe', z.object({
  title: z.string().describe('Recipe title'),
  steps: z.array(z.string()).describe('Preparation steps'),
}));
```

`prompts/recipe.prompt` uses Picoschema for input and the registered name for output. Select a verified model supported by the existing provider instead of changing the project's model merely to match this example.

```prompt
---
model: googleai/gemini-pro-latest
input:
  schema:
    food: string
output:
  schema: Recipe
---
Generate a recipe for {{food}}.
```

## Call, stream, or render

`ai.prompt(name, { variant? })` returns a callable `ExecutablePrompt`, not an object with an `execute()` method. It also exposes `.stream()`, `.render()`, and `.asTool()`.

```ts
const recipePrompt = ai.prompt('recipe');
const result = await recipePrompt({ food: 'banana bread' });
const recipe = result.output;
```

For a streaming text prompt, consume the stream and then await the final response:

```ts
const storyPrompt = ai.prompt('story');
const { response, stream } = storyPrompt.stream({ subject: 'a robot' });
for await (const chunk of stream) {
  // Consume text without logging sensitive content.
  consumeText(chunk.text);
}
const final = await response;
consumeText(final.text);
```

`consumeText` stands for the application's existing output consumer. To inspect generated options without a model call:

```ts
const rendered = await ai.prompt('recipe').render({ food: 'banana bread' });
// rendered contains GenerateOptions: messages, model, config, and other options.
```

## Variants, partials, and helpers

- Name a variant `<name>.<variant>.prompt`, such as `recipe.robot.prompt`. Select it with `ai.prompt('recipe', { variant: 'robot' })`.
- Name a partial `_<name>.prompt`. Include it with `{{>name param=value}}`.
- Register template helpers with `ai.defineHelper(name, fn)`. Keep helpers local and side-effect-free when using render-only checks.

## Tools and middleware

Frontmatter accepts `tools` (registered tool names), `toolChoice` (`auto`, `required`, `none`), `maxTurns`, `returnToolRequests`, and `use`. These match generation options, not authorization rules. A `use` entry is a registered middleware name or a map with `name` and optional `config`.

```prompt
---
model: googleai/gemini-flash-latest
input:
  schema:
    tone: string
tools:
  - getAttractions
  - getFlightInfo
toolChoice: auto
maxTurns: 20
returnToolRequests: false
use:
  - name: retry
    config:
      maxRetries: 2
---
{{role "system"}}
You are a friendly trip planning assistant. Keep your tone {{tone}}.

{{history}}
```

Register `retry.plugin()` on the same Genkit instance before resolving `retry` by name. See [middleware](middleware.md) for direct factories versus named references. [Beta agents](agents.md) share the prompt fields; a prompt with tools does not require migration to an agent.
