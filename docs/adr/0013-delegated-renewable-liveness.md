# ADR 0013: Replace the delegated runtime ceiling with renewable liveness

## Status

Accepted (2026-08-27). Implements the accepted contract in `docs/delegated-pi-loop-runtime-ceiling-removal-plan.md`. Extends ADR 0007, ADR 0008, and ADR 0012. Supersedes only the hard total-runtime portions of `docs/delegated-pi-loop-deadline-and-liveness-plan.md` (its sections 4.1, 4.2, 6.1, 6.2, 6.3, 7.3, 8.2, 9.1, 11, 12, 14.6, 15, 18, and 19) and the current-policy statements in ADR 0007 and ADR 0012 that an active delegate always reaches a 45-minute wall deadline. Routing, role permissions, concurrency, resource isolation, child resource profiles, prompt efficiency, report recovery, interruption, cleanup, process-group proof, and the prompt-efficiency behavior of baseline `51722ff` are unchanged.

## Context

The deadline-and-liveness remediation replaced provider-count-based route allocations with one shared 45-minute chain work deadline. That removed the equal-share defect, but it kept a new defect: a delegate that was still productively working was terminated at 45 minutes regardless of activity or progress. The one-shot deadline timer also sat beside an activity clock that treated a nonempty thinking delta, a novel tool update, retry churn, compaction churn, and a completed tool checkpoint as equally alive. A stream that never completed anything could stay within the activity bound for the entire 45 minutes, while a delegate that produced one large legitimate structural unit every 50 minutes could never finish at all.

The supervisor cannot prove that work is semantically useful, correct, relevant, or converging from event shape alone. A busy process can loop in CPU, a valid RPC stream can emit irrelevant events, a tool can produce changing output forever, and a model can emit continuously novel but useless text. No deterministic local classifier solves that on arbitrary assignments, and an LLM judge was rejected as paid inference used for liveness.

The workable split is between what the supervisor can prove mechanically and what it cannot. It can prove that the child process exists, that valid Pi RPC records keep arriving, that syntactically valid task activity keeps being accepted, and that novel completed structural checkpoints (an authoritative assistant message, a completed turn, a completed tool call, settlement) were not seen before. It cannot prove meaning. This decision therefore replaces the total deadline with renewable leases over the provable properties and leaves semantic usefulness to parent verification and the manual `/delegate:stop` authority.

## Decision

### No total runtime ceiling

Total delegate elapsed time never terminates a delegate. `DEFAULT_WORK_TIMEOUT_MS`, the chain `workDeadline`, `timeoutMs` work budgets, `workBudgetSeconds`, `remainingWorkSecondsAtAttemptStart`, and new-runtime `deadlineCause: "work_deadline"` are removed from options, progress, attempts, results, diagnostics, and rendering. `elapsedSeconds` remains telemetry and TUI information only. A delegate may run indefinitely while it keeps completing novel structural checkpoints and stays within every other bound. This is an explicit accepted tradeoff, not an accident.

### Three separate liveness clocks

`PiRpcMonitor` now maintains three monotonic clocks instead of one:

1. **Valid RPC health** (`lastValidRpcMonotonic`): renewed by every protocol record that passed LF-framed JSONL parsing and prompt-round correlation. Malformed, partial, oversized, duplicate, and out-of-order records never renew it. It proves communication only.
2. **Accepted activity** (`lastActivityMonotonic`): renewed by prompt acceptance, valid lifecycle transitions, nonempty thinking/text/tool-call deltas, novel tool-execution updates, retry and compaction transitions, and changed relevant queue state. Empty deltas, unchanged queue signatures, identical accumulated tool updates, raw stderr, UI traffic, rendering ticks, and malformed events never renew it.
3. **Novel structural progress** (`lastStructuralProgressMonotonic`): renewed only by completion of a structural checkpoint not seen before in this attempt: initial and recovery prompt acceptance, an authoritative assistant `message_end` with a new checkpoint digest, a `turn_end` with a new bounded turn summary, a `tool_execution_end` with a new completed-tool digest, final `agent_end`, and `agent_settled`. Turn and agent summaries are per-round lifecycle-validated: a nested `turn_start`, an unmatched `turn_end` (including upstream failure-shaped ones), and an `agent_end` with an open turn are invalid-stream sequences that earn no activity or progress credit; the turn summary is initialized only on an accepted `turn_start`, consumed exactly once by its `turn_end`, and the completed-turn digest feeds only the enclosing agent summary. Streaming deltas, `tool_execution_start`, generic tool updates, retries, and compaction are activity but never structural progress. Compaction renews progress only through the subsequent normal message, turn, tool completion, or settlement.

### Ephemeral checkpoint novelty

Checkpoint novelty uses one random per-attempt HMAC key held only in memory. Digest inputs are normalized semantic identities only: for `message_end`, the assistant role, stop reason, and normalized content (semantic text, thinking, and tool names plus arguments), excluding timestamp, response id, usage, provider/api/model metadata, opaque signatures, and volatile tool-call ids; for a completed tool, the tool name, normalized start arguments, final result, and error flag, excluding volatile tool-call and anonymous correlation keys; and a bounded per-turn or per-agent summary (checkpoint count plus last digest) for `turn_end`/`agent_end`. Digestion is bounded during traversal: the HMAC is fed incrementally while the input is walked, capped by UTF-8 byte, visited-node, and depth limits, and the whole payload is never serialized or allocated first. A bounded index of 64 recent digests decides novelty. An exact repeated checkpoint (including its preserved identity inside turn and agent summaries, so duplicate messages and tools cannot make enclosing turns novel by omission) increments bounded duplicate counters and does not renew the progress lease; a failed or over-budget checkpoint digestion earns no novelty credit, and a failed or over-budget tool-update digestion cannot prove change and renews neither tool nor activity liveness. The key, every digest, and every raw digest input are dropped when the attempt ends (`clearEphemeralState`) and are never persisted, rendered, logged, or returned. Active tools also carry a per-tool digest: an identical accumulated `tool_execution_update` is not activity, while a changed one renews the tool and activity clocks but never structural progress.

