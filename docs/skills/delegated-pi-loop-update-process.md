# Delegated Pi extension update process

Purpose: maintain the native TypeScript `delegate_run` Pi extension that runs inside the parent Pi process and supervises fresh Pi or Claude Code delegates. The extension owns route selection, bounded subprocess lifecycle, private JSON parsing, live last-event timestamps, role isolation, read-only fingerprints, terminal result enforcement, the Markdown tool-result envelope with native error marking, and private failure diagnostics.

## Classification and provenance

- Former Local Skill classification: **remove it**. The runtime skill was replaced by the native extension.
- Extension classification: **keep it**. Process supervision, fallback cutoffs, live event parsing, and shared-tree safety are executable behavior that should not be reconstructed in prompts.
- Source of truth: this Pi config, ADR 0007 as historical role-isolation rationale, ADR 0008 as the native-extension decision, and the installed Pi extension/JSON documentation.
- Pi harness authority: installed `@earendil-works/pi-coding-agent` documentation for extensions, JSON mode, CLI flags, project trust, and environment variables.
- Route authority: `agent/extensions/delegated-pi-loop/routes.ts`, checked against `agent/models.json` and Pi's live model catalog.
- Claude authority: installed `claude --help` for model, effort, persistence, permission, and tool flags.
- Project execution guides and accepted architecture decisions remain authoritative for task-specific prompts, findings, gates, and release transitions.

The extension runs as part of the parent Pi process, like CodeGraph and Context Mode. It spawns fresh child agents because role and context isolation still require separate agent processes. Child processes inherit provider credentials and operating-system permissions from the parent environment. The extension clears stale parent session metadata before each spawn.

## Owned surfaces

