# Agents (beta)

Use agents for requested persistent, multi-turn Genkit JS conversations when the project's resolved SDK supports the API. Keep existing flows for stateless tasks; do not migrate every chatbot or upgrade dependencies just to use this reference.

## Entrypoints and definition

The pinned source requires `genkit >= 1.39.0`. Server APIs come from `genkit/beta`, not the stable `genkit` entrypoint. Browser/Node clients come from `genkit/beta/client`. Beta signatures can change; verify imports and options against installed source.

Reuse the approved provider and model configuration. The following defines an agent; it is not authorization to call a provider, change secrets, write a hosted session store, or deploy. Live model/API calls and hosted mutations require explicit instruction for the exact action and target. Never print or save credentials or sensitive conversation state.

```ts
import { genkit } from 'genkit/beta';
import { googleAI } from '@genkit-ai/google-genai';

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model('gemini-flash-latest'),
});

const weatherAgent = ai.defineAgent({
  name: 'weatherAgent',
  system: 'You are a helpful weather assistant. Use getWeather. Be concise.',
  tools: [getWeather],
});
```

`getWeather` is an existing tool registered on this instance, not an automatically authorized weather API. `defineAgent` shares prompt fields (`system`, `prompt`, `tools`, `model`, `use`, input schemas). `stateSchema` describes custom session state; `store` selects server persistence. See [Dotprompt](dotprompt.md) and [middleware](middleware.md).

## Turns and state

Run turns only for separately authorized live calls or project-local mocked checks:

```ts
const chat = weatherAgent.chat();
const res = await chat.send('Weather in Tokyo?');
const res2 = await chat.send('What about Paris?');
```

Reuse one `chat` to carry history across turns. `chat.sendStream` returns a turn with `stream` and `response`; iterate `turn.stream` and await `turn.response` for the final result. Avoid logging streamed text or full state if it can contain sensitive content.

Without `store`, the caller owns the state blob. `remoteAgent` carries it automatically; direct calls must round-trip `res.raw.state`:

```ts
async function turn(state: unknown | undefined, text: string) {
  const chat = weatherAgent.chat(state ? { state } : undefined);
  const res = await chat.send(text);
  return { state: res.raw.state, text: res.text };
}
```

With a store, history is held as snapshots. `InMemorySessionStore`, `FileSessionStore`, and `FirestoreSessionStore` serve different persistence needs; do not provision or switch stores automatically. Client-supplied state and session/snapshot IDs do not authorize access to another user's history.

## Selected deeper source

Read only the pinned reference needed, then verify against the resolved SDK:

- [Sessions](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-js/references/agents-sessions.md): persistence, snapshots, and typed state.
- [Interrupts](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-js/references/agents-human-in-the-loop.md): pause/resume and approval/input. Require exact tool-action authorization; do not auto-approve shell tools.
- [Serving](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-js/references/agents-deployment.md): HTTP handlers and companion snapshot/abort endpoints. Add authentication and session ownership checks before exposure; the source examples are not production authorization recipes.

`remoteAgent({ url })` from `genkit/beta/client` talks to an authorized endpoint and exposes `.chat()`. Network calls are not local validation. `flow:run` runs flows, not agents; do not add a throwaway live-check flow merely to validate documentation.
