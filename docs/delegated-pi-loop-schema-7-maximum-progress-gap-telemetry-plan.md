# Delegated Pi Loop Schema-7 Maximum Progress-Gap Telemetry Plan

## Status

Status note (2026-08-29, after completion): this plan was implemented and its decisions are historical. New writes moved from schema 7 to schema 8 under `docs/adr/0017-delegated-schema-8-diagnostic-report-persistence.md` (ADR 0017), which adds the failure-only bounded `delegateReport` object; every other schema-7 decision here (the `maxProgressIdleSeconds` measurement, metadata-only success records, retention, and the analyzer) remains current policy as amended by ADR 0017. Historical schema-7 files remain valid and untouched. The body below is preserved unchanged as historical evidence.

Ready for implementation by a fresh agent. Not yet implemented.

At planning time, local `master` and `origin/master` point to `031fe0c`. A fresh agent must inspect the current branch and working tree before editing. If later source changes materially alter the telemetry pipeline described here, the agent must stop and report the conflict instead of silently redesigning this contract.

This plan introduces failure-diagnostic schema 7, records the maximum structural-progress gap for every supervised route attempt, adds bounded metadata-only telemetry for successful delegate runs, and adds a read-only local percentile analyzer. It does not change the 15-minute progress warning, the renewable 45-minute progress stall, route selection, role policy, recovery, cleanup, model-visible prompts, or provider behavior.

## 1. Answer and implementation ownership

A fresh agent can implement this plan. The work is self-contained because this document fixes:

- the exact meaning of the new measurement;
- where the measurement is collected;
- every propagation and serialization boundary;
- the schema-version decision;
- successful-run sampling and retention;
- percentile calculations;
- privacy and failure-isolation rules;
- file scope, tests, documentation, and acceptance gates.

The implementation agent must execute this contract rather than reopen the design. A material incompatibility with newer source is the only reason to return for a plan revision.

### 1.1 Required branch and worktree isolation

The fresh agent must not implement in `/home/gc/.pi`. That checkout contains unrelated user-owned changes.

Before implementation, the agent must:

1. Inspect `/home/gc/.pi` status without stashing, resetting, cleaning, staging, or editing it.
2. Fetch `origin/master` so the new branch starts from the latest remote `master`.
3. Confirm that branch `feat/delegate-schema-7-progress-gap-telemetry` and worktree path `/home/gc/worktrees/pi-delegate-schema-7-progress-gap-telemetry` do not already exist.
4. If either exists, stop and report the collision. Do not delete, reuse, reset, or overwrite it.
5. Create branch `feat/delegate-schema-7-progress-gap-telemetry` from the fetched `origin/master`.
6. Create worktree `/home/gc/worktrees/pi-delegate-schema-7-progress-gap-telemetry` on that branch.
7. Copy this untracked governing plan from `/home/gc/.pi/docs/delegated-pi-loop-schema-7-maximum-progress-gap-telemetry-plan.md` into the same relative path in the new worktree.
8. Verify the source and copied plan have the same SHA-256 hash before editing any implementation file.
9. Perform every implementation edit, generated-document update, test, analyzer smoke, and validation command inside the new worktree.

The implementation agent must leave the main `/home/gc/.pi` checkout and its unrelated changes untouched. It must leave the new branch and worktree present after reporting. Creating the branch and worktree is authorized by this plan; staging, committing, pushing, deleting a worktree, and deleting a branch remain unauthorized.

## 2. Problem

Schema 6 records `progressIdleSeconds` when an attempt settles. It does not retain the longest structural-progress gap that occurred earlier in the attempt.

Example:

```text
14-minute gap -> novel checkpoint -> 1-minute gap -> completed attempt
```

Schema 6 records approximately one minute. The 14-minute gap is lost. A percentile calculated from schema-6 settlement ages is therefore not a percentile of maximum structural-progress gaps.

Schema 6 also persists diagnostics only for unsuccessful delegate invocations. Adding a maximum field only to the current failure diagnostic would oversample stalled and failed work and omit normal successful work. That dataset cannot support threshold tuning.

## 3. Goals

