# Delegated Pi Loop Schema-6 Progress-Warning Retune Plan

## Status

Approved for implementation on `master` on 2026-08-28.

This plan changes the default structural-progress warning from 30 minutes to 15 minutes and retains the renewable structural-progress stall at 45 minutes. It treats failure-diagnostic schema 6 as a stable compatibility boundary. It does not add fields, change the schema version, or migrate historical diagnostics.

This plan supersedes only the 30-minute structural-progress warning in `docs/delegated-pi-loop-runtime-ceiling-removal-plan.md` and ADR 0015. Every other renewable-liveness decision remains current.

## 1. Goal

Warn the parent earlier when a delegate remains active but completes no novel structural checkpoint.

The new default thresholds are:

| Signal | Warning | Stop |
| --- | ---: | ---: |
| Accepted activity | 5 minutes | 10 minutes |
| Valid RPC | none | 10 minutes |
| Stalest active tool | none | 10 minutes |
| Novel structural progress | **15 minutes** | **45 minutes** |
| Report recovery | none | 5 minutes |

The 15-minute event is informational. It does not terminate a route, trigger fallback, prompt the child, or alter cleanup. The 45-minute structural-progress lease remains renewable after every novel checkpoint.

## 2. Why 15/45

A healthy delegate normally completes assistant messages, turns, or tool calls every few seconds or minutes. A 30-minute gap is expected only for a long-running tool that continues to emit novel updates, continuous model streaming without message completion, retry or compaction churn, or another active but non-completing phase.

The ten-minute RPC, accepted-activity, and active-tool stops already terminate silent work. Therefore the progress warning matters only when communication and activity remain fresh while structural completion does not. Fifteen minutes gives the parent useful visibility without reducing the conservative 45-minute stop allowance for legitimate long-running tools.

## 3. Schema-6 compatibility decision

### 3.1 Keep schema version 6

Schema 6 already carries the fields affected by this policy:

- `progressIdleSeconds`
- `progressWarningCount`
- `structuralProgressCount`
- `duplicateCheckpointCount`
- `stallCause`
- per-attempt copies of the same bounded liveness telemetry

Changing when `progressWarningCount` increments does not change any field name, type, privacy rule, cardinality bound, or serialization rule. Diagnostics continue to use schema 6.

### 3.2 Do not migrate historical records

Historical schema-6 diagnostics remain valid under the policy active when they were written. The dated changelog entry and commit boundary identify the policy epoch. Existing schema 3, 4, and 5 files remain untouched.

### 3.3 Telemetry limitation

Schema 6 records the progress-idle age at attempt settlement and the number of warnings. It does not record the maximum structural-progress gap reached during the complete attempt. Consequently:

- warning incidence can be compared before and after the retune;
- final idle ages and stall causes remain auditable;
- a true p50/p95/p99 distribution of maximum checkpoint gaps cannot be reconstructed from schema 6.

Adding a maximum-gap field would change the durable diagnostic contract and requires a separate schema decision. It is outside this implementation.

## 4. Runtime behavior contract

1. `DEFAULT_PROGRESS_WARNING_MS` changes from `30 * 60 * 1000` to `15 * 60 * 1000`.
2. `DEFAULT_PROGRESS_STALL_MS` remains exactly `45 * 60 * 1000`.
3. `evaluateLiveness` precedence remains unchanged:
   1. active-tool idle stall;
   2. RPC-silent stall;
   3. activity-idle stall;
   4. progress stall, classified as `repeated_cycle` or `progress_stagnation`;
   5. activity warning;
   6. progress warning;
   7. continue running.
4. The progress warning remains inclusive at exactly 15 minutes.
5. A novel structural checkpoint below 15 minutes keeps the progress lease outside warning state.
6. The warning remains one-shot per structural-progress interval.
7. A novel structural checkpoint clears the progress-warning latch.
8. A later 15-minute gap may warn again.
9. The public `delegate_run` schema gains no timeout or threshold parameter.
10. Report recovery, activity leases, catalog timeout, output limit, finite routing, interruption, and cleanup remain unchanged.

## 5. File-by-file implementation

### 5.1 Runtime constant

Update `agent/extensions/delegated-pi-loop/supervisor.ts`:

```ts
export const DEFAULT_PROGRESS_WARNING_MS = 15 * 60 * 1000;
export const DEFAULT_PROGRESS_STALL_MS = 45 * 60 * 1000;
```

Do not change ticker frequency, latch handling, `evaluateLiveness`, or termination logic.

### 5.2 Internal type documentation

Update the `RunOptions.progressWarningMs` comment in `agent/extensions/delegated-pi-loop/types.ts` from “thirty-minute” to “fifteen-minute.” Keep it an internal test seam.

### 5.3 Pure reducer tests

Update `agent/extensions/delegated-pi-loop/liveness.test.ts`:

