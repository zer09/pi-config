# Genkit documentation and CLI

## Tool selection and boundaries

Use the installed or repository-pinned `genkit` CLI when the task benefits from it. Documentation/code work does not require CLI setup. Verify commands against installed help or source; do not download, install, or upgrade tooling as skill maintenance. The upstream documentation commands assume CLI 1.29.0 or newer; an older CLI is a check limit, not automatic upgrade authority.

Review the run command and startup code before invocation. A local Dev UI, flow, or evaluator can call hosted providers or execute tool mutations. Live model/API calls, deployments, provider/secret changes, and hosted writes require explicit user instruction for the exact action and target. Prefer existing mock/local checks.

## Documentation lookup

When available, use a focused command rather than loading the whole catalog:

```bash
genkit docs:search "streaming"
genkit docs:read js/flows.md
genkit docs:list
```

Installed package source and project references remain valid alternatives. Documentation lookup does not require login, a model call, or a running app.

## Runtime lifecycle

`genkit start -- <run-command>` wraps the existing app with tracing. For an authorized development session, use the project's installed runner and normal entrypoint. Do not use `npx`/`dlx` to fetch a missing runner automatically.

`start` stays running until stopped. `--noui` removes the Dev UI, not the persistent runtime. It is not a one-shot validation command. Add `--non-interactive` before `--` in non-interactive contexts when the installed version supports it; this avoids CLI prompts, not provider calls.

## Flow execution

For a separately authorized invocation or a safe local/mock flow, append the existing runtime command after `--`:

```bash
genkit flow:run tellJoke '"chicken"' -- <existing-run-command>
genkit flow:run generateStory '{"subject": "robot", "genre": "sci-fi"}' -- <existing-run-command>
```

`flow:run` starts that runtime, invokes the named flow once, prints a trace ID, and exits. Pass input JSON explicitly: omitted input is `undefined`, not a schema `.default()` value. The command runs flows (`ai.defineFlow`), not [beta agents](agents.md). Do not add a throwaway live-check flow just to validate local code or documentation.

## Evaluation

Evaluators can make additional paid model calls. Confirm exact authorization for the flow, dataset, evaluator, provider, and output before a live evaluation. Keep sensitive datasets and results out of tracked files. Use local/mock evaluators when possible.

```bash
genkit eval:flow answerQuestion --input inputs.json -- <existing-run-command>
genkit eval:run dataset.json --output results.json
```

The command after `--` starts the runtime for `eval:flow`; it can have side effects before the flow runs. Verify dataset shape and flags against the installed CLI. These are reference commands, not maintenance acceptance checks.

## Traces

Trace content can contain prompts, outputs, tool arguments, and credentials. Inspect only needed fields and redact sensitive content before saving or sharing. Never log tokens or credential values. Keep verbose output bounded in temporary files after redaction.

```bash
genkit trace:list
genkit trace:get <traceId> --format json
```

Use `--format json` for machine parsing. The default output is human-oriented and may contain banners or truncated data; do not pipe that form directly into JSON parsers. Traces do not replace offline tests, type checks, or authorization.
