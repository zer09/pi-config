# Setup: Genkit Python

## Runtime and environment

Genkit requires **Python 3.10+**. [PyPI's genkit metadata](https://pypi.org/project/genkit/) reports `Requires-Python: >=3.10`; official Genkit documentation correction #4658 changed the earlier 3.14+ guidance to 3.10+. Preserve a project's pinned newer Python version and resolve plugins against that project's constraints.

Use a project virtual environment, not the system interpreter. With `uv`, dependency commands manage `.venv`; activation is not needed for `uv run`. Inspect existing project files before initialization. Install dependencies only within the requested setup task.

## New project

The following example selects the supported minimum. Use the project's required version instead when one is specified:

```bash
mkdir my-app && cd my-app
uv init --python 3.10
uv add genkit genkit-plugin-google-genai
```

A minimal project block can declare:

```toml
[project]
name = "my-app"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "genkit",
    "genkit-plugin-google-genai",
]
```

Keep the resolved lockfile and existing repository layout. Do not lower a project's runtime requirement just to match this example.

## Plugins

Plugin packages use `genkit-plugin-*` names on PyPI, such as `genkit-plugin-google-genai`, `genkit-plugin-vertex-ai`, `genkit-plugin-anthropic`, and `genkit-plugin-fastapi`. Choose the provider the project needs; Google AI below is an example, not a required default.

## Hello World

This example calls a hosted model when executed. Run it only with explicit user instruction for that exact live call. Provide `GEMINI_API_KEY` through the approved environment or secret manager; never print, save, or commit the key. Verify the model ID and plugin version before use.

```python
from genkit import Genkit
from genkit.plugins.google_genai import GoogleAI

ai = Genkit(
    plugins=[GoogleAI()],
    model='googleai/gemini-flash-latest',
)

async def main():
    response = await ai.generate(prompt='Tell me a joke about Python.')
    print(response.text)

if __name__ == '__main__':
    ai.run_main(main())
```

For a matching `src/main.py` entrypoint, the run command is `uv run python src/main.py`. Use mocked providers for checks that must stay offline.

## Optional Genkit CLI

The CLI is useful for tracing and interactive flow inspection, not a prerequisite for every task. Check `genkit --version` if needed. If CLI installation is part of the requested setup:

```bash
npm install -g genkit-cli
```

See [Development workflow](dev-workflow.md) for optional `genkit start` and Dev UI usage. Review startup code and the live-call gate before running an app.
