# Delegated Pi Loop Runtime-Ceiling Removal and Renewable Liveness Plan

Status: Accepted implementation contract

Supersession note (2026-08-28): the 30-minute structural-progress warning default in this plan was retuned to 15 minutes under the accepted contract in `docs/delegated-pi-loop-schema-6-progress-warning-retune-plan.md` and the ADR 0015 amendment. The renewable 45-minute structural-progress lease and every other decision below remain current policy. The rest of this document is preserved unchanged as historical evidence of the accepted 30/45 design.

Supersession note (2026-08-28, diagnostics schema): the schema-6 diagnostics sections of this plan no longer describe current writes: new run telemetry uses schema 7 with `maxProgressIdleSeconds` and metadata-only success records under `docs/delegated-pi-loop-schema-7-maximum-progress-gap-telemetry-plan.md` (ADR 0016). Historical schema 3 through 6 files remain valid and untouched.

Baseline commit: `51722ff` (`refactor(delegate): compact delegation instructions`)

Intended branch: `feat/delegate-renewable-liveness`

Intended worktree: `/home/gc/worktrees/pi-delegate-renewable-liveness`

Implementation authorization: Granted by the user for this accepted contract. Staging, committing, pushing, deployment, hosted-service mutation, and live provider inference remain unauthorized.

## 1. Decision summary

Remove the 45-minute absolute productive-work ceiling from delegated Pi runs.

Replace the chain-level deadline with a layered, programmatic liveness model that distinguishes:

1. operating-system process liveness;
2. valid Pi RPC communication;
3. accepted task activity;
4. novel structural progress;
5. semantic usefulness, which the supervisor cannot prove.

A delegate has no total runtime ceiling. A delegate may continue beyond 45 minutes while it keeps completing novel structural checkpoints. Silence, activity starvation, silent tools, exact repeated cycles, and prolonged structural stagnation remain programmatically bounded.

The initial structural-progress lease is renewable. It warns after 30 minutes without novel structural progress and stops after 45 minutes without novel structural progress. The 45-minute value is no longer measured from delegate start and no longer limits total productive runtime.

Preserve fixed bounds for catalog preflight, output, cleanup, interruption, report recovery, process-group proof, and the finite configured route chain.

## 2. Relationship to existing decisions

This plan supersedes only the hard total-runtime portions of:

- `docs/delegated-pi-loop-deadline-and-liveness-plan.md` sections 4.1, 4.2, 6.1, 6.2, 6.3, 7.3, 8.2, 9.1, 11, 12, 14.6, 15, 18, and 19;
- `docs/adr/0007-delegated-pi-role-isolation.md` statements that an active loop always reaches a 45-minute wall deadline;
- `docs/adr/0012-delegated-instruction-efficiency.md` statements that the supervisor enforces a 45-minute productive-work deadline;
- current README and generated-reference runtime-limit descriptions.

Do not erase the historical equal-share deadline defect or the evidence that motivated the previous design. Add a supersession note and a new ADR for the current decision.

The prompt-efficiency implementation in baseline `51722ff` remains valid. Child prompts still contain no wall-clock instruction. The new liveness logic remains entirely programmatic.

## 3. Current behavior and defect boundary

### 3.1 Absolute chain deadline

Current production behavior:

- `agent/extensions/delegated-pi-loop/supervisor.ts:24` defines `DEFAULT_WORK_TIMEOUT_MS` as 45 minutes.
- `agent/extensions/delegated-pi-loop/runner.ts:295-302` selects and validates `timeoutMs`.
- `agent/extensions/delegated-pi-loop/runner.ts:345-346` computes one chain-level `workDeadline` and `workBudgetSeconds`.
- `agent/extensions/delegated-pi-loop/runner.ts:369-461` prevents catalog checks and attempts from starting after that deadline.
- `agent/extensions/delegated-pi-loop/runner.ts:547-551` prevents fallback after that deadline.
- `agent/extensions/delegated-pi-loop/supervisor.ts:340` clamps each attempt to the chain deadline.
- `agent/extensions/delegated-pi-loop/supervisor.ts:658-663` installs the one-shot termination timer.
- `agent/extensions/delegated-pi-loop/supervisor.ts:551-568` prevents report recovery after the work deadline.

This behavior terminates a delegate even when valid RPC activity and structural progress continue.