1. Record one maximum structural-progress gap for every supervised route attempt.
2. Preserve the measurement through fallback, final progress, ToolResult details, and durable diagnostics.
3. Bump new failure diagnostics from schema 6 to schema 7.
4. Write bounded, metadata-only schema-7 records for successful delegate invocations.
5. Retain enough successful samples for useful p50, p95, and p99 calculations without unbounded success-record growth.
6. Add a read-only local analyzer with deterministic percentile semantics.
7. Preserve all renewable-liveness decisions and thresholds.
8. Preserve historical schema 3 through schema 6 files without migration.

## 4. Non-goals

Do not:

- change the 15-minute progress warning or 45-minute progress stall;
- add a public timeout, threshold, telemetry, or analytics parameter to `delegate_run`;
- alter which events count as activity, novelty, or structural progress;
- add filesystem polling, paid inference, a semantic-progress judge, or hosted telemetry;
- persist prompts, reports, tool arguments, tool results, child output, HMAC keys, checkpoint digests, raw monotonic timestamps, environment values, credentials, PIDs, or arbitrary errors;
- migrate, rewrite, or delete schema 3 through schema 6 diagnostic files;
- calculate percentiles from schema-6 `progressIdleSeconds`;
- automatically change thresholds from analyzer output;
- add a model-visible analytics tool;
- change routing, fallback, role permissions, concurrency, resource isolation, recovery, or cleanup.

## 5. Measurement contract

### 5.1 Field name

Add:

```ts
maxProgressIdleSeconds
```

The durable and parent-facing value is a finite, non-negative number rounded to one decimal place.

### 5.2 Exact meaning

For one supervised route attempt, `maxProgressIdleSeconds` is the maximum duration between these boundaries:

- attempt start and the first novel structural checkpoint;
- one novel structural checkpoint and the next novel structural checkpoint;
- the last novel structural checkpoint and attempt settlement.

The final open interval is included even when no later checkpoint closes it. Therefore:

```text
maxProgressIdleSeconds >= progressIdleSeconds
```

subject only to equal one-decimal rounding from the same settlement instant.

### 5.3 Lease identity

The measurement uses the same authoritative lease boundaries as the current watchdog:

- `PiRpcMonitor` construction starts the first interval;
- `renewStructuralProgress()` closes the current interval and starts the next;
- duplicate checkpoints do not close an interval;
- unavailable or over-budget checkpoints do not close an interval;
- activity-only events do not close an interval;
- `beginRecovery()` does not reset structural progress;
- accepted recovery prompt 2 closes the existing interval because prompt acceptance already calls `renewStructuralProgress()`;
- attempt settlement closes the final open interval for telemetry only.

No new event may become structural progress merely to support telemetry.

### 5.4 Monotonic behavior

Use monotonic time only for interval calculation. Clamp a negative injected or anomalous delta to zero before comparison. Never persist a monotonic timestamp.

Capture one `now` value when building live progress or final attempt status. Use that same value for current `progressIdleSeconds` and the candidate final open interval so the values cannot drift across separate clock reads.

### 5.5 Maximum accumulator

`PiRpcMonitor` owns the completed-interval accumulator because `renewStructuralProgress()` is the single structural-renewal authority.

Add an internal value with semantics equivalent to:

```ts
maxCompletedProgressGapMs = Math.max(
  maxCompletedProgressGapMs,
  Math.max(0, now - lastStructuralProgressMonotonic),
);
lastStructuralProgressMonotonic = now;
```

Expose the completed maximum in `MonitorSnapshot` as a duration, not a timestamp. The supervisor computes the observable maximum as:

```ts
Math.max(
  snapshot.maxCompletedProgressGapMs,
  Math.max(0, now - snapshot.lastStructuralProgressMonotonic),
)
```

Convert to one-decimal seconds only at the supervisor boundary.

## 6. Schema-7 contract

### 6.1 Version boundary

All newly written unsuccessful-run diagnostics use:

```json
{"schemaVersion": 7}
```

Historical schema 3 through schema 6 files remain valid historical records. Do not migrate them.

`AttemptStatus.schemaVersion` remains `1`. That private attempt-artifact version has remained stable while bounded status fields were extended and is not the failure-diagnostic schema number.

### 6.2 New fields

Add `maxProgressIdleSeconds` to:

- live and final `DelegateProgress`;
- `AttemptStatus` for every supervised attempt;
- `ChainAttempt` for supervised attempts only;
- final ToolResult `details.progress`;
- sanitized ToolResult `details.attempts[]` for supervised attempts;
- schema-7 diagnostic top-level final-progress telemetry;
- schema-7 diagnostic `attempts[]` for supervised attempts.