| Path | Responsibility |
|---|---|
| `agent/AGENTS.md` | Compact trigger and global orchestration safety rules. |
| `agent/extensions/delegated-pi-loop/index.ts` | Extension entrypoint, `delegate_run` registration, prompt guidance, execute-level finalization, native `tool_result` error marking, child watchdog, and lifecycle cleanup. |
| `agent/extensions/delegated-pi-loop/routes.ts` | Role classification, route maps, prompt contracts, and terminal marker contract. |
| `agent/extensions/delegated-pi-loop/monitor.ts` | Private Pi JSON lifecycle parsing, sanitized event metadata, terminal report extraction, and availability classification. |
| `agent/extensions/delegated-pi-loop/supervisor.ts` | Process groups, deadlines, output bounds, environment scrubbing, live progress, artifact status, and Claude plain protocol. |
| `agent/extensions/delegated-pi-loop/runner.ts` | Catalog preflight, ordered fresh-route fallback, shared deadline, read-only fingerprints, and the in-memory chain result. |
| `agent/extensions/delegated-pi-loop/result.ts` | Model-visible Markdown result builders, terminal marker stripping, the native tool-result error patch, and execute-level finalization (diagnostic persistence, tool-result assembly, artifact cleanup). |
| `agent/extensions/delegated-pi-loop/diagnostics.ts` | Private sanitized failure diagnostics under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop/` with 0700/0600 permissions. |
| `agent/extensions/delegated-pi-loop/manager.ts` | Parent-session concurrency guard, cancellation, and aggregate TUI widget. |
| `agent/extensions/delegated-pi-loop/render.ts` | Compact and expanded tool rendering with last event, UTC receipt time, and the TUI-only diagnostic path. |
| `agent/extensions/delegated-pi-loop/artifacts.ts` | Private temporary artifacts, atomic writes, best-effort directory removal, fingerprints, and bounded report output. |
| `agent/extensions/delegated-pi-loop/types.ts` | Extension, route, progress, status, and result contracts. |
| `agent/extensions/delegated-pi-loop/*.test.ts` | Monitor, route, supervisor, cleanup, fallback, result Markdown, diagnostics, and integration regressions. |
| `docs/skills/delegated-pi-loop-update-process.md` | This maintenance and validation contract. |

The retired `agent/skills/delegated-pi-loop/` directory must not be restored unless the user explicitly requests a separate skill layer.

## Runtime contract

### Parent and child boundaries

1. The extension executes inside the parent Pi process and registers `delegate_run` as a native custom tool.
2. The parent Pi session remains the sole orchestrator and synthesizes all delegate reports.
3. Each assigned role starts in a fresh ephemeral Pi or Claude Code process.
4. Child Pi uses `--mode json --no-session --approve`.
5. Child Claude Code uses `--print --no-session-persistence` with role-appropriate permissions.
6. `PI_DELEGATED_CHILD=1` suppresses `delegate_run` registration inside child Pi.
7. A child-side watchdog checks `PI_DELEGATE_PARENT_PID` and terminates the child's process group if the parent disappears.
8. `session_shutdown` aborts all active delegates.
9. Process-group cleanup runs after timeout, abort, terminal completion, and natural leader exit so descendants cannot remain.

### Environment and permissions

1. Provider credentials and operating-system permissions inherit from the parent Pi process.
2. Clear `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` before every delegate.
3. Clear `AI_AGENT` and `PI_CODING_AGENT` before Claude Code delegates.
4. Set `PI_SKIP_VERSION_CHECK=1` for child Pi startup.
5. Never persist delegate command lines or credential values.
6. A backend never widens the assigned role's mutation permissions.

### Lifecycle bounds and privacy

1. Default wall deadline: 45 minutes.
2. Default combined child output limit: 50 MiB.
3. Default Pi event-idle warning: 5 minutes.
4. Default Pi event-idle termination: 10 minutes.
5. Thinking, text deltas, tool arguments, and tool results remain private runtime input.
6. Temporary supervision artifacts (prompt and per-attempt report, stderr, and status files) may exist while a run is in flight in a private temporary directory. No chain-level `report.md` or `status.json` is written; every chain outcome returns in memory. Every terminal outcome removes the entire artifact directory after the failure diagnostic is persisted and the tool result is assembled.
7. Every accepted activity event records:
   - event type;
   - optional tool name, never tool arguments;
   - phase;
   - UTC supervisor receipt time;
   - monotonic activity time for idle enforcement.
8. The tool renderer and aggregate widget show the last event, its UTC time, relative age, route, phase, attempt, and elapsed time. For unsuccessful results the renderer also shows the private diagnostic path; nothing prompts or automatically reads it.
9. A valid `DELEGATE_RESULT: COMPLETED` report followed by final `agent_end` and `agent_settled` is terminal success even if Pi remains alive.
10. `BLOCKED`, `FAILED`, missing reports, malformed markers, malformed lifecycle streams, partial trailing JSON, output overflow, stalls, and wall timeout remain distinct non-success states.

### Tool result contract

1. `execute` always returns the native ToolResult envelope; model-visible `content[0].text` is raw Markdown, and JSON escaping is transport-only. Delegate Markdown is passed through verbatim, never parsed into plain text.
2. Successful runs return a minimal status header (label, `completed`, route, elapsed) followed by the delegate's final Markdown body with the validated terminal `DELEGATE_RESULT: COMPLETED` marker stripped. Report, status, artifact, and diagnostic paths never appear in model-visible content.
3. Unsuccessful runs return a compact sanitized failure Markdown: state, role, backend, selected or final route when present, phase, last sanitized event with optional tool name, exact UTC receipt time, elapsed time, the ordered attempt chain, and one deterministic per-state summary sentence. It excludes reports, raw stdout/stderr, prompts, tool arguments and results, provider response bodies, credentials, and all file paths.
4. The extension registers a native `tool_result` handler that patches unsuccessful `delegate_run` results to `isError: true` while preserving the returned Markdown content and renderer details. `execute` itself never throws for a supervised failure.
5. Unsuccessful runs persist one small private diagnostic JSON under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop/` with 0700 directories and 0600 atomic files. It contains only bounded sanitized fields (state, role, backend, routes, times, sanitized progress and attempts, bounded stream errors). It excludes prompts, delegate reports, raw stdout/stderr, tool arguments and results, Git status and fingerprints, credentials, provider bodies, and every file path. The temporary supervision artifact directory is removed after the diagnostic is persisted, so nothing in `/tmp` outlives the run beyond best-effort removal limits.
6. The diagnostic path travels only in `details` for the TUI renderer. Successful runs write no diagnostic.
7. Execute-level finalization awaits `runDelegate`, persists the failure diagnostic when unsuccessful, assembles the final ToolResult, and then removes the temporary artifact directory for every terminal outcome in a `finally` that also runs when diagnostic persistence fails. A failed diagnostic write still returns sanitized failure content with no diagnostic path; directory removal stays best-effort.

### Route fallback

A route chain may advance only when all conditions are true:

1. No terminal delegate result exists.
2. No tool execution started.
3. The route is absent from Pi's live catalog, or the attempt reports recognized provider unavailability, or the attempt reaches event-idle stall.
4. The next route is fresh and has not been tried.
5. The original shared wall deadline still has time remaining.

Recognized availability signals remain narrow:

- typed status codes and provider/network availability errors;
- `client_gone` and `context canceled`;
- `scanner_error` and `unexpected EOF`;
- a complete single-line `[error] ...` machine envelope.

Prose, multi-section reports, arbitrary missing markers, and every attempt that started a tool remain terminal failures rather than fallback triggers.

### Role routes

| Role | Default route |
|---|---|
| Solution or review A | `opencode-go/muse-spark-1.2-contributor:xhigh`, then AgentRouter Sol/max, Tabitoken Opus 5 Thinking/max, SeekAI Opus 5/max, GoRouter Opus 5 Thinking/high. |
| Solution or review B | `opencode-go/deepseek-v4-flash:max`, then SeekAI DeepSeek V4 Flash/max, AgentRouter Opus 5/max, Tabitoken Opus 5 Thinking/max, GoRouter Opus 5 Thinking/high. |
| Solution or review C | `opencode-go/hy3:high`, then AgentRouter Opus 5/max, Tabitoken Opus 5 Thinking/max, SeekAI Opus 5/max, GoRouter Opus 5 Thinking/high. |
| Implementation or remediation | `zai/glm-5.3:max`. |
| Finding verification | `openai-codex/gpt-5.6-sol:high`. |
| Explicit Z.AI alternative | `zai/glm-5.3:max` with assigned-role permissions. |
| Explicit Claude Code alternative | `claude-opus-5`, effort `medium`, with assigned-role permissions. |

AgentRouter, Tabitoken, SeekAI, and GoRouter remain backup-only in default A/B/C maps. Muse Spark uses `xhigh` because its `max` map is null. HY3 uses `high` because it does not support `max`.

### Orchestration gates

1. When no accepted solution contract exists, call solution A, B, and C concurrently with the same neutral assignment.
2. Require all three reports. One or two reports cannot complete the gate.
3. Verify material citations and architecture claims before finalizing the implementation contract.
4. Stop for user input on material architecture ambiguity.
5. Run one implementation or remediation delegate at a time.
6. Do not let the parent edit the shared tree while a mutating delegate runs.
7. After implementation or remediation, call fresh review A, B, and C concurrently with the same neutral review scope.
8. Verify every blocking finding in a fresh sequential verification role before remediation.
9. Run a fresh three-reviewer gate after remediation.
10. Solution investigators cannot act as implementers or later reviewers.
11. Read-only roles receive pre/post Git status plus tracked, staged, and path-safe untracked-content hashes. Any detected tree change becomes `read_only_mutation`.
12. Git transitions and hosted-service writes always require separate explicit authorization.

## Update workflow

1. Read installed Pi `docs/extensions.md`, `docs/json.md`, `docs/environment-variables.md`, and `docs/tui.md` completely.
2. Read ADR 0007, ADR 0008, this document, and every owned source file.
3. Compare process and renderer patterns with the local CodeGraph and Context Mode extensions.
4. Confirm every route and thinking level in Pi's live catalog without running paid inference.
5. Confirm Claude Code supports the pinned model, effort, persistence, permission, and tool flags.
6. Preserve parent-process extension execution, child role isolation, environment inheritance, recursive-delegation suppression, deadlines, private event handling, exact timestamps, process-group cleanup, fallback cutoffs, fingerprints, concurrency gates, the raw-Markdown tool-result contract, native error marking through `tool_result`, and the 0700/0600 failure diagnostic contract.
7. Update tests before or with behavior changes.
8. Update `agent/AGENTS.md`, root `README.md`, ADRs, and context-cost accounting when the active tool contract changes.
9. Do not restore the retired runtime skill or Python supervisors.
10. Run structural validation before any paid delegate smoke.

## Required checks

Run the extension suite:

```bash
cd ~/.pi/agent/extensions/delegated-pi-loop
npm test
```

Run a strict TypeScript check using the repository's available TypeScript toolchain or an equivalent temporary config that resolves Pi's installed type declarations.

Validate extension loading without paid inference:

```bash
pi --list-models zai/glm-5.3
```

Verify route catalog entries:

```bash
pi --list-models opencode-go/muse-spark-1.2-contributor
pi --list-models opencode-go/deepseek-v4-flash
pi --list-models opencode-go/hy3
pi --list-models agentrouter/gpt-5.6-sol
pi --list-models tabitoken/claude-opus-5-thinking
pi --list-models seekai/claude-opus-5
pi --list-models seekai/deepseek-v4-flash
pi --list-models agentrouter/claude-opus-5
pi --list-models gorouter/claude-opus-5-thinking
pi --list-models zai/glm-5.3
pi --list-models openai-codex/gpt-5.6-sol
```

Also verify:

- no raw thinking or tool payload appears in reports, status, progress, diagnostics, or test output;
- `lastEventAt` is an ISO-8601 UTC receipt timestamp and updates on every accepted activity event;
- empty deltas do not reset event-idle time;
- a completed settled lifecycle cleans up a lingering process group;
- natural leader exit cleans up descendants;
- partial trailing JSON fails closed;
- fallback never occurs after tool execution or a terminal marker;
- abort during catalog preflight stops the chain;
- child Pi does not register `delegate_run` recursively;
- read-only fingerprint changes invalidate the result;
- no delegate command line or credential value is persisted;
- unrelated dirty files remain untouched;
- every terminal outcome removes its temporary supervision artifact directory after diagnostic persistence and tool-result assembly, and no chain-level `report.md` or `status.json` is ever written;
- successful runs return exact Markdown with the terminal marker stripped and no paths;
- unsuccessful runs return the compact sanitized failure Markdown, are patched to `isError: true` through the native `tool_result` lifecycle, persist one 0600 diagnostic JSON under `logs/delegated-pi-loop/` with only bounded sanitized fields and no file paths, and surface its path only in the TUI renderer;
- a diagnostic write failure still returns sanitized failure content with no diagnostic path and performs artifact cleanup.

Run paid model smokes only when the user authorizes the provider cost and mutation scope. Use a disposable local Git fixture for mutating tests.
