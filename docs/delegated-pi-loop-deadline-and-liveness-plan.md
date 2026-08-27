# Delegated Pi Loop Deadline, Liveness, Cleanup, and Diagnostic Remediation Plan

> **Supersession note (renewable liveness).** The total-runtime portions of
> this plan are superseded by
> [`docs/delegated-pi-loop-runtime-ceiling-removal-plan.md`](./delegated-pi-loop-runtime-ceiling-removal-plan.md)
> and
> [`docs/adr/0013-delegated-renewable-liveness.md`](./adr/0013-delegated-renewable-liveness.md).
> Superseded sections: 4.1, 4.2, 6.1, 6.2, 6.3, 7.3, 8.2, 9.1, 11, 12,
> 14.6, 15, 18, and 19. A delegate no longer has a 45-minute total
> productive-work ceiling; the 45-minute value is now a renewable maximum gap
> between novel structural checkpoints. The equal-share deadline defect and
> the evidence in this document remain historically valid; sections on
> activity-based stuck detection, cleanup, process proof, and diagnostics
> remain current except where the superseding plan narrows them.

Status: Accepted implementation plan (total-runtime portions superseded)

Baseline commit: `450c58e` (`feat: add permanent Solution E`)

Scope owner: the future implementation agent

Implementation authorization: not granted by this plan. The implementation agent must receive a separate explicit request before changing product code.

## 1. Purpose

Correct the delegated Pi loop so fallback-provider count never reduces a delegate's working time.

Replace provider-count-based route deadlines with:

1. one fixed delegate work deadline;
2. activity-based stuck detection using the Pi RPC events already shown in the TUI;
3. sequential provider fallback that consumes only time actually spent by failed routes;
4. a separate bounded cleanup allowance;
5. privacy-safe diagnostics that identify deadline, interruption, active-tool, and cleanup causes.

The implementation must preserve Pi RPC supervision, role isolation, routing order, provider fallback, same-session report recovery, process-group cleanup, privacy exclusions, and parent orchestration rules.

## 2. Confirmed defect

The current runner computes each route's deadline from the number of remaining routes:

```typescript
const routeDeadline = performance.now() + remainingMs / (routes.length - index);
```

The default chain deadline is 45 minutes. Gate D has nine provider routes. Its initial nominal allocation is therefore:

```text
2,700 seconds / 9 routes = 300 seconds
```

Catalog startup and the current 15-second termination reserve reduce actual supervision to approximately 282 to 286 seconds. Persisted diagnostics reproduced that exact pattern across multiple Codex providers.

This behavior incorrectly treats fallback providers as equal work-budget allocations. Adding providers reduces model working time even though providers are sequential fallback candidates.

The current behavior also explains why a pinned one-route Review D retry completed after 658.2 seconds while default nine-route Review D was terminated at 300 seconds.

## 3. Evidence and current authority

The implementation agent must inspect these current sources before editing:

- `agent/extensions/delegated-pi-loop/runner.ts:232-515`
- `agent/extensions/delegated-pi-loop/supervisor.ts:19-35`
- `agent/extensions/delegated-pi-loop/supervisor.ts:198-255`
- `agent/extensions/delegated-pi-loop/supervisor.ts:314-739`
- `agent/extensions/delegated-pi-loop/monitor.ts:25-64`
- `agent/extensions/delegated-pi-loop/monitor.ts:216-468`
- `agent/extensions/delegated-pi-loop/types.ts`
- `agent/extensions/delegated-pi-loop/diagnostics.ts`
- `agent/extensions/delegated-pi-loop/manager.ts`
- `agent/extensions/delegated-pi-loop/index.ts:195-227`
- `agent/extensions/delegated-pi-loop/routing.json`
- `docs/adr/0009-delegated-routing-configuration.md:62-66`
- `docs/skills/delegated-pi-loop-update-process.md:68-90`

The current equal-share policy is intentional and tested, but it is now rejected. Replace its tests and current-policy documentation rather than preserving compatibility with it.

## 4. Goals

### 4.1 Deadline goals

- Give every delegate one 45-minute work budget independent of provider count.
- Keep one monotonic absolute work deadline across catalog checks, provider attempts, report recovery, and fallback.
- Never reset or extend the work deadline after activity, fallback, tools, retries, compaction, or report recovery.
- Let every attempted route use the full remaining work budget.
- Charge elapsed catalog, cleanup, and failed-route time against the same monotonic chain clock.
- Permit the final process cleanup to finish within a separate bounded allowance after the work deadline.