Catalog-only attempts continue to omit all supervised liveness telemetry, including the new field.

### 6.3 Sanitization

At every untrusted serialization boundary:

- retain zero and positive finite values;
- omit negative, `NaN`, and infinite values;
- never convert invalid data to zero;
- preserve one-decimal values without adding string formatting;
- ensure the new field receives the same privacy review as existing liveness ages.

The internal monitor duration must never cross into ToolResult or disk directly. Only bounded seconds cross those boundaries.

### 6.4 Failure records

Preserve existing failure behavior:

- unsuccessful results still write a private diagnostic;
- the diagnostic path remains available only in ToolResult details and the TUI footer;
- a diagnostic-write failure never masks the delegate outcome;
- directory mode remains `0700` and file mode remains `0600`;
- filenames remain bounded and contain no prompt or report content.

The implementation may introduce a shared schema-7 record builder, but it must retain a failure-specific writer or wrapper so unsuccessful-result behavior and tests remain explicit.

## 7. Successful-run telemetry

### 7.1 Why success records are required

The tuning dataset must include normal completed work. Failure-only records are unsuitable for a p99 estimate of normal structural gaps.

### 7.2 Record shape

After every completed delegate invocation, write one private metadata-only schema-7 record using the same bounded schema-7 builder as failure diagnostics.

A successful record may contain only fields already allowed by the safe diagnostic contract plus `maxProgressIdleSeconds`. It must not contain the report, prompt, child output, raw tool data, digests, keys, arbitrary provider text, or session content.

Use an exact extension-owned filename prefix that distinguishes successful schema-7 telemetry, for example:

```text
success-v7-<bounded-label>-<timestamp>-<pid>-<counter>.json
```

The filename is an implementation detail, but the prefix must be exact and covered by retention tests.

### 7.3 Result isolation

Successful telemetry is best-effort:

- failure to create, write, chmod, or prune telemetry must not change a completed result into an error;
- temporary supervision artifacts must still be removed;
- the success telemetry path must not be added to model-visible content;
- do not add a success diagnostic footer to the TUI;
- the final ToolResult may omit the success path entirely.

Unsuccessful diagnostic behavior remains unchanged and still exposes its private path only through existing details/TUI behavior.

### 7.4 Retention

Bound successful telemetry to the newest 4,096 `success-v7-*.json` regular files in the delegated-pi-loop diagnostic directory.

Rationale:

- 4,096 completed runs provide enough headroom for tail analysis beyond the minimum 100 observations needed for a literal nearest-rank p99;
- bounded records keep local disk use finite;
- historical failure diagnostics remain untouched.

Retention rules:

1. Prune only exact extension-owned `success-v7-*.json` names.
2. Never prune `failure-*`, schema 3 through schema 6 files, unknown files, directories, or symlinks.
3. Use `lstat` or an equivalent no-follow check before deletion.
4. Sort deterministically by write time and filename tie-breaker.
5. Ignore an `ENOENT` caused by another local Pi process pruning the same file.
6. Treat every other prune error as a best-effort telemetry failure that cannot alter the delegate result.
7. Serialize write-plus-prune operations inside one extension process to avoid same-process races.
8. Tests must cover concurrent finalization and cross-process-style disappearance without using live providers.

Do not impose retention on historical or unsuccessful diagnostics in this change.

## 8. Percentile analyzer

### 8.1 Command

Add a local read-only script and package command, with names equivalent to:

```text
agent/extensions/delegated-pi-loop/analyze-progress-gaps.ts
npm --prefix agent/extensions/delegated-pi-loop run analyze:progress-gaps
```

The exact script filename may follow repository style, but the package command must be stable and documented.

### 8.2 Input

By default, scan the delegated-pi-loop diagnostics directory resolved from the same `PI_CODING_AGENT_DIR` rules as the writer.

Default eligible sample:

- schema version exactly 7;
- top-level invocation state `completed`;
- an attempt whose state is `completed`;
- finite, non-negative `maxProgressIdleSeconds`.

There should be one completed supervised attempt per completed invocation. Ignore fallback attempts by default because they represent operational failures rather than the final normal completion.

Ignore and count separately:

- historical schema 3 through schema 6 records;
- malformed JSON;
- unknown schema versions;
- unsuccessful records;
- catalog-only attempts;
- missing, negative, or non-finite maximum values.