### 3.2 Existing activity detector

`PiRpcMonitor` already provides a useful base:

- prompt acceptance records activity at `monitor.ts:261-277`;
- lifecycle-valid events are checked at `monitor.ts:288-333`;
- empty message deltas are rejected as activity at `monitor.ts:335-352`;
- empty bash updates and unchanged queue signatures are rejected at `monitor.ts:355-363`;
- active tools are correlated and bounded at `monitor.ts:364-393` and `monitor.ts:475-544`;
- accepted activity updates one monotonic clock at `monitor.ts:556-564`;
- existing tests prove empty deltas and duplicate queue updates do not reset idle age at `monitor.test.ts:148-172`.

The current weakness is not a lack of activity tracking. The weakness is that all accepted activity shares one clock. A nonempty thinking delta, a novel tool update, retry churn, compaction churn, and a completed tool all look equally alive to the idle watchdog.

### 3.3 What cannot be proven

The supervisor cannot prove that work is semantically useful, correct, relevant, or converging from event shape alone.

A busy process can be stuck in a CPU loop. A valid RPC stream can emit irrelevant events. A tool can produce changing output forever. A model can produce continuously novel but useless text. No deterministic local classifier can distinguish every such case from legitimate work on arbitrary assignments.

This plan therefore uses the term **novel structural progress**, not semantic progress. The parent still verifies the final report, cited evidence, implementation diff, tests, and review findings.

## 4. Goals

1. Remove the total productive-work deadline from every delegate and fallback chain.
2. Permit a productive delegate to continue beyond 45 minutes.
3. Preserve the five-minute warning and ten-minute activity-stall behavior.
4. Detect valid-RPC traffic that contains no accepted task activity.
5. Detect active streams that do not complete novel structural checkpoints.
6. Prevent exact repeated checkpoints from renewing the progress lease.
7. Preserve finite catalog, output, cleanup, and report-recovery bounds.
8. Preserve mandatory process-group disappearance proof before fallback.
9. Preserve route ordering, role behavior, resource isolation, and concurrency.
10. Preserve privacy by retaining only fixed enums and bounded numeric metadata.
11. Keep all wall-clock tracking in the supervisor. Do not ask the child model to track time.
12. Keep the staged prompt-efficiency behavior from baseline `51722ff` unchanged unless implementation evidence requires a model-visible wording correction.

## 5. Non-goals

1. Do not claim to prove semantic usefulness.
2. Do not add an LLM judge or another paid inference call for liveness.
3. Do not add a public timeout parameter to `delegate_run`.
4. Do not poll Git status or filesystem fingerprints as a progress authority.
5. Do not use CPU usage, process existence, or I/O counters as proof of meaningful work.
6. Do not persist tool arguments, tool results, assistant text, event payloads, or checkpoint hashes.
7. Do not change routing profiles, provider order, model IDs, role families, or concurrency.
8. Do not weaken process-group cleanup or permit overlapping route processes.
9. Do not expand report recovery beyond one same-session recovery round.
10. Do not run live provider inference during implementation validation without separate authorization.

## 6. Liveness terminology and state model

### 6.1 Process alive

`processAlive` means the child leader has not recorded an exit or signal. Existing `processIsRunning` at `supervisor.ts:135-137` remains the immediate check.

Process existence proves only that the process has not exited. It does not renew activity or progress leases.

### 6.2 RPC healthy

`lastValidRpcMonotonic` records the most recent protocol record that:

- passed LF-framed JSONL parsing;
- passed prompt-round correlation;
- was accepted as a known protocol record or a safely ignored valid record.

Malformed JSON, partial records, oversized records, duplicate responses, and out-of-order rounds never renew this clock.

RPC health proves communication only. UI traffic and ignored informational records may renew RPC health but never renew task activity.

### 6.3 Accepted activity

`lastAcceptedActivityMonotonic` records recent syntactically valid work activity:

- prompt acceptance;
- valid agent, turn, and message lifecycle transitions;
- nonempty thinking, text, and tool-call deltas;
- novel tool-execution updates;
- unique tool start and end events;
- retry and compaction transitions;
- changed queue state when relevant to the active run.

Accepted activity excludes:

- raw stdout bytes that have not formed an accepted RPC record;
- stderr bytes;
- progress-render ticks;
- UI requests;
- empty deltas;
- unchanged queue state;
- identical accumulated tool updates;
- malformed or lifecycle-invalid events.