### 4.2 Liveness goals

- Use meaningful Pi RPC activity as the authoritative stuck signal.
- Preserve the existing five-minute idle warning.
- Preserve the existing ten-minute idle failure threshold unless tests expose a provider-specific compatibility problem.
- Ignore empty deltas and informational heartbeats that do not show progress.
- Keep a hard 45-minute work ceiling even while activity continues.

### 4.3 Fallback goals

- Fallback after an operational failure only while work time remains.
- Do not reserve equal time for routes that may never run.
- Do not classify a productive delegate reaching the global work deadline as a provider failure.
- Preserve restart-after-work behavior and its fixed sanitized note when an operational failure occurs after tools or accepted report recovery.
- Preserve terminal behavior for completed, intentional BLOCKED/FAILED, interruption, and cleanup failure.

### 4.4 Cleanup goals

- Preserve the requirement that a later route never starts until the previous process group is positively proven gone.
- Replace the 40-millisecond forced-kill verification reserve with a realistic bounded interval.
- Distinguish `group_alive` from `close_unconfirmed` in safe internal and diagnostic metadata.
- Keep `cleanup_failed` terminal and non-fallback-eligible.

### 4.5 Diagnostic goals

- Explain why a run stopped without retaining sensitive or delegate-authored content.
- Persist fixed enums and numeric timing only.
- Record interruption source, timeout scope, cleanup reason, active tool, and relevant per-attempt liveness metadata.
- Continue excluding prompts, reports, raw stdout/stderr, tool arguments/results, Git state, credentials, provider bodies, and every file path.

## 5. Non-goals

- Do not change role taxonomy or gate concurrency.
- Do not change routing order, configured providers, model IDs, thinking levels, or override policy.
- Do not add a public timeout parameter to `delegate_run`.
- Do not couple limits to `routing.json` profiles or provider entries.
- Do not make provider count affect any deadline.
- Do not retain raw child output or provider errors.
- Do not expose process IDs, process-group IDs, signals, command arguments, or file paths to the model.
- Do not add recursive delegation.
- Do not run paid live inference without separate explicit authorization.

## 6. Accepted runtime contract

### 6.1 Work deadline

Define one extension-owned work limit:

```typescript
DEFAULT_WORK_TIMEOUT_MS = 45 * 60 * 1000;
```

At the start of `runDelegate`:

```typescript
const workDeadline = started + workTimeoutMs;
```

Every route receives that same absolute deadline:

```typescript
const remainingWorkMs = workDeadline - performance.now();
if (remainingWorkMs <= 0) {
  finalState = "timed_out";
  deadlineCause = "work_deadline";
  break;
}

const attemptStatus = await supervisePi({
  // ...
  workDeadline,
  timeoutMs: remainingWorkMs,
});
```

Delete the equal-share calculation. Do not divide by `routes.length`, tier count, provider count, or remaining-route count.

### 6.2 Sequential fallback examples

#### Early provider failure

```text
T+00:00 primary starts
T+00:30 provider failure
T+00:30 fallback starts with about 44m30s remaining
```

#### Activity stall

```text
T+00:00 primary starts
T+10:00 no meaningful activity for ten minutes
T+10:00 primary becomes stalled and is cleaned up
T+10:10 fallback starts with about 34m50s remaining
```

#### Productive work reaches the hard limit

```text
T+00:00 primary starts
T+44:59 meaningful activity is still arriving
T+45:00 global work deadline expires
T+45:00 run becomes timed_out
T+45:00 no fallback starts because no work budget remains
T+45:00 bounded cleanup begins
```

This behavior is intentional. A provider that stayed active until the task deadline did not prove a provider failure.

### 6.3 Timeout and fallback classification

Use these semantics:

| Condition | State | Cause metadata | Fallback |
|---|---|---|---|
| Authentication, quota, availability, or compatible provider error | `provider_failed` | existing provider category | Yes, while work remains |
| No meaningful RPC activity for the idle deadline | `stalled` | `idle_deadline` | Yes, while work remains |
| Catalog check exceeds its fixed cap | attempt `timed_out` | `catalog_preflight` | Yes, while work remains |
| Child, prompt, stream, output, or report operational failure | existing state | existing metadata | Yes, while work remains |
| Global work deadline expires | `timed_out` | `work_deadline` | No |
| User or parent cancellation | `interrupted` | fixed interruption source | No |
| Process group cannot be proven dead | `cleanup_failed` | fixed cleanup reason | No |
| Valid COMPLETED/BLOCKED/FAILED terminal | existing terminal state | existing terminal reason | No |

Remove supervised global-work `timed_out` from ordinary fallback eligibility. A catalog preflight timeout remains a direct runner-level continuation while work remains and is distinguished by `deadlineCause: "catalog_preflight"`.

Do not infer provider failure from elapsed work time.

## 7. Activity-based liveness design

### 7.1 Meaningful activity

The existing monitor already recognizes most required events. Preserve and test these meaningful categories:

- prompt acceptance;
- `agent_start`, `agent_end`, and `agent_settled`;
- `turn_start` and `turn_end`;
- `message_start` and `message_end`;
- `thinking_start`, nonempty `thinking_delta`, and `thinking_end`;
- `text_start`, nonempty `text_delta`, and `text_end`;
- `toolcall_start`, nonempty `toolcall_delta`, and `toolcall_end`;
- `tool_execution_start`, `tool_execution_update`, and `tool_execution_end`;
- nonempty `bash_execution_update`;
- retry start/end;
- compaction and summarization-retry transitions;
- report-recovery prompt acceptance and activity;
- a new durable entry when it represents actual progress.

Each meaningful event must update:

- `lastActivityMonotonic`;
- `lastEvent`;
- `lastEventDetail` when safe;
- `lastEventAt`;
- `phase`;
- `activityEventCount`.

### 7.2 Non-meaningful activity

Do not reset the idle timer for:

- empty thinking, text, tool-call, or bash deltas;
- progress rendering ticks;
- repeated queue/status heartbeats with no state change;
- duplicate informational events;
- raw stderr bytes;
- output that cannot be parsed as an accepted RPC event.

The implementation may continue displaying a safe informational event without treating it as liveness. If needed, separate `lastObservedEvent` from `lastMeaningfulActivity`; do not weaken the stuck detector to preserve one display field.

### 7.3 Idle thresholds

Retain:

```typescript
DEFAULT_IDLE_WARNING_MS = 5 * 60 * 1000;
DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
```

Behavior:

1. At five minutes without meaningful activity, issue one warning and keep running.
2. At ten minutes without meaningful activity, classify the attempt `stalled`.
3. Clean up the route.
4. Start the next route only after positive cleanup proof and only while global work time remains.

Meaningful activity resets only the idle age. It never resets the global work deadline.

## 8. Tool activity design

### 8.1 Active-tool tracking

Extend `PiRpcMonitor` to track active tool executions by tool-call ID when available. Support more than one active tool even if current Pi behavior is normally sequential.

Expose bounded fields:

- `activeToolCount`;
- `activeToolName` for the most recently started active tool;
- `activeToolStartedMonotonic` internally;
- `activeToolElapsedSeconds` in snapshots and progress;
- `lastToolActivityAt` if needed internally.

Tool names are already treated as safe bounded metadata. Continue truncating them to 80 characters.

On events:

- `tool_execution_start`: add the tool and record meaningful activity;
- `tool_execution_update`: update its activity and record meaningful activity;
- `tool_execution_end`: remove it and record meaningful activity;
- malformed lifecycle: preserve existing fail-closed stream handling.

### 8.2 Tool timeout behavior

Do not add an arbitrary total-duration limit for an active tool in this change.

Use the same meaningful-activity idle watchdog:

- a tool that emits updates remains live;
- a tool that emits no meaningful updates for ten minutes becomes `stalled`;
- every tool remains bounded by the global 45-minute work deadline.

If a tool has its own explicit timeout, that tool remains responsible for enforcing it. Do not rewrite tool arguments or infer a timeout from free text in this implementation.

A later change may add trusted machine-readable tool-deadline events. Do not add a `tool_timed_out` state until Pi exposes evidence that distinguishes a tool timeout from a generic tool error.

### 8.3 TUI behavior

Continue displaying the latest safe activity already visible to the user, including:

- phase such as `thinking`, `provider`, `tool`, `retry`, or `complete`;
- last event such as `thinking_start`, `thinking_delta`, `thinking_end`, or `tool_execution_start`;
- bounded tool name;
- UTC event receipt time;
- idle seconds;
- total elapsed seconds.

Add active-tool elapsed time to progress details. Keep rendering updates throttled to approximately one second. Rendering must not itself count as activity.

## 9. Cleanup design

### 9.1 Separate cleanup allowance

Replace the 40ms forced-kill verification and 20ms final-cleanup tail with:

```typescript
DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;
DEFAULT_TERMINATION_GRACE_MS = 5_000;
FORCED_KILL_VERIFY_MS = 3_000;
FINAL_CLEANUP_ALLOWANCE_MS = 2_000;
```

The 45-minute value describes productive delegate work. Cleanup may extend final settlement by at most ten seconds.

For an early operational failure, cleanup time still advances the monotonic chain clock and therefore reduces remaining work naturally. For a failure at the global work deadline, final settlement may extend no later than the separate cleanup limit.

### 9.2 Termination algorithm

For each termination request:

1. Establish a cleanup deadline from the current monotonic time and the ten-second cleanup limit.
2. Send SIGTERM to the process group.
3. Poll for up to five seconds.
4. If the group remains, send SIGKILL.
5. Poll for actual process-group disappearance for up to three seconds.
6. Require leader close or recorded exit.
7. Reserve the final two seconds for bounded stderr/status/progress finalization.
8. Return success only after positive leader and group proof.

Preserve Windows-specific child handling.

Do not advance to a fallback route after negative cleanup proof.

### 9.3 Cleanup reason propagation

Add a fixed type:

```typescript
type CleanupFailureReason = "group_alive" | "close_unconfirmed";
```

Propagate it from `TerminationOutcome` through:

- catalog outcome metadata;
- `AttemptStatus`;
- `DelegateProgress`;
- `ChainAttempt`;
- `DelegateRunResult` final progress;
- ToolResult details;
- failure diagnostics;
- deterministic failure Markdown.

Do not expose signals, process IDs, group IDs, command lines, or raw errors.

## 10. Interruption-source design

The current `AbortSignal.any` path loses the operational source. Add a fixed internal reason:

```typescript
type InterruptionSource =
  | "delegate_stop"
  | "session_shutdown"
  | "tool_call_abort"
  | "unknown";
```

Required changes:

- `/delegate:stop` aborts with `delegate_stop`.
- `session_shutdown` calls `abortAll("session_shutdown")`.
- the Pi tool execution signal maps to `tool_call_abort`.
- first abort wins.
- an unrecognized abort reason maps to `unknown`.
- do not accept arbitrary external reason text.

Propagate the fixed value through progress, result details, failure Markdown, and diagnostics.

Do not claim `parent_disappeared` unless the parent watchdog gains a trusted channel that can report that cause back before the child exits.

## 11. Type and schema changes

### 11.1 New fixed enums

Add to `types.ts`:

```typescript
type DeadlineCause =
  | "work_deadline"
  | "idle_deadline"
  | "catalog_preflight";

type CleanupFailureReason =
  | "group_alive"
  | "close_unconfirmed";

type InterruptionSource =
  | "delegate_stop"
  | "session_shutdown"
  | "tool_call_abort"
  | "unknown";
```

### 11.2 Progress and attempt fields

Add optional bounded fields where applicable:

```typescript
readonly deadlineCause?: DeadlineCause;
readonly cleanupFailureReason?: CleanupFailureReason;
readonly interruptionSource?: InterruptionSource;
readonly workBudgetSeconds?: number;
readonly remainingWorkSecondsAtAttemptStart?: number;
readonly activeToolCount?: number;
readonly activeToolName?: string;
readonly activeToolElapsedSeconds?: number;
```

Add the relevant subset to `MonitorSnapshot`, `AttemptStatus`, `DelegateProgress`, `ChainAttempt`, and `DelegateRunResult`.

Do not add absolute filesystem paths or raw error text.

### 11.3 Schema versions

- Increment durable failure diagnostics from schema version 4 to 5.
- Increment temporary `AttemptStatus` schema only if the project treats its current version as a contract. Temporary attempt artifacts remain private and are removed after finalization.
- Do not migrate historical diagnostic files.
- Document that existing schema 3 and 4 logs remain unchanged.