The analyzer must not fail the whole scan because one file is malformed or disappears during the scan.

### 8.3 Percentile method

Sort eligible values ascending and use nearest-rank percentiles:

```text
rank = ceil(percentile * sampleCount)
value = sorted[rank - 1]
```

Report at least:

- eligible sample count;
- records scanned;
- records ignored by category;
- minimum and maximum;
- p50;
- p95;
- p99;
- count and percentage at or above 5, 10, 15, 20, 30, and 45 minutes.

Round display values to one decimal second. Do not round values before percentile selection.

### 8.4 Sample sufficiency

The analyzer may calculate all values for any non-empty sample, but it must label p99 as insufficient when fewer than 100 eligible completed attempts exist. It must not emit an automatic threshold recommendation.

Document that even 100 local runs can be unrepresentative because role, model, provider, tool, and workload mix affect the distribution. Threshold changes still require human review.

### 8.5 Output and privacy

Output aggregates only. Do not print:

- individual file paths;
- timestamps;
- labels;
- roles unless a future separate decision adds a sufficiently sampled aggregate breakdown;
- routes or providers;
- per-run values;
- prompts, reports, errors, or tool data.

The analyzer is local and read-only. It creates no files and performs no network calls.

## 9. File-by-file implementation

### 9.1 `agent/extensions/delegated-pi-loop/monitor.ts`

- Add the completed-gap maximum accumulator.
- Update it only inside `renewStructuralProgress()` before replacing the prior structural timestamp.
- Use one monotonic `now` value per renewal.
- Expose the completed maximum duration through `snapshot()`.
- Do not alter checkpoint novelty, counts, keys, summaries, event acceptance, or recovery semantics.

### 9.2 `agent/extensions/delegated-pi-loop/monitor.test.ts`

Add injected-clock tests proving:

- the attempt-start interval is included;
- successive novel checkpoints close intervals;
- a shorter final interval does not replace an earlier maximum;
- duplicate checkpoints do not close an interval;
- unavailable/over-budget checkpoints do not close an interval;
- activity-only events do not close an interval;
- recovery start does not reset the interval;
- recovery prompt acceptance closes the existing interval;
- negative injected deltas clamp to zero;
- snapshot exposes duration only, never a new raw timestamp or digest.

### 9.3 `agent/extensions/delegated-pi-loop/types.ts`

Add the internal completed-gap duration to `MonitorSnapshot`.

Add `maxProgressIdleSeconds` to:

- `DelegateProgress`;
- `AttemptStatus`;
- `ChainAttempt` as optional because catalog-only attempts omit it.

Update comments so `progressIdleSeconds` means settlement/current age and `maxProgressIdleSeconds` means attempt maximum.

### 9.4 `agent/extensions/delegated-pi-loop/supervisor.ts`

- Add one small helper that combines completed maximum and current open interval using one captured `now`.
- Use the same `now` for `progressIdleSeconds` and `maxProgressIdleSeconds` in live progress.
- Use the same settlement `now` for both fields in `buildStatus`.
- Persist only rounded seconds in `AttemptStatus`.
- Do not add the maximum to `evaluateLiveness`; it is telemetry, not a stop input.
- Do not change ticker frequency, warning latches, threshold precedence, or report recovery.

### 9.5 `agent/extensions/delegated-pi-loop/supervisor.test.ts`

Add deterministic tests proving:

- final status includes the final open interval;
- a completed earlier interval remains the maximum when settlement age is smaller;
- a progress warning does not reset or inflate the maximum;
- a novel checkpoint resets current idle but preserves the maximum;
- progress-stall settlement records a maximum at least equal to the stall boundary;
- recovery preserves the round-1 maximum and measures the cross-recovery interval correctly;
- completion, interruption, output limit, invalid stream, and operational fallback statuses all produce finite non-negative telemetry when supervised.

Use injected or bounded fixture time. Do not create new scheduler-sensitive sub-200-ms assumptions when a pure seam can prove the behavior.

### 9.6 `agent/extensions/delegated-pi-loop/runner.ts`

- Copy the new field in `progressFromStatus()`.
- Initialize it consistently in `initialProgress()`.
- Copy it from every supervised `AttemptStatus` into `ChainAttempt`.
- Keep it through fallback and final progress.
- Catalog-only attempts omit it.
- Update comments that still say failure-only diagnostics once successful telemetry exists.