### 6.4 Novel structural progress

`lastStructuralProgressMonotonic` records completion of a novel structural unit:

- initial prompt acceptance;
- authoritative `message_end` with a new ephemeral checkpoint digest;
- `turn_end` for a new completed turn;
- `tool_execution_end` for a new completed tool checkpoint;
- final `agent_end`;
- `agent_settled`;
- report-recovery prompt acceptance, which starts a distinct bounded reporting phase.

The following are activity but not structural progress:

- thinking, text, and tool-call start/delta/end streaming events before authoritative message completion;
- `tool_execution_start`;
- generic `tool_execution_update`;
- retry start/end;
- compaction start/end;
- summarization retry transitions;
- queue changes;
- UI traffic;
- process CPU or I/O movement.

A successful compaction does not renew structural progress by itself. A subsequent normal message, turn, tool completion, or settlement does.

### 6.5 Trusted tool progress

The initial implementation does not treat generic tool updates as structural progress. Pi documents `tool_execution_update.partialResult` as accumulated output, and changing accumulated output does not prove completion or convergence.

A future tool may expose a trusted, machine-readable progress contract containing only:

- a monotonically increasing sequence;
- a fixed bounded phase enum;
- optional finite completed and total unit counts.

Free text, paths, arguments, results, process IDs, or provider data never qualify as trusted progress metadata. Adding this contract is deferred unless implementation evidence shows a current approved tool requires more than one progress-stagnation lease.

## 7. Ephemeral novelty and repeated-cycle detection

### 7.1 Checkpoint fingerprints

Use one random per-attempt HMAC key. Compute in-memory digests for checkpoint comparison only.

Potential digest inputs:

- authoritative assistant message payload for `message_end`;
- tool name, approved call identity, arguments, and final result for a completed tool checkpoint;
- bounded structural event sequence for a completed turn.

Requirements:

- never persist the HMAC key;
- never persist, render, log, or return checkpoint digests;
- never include raw digest inputs in progress or diagnostics;
- clear the in-memory index when the attempt ends;
- use a bounded recent-checkpoint index, initially 64 entries;
- treat digest computation failure as no novelty credit, not as a process crash.

### 7.2 Renewal rule

A checkpoint renews `lastStructuralProgressMonotonic` only when its digest is not already present in the bounded recent-checkpoint index.

An exact repeated checkpoint:

- increments `duplicateCheckpointCount`;
- records accepted activity when appropriate;
- does not renew the progress lease.

If the progress lease expires and duplicate checkpoints were observed since the last novel checkpoint, classify the cause as `repeated_cycle`. Otherwise classify it as `progress_stagnation`.

This detector catches exact and short repeated cycles. It does not claim to catch continuously changing semantic nonsense.

### 7.3 Tool-update novelty

`ActiveTool` gains `lastNovelUpdateMonotonic` and one ephemeral digest for the accumulated partial result.

- An identical accumulated `tool_execution_update` does not renew activity.
- A changed accumulated update renews accepted activity.
- Generic changed output does not renew structural progress.
- `tool_execution_end` closes the tool and may create a novel structural checkpoint.

## 8. Programmatic watchdogs

### 8.1 Constants

Use extension-owned defaults:

```typescript
DEFAULT_ACTIVITY_WARNING_MS = 5 * 60 * 1000;
DEFAULT_ACTIVITY_IDLE_MS = 10 * 60 * 1000;
DEFAULT_PROGRESS_WARNING_MS = 30 * 60 * 1000;
DEFAULT_PROGRESS_STALL_MS = 45 * 60 * 1000;
DEFAULT_REPORT_RECOVERY_IDLE_MS = 5 * 60 * 1000;
DEFAULT_CATALOG_TIMEOUT_MS = 15_000;
DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;
DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
```

`DEFAULT_PROGRESS_STALL_MS` is a renewable maximum gap between novel structural checkpoints. It is not measured from delegate start.

Keep short injectable values in internal test options. Do not expose these values in the public tool schema.

### 8.2 Watchdog ordering

The supervisor ticker evaluates conditions in this order:

```text
1. Terminal outcome already requested -> no action
2. Child leader has exited -> normal settlement/classification
3. Output bytes exceed cap -> output_limit
4. Any active tool has no novel update for the activity-idle interval -> stalled/active_tool_idle
5. No valid RPC for activity-idle interval -> stalled/rpc_silent
6. Valid RPC exists but no accepted task activity for activity-idle interval -> stalled/activity_idle
7. No novel structural progress for progress-stall interval:
   a. duplicate checkpoints observed -> stalled/repeated_cycle
   b. otherwise -> stalled/progress_stagnation
8. Warning thresholds -> emit bounded progress warning
9. Otherwise remain running
```

When multiple tools are active, step 4 evaluates the maximum idle age across all active tool IDs. A newer updating tool cannot mask an older silent tool. The bounded active-tool name and age exposed to progress identify the stalest watchdog-selected tool; ties use the most recently started tool.

The five-minute activity warning remains one-shot per activity-idle interval. A novel accepted activity clears the warning latch. The 30-minute structural warning remains one-shot per structural-progress interval. A novel structural checkpoint clears that warning latch.

### 8.3 No total deadline

Delete every terminal condition based only on total delegate elapsed time.

`elapsedSeconds` remains telemetry and TUI information. It never causes termination.

A delegate may run indefinitely if it continues producing novel structural checkpoints and stays within all other resource and safety bounds. This is an explicit accepted tradeoff, not an accidental behavior.

## 9. Stall causes and state semantics

Add a fixed type:

```typescript
type StallCause =
  | "rpc_silent"
  | "activity_idle"
  | "active_tool_idle"
  | "progress_stagnation"
  | "repeated_cycle"
  | "report_recovery_idle";
```

Keep the existing `stalled` `DelegateState`. Use `stallCause` to distinguish mechanisms.

Runtime `work_deadline` is no longer emitted. Historical diagnostics remain unchanged and are not migrated.

`timed_out` remains available for fixed catalog-preflight timeout attempts with `deadlineCause: "catalog_preflight"`. If implementation shows that a dedicated catalog state is clearer, make that a separate reviewed decision rather than silently changing result semantics.

## 10. Fallback contract

### 10.1 Finite route chain

`runDelegate` continues to iterate one finite route list selected once per invocation. No route is retried recursively and no route list is regenerated during the run.

### 10.2 Fallback-eligible states

The following remain operational and fallback-eligible after positive cleanup proof:

- `provider_failed`;
- `stalled` with any fixed `stallCause`;
- `output_limit`;
- `prompt_rejected`;
- `invalid_result`;
- `invalid_stream`;
- `missing_report`;
- `child_failed`;
- `spawn_failed`;
- fixed catalog-preflight timeout or catalog unavailability.

Do not check remaining chain work time before fallback. No chain work budget exists.

### 10.3 Terminal states

The following remain terminal and never start another route:

- `completed`;
- intentional `blocked`;
- intentional `delegate_failed`;
- `interrupted`;
- `cleanup_failed`;
- route-chain exhaustion, reported as `routes_unavailable`.

### 10.4 Restart after work

Preserve the existing restart-after-work behavior. If an operationally failed attempt executed tools or accepted report recovery, rebuild the next prompt from the original assignment plus the fixed sanitized restart note.

A liveness stop does not prove that prior tool actions were reversible. The next route treats the current working tree as authoritative.

## 11. Catalog, cleanup, interruption, and process proof

### 11.1 Catalog

Change catalog preflight from:

```typescript
Math.min(workDeadline, performance.now() + catalogTimeoutMs)
```

to:

```typescript
performance.now() + catalogTimeoutMs
```

Preserve the 15-second maximum and mandatory process cleanup after every catalog child.

### 11.2 Cleanup

Preserve:

- 10-second cleanup allowance;
- 5-second SIGTERM grace;
- SIGKILL escalation;
- 3-second process-group disappearance verification;
- final bounded settlement allowance;
- `group_alive` and `close_unconfirmed` causes;
- terminal `cleanup_failed` behavior.

No later route starts until the prior leader and process group are positively proven gone.

### 11.3 Interruption

Preserve fixed first-source interruption values:

- `delegate_stop`;
- `session_shutdown`;
- `tool_call_abort`;
- `unknown`.

Manual `/delegate:stop` remains the final authority for continuously novel but semantically useless work.

## 12. Same-session report recovery

Preserve exactly one recovery round in the same running child session.

Eligibility remains:

- round 1 settled as `missing_report` or `invalid_result`;
- no prior recovery;
- child remains running;
- request is not aborted;
- output remains under the cap;
- no liveness termination has begun.

Remove the global-work-deadline condition.

When recovery begins:

- reset RPC and accepted-activity clocks for round 2;
- initialize a distinct five-minute report-recovery idle lease;
- do not reset output bytes, retry counters, duplicate checkpoint counters, or tool-execution counts;
- forbid tools through the existing recovery prompt;
- accept no third prompt round.

If round 2 becomes silent for five minutes, classify `stalled/report_recovery_idle`. If round 2 settles missing or invalid again, preserve the existing terminal result classification.

## 13. Types and telemetry

### 13.1 Remove new-runtime work-budget fields

Remove from runtime options, progress, attempts, results, diagnostics, and rendering:

- `timeoutMs` as the productive-work budget;
- `workDeadline`;
- `workBudgetSeconds`;
- `remainingWorkSecondsAtAttemptStart`;
- new-runtime `deadlineCause: "work_deadline"`.

Keep `elapsedSeconds`.

### 13.2 Add bounded liveness fields

Add the relevant subset to `MonitorSnapshot`, `AttemptStatus`, `DelegateProgress`, `ChainAttempt`, and `DelegateRunResult`:

```typescript
readonly stallCause?: StallCause;
readonly rpcIdleSeconds?: number;
readonly activityIdleSeconds?: number;
readonly progressIdleSeconds?: number;
readonly activityEventCount: number;
readonly structuralProgressCount: number;
readonly duplicateCheckpointCount: number;
readonly activityWarningCount: number;
readonly progressWarningCount: number;
readonly activeToolIdleSeconds?: number;
```

For each supervised `ChainAttempt`, the relevant subset is every field above that has a value at attempt settlement. This preserves prior-route liveness evidence after fallback. Catalog-only attempts omit the supervised liveness ages, counters, warnings, and stall cause.

Monotonic timestamps, HMAC keys, and checkpoint digests remain internal and never cross the monitor boundary.

### 13.3 Progress display

TUI progress should show:

- phase;
- latest safe event and UTC receipt time;
- RPC idle age;
- accepted-activity idle age;
- structural-progress idle age;
- stalest active tool name and idle age when one or more tools are active;
- total elapsed time for information only;
- one bounded warning label when a lease warning is active.

Rendering does not count as activity.

## 14. Diagnostics schema 6

Increment failure diagnostics from schema 5 to schema 6.

Schema 6 may contain:

- final fixed state;
- fixed `stallCause`;
- fixed catalog, cleanup, interruption, terminal-reason, and provider categories;
- bounded elapsed and idle ages;
- activity, structural-progress, duplicate-checkpoint, warning, tool, attempt, and recovery counts;
- bounded safe route and event identifiers already allowed by schema 5.

Schema 6 must not contain:

- prompts or reports;
- assistant text or thinking;
- tool arguments, partial results, or final results;
- checkpoint digests or HMAC keys;
- stdout, stderr, or provider bodies;
- filesystem paths or Git state;
- credentials, cookies, or private keys;
- command lines, process IDs, process-group IDs, or signals;
- arbitrary exception text.

Do not migrate schema 3, 4, or 5 files.

## 15. File-by-file implementation plan

### Phase 0: Baseline and branch discipline

1. Start in `/home/gc/worktrees/pi-delegate-renewable-liveness` on `feat/delegate-renewable-liveness` at baseline `51722ff`.
2. Confirm the plan file is the only intentional uncommitted file before implementation.
3. Record `git status --short` and `git worktree list`.
4. Run the current delegated-pi-loop suite and strict TypeScript check.
5. Do not stage, commit, push, deploy, or run live inference without separate authorization.

### Phase 1: Types and pure liveness model

Files:

- `agent/extensions/delegated-pi-loop/types.ts`
- a new small pure module such as `liveness.ts`, if separation improves deterministic tests;
- corresponding tests.

Tasks:

1. Add `StallCause`.
2. Define bounded liveness snapshot fields.
3. Remove productive-work budget fields from new runtime types.
4. Create a pure watchdog decision function over ages, active-tool state, duplicate count, thresholds, and terminal state.
5. Test precedence without real timers or child processes.

A pure reducer is preferred because it makes threshold ordering deterministic and keeps `supervisor.ts` focused on process lifecycle.