- set the representative progress warning threshold to 15 minutes;
- assert `run` at `15 minutes - 1 ms` with fresh activity and RPC;
- assert a progress warning at exactly 15 minutes;
- retain the progress warning below `45 minutes - 1 ms`;
- retain `progress_stagnation` at exactly 45 minutes;
- retain `repeated_cycle` at exactly 45 minutes when duplicates exist;
- retain activity-warning precedence when both warning ranges are active.

### 5.4 Default-policy regression

Expose the production constants to an existing test and assert:

```ts
DEFAULT_PROGRESS_WARNING_MS === 15 * 60 * 1000
DEFAULT_PROGRESS_STALL_MS === 45 * 60 * 1000
```

This prevents the production default from drifting while pure reducer tests continue to use injected thresholds.

### 5.5 Supervisor behavior regressions

Retain the existing injected-time tests that prove:

- one-shot progress warning behavior;
- latch reset after novel progress;
- later warning after a second stale interval;
- warning never outranks a stall;
- progress stagnation and repeated-cycle causes remain unchanged.

No real 15-minute sleep is permitted. All runtime tests must use short injected thresholds.

### 5.6 Schema-6 regression

Keep schema 6 unchanged and run the existing diagnostics/result/runner regressions to prove:

- `progressWarningCount` still propagates through final progress, every supervised `ChainAttempt`, ToolResult details, and schema-6 diagnostics;
- `progressIdleSeconds` remains finite and bounded;
- malformed/non-finite values are omitted;
- prompts, reports, tool data, checkpoint digests, paths, credentials, and provider text remain absent;
- catalog-only attempts still omit supervised liveness fields.

Do not add threshold values or policy names to diagnostics in this change.

## 6. Documentation updates

### 6.1 Current policy

Update current-policy references from 30 to 15 minutes in:

- `README.md`
- `docs/delegated-pi-loop-agent-instructions.md`
- `docs/adr/0009-delegated-routing-configuration.md`
- `docs/adr/0015-delegated-renewable-liveness.md`
- `docs/skills/delegated-pi-loop-update-process.md`

ADR 0015 must record that the original 30-minute warning was retuned to 15 minutes on 2026-08-28 while the 45-minute stop remained unchanged.

### 6.2 Historical implementation plan

Add a visible current-policy supersession note to `docs/delegated-pi-loop-runtime-ceiling-removal-plan.md`. Preserve its original 30-minute design text as historical evidence.

### 6.3 Changelog

Add a new top entry to `docs/CHANGELOG.md` that states:

- warning changed 30 → 15 minutes;
- stall remains 45 minutes;
- schema 6 remains unchanged;
- no diagnostic migration occurred;
- tests and validation performed.

Do not rewrite the historical renewable-liveness changelog entry that recorded the original 30-minute threshold.

### 6.4 Generated instruction document

The threshold table in `docs/delegated-pi-loop-agent-instructions.md` is outside the generated model-visible instruction sections. Update it directly, then run the renderer twice to prove generated sections remain current and idempotent.

## 7. Validation gates

Run all of the following:

1. Focused pure reducer tests: `liveness.test.ts`.
2. Focused supervisor tests for warning latches and stalls.
3. Diagnostics, result, and runner tests for schema-6 propagation.
4. Full delegated-pi-loop maintained suite.
5. Strict all-file TypeScript with `strict`, `noUnusedLocals`, and `noUnusedParameters` using the documented temporary configuration and installed Pi declarations.
6. Instruction renderer twice; the second run must be byte-identical.
7. `git diff --check`.
8. Current-policy scan showing no current 30-minute progress-warning claim outside explicitly historical text.
9. Process inventory before and after tests; no fresh fixture child or descendant may survive.
10. Working-tree review proving unrelated local changes in `agent/models.json`, `agent/settings.json`, browser configuration, and findings remain untouched.

No live provider inference or live delegate smoke is required.

## 8. Review focus

Reviewers must verify:

- the warning changes to 15 minutes in production, not only tests or docs;
- the 45-minute stop remains unchanged;
- activity, RPC, active-tool, and recovery thresholds remain unchanged;
- warning precedence and latch reset remain unchanged;
- schema version remains 6 and every existing privacy bound survives;
- historical 30-minute statements remain clearly historical rather than appearing as current policy;
- no public threshold parameter is introduced;
- no unrelated local working-tree changes are staged or modified.

## 9. Rollback

Rollback requires one policy revert:

1. restore `DEFAULT_PROGRESS_WARNING_MS` to 30 minutes;
2. restore current-policy documentation to 30 minutes;
3. retain schema 6 and all historical diagnostics unchanged.

No data migration or runtime cleanup is required because the retune changes only warning timing.

## 10. Acceptance criteria

The change is complete when:

- production defaults are exactly 15-minute warning and 45-minute stall;
- pure and supervisor tests prove inclusive boundaries and one-shot reset behavior;
- schema-6 diagnostics remain shape- and privacy-compatible;
- current documentation consistently says 15/45;
- historical records clearly preserve the original 30/45 decision;
- all required test, type, render, whitespace, and process-leak gates pass;
- unrelated local changes remain untouched;
- nothing is staged, committed, pushed, or deployed without separate authorization.