## 12. Diagnostic schema version 5

A failure diagnostic should contain safe fields similar to:

```json
{
  "schemaVersion": 5,
  "state": "stalled",
  "deadlineCause": "idle_deadline",
  "workBudgetSeconds": 2700,
  "remainingWorkSecondsAtAttemptStart": 2700,
  "lastEvent": "thinking_start",
  "lastEventAt": "2026-08-24T07:57:50.278Z",
  "idleSeconds": 600,
  "activeToolCount": 0,
  "cleanupFailureReason": null,
  "interruptionSource": null
}
```

A cleanup failure may contain:

```json
{
  "schemaVersion": 5,
  "state": "cleanup_failed",
  "deadlineCause": "work_deadline",
  "lastEvent": "tool_execution_start",
  "lastEventDetail": "ctx_batch_execute",
  "activeToolCount": 1,
  "activeToolName": "ctx_batch_execute",
  "activeToolElapsedSeconds": 154.7,
  "cleanupFailureReason": "group_alive"
}
```

Continue omitting undefined fields during JSON serialization.

Keep all current privacy exclusions and size bounds. Extend privacy tests with seeded path, credential, prompt, report, tool-argument, tool-result, provider-body, signal, PID, and raw-error values.

## 13. File-by-file implementation sequence

### Phase 0: Baseline and branch discipline

1. Start from commit `450c58e` or a descendant that does not alter this plan's assumptions.
2. Record `git status --short`.
3. Preserve untracked `agent/browser-harness.json` and `findings/*` files.
4. Run the current extension suite and strict TypeScript check.
5. Do not stage or commit without separate authorization.

### Phase 1: Types and monitor

Files:

- `agent/extensions/delegated-pi-loop/types.ts`
- `agent/extensions/delegated-pi-loop/monitor.ts`
- `agent/extensions/delegated-pi-loop/monitor.test.ts`

Tasks:

1. Add fixed deadline, cleanup, and interruption enums.
2. Add active-tool fields.
3. Track tool lifecycle by ID.
4. Separate meaningful liveness activity from informational events if necessary.
5. Preserve nonempty-delta behavior.
6. Add tests for thinking, text, tool-call, and tool-execution activity.
7. Add tests proving empty deltas and informational heartbeats do not reset idle age.

### Phase 2: Supervisor deadlines and cleanup

Files:

- `agent/extensions/delegated-pi-loop/supervisor.ts`
- `agent/extensions/delegated-pi-loop/supervisor.test.ts`

Tasks:

1. Rename the conceptual timeout to work timeout.
2. Accept one absolute `workDeadline` shared by every route.
3. Replace route-share cleanup-inclusive cutoff logic.
4. Keep one one-shot timer for the global work deadline.
5. Keep the 100ms ticker for progress, idle, and output checks.
6. Use meaningful monitor activity for idle warning and stall classification.
7. Add the separate ten-second cleanup deadline.
8. Increase forced-kill verification to three seconds.
9. Propagate cleanup and deadline causes.
10. Keep positive process-group death proof and bounded settlement.

### Phase 3: Runner fallback policy

Files:

- `agent/extensions/delegated-pi-loop/runner.ts`
- `agent/extensions/delegated-pi-loop/runner.test.ts`

Tasks:

1. Remove equal-share route allocation.
2. Pass the same absolute work deadline to every route.
3. Keep catalog checks capped at 15 seconds and bounded by remaining work.
4. Continue after catalog preflight timeout while work remains.
5. Continue after operational failure while work remains.
6. End terminal `timed_out` when the shared work deadline expires.
7. Preserve restart-after-work semantics.
8. Propagate per-attempt cause and liveness metadata.
9. Replace equal-share tests rather than weakening their assertions.

### Phase 4: Interruption source

Files:

- `agent/extensions/delegated-pi-loop/manager.ts`
- `agent/extensions/delegated-pi-loop/manager.test.ts`
- `agent/extensions/delegated-pi-loop/index.ts`
- `agent/extensions/delegated-pi-loop/index.test.ts` if visible metadata changes

Tasks:

