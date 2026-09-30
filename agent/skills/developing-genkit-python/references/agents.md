# Beta agents: Genkit Python

Use this [pinned preview API](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-python/references/agents.md) only when the resolved SDK exposes `genkit.agent` and the task needs multi-turn state. Do not migrate every flow or upgrade dependencies automatically. [Setup](setup.md) distinguishes split-package imports from legacy plugins; preserve the project's model, provider, manager, and entrypoint.

## Define and chat

This fragment reuses an initialized `ai` with a selected default model and a registered `get_weather` tool. Set `model=` explicitly if the instance has no default. Tool inputs should be a small Pydantic model, including an empty subclass for no fields, not bare `BaseModel`. Sending turns can call hosted models/tools and requires exact authorization.

```python
from genkit.agent import InMemorySessionStore

agent = ai.define_agent(
    name='weatherAgent',
    system='Answer weather questions using the registered tools.',
    tools=[get_weather],
    store=InMemorySessionStore(),
    max_turns=20,
)
chat = agent.chat()
response = await chat.send('Weather in Tokyo?')
turn = chat.send_stream('What about Paris?')
async for chunk in turn.stream:
    if chunk.text:
        pass  # Deliver to the authorized caller without logging private state.
final = await turn.response
```

One send at a time per chat. `send_stream` is synchronous; await `.response`, not the turn handle. The final response completes even without draining every chunk. A throwing tool can surface `AgentError`; handle the error without exposing raw state or blindly replaying mutations.

## State and storage

With a store, the server owns history and creates immutable snapshots. Restore with `await agent.load_chat(snapshot_id=response.snapshot_id)`; `chat(snapshot_id=...)` only attaches a resume handle. In-memory stores lose state on restart. Without a store, IDs remain `None`. Reuse the chat or round-trip all three values:

```python
resumed = agent.chat(
    messages=chat.messages,
    state=chat.state,
    artifacts=chat.artifacts,
)
```

The fragment above is for an agent defined without `store`. With a store, update custom fields inside tools through `ai.current_session()` rather than injecting client state. `state_schema` alone does not fill state. See selected pinned [state](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-python/references/agents-state.md) and [sessions](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-python/references/agents-sessions.md) details only when needed. Storage needs approved paths, retention, and tenant isolation. Never log raw state/artifacts or treat client-supplied state as authority.

`ai.define_prompt_agent(name=...)` uses that name as the `.prompt` stem. Keep stable preamble inputs; put dynamic turn data in messages or tools. See [Dotprompt](dotprompt.md).

## Middleware and approvals

Compatible split-package SDKs import `Middleware`, `ToolApproval`, `Filesystem`, `Skills`, and `Retry` from `genkit_middleware`. Register `Middleware()` in the existing `Genkit(plugins=[...])` array, then pass configured instances in `use=[...]`. Keep filesystem writes off (`allow_write_access=False`) unless explicitly requested. Do not auto-approve shell, write, artifact, or hosted tools; bound retries and their costs.

An interrupt is not a completed answer. Build entries from `response.interrupts`, never arbitrary client parts. `.respond(output)` supplies output without executing a tool. `.restart(resumed_metadata={'tool_approved': True})` reissues an approved pending tool. Call `chat.resume(respond=[...], restart=[...])` or `resume_stream` on the same chat. Approve only the reviewed operation and target after checking user authority; middleware approval is not application authorization. Recheck for new interrupts. See the [pinned interrupt protocol](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-python/references/agents-human-in-the-loop.md), not its schematic banking example as a security design.

## HTTP routers and nested flows

The compatible split-package FastAPI API imports `serve_agent`, `serve_flow`, and `handle_genkit_request` from `genkit_fastapi`. Authenticate server-side and enforce ownership of sessions/snapshots before serving turns, restores, or aborts. Client headers and state are not trusted identity. The context dependency must verify credentials and return a plain dict; do not copy the upstream `X-User` example as authentication.

Given an existing `app`, `agent`, `hello` flow, and verified `verified_context` dependency:

```python
from genkit_fastapi import serve_agent, serve_flow

app.include_router(
    serve_agent(agent, context_dependency=verified_context), prefix='/api'
)
app.include_router(
    serve_flow(hello, context_dependency=verified_context), prefix='/api'
)
```

Default paths use action names; preserve existing paths or configure `base_path`. Routers accept `{"data": ...}` and return `{"result": ...}`; `Accept: text/event-stream` selects streaming. `handle_genkit_request(request, action=flow, context=...)` supports custom routes with existing auth wiring.

On this flow-wrapper API, forward child chunks with `result = await child.run(input, on_chunk=ctx.send_chunk)` and read `result.response`; do not pass `ctx` as a second positional argument. Preserve non-streaming child calls and existing parallel-flow semantics. The [pinned FastAPI source](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-python/references/fastapi.md) has details. Do not nest `uvicorn.run()` inside `ai.run_main`; preserve the existing server's event-loop ownership.

`remote_agent` from `genkit.agent` uses `state_management='server'` for store-backed agents or `'client'` without a store. Reuse one chat and match the URL to the mounted route; omit trailing slashes. Its headers only forward credentials, not establish trusted server identity. See [HTTP source](https://github.com/genkit-ai/skills/blob/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6/skills/developing-genkit-python/references/agents-http.md) behind the same authorization gates.

The optional CLI's `flow:run` runs flows, not agents. Wrapping one agent turn for an explicitly requested check does not make the call offline. Use `uv run python` or the existing project script when execution is authorized; see [development workflow](dev-workflow.md).