### 9.7 `agent/extensions/delegated-pi-loop/runner.test.ts`

Add coverage proving:

- a completed attempt exposes the maximum in final progress and attempt history;
- a stalled first route retains its maximum after a completed fallback route;
- the final top-level progress belongs to the final route;
- every supervised attempt retains its own maximum;
- catalog-only attempts omit the field;
- restart-after-work behavior is unchanged.

### 9.8 `agent/extensions/delegated-pi-loop/result.ts`

- Add the field to sanitized progress and sanitized attempts.
- Use a finite non-negative sanitizer.
- Preserve zero.
- Omit negative, `NaN`, and infinite values.
- Finalize every result through the best-effort schema-7 writer.
- Pass the diagnostic path to `finalToolResult()` only for unsuccessful results so completed ToolResult behavior stays quiet.
- Preserve artifact cleanup in `finally`.

### 9.9 `agent/extensions/delegated-pi-loop/result.test.ts`

Add coverage for:

- valid top-level and per-attempt maximum propagation;
- zero preservation;
- negative/non-finite omission;
- completed ToolResult content and details containing no telemetry path;
- unsuccessful diagnostic-path behavior remaining unchanged;
- successful telemetry write failure not changing completed output;
- artifact cleanup after both successful and failed telemetry writes.

### 9.10 `agent/extensions/delegated-pi-loop/diagnostics.ts`

- Introduce an explicit schema-version constant set to 7.
- Build one privacy-bounded schema-7 record for completed and unsuccessful results.
- Add the new field at top level and per supervised attempt.
- Preserve every existing enum, bound, attempt cap, stream-error cap, route bound, timestamp validation, and privacy exclusion.
- Keep failure-specific writer behavior available.
- Add the best-effort success writer and 4,096-record success retention.
- Keep permissions at `0700`/`0600`.
- Never read temporary prompt/report/stderr artifacts to build telemetry.

### 9.11 `agent/extensions/delegated-pi-loop/diagnostics.test.ts`

Update schema tests to version 7 and prove:

- exact schema version and new field shape;
- completed and unsuccessful records share the safe shape;
- success records contain no report or prompt text;
- top-level and attempt values survive when valid;
- invalid maximum values fail closed by omission;
- catalog-only attempts omit the field;
- schema 3 through schema 6 fixture files are not rewritten;
- permissions remain exact;
- success write failures are isolated;
- retention keeps the newest 4,096 exact success files;
- retention ignores failures, historical files, unknown names, directories, and symlinks;
- concurrent same-process writers settle without excess retained success records;
- disappearing files do not fail the delegate result.

Use a lower injectable retention limit in tests rather than creating 4,097 physical files when practical. The production constant remains 4,096.

### 9.12 `agent/extensions/delegated-pi-loop/index.ts`

Update finalization comments from failure-only diagnostics to schema-7 run telemetry. Do not change tool schema, prompt guidance, role registration, or child behavior.

### 9.13 Analyzer files

Add:

- one analyzer implementation;
- one focused analyzer test file;
- the analyzer test to the maintained `npm test` list;
- `analyze:progress-gaps` to `package.json`.

Analyzer tests must cover exact nearest-rank boundaries, ignored records, malformed JSON, disappearing files, no samples, fewer than 100 samples, at least 100 samples, aggregate-only output, and no writes/network calls.

### 9.14 Documentation

Update current-policy text in:

- `README.md`;
- `docs/CHANGELOG.md` with one new dated entry;
- `docs/adr/0015-delegated-renewable-liveness.md` with a supersession note for schema-6 telemetry limits;
- new `docs/adr/0016-delegated-schema-7-progress-gap-telemetry.md`;
- `docs/delegated-pi-loop-agent-instructions.md` only where surrounding non-generated runtime/diagnostic prose mentions schema 6;
- `docs/config-context-cost.md` where privacy text says failure-only diagnostics;
- `docs/skills/delegated-pi-loop-update-process.md` for schema 7, success retention, and analyzer maintenance;
- `docs/delegated-pi-loop-schema-6-progress-warning-retune-plan.md` with a short status note that its schema-6 compatibility decision was correct for that completed retune and later superseded for new writes by schema 7;
- `docs/delegated-pi-loop-runtime-ceiling-removal-plan.md` only with a short historical supersession note if it presents schema 6 as current.

Preserve historical evidence in ADRs, changelogs, and plans. Do not rewrite old statements as though schema 7 existed earlier.

