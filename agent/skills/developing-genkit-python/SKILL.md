---
name: developing-genkit-python
description: "Implement or debug Genkit Python generation, agents, flows, tools, and provider integrations. Use for Genkit Python SDK code, setup, import failures, or Python-specific API errors."
---

# Genkit Python

## Safety and version checks

- Local code edits and checks are allowed within the requested task. Firebase/GCP mutations, deployment, provider or secret changes, and live model/API calls require explicit user instruction for the exact action. A local flow or Dev UI can still call hosted services.
- Never print, save, or commit API keys, tokens, or service credentials. Use environment variable names or `<api-key>` placeholders.
- The Genkit Python runtime floor is **Python 3.10+**. Preserve a project's pinned newer Python version and dependency constraints. Inspect `pyproject.toml`, lockfiles, imports, and installed package versions; use the project's `uv` environment without upgrading dependencies unless requested.
- Verify uncertain imports and APIs against installed source, the relevant reference, or current SDK documentation. [Setup](references/setup.md) records the runtime-floor evidence and bootstrap examples.

## Python API guidance and references

Use provider-prefixed model IDs with the project's selected plugin. For Genkit-driven long-running apps, use `ai.run_main(main())`; see the entrypoint guidance in [Common errors](references/common-errors.md) rather than replacing an existing server's event loop blindly. Python tools use `@ai.tool()`; streaming has separate chunk and final-response handling.

Load only the reference relevant to the task:

| Task | Reference |
| --- | --- |
| New setup, plugins, Hello World, optional CLI installation | [Setup](references/setup.md) |
| Structured output, streaming, flows, tools, embeddings | [Examples](references/examples.md) |
| Python SDK import, schema, decorator, streaming, or event-loop failures | [Common errors](references/common-errors.md) |
| HTTP handlers and parallel flows | [FastAPI](references/fastapi.md) |
| `.prompt` files and helpers | [Dotprompt](references/dotprompt.md) |
| Requested evaluation implementation | [Evals](references/evals.md) |
| Optional local tracing and Dev UI | [Development workflow](references/dev-workflow.md) |

## Validation and completion

Run the relevant available project tests, lint, or type checks for affected code through `uv run`. Prefer mocked/local checks; live calls and model-based evaluations require exact authorization. Documentation-only work needs relevant link/example checks, not CLI startup or a full environment setup.

Finish with the requested deliverable, checks and results, and version assumptions or blocked checks. Fix in-scope regressions without expanding into dependency upgrades or hosted actions.

## Maintenance

For future updates, read the [Firebase skills update process](../../../docs/skills/firebase-skills-update-process.md).