### Phase 2: Monitor clocks and novelty

Files:

- `agent/extensions/delegated-pi-loop/monitor.ts`
- `agent/extensions/delegated-pi-loop/monitor.test.ts`

Tasks:

1. Split valid RPC, accepted activity, and structural-progress clocks.
2. Add bounded checkpoint counts.
3. Extend active tools with latest novel-update time and digest.
4. Add per-attempt keyed HMAC checkpoint comparison.
5. Ensure identical accumulated tool updates do not renew activity.
6. Ensure exact repeated structural checkpoints do not renew progress.
7. Keep all sensitive content and digests internal.
8. Do not use undocumented `entry_appended` as a required progress signal.

### Phase 3: Supervisor watchdogs

Files:

- `agent/extensions/delegated-pi-loop/supervisor.ts`
- `agent/extensions/delegated-pi-loop/supervisor.test.ts`

Tasks:

1. Remove `DEFAULT_WORK_TIMEOUT_MS` and productive-work options.
2. Remove `workDeadline` computation and one-shot timer.
3. Feed accepted protocol records into the valid-RPC clock.
4. Evaluate the pure liveness reducer from the existing ticker.
5. Propagate exact `stallCause` values.
6. Add activity and progress warnings.
7. Add the report-recovery idle lease.
8. Preserve output, interruption, protocol, completion, and cleanup behavior.
9. Clear every timer, listener, and ephemeral key on every path.

### Phase 4: Runner and fallback

Files:

- `agent/extensions/delegated-pi-loop/runner.ts`
- `agent/extensions/delegated-pi-loop/runner.test.ts`

Tasks:

1. Remove `timeoutMs` selection and validation.
2. Remove chain `workDeadline`, remaining-time calculations, and checks.
3. Make catalog preflight use its fixed independent deadline.
4. Start every eligible route regardless of total elapsed time.
5. Preserve finite route order and one attempt per selected route.
6. Preserve cleanup proof before fallback.
7. Preserve restart-after-work behavior.
8. Remove work-budget telemetry and propagate liveness telemetry.

### Phase 5: Results, diagnostics, and rendering

Files:

- `agent/extensions/delegated-pi-loop/diagnostics.ts`
- `agent/extensions/delegated-pi-loop/diagnostics.test.ts`
- `agent/extensions/delegated-pi-loop/result.ts`
- `agent/extensions/delegated-pi-loop/result.test.ts`
- `agent/extensions/delegated-pi-loop/render.ts`
- relevant manager or index fixtures if progress shapes change.

Tasks:

1. Write schema 6 diagnostics.
2. Make failure summaries cause-aware.
3. Render the three liveness ages and bounded warning state.
4. Remove new-runtime work-budget wording.
5. Preserve deterministic, privacy-safe ToolResult content.
6. Extend seeded privacy tests to every new field.

### Phase 6: Documentation and decision records

Files:

- new `docs/adr/0015-delegated-renewable-liveness.md`;
- `docs/delegated-pi-loop-deadline-and-liveness-plan.md` supersession note;
- `docs/adr/0007-delegated-pi-role-isolation.md` current-policy note;
- `docs/adr/0012-delegated-instruction-efficiency.md` current-policy note;
- `README.md`;
- `docs/delegated-pi-loop-agent-instructions.md` runtime sections;
- `docs/skills/delegated-pi-loop-update-process.md`;
- `docs/CHANGELOG.md`.

Tasks:

1. Preserve historical evidence while marking the total ceiling superseded.
2. Document the distinction between activity, structural progress, and semantic usefulness.
3. Document renewable progress leases and residual indefinite-runtime risk.
4. Update runtime-limit tables and fallback rules.
5. Run `npm run render:instructions-doc` and confirm generated sections are unchanged or correctly regenerated.
6. Recalculate context-cost attribution only if model-visible exports in `instructions.ts` change. No prompt wording change is expected.

Files expected to remain unchanged unless evidence requires otherwise:

- `agent/extensions/delegated-pi-loop/routing.json`
- `agent/extensions/delegated-pi-loop/routing.ts`
- `agent/extensions/delegated-pi-loop/routes.ts`
- `agent/extensions/delegated-pi-loop/resources.ts`
- `agent/extensions/delegated-pi-loop/artifacts.ts`
- `agent/extensions/delegated-pi-loop/instructions.ts`
- `agent/AGENTS.md`