1. Add fixed abort reasons.
2. Replace source-losing signal composition.
3. Record `/delegate:stop`, session shutdown, and parent tool-call abort distinctly.
4. Preserve first-abort-wins behavior.
5. Preserve manager concurrency and targeted-stop behavior.

### Phase 5: Results, diagnostics, and TUI

Files:

- `agent/extensions/delegated-pi-loop/diagnostics.ts`
- `agent/extensions/delegated-pi-loop/diagnostics.test.ts`
- `agent/extensions/delegated-pi-loop/result.ts`
- `agent/extensions/delegated-pi-loop/result.test.ts`
- `agent/extensions/delegated-pi-loop/render.ts`
- relevant render or manager tests

Tasks:

1. Write schema version 5 diagnostics.
2. Render fixed deadline, interruption, and cleanup causes.
3. Add active-tool elapsed time to progress details.
4. Keep diagnostic paths out of model-visible content.
5. Keep raw operational details out of failure Markdown.
6. Preserve deterministic summaries for every state.

### Phase 6: Documentation

Files:

- `README.md`
- `docs/adr/0009-delegated-routing-configuration.md`
- `docs/skills/delegated-pi-loop-update-process.md`
- `docs/CHANGELOG.md`
- `docs/config-context-cost.md` only if model-visible instructions or tool metadata change

Tasks:

1. Mark equal-share route allocation as superseded current policy.
2. Document provider-count-independent work deadlines.
3. Document activity-based stall detection.
4. Document separate cleanup allowance and safe cause codes.
5. Document diagnostic schema 5 and non-migration of old logs.
6. Preserve historical provenance in older ADR sections.
7. Recalculate context-cost attribution only if `agent/AGENTS.md`, tool description, prompt guidelines, snippet, or parameter schema changes.

Files that should normally remain unchanged:

- `agent/extensions/delegated-pi-loop/routing.json`
- `agent/extensions/delegated-pi-loop/routing.ts`
- `agent/extensions/delegated-pi-loop/routes.ts`
- `agent/extensions/delegated-pi-loop/protocol.ts`
- `agent/extensions/delegated-pi-loop/artifacts.ts`

Any change to these files requires a specific explanation tied to the accepted contract.

## 14. Required regression tests

### 14.1 Provider-count independence

1. Build equivalent one-route and nine-route configurations.
2. Inject the same work timeout.
3. Prove the first route receives the same absolute work deadline in both configurations.
4. Prove adding a tenth provider does not change that deadline.
5. Prove no calculation divides by route count.

### 14.2 Early fallback

1. Primary provider fails early.
2. Cleanup succeeds.
3. Fallback starts.
4. Its remaining budget equals the global work deadline minus actual elapsed time, not an allocated fraction.

Cover provider failure, spawn failure, invalid stream, and idle stall.

### 14.3 Activity beyond the old five-minute slice

Use injected short clocks rather than a real five-minute test:

1. Configure nine routes.
2. Emit meaningful thinking deltas beyond the old one-ninth boundary.
3. Prove route one remains active.
4. Complete before the shared work deadline.
5. Prove no fallback route spawned.

Repeat with tool execution updates.

### 14.4 Empty and informational events

1. Emit empty thinking/text/tool-call/bash deltas.
2. Prove idle age does not reset.
3. Emit repeated unchanged queue/status events.
4. Prove idle age does not reset.
5. Emit a nonempty thinking delta.
6. Prove idle age resets.

### 14.5 Idle fallback

1. Stop meaningful activity.
2. Prove one warning at the warning threshold.
3. Prove `stalled` at the idle threshold.
4. Prove the next route starts only after positive cleanup.
5. Prove remaining work is based on actual elapsed time.

### 14.6 Hard work deadline

1. Keep sending meaningful activity through the injected work deadline.
2. Prove activity does not extend the deadline.
3. Prove final state is `timed_out` with `work_deadline`.
4. Prove no later route starts.
5. Prove cleanup finishes inside the additional cleanup allowance.

### 14.7 Tool lifecycle

1. Track start, update, and end by tool-call ID.
2. Cover multiple active tool IDs.
3. Prove active tool fields are bounded and cleared.
4. Prove a silent tool reaches the idle deadline.
5. Prove a tool emitting meaningful updates stays live until the global work deadline.

### 14.8 Cleanup realism

Linux tests must cover:

