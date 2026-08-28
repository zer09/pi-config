# ADR 0016: Delegated schema-7 maximum progress-gap telemetry

## Status

Accepted (2026-08-28). Implements the accepted contract in `docs/delegated-pi-loop-schema-7-maximum-progress-gap-telemetry-plan.md`. Extends ADR 0015 (renewable liveness). Supersedes ADR 0015's schema-6 telemetry limits for newly written records only: schema 6 recorded only the settlement idle age and only for unsuccessful runs, so a percentile over maximum structural-progress gaps could not be reconstructed and the dataset oversampled failures. Historical schema 3 through schema 6 files remain valid historical records and are never migrated, rewritten, or deleted. The 15-minute structural-progress warning, the renewable 45-minute structural-progress stall, every other lease threshold, warning precedence, latches, fallback, recovery, routing, role permissions, concurrency, resource isolation, cleanup, and model-visible instructions are unchanged.

## Context

Schema 6 persisted `progressIdleSeconds` only at attempt settlement and only for unsuccessful delegate invocations. Two defects followed:

1. A 14-minute silent gap followed by a novel checkpoint and quick completion was recorded as roughly the final short interval; the long gap was lost. Settlement ages are not maximum structural-progress gaps.
2. Sampling only failures omits normal completed work, so the dataset cannot support threshold tuning for the p99 of normal structural gaps.

Semantic progress remains unprovable mechanically (ADR 0015); this decision measures only the structural-progress lease boundaries the watchdog already enforces, and it never feeds the measurement back into liveness decisions.

## Decision

### Measurement

Every supervised route attempt records `maxProgressIdleSeconds`: the maximum duration between attempt start and the first novel structural checkpoint, between successive novel structural checkpoints, and between the last novel checkpoint and attempt settlement. The final open interval is included even when no checkpoint closes it, so `maxProgressIdleSeconds >= progressIdleSeconds` subject only to equal one-decimal rounding from the same settlement instant.

The measurement uses the exact existing lease boundaries: `PiRpcMonitor` construction starts the first interval; `renewStructuralProgress()` closes one interval and starts the next; duplicate, unavailable, and over-budget checkpoints, activity-only events, and `beginRecovery()` never close an interval; accepted recovery prompt 2 closes the existing interval. No new event becomes structural progress for telemetry.

`PiRpcMonitor` owns a completed-interval maximum accumulator updated only inside `renewStructuralProgress()` using one monotonic read per renewal; negative or anomalous deltas clamp to zero before comparison; no monotonic timestamp is ever persisted. `MonitorSnapshot` exposes the completed maximum as a duration. The supervisor combines it with the still-open interval from one captured `now`, so current and maximum ages cannot drift across clock reads. The value is telemetry only: it never enters `evaluateLiveness`, and no threshold or decision consumes it.

### Schema 7

All newly written run-telemetry records use `schemaVersion: 7` and add `maxProgressIdleSeconds` to the top-level final progress, every supervised attempt, live and final `DelegateProgress`, `AttemptStatus`, and `ChainAttempt` (supervised only; catalog-only attempts omit it), and sanitized ToolResult details. At every untrusted serialization boundary, zero and positive finite values survive while negative, `NaN`, and infinite values are omitted, never converted to zero. `AttemptStatus.schemaVersion` remains `1`; that private artifact version is not the failure-diagnostic schema number. Historical schema 3 through schema 6 files are untouched.

### Successful-run telemetry

Every completed invocation also writes one private metadata-only schema-7 record through the same bounded builder as failure diagnostics, named with the exact extension-owned `success-v7-` prefix. The record contains only fields the safe diagnostic contract already allowed plus `maxProgressIdleSeconds`; never the report, prompt, child output, raw tool data, digests, keys, provider text, or session content. The telemetry is best-effort: create, write, chmod, or prune failures never change a completed result into an error, temporary supervision artifacts are still removed, the path never reaches model-visible content or ToolResult details, and no success footer is added to the TUI. Failure diagnostics keep their existing writer, path exposure only through ToolResult details and the TUI footer, 0700/0600 permissions, and failure isolation.

Retention bounds successful telemetry to the newest 4,096 exact `success-v7-*.json` regular files in the delegated-pi-loop diagnostics directory. Pruning touches only those exact names after a no-follow `lstat` regular-file check, sorts deterministically by write time with a filename tie-breaker, tolerates `ENOENT` from another local Pi process, treats every other error as best-effort, and serializes write-plus-prune inside one extension process. Failures, historical schema 3-6 files, unknown names, directories, and symlinks are never pruned.

### Analyzer

A local read-only analyzer (`npm --prefix agent/extensions/delegated-pi-loop run analyze:progress-gaps`) scans the same `PI_CODING_AGENT_DIR` diagnostics directory and reports aggregate nearest-rank p50/p95/p99 statistics over the default eligible sample: schema-7 records of completed invocations, using the completed supervised attempt's finite non-negative maximum; fallback and catalog-only attempts are ignored. Rank is `ceil(percentile * count)` over ascending unrounded values; display rounds to one decimal. Counts and percentages at or above 5, 10, 15, 20, 30, and 45 minutes are reported. p99 is labeled insufficient below 100 eligible samples. Output is aggregate-only: no paths, timestamps, labels, roles, routes, providers, or per-run values are printed, and the analyzer performs no writes and no network calls. Threshold changes still require human review; even 100 local runs can be unrepresentative because role, model, provider, tool, and workload mix affect the distribution.

## Consequences

- Every supervised attempt reports an exact bounded maximum structural-progress gap that survives fallback, ToolResult sanitization, and durable diagnostics.
- Completed invocations write bounded metadata-only samples, giving a tuning dataset that includes normal work and stays finite on disk (at most 4,096 success records).
- Unsuccessful diagnostics preserve their existing path, footer, and failure-isolation behavior; only the schema version and one new bounded field change.
- Liveness decisions, thresholds, routing, roles, recovery, cleanup, and model-visible instructions are untouched.
- Rollback may stop success writes, remove the analyzer, remove the field, and restore failure writes to schema 6, without deleting or rewriting already written schema-7 files.

## Validation

- Monitor tests prove exact interval accumulation, duplicate and unavailable checkpoint exclusion, activity-only exclusion, recovery behavior, negative-delta clamping, and duration-only snapshots on injected clocks.
- Supervisor tests prove the completed/open combination from one captured `now`, settlement inclusion, warning independence, stall-boundary coverage, cross-recovery measurement, and finite non-negative telemetry for every supervised terminal state.
- Runner, result, and diagnostics tests prove propagation through fallback history, sanitization (zero preserved; negative and non-finite omitted), catalog-only omission, schema-7 shape and privacy, permissions, retention bounds, symlink/directory/historical immunity, concurrent writers, and disappearing files.
- Analyzer tests prove exact nearest-rank boundaries, ignored categories, malformed JSON and vanished-file tolerance, sample-sufficiency labeling, aggregate-only output, and read-only scanning; the analyzer test runs in the maintained `npm test` list.
- The full delegated-pi-loop suite must pass three consecutive times; strict all-file TypeScript with `strict`, `noUnusedLocals`, and `noUnusedParameters`; the instruction renderer must be idempotent; no live provider inference may run without separate authorization.