Do not edit `agent/extensions/delegated-pi-loop/instructions.ts` or `agent/AGENTS.md`. This telemetry is not model-visible policy.

Run the instruction renderer twice after touching the generated reference document. The second run must be byte-identical.

## 10. Privacy and safety invariants

The implementation is unacceptable if any new record or analyzer output contains:

- assignment prompt or delegate report;
- message, thinking, or tool content;
- raw errors, stderr, or provider bodies;
- paths other than the existing private diagnostic path behavior;
- credentials, environment variables, secrets, or request headers;
- raw checkpoint identities, HMAC keys, or digests;
- PIDs or process-group data inside JSON records;
- raw monotonic timestamps;
- arbitrary child-supplied tool names or text.

Successful telemetry must use the existing bounded safe metadata model. The increase in write frequency does not relax any privacy rule.

## 11. Validation gates

Run all of the following without live provider inference:

1. Focused monitor tests for exact interval accumulation.
2. Focused supervisor tests for current-open and completed-gap combination.
3. Focused runner, result, and diagnostics propagation tests.
4. Focused analyzer tests.
5. Maintained delegated-pi-loop suite with the analyzer test included.
6. Three consecutive clean maintained-suite runs after the final code change.
7. Strict all-file TypeScript with `strict`, `noUnusedLocals`, and `noUnusedParameters`, using the repository's documented temporary configuration and installed Pi declarations.
8. Instruction renderer twice with byte-identical second output.
9. `git diff --check` and a trailing-whitespace scan for new/changed Markdown.
10. Current-policy scan proving schema 7 is current while schema-6 references are historical or explicitly superseded.
11. Privacy-seed tests proving paths, credentials, provider text, prompts, reports, raw errors, timestamps, digests, and keys do not enter schema-7 records or analyzer output.
12. Pre/post process inventory around the maintained suite proving no new fixture child or descendant survives.
13. Working-tree review proving unrelated local changes in `agent/models.json`, `agent/settings.json`, `agent/browser-harness.json`, and `findings/` remain untouched.
14. Analyzer smoke against temporary synthetic schema-7 records only. Do not analyze or expose the user's real local diagnostics during implementation validation.

No live delegate, web search, hosted telemetry, deployment, staging, commit, or push is part of implementation validation.

## 12. Review focus

Reviewers must verify:

- maximum-gap semantics include attempt start, every completed interval, and final settlement;
- duplicates and activity-only events do not close gaps;
- recovery does not reset structural progress;
- one captured `now` drives current and maximum settlement ages;
- the maximum is telemetry only and cannot affect liveness decisions;
- every supervised attempt retains the field through fallback;
- catalog-only attempts omit it;
- schema 7 is used only for new records and historical files are untouched;
- completed runs produce bounded metadata-only records;
- telemetry write/prune failures never alter delegate outcomes;
- success retention cannot delete failures, historical files, unknown files, directories, or symlinks;
- analyzer default samples only completed attempts from completed schema-7 invocations;
- nearest-rank p50/p95/p99 is implemented exactly;
- fewer than 100 samples is labeled insufficient for p99;
- analyzer output is aggregate-only;
- all existing privacy, cleanup, fallback, role, routing, and recovery invariants remain unchanged.

## 13. Rollback

A rollback may:

1. stop successful-run telemetry writes;
2. remove the analyzer command;
3. remove `maxProgressIdleSeconds` propagation;
4. restore new failure writes to schema 6.

Do not delete or rewrite already written schema-7 files during rollback. They remain valid historical metadata. Do not migrate schema 7 back to schema 6.

Thresholds remain 15-minute warning and 45-minute stall throughout rollback.

## 14. Acceptance criteria

The change is complete when:

- every supervised attempt reports an exact bounded maximum structural-progress gap;
- the final open interval is included;
- the field survives fallback, ToolResult sanitization, and schema-7 diagnostics;
- completed invocations write private metadata-only schema-7 samples;
- successful samples are capped at 4,096 exact extension-owned files;
- unsuccessful diagnostics preserve their existing path and failure-isolation behavior;
- schema 3 through schema 6 files remain untouched;
- the analyzer emits deterministic aggregate p50/p95/p99 values and sample sufficiency;
- no liveness threshold or decision changes;
- all focused, full-suite, type, render, whitespace, privacy, and process gates pass;
- unrelated user-owned changes remain untouched;
- nothing is staged, committed, pushed, deployed, or sent to a hosted service without separate authorization.

