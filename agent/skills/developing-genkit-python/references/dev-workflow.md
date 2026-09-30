# Development Workflow: Genkit Python

Use this reference when the task needs local tracing, flow inspection, or the Genkit Dev UI. Ordinary code and documentation changes can use project checks without starting the CLI.

## Safety and prerequisites

Local UI startup can execute application code, and a flow can call a hosted model or mutate data. Review the entrypoint and tool behavior before starting it. Live model/API calls, provider or secret changes, and Firebase/GCP mutations require explicit user instruction for the exact action. Model-based evaluation is not an offline check.

Use the existing project environment and dependencies. [Setup](setup.md) covers a requested new environment, optional CLI installation, and provider selection. Do not install missing tooling or obtain credentials merely to complete an unrelated task.

For Google AI, supply `GEMINI_API_KEY` through the approved environment or secret manager. Do not ask the user to paste a key into chat. Never print, save, or commit credentials; do not add keys to a shell profile or source file. Users who explicitly need a new key can manage it in [Google AI Studio](https://aistudio.google.com/apikey).

## Optional Dev UI session

For an authorized local session with a safe entrypoint, run from the project directory:

```bash
genkit start -- uv run python src/main.py
```

Match the path to the project's entrypoint or existing startup script. The foreground process stays open while the UI is in use; stop it with `Ctrl+C` when finished. `--noui` disables the UI, not the persistent server. Use the installed/repository-pinned CLI and the URL it prints, typically `http://localhost:4000`. Never fetch a latest runner automatically.

For an authorized automated invocation, put `--non-interactive` before `--`. A one-shot flow call takes JSON matching the flow input and a runtime command:

```bash
genkit flow:run my_flow '"input"' --non-interactive -- uv run python src/main.py
```

`flow:run` exits after one flow invocation; it does not run an agent directly. An agent test needs an explicitly requested flow wrapper around one turn and the same live-call gate. `start --noui` is not a one-shot check.

For machine-readable trace output, use `genkit trace:get <traceId> --format json`. Bound output and redact private inputs, outputs, and credentials before saving or sharing it. Trace collection is optional, not proof required for every code edit.

When a flow invocation is explicitly authorized, or the flow uses only local mocks within the requested task:

1. Open the Dev UI's **Run** view.
2. Select the flow and provide JSON matching its input schema.
3. Run the flow and inspect the result.
4. Inspect **Traces** only as needed; redact sensitive inputs, outputs, and credentials before saving or sharing excerpts.

## Troubleshooting

| Problem | Check |
| --- | --- |
| `genkit: command not found` | Check the existing installation and PATH; install only within an authorized setup task. |
| `GEMINI_API_KEY not set` | Confirm the selected provider and approved environment setup without printing the key. |
| Port 4000 already in use | For an authorized session, use `genkit start --port 4001 -- uv run python src/main.py`. |
| `uv: command not found` | Report the unavailable project tool; do not silently change environment managers. |
| Flow not showing in Dev UI | Inspect startup errors and registration for that flow. |

## Completion

Report relevant checks, observed results, and any untested live behavior. Give startup instructions only when they help the requested deliverable; do not append a full installation or Dev UI tutorial to every code response.