1. process group disappears 100 to 500ms after SIGKILL and succeeds;
2. process group disappears before the three-second verification deadline and succeeds;
3. process group remains alive beyond verification and returns `cleanup_failed/group_alive`;
4. group is gone but leader close remains unconfirmed and returns `cleanup_failed/close_unconfirmed`;
5. no second route starts after negative cleanup proof;
6. inherited stdio cannot create an unbounded close wait;
7. all timers and listeners are removed on every path.

### 14.9 Interruption source

Cover:

- targeted `/delegate:stop`;
- session shutdown;
- upstream tool-call abort;
- unknown abort reason;
- first abort wins.

### 14.10 Diagnostic privacy

Prove schema 5 contains only fixed enums and bounded numeric/string metadata. Seed forbidden values into all available inputs and assert they do not appear in diagnostics, failure Markdown, progress, or ToolResult content.

## 15. Acceptance criteria

Implementation is complete only when all conditions pass:

1. Provider count has no effect on delegate or attempt work deadline.
2. There is no division of time by route count in production source.
3. Gate D and Gate E can remain on an active first provider beyond five minutes.
4. The global work deadline remains 45 minutes and never resets.
5. Meaningful RPC activity is the sole idle-liveness signal.
6. Empty deltas and informational heartbeats do not prevent stall detection.
7. Operational failures fall back using actual remaining work time.
8. Global work timeout does not fall back.
9. Cleanup has a separate ten-second maximum allowance.
10. SIGKILL verification is measured in seconds, not tens of milliseconds.
11. Negative cleanup proof remains terminal and prevents route overlap.
12. Diagnostics identify deadline cause, cleanup reason, interruption source, and active-tool timing with fixed safe values.
13. Historical diagnostics are not migrated.
14. Routing configuration and role behavior remain unchanged.
15. The full extension suite passes.
16. Strict TypeScript with unused-symbol checks passes.
17. `git diff --check` passes.
18. At least three consecutive full-suite runs pass to catch process/timer races.
19. Linux process-leak checks find no surviving test-owned child or descendant.
20. No live provider inference occurs without explicit authorization.

## 16. Validation commands

Run from `/home/gc/.pi`:

```bash
npm test --prefix agent/extensions/delegated-pi-loop
```

Run the repository's existing strict temporary TypeScript configuration or recreate it with exact installed Pi and TypeBox declaration mappings, then require:

```text
strict=true
noUnusedLocals=true
noUnusedParameters=true
no diagnostics
```

Also run:

```bash
git diff --check
```

Run the full extension test suite three consecutive times. Use focused Linux lifecycle tests repeatedly. Do not use paid model inference for validation unless separately authorized.

## 17. Implementation-agent reporting contract

The implementation agent must report:

- changed files;
- exact old and new deadline algorithms;
- liveness-event classification;
- fallback-state changes;
- cleanup timing and proof behavior;
- diagnostic schema changes;
- test count and repeated-run results;
- strict TypeScript result;
- diff-check result;
- confirmation that routing and untracked user files were untouched;
- confirmation that nothing was staged, committed, pushed, deployed, or sent to hosted services unless separately authorized.

## 18. Risks and explicit tradeoffs

### Active provider consumes the full work budget

A provider that keeps producing meaningful activity can consume the full 45 minutes, leaving no fallback time. This is accepted because provider count must not reduce work time and continuous activity does not prove provider failure.

### Silent legitimate tools

A legitimate tool that emits no updates for ten minutes will be classified as stalled. This is the existing idle policy made authoritative. Long-running tools should emit updates or enforce and surface their own explicit timeout. Do not weaken model liveness by allowing indefinite silent tools.

### Cleanup extends final wall time

Final settlement may take up to ten seconds beyond the 45-minute work deadline. This is accepted because cleanup is safety work, not model work. The extension must still bound it.

### More informative diagnostics

Fixed cleanup and interruption reason codes reveal operational mechanism but not sensitive content. This is accepted and required for supportability.

## 19. Final implementation rule

Use this rule to resolve ambiguity:

> A delegate gets one fixed work deadline independent of provider count. Meaningful Pi RPC activity determines whether the current route is alive. Sequential fallback consumes only actual elapsed time after an evidence-backed operational failure. Cleanup uses a separate bounded deadline, and diagnostics retain only fixed privacy-safe operational causes.
