---
name: developing-genkit-go
description: "Implement or debug Genkit Go generation, flows, tools, prompts, streaming, and providers. Use for Genkit Go SDK code, setup, or Go-specific API errors."
---

# Genkit Go

## Safety and version checks

- Local code edits and checks are allowed within the requested task. Firebase/GCP mutations, deployment, provider or secret changes, and live model/API calls require explicit user instruction for the exact action. A local flow or Dev UI can still call hosted services.
- Never print, save, or commit API keys, tokens, or service credentials. Use environment variable names or `<api-key>` placeholders.
- Inspect `go.mod`, `go.sum`, existing imports, and the selected provider. Preserve project versions; do not upgrade dependencies unless requested. Verify uncertain APIs against installed source, relevant references, or current SDK/provider documentation. Check provider model IDs before using them.

## Go API guidance and references

Pass the `*Genkit` registry returned by `genkit.Init` explicitly through the call chain. Use flows when tracing or HTTP exposure is needed. Describe tool inputs and structured fields, including `jsonschema:"description=..."` tags where appropriate.

Load only the reference needed for the task:

| Task | Reference |
| --- | --- |
| Initialization, Hello World, optional CLI/Dev UI | [Getting started](references/getting-started.md) |
| `Generate`, `GenerateText`, `GenerateData`, streaming and output formats | [Generation](references/generation.md) |
| `DefinePrompt`, `DefineDataPrompt`, `.prompt` files and schemas | [Prompts](references/prompts.md) |
| `DefineTool`, interrupts, `RestartWith`/`RespondWith` | [Tools](references/tools.md) |
| `ai.WithUse`, hooks, retry/fallback, approval and filesystem middleware | [Middleware](references/middleware.md) |
| `DefineFlow`, `DefineStreamingFlow`, `genkit.Handler`, HTTP serving | [Flows and HTTP](references/flows-and-http.md) |
| Google AI, Vertex AI, Anthropic, OpenAI-compatible APIs, Ollama | [Providers](references/providers.md) |

Prefer existing middleware when it fits. For custom middleware, allocate per-call state in closures captured by `New` and guard state mutated by `WrapTool`, because tools can run concurrently.

## Validation and completion

Validate affected Go packages with the project's available formatting, build, and test checks. Use mocked/local providers for offline tests; do not install tools or make live calls to satisfy a check. The Genkit CLI is optional for tasks that benefit from tracing or interactive flow inspection.

Finish with the requested deliverable, relevant checks and results, and version assumptions or blocked checks. Fix failures caused by the change within scope. Documentation-only work does not require starting an app or model.

## Maintenance

For future updates, read the [Firebase skills update process](../../../docs/skills/firebase-skills-update-process.md).
