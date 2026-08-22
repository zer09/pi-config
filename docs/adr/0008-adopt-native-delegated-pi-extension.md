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

The extension registers one `delegate_run` custom tool. The parent Pi agent remains the sole orchestrator and calls one tool instance per assigned role. Pi's normal parallel tool execution supports the solution A/B/C/D and review A/B/C/D gates. An in-process manager keeps implementation, remediation, and oracle roles exclusive against every active delegate, allows finding-verification roles to overlap only other verification roles in batches of at most four with a bounded rejection for a fifth, and leaves solution/review concurrency unchanged; the oracle role runs between solution synthesis and implementation as the advisory Sol review defined by ADR 0007, and the extension rejects a main-Sol parent or a non-default oracle backend before spawning.

The extension directly supervises only child Pi RPC processes. The former direct Claude Code CLI backend is removed, including its public backend value, route type, supervisor, permissions, and plain protocol. Claude-named models remain supported when ordinary Pi providers serve them. Child processes inherit provider credentials and operating-system permissions from the parent environment. The extension clears stale parent session metadata before spawn and uses fresh ephemeral child sessions.

Each route attempt uses one persistent `--mode rpc --no-session --approve` child. The extension sends the assigned task as correlated `prompt-1`. A clean settled `missing_report` or `invalid_result` receives exactly one fixed `prompt-2` in the same child session. The second response is complete and authoritative; the extension never merges reports or inserts a marker. One wall deadline, idle policy, output bound, manager ID, cancellation path, and process group cover both rounds.

The strict RPC layer splits only on LF, preserves partial UTF-8, bounds records before parsing, correlates prompt responses, buffers early lifecycle events until acceptance, cancels blocking extension UI requests, and fails closed on malformed protocol. A rejected prompt becomes `prompt_rejected`.

Structured provider failure is classified before report recovery. Typed assistant errors and bounded compatibility signatures for credit, quota, billing, usage, authentication, rate-limit, network, overload, timeout, and model availability produce only a bounded category. Before tools, `provider_failed` can use the existing provider fallback. After tools or accepted recovery, it fails closed.

The extension privately parses Pi RPC events. For every accepted activity event, it records only:

- the event type;
- an optional tool name;
- the current phase;
- a monotonic activity time for idle enforcement; and
- an ISO-8601 UTC supervisor receipt time for display.

It does not publish or persist thinking, text deltas, tool arguments, or tool results. The native `delegate_run` tool renderer streams this state in the tool's own row: while a delegate runs, Pi re-renders the live tool block in place with the session-local monotonic numeric delegate ID, current route, state, phase, attempt, last event, exact UTC time, relative age, and elapsed time, and the settled render keeps the ID, final state, route, elapsed time, and last event in front of the collapsed report. No separate aggregate, footer, or below-editor widget duplicates this state.

The manager assigns IDs `1, 2, 3, ...` only after a run passes its concurrency gate, never reuses an ID during that extension lifetime, and retains an aborted run until process-group cleanup and execute finalization finish. `/delegate:list` opens a stable active-run selector and only prefills `/delegate:stop <id>`; `/delegate:stop <id>` aborts that manager-owned controller, leaves siblings running, and produces the existing `interrupted` terminal path without fallback. The commands execute locally without an LLM turn. There is no BTW-specific command or raw PID control.

Preserve ADR 0007's route maps, structured terminal markers, 45-minute wall deadline, 50 MiB output limit, 5-minute idle warning, 10-minute idle termination, pre-tool-only fallback, private artifacts, role separation, and authorization boundaries.

The parent is the sole author of plan and research deliverables, including repository artifacts. Solution delegates may gather evidence and propose options, but implementation and remediation delegates must not research, formulate, draft, save, or revise these deliverables. Pure planning or research work does not run an implementation delegate, implementation review gate, or remediation. This exception is based on the artifact's purpose rather than its `.md` extension: implementation documentation such as README updates, ADRs, changelogs, policy files, and documentation accompanying code still follows implementation delegation.

Global pre/post Git tree fingerprints and the `read_only_mutation` state were removed on 2026-08-22. Shared monorepo worktrees are modified concurrently by unrelated agents, so a before/after fingerprint cannot attribute the actor and incorrectly invalidated otherwise completed read-only reports. Read-only roles stay enforced through their role contracts and the existing Pi role classification. Residual risk: Pi-based read-only delegates still receive the normal tool set and extensions and can misuse writable tools; without fingerprinting the extension does not automatically detect such mutation.

Set `PI_DELEGATED_CHILD=1` for child Pi. The extension does not register `delegate_run` in a delegated child, which makes recursive delegation unavailable even if a prompt ignores the prohibition. A child-side parent watchdog terminates the child process group if the parent disappears. The parent extension aborts active groups during `session_shutdown`, and the supervisor cleans descendants after natural leader exit.

Retire and remove `agent/skills/delegated-pi-loop/`. Keep its maintenance document as the extension update contract and retired-skill record.

## Consequences

- Delegation becomes a native Pi tool with normal custom rendering, cancellation, and extension lifecycle cleanup.
- The parent can see the last sanitized child event and its exact receipt time while the delegate runs.
- Route policy and safety checks become deterministic executable behavior instead of prompt-driven shell construction.
- Provider credentials and OS permissions inherit from the parent Pi process without copying secrets into prompts or commands.
- Fresh subprocesses still isolate role context and model state.
- The active tool schema remains startup context, while removing direct Claude backend metadata reduces its current cost.
- TypeScript tests replace the Python supervisor suite.
- The public backend schema contains only `default` and `zai`; direct Claude CLI supervision and plain-protocol heartbeats no longer exist.
- Pi-served Claude model routes remain normal Pi RPC routes and retain their provider/model ordering.
- Exactly one same-session report recovery improves malformed-report handling without repeating assigned work in a fresh route.
- Runtime provider failures use `provider_failed`, while rejected RPC prompts use `prompt_rejected`.

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
