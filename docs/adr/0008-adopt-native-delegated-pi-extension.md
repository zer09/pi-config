# ADR 0008: Adopt a native TypeScript delegated Pi extension

## Status

Accepted

## Context

ADR 0007 established fresh role isolation, one shared-tree mutator, neutral three-member investigation and review gates, independent finding verification, bounded child supervision, and separate authorization for Git or hosted-service transitions. Its first implementation used a Local Skill plus Python supervisor scripts invoked through the parent agent's bash tool.

That implementation kept policy out of the always-loaded context, but process observability remained indirect. The parent saw startup, idle warnings, and terminal output. It could not continuously show the latest accepted child event or the exact time that event reached the supervisor. The Python runtime also remained outside Pi's native extension lifecycle and custom tool rendering.

The user requested a pure TypeScript extension that executes inside the parent Pi process, follows the same local pattern as CodeGraph and Context Mode, inherits the parent process environment and operating-system permissions, and shows each delegate's last event with its execution time.

Separate child agent processes remain necessary. Running the extension inside the parent does not remove the need for fresh context, model selection, role isolation, or process-level cancellation.

## Decision

Replace the `delegated-pi-loop` Local Skill and Python supervisors with the native TypeScript extension under `agent/extensions/delegated-pi-loop/`.

The extension registers one `delegate_run` custom tool. The parent Pi agent remains the sole orchestrator and calls one tool instance per assigned role. Pi's normal parallel tool execution supports the solution A/B/C/D and review A/B/C/D gates. An in-process manager rejects concurrent implementation, remediation, or verification roles.

The extension directly supervises child Pi and Claude Code processes. Child processes inherit provider credentials and operating-system permissions from the parent environment. The extension clears stale parent session metadata before spawn and uses fresh ephemeral child sessions.

The extension privately parses Pi JSON events. For every accepted activity event, it records only:

- the event type;
- an optional tool name;
- the current phase;
- a monotonic activity time for idle enforcement; and
- an ISO-8601 UTC supervisor receipt time for display.

It does not publish or persist thinking, text deltas, tool arguments, or tool results. Partial tool rendering and an aggregate TUI widget show the current route, state, phase, attempt, last event, exact UTC time, relative age, and elapsed time.

Preserve ADR 0007's route maps, structured terminal markers, 45-minute wall deadline, 50 MiB output limit, 5-minute idle warning, 10-minute idle termination, pre-tool-only fallback, private artifacts, read-only fingerprints, role separation, and authorization boundaries.

Set `PI_DELEGATED_CHILD=1` for child Pi. The extension does not register `delegate_run` in a delegated child, which makes recursive delegation unavailable even if a prompt ignores the prohibition. A child-side parent watchdog terminates the child process group if the parent disappears. The parent extension aborts active groups during `session_shutdown`, and the supervisor cleans descendants after natural leader exit.

Retire and remove `agent/skills/delegated-pi-loop/`. Keep its maintenance document as the extension update contract and retired-skill record.

## Consequences

- Delegation becomes a native Pi tool with normal custom rendering, cancellation, and extension lifecycle cleanup.
- The parent can see the last sanitized child event and its exact receipt time while the delegate runs.
- Route policy and safety checks become deterministic executable behavior instead of prompt-driven shell construction.
- Provider credentials and OS permissions inherit from the parent Pi process without copying secrets into prompts or commands.
- Fresh subprocesses still isolate role context and model state.
- The active tool schema adds startup context cost, while removal of the skill catalog entry offsets part of that cost.
- TypeScript tests replace the Python supervisor suite.
- Explicit Claude Code roles retain plain-protocol heartbeats because Claude's existing contract does not expose Pi JSON events.

## Alternatives rejected

- **Keep the Python supervisor and add a TUI wrapper:** rejected because process ownership and event transport would remain split across runtimes.
- **Run delegates in the parent agent session:** rejected because it destroys fresh context and role independence.
- **Expose raw child JSON to the parent model:** rejected because it leaks thinking and tool payloads into context.
- **Show only periodic heartbeats:** rejected because the user requested the actual last accepted event and its time.
- **Allow child copies of `delegate_run`:** rejected because prompt-only recursion controls are weaker than removing the tool from delegated children.

## Validation

1. Run the extension's monitor, route, supervisor, process-group, and chain integration tests.
2. Run strict TypeScript checking against installed Pi declarations.
3. Load Pi with `--list-models` to validate extension startup without paid inference.
4. Confirm every configured role route in Pi's live catalog.
5. Confirm no raw thinking, tool arguments, tool results, commands, or credentials appear in progress or status artifacts.
6. Confirm exact UTC last-event timestamps, idle behavior, terminal cleanup, descendant cleanup, abort handling, and pre-tool-only fallback.
7. Run paid delegate smokes only with explicit cost and mutation authorization.
