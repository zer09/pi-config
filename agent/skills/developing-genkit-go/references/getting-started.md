# Getting Started

## Project Setup

Use these setup commands only for a requested new project. Preserve existing module and Go version constraints; do not upgrade an existing project to `@latest` just to follow this example.

```bash
mkdir my-genkit-app && cd my-genkit-app
go mod init my-genkit-app
go get github.com/genkit-ai/genkit/go@latest
```

Provider plugins ship in the same module under `plugins/`, so they don't need to be fetched separately. Just import the ones you want and run `go mod tidy` afterwards. The available plugins include:

- `plugins/googlegenai` for Google AI and Vertex AI
- `plugins/anthropic` for Anthropic Claude
- `plugins/compat_oai` for OpenAI-compatible APIs (OpenAI, Groq, xAI, etc.)
- `plugins/ollama` for local Ollama models
- `plugins/middleware` for the built-in middleware bundle (`Retry`, `Fallback`, `ToolApproval`, `Filesystem`, `Skills`)

## Hello World

This flow calls a hosted model when invoked. Live model/API calls, provider changes, and Firebase/GCP mutations require explicit user instruction for the exact action. Supply credentials through the approved environment; never print, save, or commit keys or tokens. Verify the provider model ID before use.

```go
package main

import (
	"context"
	"log"
	"net/http"

	"github.com/genkit-ai/genkit/go/ai"
	"github.com/genkit-ai/genkit/go/genkit"
	"github.com/genkit-ai/genkit/go/plugins/googlegenai"
	"github.com/genkit-ai/genkit/go/plugins/server"
)

func main() {
	ctx := context.Background()
	g := genkit.Init(ctx, genkit.WithPlugins(&googlegenai.GoogleAI{}))

	genkit.DefineFlow(g, "jokeFlow", func(ctx context.Context, topic string) (string, error) {
		return genkit.GenerateText(ctx, g,
			ai.WithModelName("googleai/gemini-flash-latest"),
			ai.WithPrompt("Tell me a joke about %s", topic),
		)
	})

	mux := http.NewServeMux()
	for _, f := range genkit.ListFlows(g) {
		mux.HandleFunc("POST /"+f.Name(), genkit.Handler(f))
	}
	log.Fatal(server.Start(ctx, "127.0.0.1:8080", mux))
}
```

## Initialization

Every Genkit app starts with `genkit.Init`, which returns a `*Genkit` instance:

```go
import (
	"context"
	"github.com/genkit-ai/genkit/go/genkit"
	"github.com/genkit-ai/genkit/go/plugins/googlegenai"
)

ctx := context.Background()
g := genkit.Init(ctx,
	genkit.WithPlugins(&googlegenai.GoogleAI{}),
)
```

### The `*Genkit` Instance

The `*Genkit` value `g` is the central registry. Pass it to every Genkit function:

```go
// Defining resources
genkit.DefineFlow(g, "myFlow", ...)
genkit.DefineTool(g, "myTool", ...)
genkit.DefinePrompt(g, "myPrompt", ...)

// Generating content
genkit.GenerateText(ctx, g, ...)
genkit.Generate(ctx, g, ...)
```

Do not store `g` in a global variable. Pass it explicitly through your call chain.

### Init Options

```go
g := genkit.Init(ctx,
	// Register one or more plugins
	genkit.WithPlugins(&googlegenai.GoogleAI{}, &anthropic.Anthropic{}),

	// Set a default model (used when no model is specified)
	genkit.WithDefaultModel("googleai/gemini-flash-latest"),

	// Set directory for .prompt files (default: "prompts")
	genkit.WithPromptDir("my-prompts"),

	// Or embed prompts using Go's embed package
	// genkit.WithPromptFS(promptsFS),
)
```

### Embedding Prompts

Use `go:embed` to bundle `.prompt` files into the binary:

```go
//go:embed prompts
var promptsFS embed.FS

g := genkit.Init(ctx,
	genkit.WithPlugins(&googlegenai.GoogleAI{}),
	genkit.WithPromptFS(promptsFS),
)
```

## Genkit CLI

The optional Genkit CLI provides a local Developer UI for running flows, tracing executions, and inspecting model interactions. It is not required for ordinary code or documentation changes.

Install only if CLI setup is part of the requested task, using the project's approved method. One option is:

```bash
npm install -g genkit-cli
```

**Verify:**
```bash
genkit --version
```

### Developer UI

Review startup code before an authorized local UI session. Flow invocation can call hosted models or write data even though the UI is local; the exact-authorization gate above still applies. Keep trace output bounded and redact sensitive content before saving or sharing.

Start a safe entrypoint with the Developer UI attached:

```bash
genkit start -- go run .
```

This launches:
- Your app (with tracing enabled)
- The Developer UI at `http://localhost:4000`
- A telemetry API at `http://localhost:4033`

Add `-o` to auto-open the UI in your browser:
```bash
genkit start -o -- go run .
```

The Developer UI lets you:
- Run and test flows interactively
- View traces for each generation call (inputs, outputs, latency, token usage)
- Inspect prompt rendering and tool calls
- Debug multi-step flows with per-step trace data

### Flow and documentation commands

Use flow commands only for explicitly authorized live invocations or local/mock flows within the requested task:

```bash
genkit flow:run myFlow '{"data": "input"}'
genkit flow:run myFlow '{"data": "input"}' --stream
genkit flow:run myFlow '{"data": "input"}' --wait
```

For focused SDK documentation lookup, when the CLI is available:

```bash
genkit docs:search "streaming" go
genkit docs:list go
genkit docs:read go/flows.md
```

### Without the CLI

Set `GENKIT_ENV=dev` to enable the reflection API without the CLI:

```bash
GENKIT_ENV=dev go run .
```

## Import Paths

```go
import (
	"github.com/genkit-ai/genkit/go/genkit"          // Core: Init, Generate*, DefineFlow, etc.
	"github.com/genkit-ai/genkit/go/ai"              // Types: WithModel, WithPrompt, Message, Part, etc.
	"github.com/genkit-ai/genkit/go/core"            // Low-level: Run (sub-steps), Flow types
	"github.com/genkit-ai/genkit/go/plugins/server"  // server.Start for HTTP
)
```
