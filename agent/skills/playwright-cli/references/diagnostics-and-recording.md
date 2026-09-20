# Diagnostics, traces, and recordings

Use the task's existing isolated session. Capture only the requested evidence with non-sensitive test data. Traces can contain DOM content, network headers/bodies, screenshots, and console output; videos and action recordings can reveal entered data. Do not capture secrets. Inspect and redact artifacts before sharing them.

## Diagnose a failed action

```bash
playwright-cli -s=task-name console warning
playwright-cli -s=task-name requests
playwright-cli -s=task-name request 5
```

Use an actual request index from `requests`, not the example index. Request details can contain credentials; do not dump sensitive payloads into saved logs or reports. Capture a fresh snapshot to distinguish a stale ref from an application error.

## Trace a reproduction

Open the isolated session before starting a trace. To include navigation, start from a blank page and trace before `goto`:

```bash
playwright-cli -s=task-name tracing-start
playwright-cli -s=task-name goto https://example.com
playwright-cli -s=task-name snapshot
playwright-cli -s=task-name tracing-stop
```

Reproduce the requested failure between start and stop. Use the artifact paths reported by the CLI; trace output can include `.trace`, `.network`, and resource files under `.playwright-cli/traces/`. Verify the relevant action and outcome in the evidence, not just that tracing stopped.

## Record actions as test code

This records user actions in a headed isolated browser and prints Playwright code when stopped:

```bash
playwright-cli -s=task-name recording-start
playwright-cli -s=task-name recording-stop
```

Let the user perform the authorized flow between commands. Keep generated actions separate from assertions; a recording is not a passing test. Use the testing reference when turning the output into a test.

## Record a WebM video

```bash
playwright-cli -s=task-name video-start demo.webm --cursor --fps=60
playwright-cli -s=task-name video-chapter "Reproduction" --description="Authorized test flow" --duration=2000
playwright-cli -s=task-name video-show-actions --duration=800 --position=top-right
playwright-cli -s=task-name goto https://example.com
playwright-cli -s=task-name video-hide-actions
playwright-cli -s=task-name video-stop
```

Place the requested actions between start and stop. `--cursor` paces actions by 800 ms; use it for demonstrations, not timing diagnosis. Omit chapters and annotations unless they improve the requested recording. Use `video-start --size=1280x800` when a fixed output size is needed.

Stop recording before closing the session so the output is finalized. Verify that the file exists and shows the requested flow. Report the artifact path and any capture limits.

## Sharing is a separate action

Creating local evidence does not authorize uploading it, creating a pull request, or posting a comment. Require explicit authorization for the exact hosted-service mutation. GitHub actions route through `gh-cli` and authenticated `gh`, not through page automation.
