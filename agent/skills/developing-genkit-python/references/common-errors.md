# Common Errors: Genkit Python

Use the matching section for a Genkit Python import, schema, API, or runtime failure. Check the installed versions and project code before applying a fix; unrelated errors do not require this reference.

---

## ModuleNotFoundError: No module named 'genkit.plugins.google_genai'

**Cause:** A missing plugin or an import from the wrong package generation.

**Fix:** Inspect the lockfile and installed module layout first. The split-package API uses `from genkit_google_genai import GoogleAI`; legacy `genkit-plugin-*` projects can retain `genkit.plugins.google_genai`. See [Setup](setup.md). Add dependencies only for an authorized setup/repair task, not as an automatic import-error workaround.

---

## 400 INVALID_ARGUMENT: functionDeclaration parameters schema should be of type OBJECT

**Cause:** Tool function has bare scalar parameters (e.g. `city: str`). Gemini requires object schema.

**Fix:** Wrap parameters in a Pydantic BaseModel:
```python
from pydantic import BaseModel

# Wrong
@ai.tool()
async def get_weather(city: str) -> str: ...

# Right
from pydantic import BaseModel

class WeatherInput(BaseModel):
    city: str

@ai.tool()
async def get_weather(input: WeatherInput) -> str: ...
```

---

## AttributeError: 'Genkit' object has no attribute 'define_tool'

**Cause:** Wrong decorator name.

**Fix:** Use `@ai.tool()`, not `@ai.define_tool()`.

---

## RuntimeError / event loop errors when using asyncio.run()

**Cause:** For apps you start with **`genkit start`**, Genkit runs your entrypoint with an event loop suited to the framework (including uvloop where used). There is no “default” loop for you to manage in that mode.

**Fix:** For long-running Genkit apps (servers, flows served under `genkit start`), use **`ai.run_main(main())`** as your entrypoint instead of `asyncio.run(main())`. For one-off scripts that exit when done, using `asyncio.run()` can still be appropriate when you are not using `genkit start`.

---

## Wrong model ID (no plugin prefix)

**Cause:** `model='gemini-flash-latest'` — missing plugin prefix.

**Fix:** `model='googleai/gemini-flash-latest'`

---

## response.json / response.message AttributeError

- Use `response.text` for plain text output
- Use `response.output` for structured (JSON) output

---

## await ai.generate_stream(...) fails or returns wrong type

**Cause:** `generate_stream` is synchronous — do not await it.

**Fix:**
```python
sr = ai.generate_stream(prompt='...')   # no await
async for chunk in sr.stream: ...
final = await sr.response
```

## Agent state, streaming, and errors

With compatible `genkit.agent`, `chat.send_stream(...)` returns a turn synchronously; consume `.stream`, then await `.response`. A stored conversation uses `await agent.load_chat(snapshot_id=...)` to restore history. Without a store, IDs remain `None`; round-trip messages, state, and artifacts yourself.

A throwing tool can end the turn with `AgentError`. Do not blindly replay side-effecting tools. Build approval restart/respond entries only from the response's interrupts, after verifying the exact operation and user authority. See [Agents](agents.md) for selected APIs and safety boundaries.