### Watchdog ordering and thresholds

A pure reducer (`liveness.ts`, `evaluateLiveness`) maps the three ages, the maximum novel-update idle age across all active tools, and the duplicate-since-novel counter to one decision with fixed precedence: active-tool idle, then RPC silence, then activity idle (each at the ten-minute activity-idle interval), then progress stagnation at the renewable 45-minute lease, split by observed duplicates into `repeated_cycle` versus `progress_stagnation`, then the one-shot warnings, otherwise run. Any active tool may stall the run: the watchdog always evaluates the stalest active tool, so a newer updating tool can never mask an older silent one, and the bounded active-tool telemetry identifies exactly that watchdog-selected tool (ties use the most recently started tool). The supervisor's 100 ms ticker feeds it ages and executes the decision; no one-shot deadline timer exists. Defaults: five-minute activity warning, ten-minute activity idle, 30-minute progress warning, 45-minute renewable progress lease, five-minute report-recovery idle. Warnings are one-shot per lease interval and clear when the matching lease renews. Injecting shorter values stays an internal test seam; the public `delegate_run` schema gains no timeout parameter.

### Stall causes and fallback

`stalled` keeps its `DelegateState`; a new fixed `stallCause` enum distinguishes `rpc_silent`, `activity_idle`, `active_tool_idle`, `progress_stagnation`, `repeated_cycle`, and `report_recovery_idle`. Runtime `work_deadline` is no longer emitted. `timed_out` survives only for fixed 15-second catalog-preflight attempts with `deadlineCause: "catalog_preflight"`. Catalog preflight now owns one fixed independent deadline (`performance.now() + catalogTimeoutMs`) with no chain budget to clamp it; the execution timer is disarmed the moment natural close or leader exit wins before the deadline, exactly one independently bounded cleanup proof then runs, and `timed_out/catalog_preflight` is returned only when the deadline itself wins before natural settlement. Every operational failure state, including `stalled` with any stall cause, remains fallback-eligible after positive cleanup proof; there is no remaining-work-time predicate anywhere in the runner. Terminal states (completed, intentional blocked/failed, interrupted, `cleanup_failed`, chain exhaustion as `routes_unavailable`) never fall back. Restart-after-work behavior is preserved unchanged.

### Report recovery

Recovery remains exactly one same-session round. The global-work-deadline condition is removed. When recovery begins, the RPC and accepted-activity clocks restart for round 2 while output bytes, retry counters, duplicate checkpoint counters, and tool counts stay cumulative. Round 2 gets a distinct five-minute activity-idle lease; a silent recovery round stops as `stalled/report_recovery_idle`, while progress-lease stalls keep their normal causes. Output, interruption, protocol, and second-settlement failure behavior is unchanged.

### Diagnostics schema 6

Failure diagnostics move from schema 5 to schema 6. Schema 6 carries the fixed state, `stallCause`, the remaining fixed catalog/cleanup/interruption categories, the three bounded idle ages, the activity, structural-progress, duplicate-checkpoint, and warning counts, and the bounded safe identifiers schema 5 already allowed. `workBudgetSeconds` and `remainingWorkSecondsAtAttemptStart` are gone. Schema 6 must never contain prompts, reports, assistant text, tool arguments or results, checkpoint digests or HMAC keys, stdout/stderr, provider bodies, paths, Git state, credentials, command lines, process or group ids, signals, or arbitrary exception text. Schema 3, 4, and 5 files are not migrated.

## Consequences

- A productive delegate can complete after crossing the former 45-minute boundary; total elapsed time is never a stop condition.
- Continuously novel but semantically useless work can run indefinitely. This is unavoidable without a total time, token, cost, or action ceiling; manual `/delegate:stop` and parent verification remain the controls.
- A finite chain of silent or stagnant routes takes at most about one stagnation interval per route; a chain of productive routes has no maximum duration.
- A legitimate single structural phase longer than 45 minutes (one huge tool or one long message) still stops as `progress_stagnation`. Trusted machine-readable tool progress may be added later only through the bounded contract the plan reserves for it; generic changing output never qualifies.
- Novelty detection catches exact repetition and short cycles, not semantic equivalence; slightly changed nonsense still renews the lease.
- Worst-case gate duration increases because no total ceiling bounds a novel-checkpoint-producing route.
- Hashing sensitive payloads stays safe only because keys and digests are random, per-attempt, in-memory only, and never serialized.
- The parent sees three idle ages, bounded warning state, and exact stall causes instead of a work budget.

## Validation

- Deterministic `liveness.test.ts` proves the reducer precedence without timers or processes.
- Monitor tests prove separate clocks, digest novelty, duplicate checkpoints, identical-update rejection, and key/digest privacy.
- Supervisor tests prove no total-ceiling termination across multiple former deadlines with renewed checkpoints, per-cause stalls, one-shot warnings, recovery idle, output, interruption, and cleanup behavior.
- Runner tests prove catalog independence, no remaining-work predicate, fallback after arbitrary elapsed time, restart-after-work, and preserved terminal behavior.
- Diagnostics, result, and render tests prove schema 6 contents, cause-aware summaries, and privacy of every new field.
- The full delegated-pi-loop suite must pass three consecutive times; strict TypeScript with `strict`, `noUnusedLocals`, and `noUnusedParameters`; `git diff --check`; bounded process-leak checks; the instruction document renderer must be idempotent; and no live provider inference may run without separate authorization.