## 15. Fresh-agent implementation prompt

Use the following prompt in a fresh agent session:

```text
Implement the accepted schema-7 maximum structural-progress gap telemetry plan from an isolated Git worktree. Do not implement in the main /home/gc/.pi checkout.

Required worktree setup:
- Inspect /home/gc/.pi git status without changing, stashing, resetting, cleaning, or staging anything.
- Fetch origin/master.
- Confirm branch feat/delegate-schema-7-progress-gap-telemetry and path /home/gc/worktrees/pi-delegate-schema-7-progress-gap-telemetry do not already exist. If either exists, stop and report the collision without deleting, resetting, reusing, or overwriting it.
- Create branch feat/delegate-schema-7-progress-gap-telemetry from the fetched origin/master.
- Create worktree /home/gc/worktrees/pi-delegate-schema-7-progress-gap-telemetry on that branch.
- Copy /home/gc/.pi/docs/delegated-pi-loop-schema-7-maximum-progress-gap-telemetry-plan.md to docs/delegated-pi-loop-schema-7-maximum-progress-gap-telemetry-plan.md inside the new worktree.
- Verify both plan copies have the same SHA-256 hash before editing implementation files.
- Perform every edit and validation command inside the new worktree. Leave /home/gc/.pi untouched.

Governing contract:
- Read the copied docs/delegated-pi-loop-schema-7-maximum-progress-gap-telemetry-plan.md completely before editing.
- Treat that plan as finalized. Do not redesign its measurement semantics, schema boundary, successful-run sampling, 4,096-record retention, percentile method, privacy rules, worktree isolation, or validation gates.

Required result:
- Add exact per-supervised-attempt maxProgressIdleSeconds telemetry.
- Include attempt start, completed checkpoint intervals, and the final open interval at settlement.
- Propagate the field through MonitorSnapshot, AttemptStatus, DelegateProgress, ChainAttempt, fallback history, sanitized ToolResult details, and schema-7 diagnostics.
- Keep catalog-only attempts free of supervised telemetry.
- Bump newly written failure diagnostics to schema 7 without migrating historical schema 3 through schema 6 files.
- Add best-effort metadata-only schema-7 records for completed invocations, bounded to the newest 4,096 exact success-v7 records without deleting failures, historical files, unknown files, directories, or symlinks.
- Add the local read-only analyze:progress-gaps command with nearest-rank p50/p95/p99, aggregate-only output, and p99 insufficiency below 100 eligible completed attempts.
- Preserve the 15-minute progress warning, renewable 45-minute progress stall, and every existing liveness, recovery, routing, role, cleanup, resource, and privacy invariant.

Scope and safety:
- Preserve unrelated local changes, especially /home/gc/.pi/agent/models.json, agent/settings.json, agent/browser-harness.json, and findings/.
- Do not edit agent/AGENTS.md or delegated-pi-loop model-visible instructions.
- Do not run live provider inference, web research, deployment, or hosted-service mutations.
- Creating the named branch and worktree is authorized. Do not stage, commit, push, delete the worktree, or delete the branch.
- If current source materially conflicts with the plan, stop and report the exact conflict instead of silently changing the contract.

Validation:
- Add every focused test required by sections 9 and 11 of the plan.
- Add analyzer tests to the maintained package test command.
- After the final edit, run the maintained delegated-pi-loop suite three consecutive times.
- Run strict all-file TypeScript with strict, noUnusedLocals, and noUnusedParameters.
- Run the instruction renderer twice and prove the second output is byte-identical.
- Run git diff --check, Markdown whitespace checks, privacy-seed tests, current-policy scans, and a pre/post fixture-process inventory.
- Use only temporary synthetic schema-7 records for analyzer smoke validation. Do not inspect or print the user's real diagnostic files.

Final report:
- State the branch and worktree path.
- List changed files.
- Explain the exact maximum-gap calculation and successful-sample retention behavior.
- Report focused and full validation results with test counts.
- Confirm schema 3 through schema 6 files were not migrated.
- Confirm thresholds remain 15/45.
- Confirm the main checkout and unrelated files were untouched.
- Confirm the worktree remains present and nothing was staged, committed, pushed, or deleted.
- State any remaining risk or incomplete gate precisely.
```
