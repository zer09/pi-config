# Agents (experimental)

Use this API for requested persistent, multi-turn Genkit Go conversations when the resolved SDK supports it. Keep existing flows for stateless tasks; an agent request does not authorize a dependency upgrade or a flow migration.

## Imports and opt-in

Constructors come from `genkit/exp` (`genkitx`); types and options come from `ai/exp` (`aix`). Initialize with `genkit.WithExperimental()` or the experimental constructors panic. Signatures can change in minor releases; inspect the project's resolved source first.

The following is a definition fragment, not a command to start an app or call a provider. Reuse the project's approved provider configuration. Live model/API calls, provider or secret changes, session-store writes, and Firebase/GCP mutations require explicit user instruction for the exact action and target. Never print or save credentials or sensitive conversation state.

```go
import (
	"github.com/genkit-ai/genkit/go/ai"
	aix "github.com/genkit-ai/genkit/go/ai/exp"
	"github.com/genkit-ai/genkit/go/genkit"
	genkitx "github.com/genkit-ai/genkit/go/genkit/exp"
)

g := genkit.Init(ctx,
	genkit.WithExperimental(),
	genkit.WithPlugins(&googlegenai.GoogleAI{}),
)

// No store: the caller carries the state between turns.
weatherAgent := genkitx.DefineAgent[any](g, "weatherAgent",
	aix.InlinePrompt{
		ai.WithModelName("googleai/gemini-flash-latest"),
		ai.WithSystem("You are a helpful weather assistant. Be concise."),
		ai.WithTools(getWeather),
	},
)
```

`getWeather` is an existing registered tool, defined with [DefineTool](tools.md), not an automatically authorized API. `aix.InlinePrompt` takes the same `ai.PromptOption` values as `genkit.DefinePrompt`, including `ai.WithUse` for [middleware](middleware.md).

## Turns and state

Run the following only for an authorized live invocation or a project-local mocked check:

```go
out, err := weatherAgent.RunText(ctx, "Weather in London?")
if err != nil {
	return err
}
if out.FinishReason == aix.AgentFinishReasonFailed {
	return fmt.Errorf("agent turn failed")
}

next, err := weatherAgent.Run(ctx,
	&aix.AgentInput{Message: ai.NewUserTextMessage("And Tokyo?")},
	aix.WithState(out.State),
)
if err != nil {
	return err
}
if next.FinishReason == aix.AgentFinishReasonFailed {
	return fmt.Errorf("agent turn failed")
}
```

A returned Go error means the invocation did not start. A failed turn can instead return `AgentFinishReasonFailed` with `out.Error` populated. Check both before consuming output; do not log the full state or error payload blindly.

Without a store, pass `out.State` into the next turn through `aix.WithState`. With a server store, use `aix.WithSessionID` for the latest snapshot or `aix.WithSnapshotID` for a specific checkpoint. A session or snapshot ID is not authorization to read another user's conversation.

`Agent.Connect(ctx)` carries state over a bidirectional connection. Send a turn with `SendText`, consume `Receive()` through `TurnEnd`, then send the next turn. `Output()` closes input and drains remaining chunks; handle send/receive errors and close abandoned connections.

## Selected deeper source

Use the pinned source only for the requested feature, then verify it against the resolved SDK:

- [Sessions](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-go/references/agents-sessions.md): `localstore.NewInMemorySessionStore[State]`, file stores, snapshot persistence, and typed state.
- [Interrupts](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-go/references/agents-human-in-the-loop.md): pause/resume and respond versus restart. Approval must cover the exact tool action and target, not merely a resume flag.
- [Serving](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-go/references/agents-deployment.md): `genkit.Handler` and companion routes. Authenticate requests and authorize session/snapshot access before exposing handlers; these examples are not production authorization recipes.

`flow:run` runs flows, not agents. Do not create throwaway live-check flows or start an app merely to validate documentation. Use available offline project checks and report unavailable SDK validation.
