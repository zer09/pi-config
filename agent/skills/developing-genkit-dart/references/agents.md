# Experimental agents: Genkit Dart

Use agents for requested multi-turn state, not as a mandatory replacement for flows. Check the resolved Genkit/Dart versions and generated schemas before using the [pinned API](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-dart/references/agents.md). Experimental APIs are not covered by semantic-versioning stability. Do not upgrade dependencies or suppress analyzer warnings automatically.

## Imports and turns

Server APIs use `package:genkit/experimental.dart` alongside stable `genkit.dart`. HTTP clients use `experimental_client.dart` alongside `client.dart`. File stores use `experimental_io.dart` and need `dart:io`. Stable cancellation types do not require experimental imports.

This fragment reuses the project's initialized `ai`, selected default model, and registered tools. Set `model:` explicitly if the instance has no default. Sending or streaming a turn can call hosted services and needs exact authorization.

```dart
import 'package:genkit/genkit.dart';
import 'package:genkit/experimental.dart';

final agent = ai.defineAgent(
  name: 'weatherAgent',
  system: 'Answer weather questions using the registered tools.',
  tools: [getWeather],
  store: InMemorySessionStore(),
  maxTurns: 20,
);
final chat = agent.chat();
final response = await chat.send(text: 'Weather in Tokyo?');
final turn = chat.sendStream(text: 'What about Paris?');
await for (final chunk in turn.stream) {
  // Deliver chunk.text without logging conversation state.
}
final finalResponse = await turn.response;
```

Reuse one chat to carry history. With a store, `agent.loadChat(snapshotId: ...)` restores history; `chat(snapshotId: ...)` branches without preloading it. In-memory stores lose data on restart. Without a store, the caller owns the state blob; the remote client round-trips it automatically. Keep `chat.state` private and carry it forward when constructing a new chat.

`stateSchema` describes Schemantic custom state; custom fields live under `SessionState.custom`. Preserve generated schemas and nullable/default fields for partially populated data. See [state](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-dart/references/agents-state.md) and [sessions](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-dart/references/agents-sessions.md) only when needed. File and hosted stores need separately authorized storage, retention, and tenant isolation; a store does not authorize Firebase writes.

## Interrupts and middleware

Dart has no `defineInterrupt`: a tool returns `.interrupt(data)`. Build resume entries from response interrupts. `.respond(output)` supplies output without running the tool; `.restart(payload)` reissues it. Both are builders, so call `chat.resume(respond: [...], restart: [...])` or `resumeStream` on the same chat. Recheck for new interrupts before treating the turn as complete.

For `toolApproval`, restart only a reviewed approved operation with `.restart({'tool-approved': true})`; the builder nests the payload under `metadata.resumed`. Denial must not restart the tool. See [middleware](genkit_middleware.md) and [interrupts](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-dart/references/agents-human-in-the-loop.md). A prompt asking for approval is not an authorization control. Do not auto-approve shell, write, or hosted tools.

Optional middleware refs in `use` require their plugins in the existing `Genkit(plugins: [...])` array. Sub-agent delegation uses `agents(agents: ['registeredSubAgentName'])`, not a zero-argument factory; Dart has no `artifacts()` middleware in this source. Load the [delegation source](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-dart/references/agents-multi-agent.md) only for that task.

## HTTP and Flutter clients

Authenticate requests and enforce session/snapshot ownership before exposing turn, snapshot, or abort endpoints. Client-supplied state and context are untrusted. `remoteAgent` rejects nonempty per-turn `context`; derive identity server-side from verified credentials. Do not copy unauthenticated serving recipes into production.

`shelfHandler(agent.action)` serves turns. Optional `getSnapshotDataAction` and `abortAgentAction` expose restore/abort operations and need the same authorization. `remoteAgent(url: ...)` uses companion `/getSnapshot` and `/abort` URLs by default. Match configured paths.

Flutter uses the same HTTP client. Its `headers` callback runs per request and can return refreshed credentials; never log those headers. Reuse the client and chat, then call `close()` at lifecycle end. A supplied `httpClient` remains caller-owned. Cancel pending UI work and check widget lifecycle before updating state.

The optional CLI's `flow:run` runs flows, not agents. An explicitly requested test can wrap one turn in a flow; that is still a live call unless mocked. See [getting started](getting-started.md).