Any change to those files requires a specific contract amendment.

## 16. Required deterministic tests

### 16.1 No total ceiling

1. Use injected short clocks to cross multiple equivalents of the former total deadline.
2. Produce a novel structural checkpoint before each progress lease expires.
3. Complete on the first route.
4. Assert no `timed_out/work_deadline` state or cause appears.
5. Assert no fallback starts.

### 16.2 Silence and activity starvation

1. Stop all valid RPC records.
2. Assert one warning at the activity-warning threshold.
3. Assert `stalled/rpc_silent` at the activity-idle threshold.
4. Send valid UI or ignored protocol traffic without task activity.
5. Assert `stalled/activity_idle`, not `rpc_silent`.

### 16.3 Infinite model deltas

1. Emit nonempty thinking deltas indefinitely.
2. Assert accepted activity stays fresh.
3. Assert structural progress does not renew.
4. Assert the progress warning fires once.
5. Assert `stalled/progress_stagnation` at the progress lease.
6. Repeat for text and tool-call deltas.

### 16.4 Duplicate checkpoints

1. Repeat an identical authoritative message.
2. Repeat an identical completed tool call and result.
3. Repeat a short alternating checkpoint cycle contained by the bounded recent index.
4. Assert duplicates increment the bounded counter but do not renew progress.
5. Assert final cause is `repeated_cycle`.
6. Assert no digest or raw payload leaves the monitor.

### 16.5 Tool behavior

1. Start a tool and emit no updates.
2. Assert `stalled/active_tool_idle` after the activity-idle interval.
3. Emit identical accumulated updates and assert they do not renew activity.
4. Emit changed accumulated updates and assert they renew activity only.
5. End the tool with a novel result and assert structural progress renews.
6. Track multiple active tool IDs and preserve existing bounded metadata.

### 16.6 Retry and compaction churn

1. Emit retry transitions without a normal completed checkpoint.
2. Emit compaction and summarization-retry transitions without a normal checkpoint.
3. Assert they renew accepted activity but not structural progress.
4. Assert progress stagnation eventually terminates the route.
5. Assert a subsequent normal completed turn renews progress.

### 16.7 Fallback after arbitrary elapsed time

1. Keep route one productively alive past the former total deadline.
2. Trigger an evidence-backed operational failure.
3. Prove cleanup succeeds.
4. Prove route two starts despite total elapsed time.
5. Prove the restart note appears only when route one executed tools or accepted recovery.

### 16.8 Catalog and cleanup

Preserve and rerun:

- fixed catalog-preflight timeout;
- catalog cleanup before route continuation;
- delayed SIGKILL disappearance success;
- `group_alive` failure;
- `close_unconfirmed` failure;
- no later route after negative cleanup proof;
- inherited-stdio bounded settlement;
- listener and timer disposal.

### 16.9 Report recovery

1. Settle round 1 as missing and invalid.
2. Confirm exactly one `prompt-2` in the same PID/session.
3. Confirm recovery remains eligible after total elapsed time exceeds the former ceiling.
4. Confirm recovery idle reaches `report_recovery_idle`.
5. Confirm no tools or third round are accepted.
6. Confirm output and interruption still stop recovery.

### 16.10 Output and privacy

1. Preserve the 50 MiB output stop.
2. Test both fast and slow output streams.
3. Seed paths, prompts, reports, arguments, results, credentials, provider bodies, PIDs, signals, errors, and checkpoint source material into every reachable input.
4. Assert none appears in schema 6 diagnostics, failure Markdown, progress, or ToolResult details.
5. Assert HMAC keys and digests never serialize.

### 16.11 Manual interruption

Cover:

- `/delegate:stop`;
- session shutdown;
- parent tool-call abort;
- unknown abort reason;
- first abort wins;
- interruption during activity, progress warning, tool execution, and report recovery.

## 17. Validation commands and gates

Run from the new worktree:

```bash
npm test --prefix agent/extensions/delegated-pi-loop
```

Run strict TypeScript with:

```text
strict=true
noUnusedLocals=true
noUnusedParameters=true
no diagnostics
```

Run:

```bash
git diff --check
npm --prefix agent/extensions/delegated-pi-loop run render:instructions-doc
```

Then:

1. run the full delegated-pi-loop suite three consecutive times;
2. repeat focused Linux cleanup and process-leak tests;
3. verify no test-owned child or descendant survives;
4. verify the generated instruction document is idempotent;
5. verify production source has no chain productive-work timer, `workDeadline`, `workBudgetSeconds`, or `remainingWorkSecondsAtAttemptStart`;
6. verify no model-visible child instruction asks the delegate to track time;
7. run no paid provider inference unless separately authorized.

## 18. Acceptance criteria

Implementation is complete only when:

1. Total delegate elapsed time never causes termination.
2. A delegate can complete after crossing the former 45-minute total boundary.
3. Five-minute warning and ten-minute activity-stall semantics remain programmatic.
4. RPC health, accepted activity, and structural progress use separate clocks.
5. Exact repeated checkpoints do not renew structural progress.
6. Generic changing tool output does not count as structural progress.
7. Progress stagnation and repeated cycles are fallback-eligible.
8. Fallback has no remaining-work-time predicate.
9. Catalog preflight remains capped at 15 seconds.
10. Output remains capped at 50 MiB per route attempt.
11. Cleanup remains bounded and requires positive leader and group proof.
12. Report recovery remains one same-session round with a bounded recovery idle lease.
13. Terminal delegate outcomes, interruption, and cleanup failure never fall back.
14. Schema 6 contains only fixed enums and bounded numeric or safe identifier fields.
15. Historical diagnostics are not migrated.
16. Routing, roles, concurrency, resource isolation, and provider order remain unchanged.
17. Prompt-efficiency behavior from `51722ff` remains intact.
18. Full tests, repeated lifecycle tests, strict TypeScript, document synchronization, and whitespace checks pass.
19. No live inference, staging, commit, push, deployment, or hosted-service mutation occurs without separate authorization.

## 19. Risks and explicit tradeoffs

### 19.1 Continuously novel but useless work can run indefinitely

This is unavoidable without a total time, token, cost, or action ceiling. The supervisor cannot prove semantic usefulness. Manual stop and parent verification remain necessary.

### 19.2 Worst-case gate duration increases

A route with no structural progress may consume one renewable progress-stagnation interval before fallback. A finite multi-provider chain can therefore take approximately the stagnation interval multiplied by route count. A route that keeps producing novel checkpoints has no maximum duration.

### 19.3 False progress-stagnation stops

A legitimate provider response or generic tool that remains in one structural phase longer than the progress lease will stop. The initial 45-minute lease does not shorten the current maximum single phase. Trusted machine-readable tool progress may be added later if real evidence requires it.

### 19.4 Novelty is not meaning

Ephemeral fingerprints detect exact repetition, not semantic equivalence. Slightly changed nonsense can renew progress. Do not describe the detector as a correctness or relevance judge.

### 19.5 Hashing sensitive payloads

Even one-way hashes can become sensitive if persisted or keyed predictably. Use a random per-attempt HMAC key, retain only a bounded in-memory index, and serialize neither keys nor hashes.

### 19.6 Fallback after mutating work

A liveness stop after tool execution can leave partial changes. Preserve the current restart note and authoritative-tree rule. Cleanup proof prevents process overlap but does not reverse prior changes.

## 20. Open implementation questions

These questions require evidence during implementation but do not block the proposed architecture:

1. Whether checkpoint fingerprinting belongs in `monitor.ts` or a small private helper module.
2. Whether a 64-entry recent-checkpoint index is sufficient for short-cycle detection.
3. Whether `turn_end` and its authoritative `message_end` should share one checkpoint identity to avoid double counting.
4. Whether report recovery should use five minutes or the existing ten-minute activity idle interval. Five minutes is recommended because no tools or new investigation are allowed.
5. Whether `timed_out` should remain the catalog-preflight attempt state or be replaced by a dedicated catalog state in a separate reviewed change.
6. Whether any approved current tool exposes trusted monotonic progress metadata. Do not assume that generic partial output qualifies.

## 21. Final implementation rule

Use this rule to resolve ambiguity:

> Total elapsed time never stops a delegate. Valid RPC proves communication, accepted novel events prove activity, and novel completed checkpoints renew a structural-progress lease. Exact repetition does not renew that lease. Semantic usefulness remains a parent-verified property. Catalog, output, recovery, interruption, cleanup, and process-group proof stay independently bounded.
