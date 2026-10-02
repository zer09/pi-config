# Context Mode verification and delegate baseline repair

Repository base: `dbc63d96b43bfca207031ff801395785181394f7`.
Worktree: `/home/gc/worktrees/pi-delegate-tests`, branch `fix/delegate-tests`, created from current master.
No main-checkout tracked edits, staging, commits, pushes, deployments, or hosted-service changes are authorized.

## Verified baseline

`npm test` in `agent/extensions/delegated-pi-loop`:

- 1469 tests, 1370 passed, 99 failed, 0 cancelled, 0 skipped, 0 todo.
- Duration: 67723.738504 ms.
- Exact failures below were recovered from the original Context Mode indexed output, not inferred from source.
- Failure families: 1 instruction test, 31 persisted-session tests, 67 session-resume tests.

## Root causes and compatibility

The test-only oracle requires exact Pi 0.87.1 before importing the real projection and writer helpers. The installed runtime and current settings identify Pi 0.99.2. The upgrade preparation explicitly targeted exact 0.99.2 and recorded 695 persistence/resume checks. The version guard fails before the 31 persistence checks exercise their expectations. The fake resume child calls the same guard before recording execution startup, so all 67 resume scenarios fail indirectly, often with `routes_unavailable`.

The instruction test asserts three phrases from the former override policy. The current policy was deliberately rewritten in commit `66087ce`. The repair must test the current policy, not restore the former policy to satisfy the test.

The compatibility contract for this repair is exact Pi 0.99.2. Unsupported versions must still fail before helper import. This does not claim support for arbitrary future Pi versions or a 0.87.1/0.99.2 matrix.

Independent investigations observed additional failures under concurrent test load. They involved short cancellation/catalog deadlines and deadline-versus-stall observations. Those failures passed in focused runs. They are timing/environment candidates, not members of the reproduced 99-failure baseline. No production defect was established by the baseline failures.

## Live Context Mode verification

The current Pi process started at local time 2026-10-03 00:53:15. Merged source mtimes and commit time are 00:04:59. Current master is `dbc63d9`; the session started after the merged implementation was present. No reload was required.

Actual session calls exercised local output growth, a silent `sleep 1`, and `sleep 3` with an explicit 200 ms timeout. A separate local, no-model harness imported the main checkout's extension registration and used its real backend with isolated temporary storage. It captured the callback and supplied an AbortSignal because the model-facing tool schema has no cancellation parameter. This verifies the real registration-to-worker cancellation path; it does not claim that the human's TUI Escape action was exercised.

Final bounded harness observations:

- Default timeout: 300000 ms. Explicit 0, 250, and 1234 remained unchanged.
- Actual output-byte progress: 0, 17, 34, 51, 68, 85, 116 bytes, with process completion and phase transitions. No duplicate progress packets.
- Silent command: zero updates during a 1100 ms running interval.
- Cancellation: command leader and TERM-resistant descendant stopped; serial queued command did not start. Total call elapsed: 856 ms.
- Explicit 500 ms timeout stopped an 8000 ms command and its TERM-resistant descendant early. Total call elapsed: 1038 ms.
- Every owned test process stopped. Temporary storage was removed in `finally`.

Commands:

- `node --import /home/gc/.pi/agent/extensions/context-mode/node_modules/tsx/dist/loader.mjs /tmp/pi-delegate-live-check.mjs`
- Context Mode: `npm test && npm run check` in the worktree extension, using the existing local dependency installation through an ignored worktree symlink.

Context Mode result: 9 files passed, 287 tests passed; typecheck passed. Existing worker tests cover parent disconnect/death, process ownership, and cleanup. Linux was exercised. Windows and deliberately escaped process groups remain documented limits.

## Exact original failing test names

### instructions.test.ts (1)

- agent/AGENTS.md no longer duplicates the parent delegation workflow

### persisted-session.test.ts (31)

- Pi 0.87.1 projection differential: null removes assignment
- Pi 0.87.1 projection differential: changed text removes assignment
- Pi 0.87.1 projection differential: exact replacement restores assignment
- Pi 0.87.1 projection differential: restart replacement restores assignment
- Pi 0.87.1 projection differential: segmented replacement restores assignment
- Pi 0.87.1 projection differential: image replacement is not an assignment
- Pi 0.87.1 projection differential: extra replacement text is not an assignment
- Pi 0.87.1 projection differential: empty replacement is not an assignment
- Pi 0.87.1 projection differential: latest edit restores
- Pi 0.87.1 projection differential: latest edit removes
- Pi 0.87.1 projection differential: off-branch removal is inert
- Pi 0.87.1 projection differential: off-branch restoration is inert
- Pi 0.87.1 projection differential: active edit wins over later physical off-branch edit
- Pi 0.87.1 projection differential: later assignment survives earlier removal
- Pi 0.87.1 projection differential: compaction retains edited assignment
- Pi 0.87.1 projection differential: compaction retains removal
- Pi 0.87.1 projection differential: post-compaction removal
- Pi 0.87.1 projection differential: post-compaction restoration
- Pi 0.87.1 projection differential: retained edit cannot restore omitted target
- Pi 0.87.1 projection differential: post-compaction edit cannot restore omitted target
- Pi 0.87.1 projection differential: self boundary retains none
- Pi 0.87.1 projection differential: tail-only assignment is inert
- Pi 0.87.1 projection differential: firstKept takes precedence over empty tail
- Pi 0.87.1 projection differential: self takes precedence over assignment tail
- Pi 0.87.1 projection differential: assignment after inert tail
- Pi 0.87.1 projection differential: system boundary retains following user
- Pi 0.87.1 projection differential: system checkpoint cannot impersonate user
- Pi 0.87.1 projection differential: latest compaction restores raw retained range
- Pi 0.87.1 projection differential: latest compaction retains older edits
- Pi 0.87.1 projection differential: off-branch compaction is inert
- Pi 0.87.1 writes accepted context edits with normalized target-role content

### session-resume.test.ts (67)

- persisted replacement after provider reads prior context before the correct prompt
- persisted replacement after tools-provider reads prior context before the correct prompt
- persisted replacement after stalled reads prior context before the correct prompt
- persisted replacement after invalid-stream reads prior context before the correct prompt
- persisted replacement after output reads prior context before the correct prompt
- persisted replacement after dead reads prior context before the correct prompt
- persisted replacement after active-tool reads prior context before the correct prompt
- persisted replacement after recovery-provider reads prior context before the correct prompt
- persisted replacement after reject reads prior context before the correct prompt
- failed final live-switch boundary resumes the same target without a synthetic attempt
- chain acceptance survives replacement, live reuse, and later rejection: {"behaviors":["provider","reject","complete"],"switchFaultRoutes":[0,1]}
- chain acceptance survives replacement, live reuse, and later rejection: {"behaviors":["provider","reject","complete"],"switchFaultRoutes":[0]}
- chain acceptance survives replacement, live reuse, and later rejection: {"behaviors":["tools-provider","provider","complete"],"switchFaultRoutes":[1]}
- replacement skips unavailable catalogs without consuming acceptance or prefetching
- acknowledged header-only replays on the selected route with one attributed restart
- acknowledged truncated replays on the selected route with one attributed restart
- acknowledged off-branch replays on the selected route with one attributed restart
- acknowledged continuation-only replays on the selected route with one attributed restart
- projection-edit-restore resumes projected assignment without replay
- projection-edit-offbranch resumes projected assignment without replay
- projection-compaction-keep resumes projected assignment without replay
- projection-compaction-tail-firstKept resumes projected assignment without replay
- projection-edit-remove triggers exactly one attributed restart then projected continuation
- projection-edit-change triggers exactly one attributed restart then projected continuation
- projection-compaction-none triggers exactly one attributed restart then projected continuation
- projection-tail-only triggers exactly one attributed restart then projected continuation
- projection-compaction-edit-omitted triggers exactly one attributed restart then projected continuation
- exit between acknowledgement and append deliberately replays, then durable replay permits continuation
- durable replay after header-only permits a further fresh continuation
- durable replay after truncated permits a further fresh continuation
- durable replay after off-branch permits a further fresh continuation
- durable replay after continuation-only permits a further fresh continuation
- repeated proven-unavailable history rebuilds one note and counts each fresh replay once
- a rejected replay retains the selected restart assignment through live fallback
- a rejected replay retains the selected restart assignment through fresh fallback
- restart attribution skips a later rejected live attempt
- restart attribution skips unavailable catalogs without consuming another route
- retained live switching uses accepted memory without inspecting unsafe disk history
- valid active assignment with a malformed tail still continues
- malformed-header fails closed before replacement spawn without exposing private history
- identity-change fails closed before replacement spawn without exposing private history
- unsafe-tree fails closed before replacement spawn without exposing private history
- over-bytes fails closed before replacement spawn without exposing private history
- over-line fails closed before replacement spawn without exposing private history
- over-records fails closed before replacement spawn without exposing private history
- projection-edit-crossbranch fails closed before replacement spawn without exposing private history
- projection-edit-missing fails closed before replacement spawn without exposing private history
- projection-edit-noneditable fails closed before replacement spawn without exposing private history
- projection-edit-malformed fails closed before replacement spawn without exposing private history
- projection-invalid-offbranch fails closed before replacement spawn without exposing private history
- projection-boundary-conflict fails closed before replacement spawn without exposing private history
- failure diagnostics never read persisted history
- unsafe symlink replacement fails closed before spawn and removes children and artifacts
- unsafe directory replacement fails closed before spawn and removes children and artifacts
- unsafe mode replacement fails closed before spawn and removes children and artifacts
- unsafe missing replacement fails closed before spawn and removes children and artifacts
- unsafe symlink before first execution is rejected after resource verification
- unsafe directory before first execution is rejected after resource verification
- unsafe mode before first execution is rejected after resource verification
- callback at replacement cleans up the run-owned session and process groups
- cancel at replacement cleans up the run-owned session and process groups
- spawn-throw at replacement cleans up the run-owned session and process groups
- resource-throw at replacement cleans up the run-owned session and process groups
- finalization exceptions still remove the private session after persisted replacement
- retained cleanup precedes a typed history exception and removes artifacts
- retained cleanup overrides a typed history exception and removes artifacts
- negative cleanup proof prohibits persisted replacement

## Repair and final acceptance

Changed paths (all relative to the worktree):

- `agent/extensions/delegated-pi-loop/pi-session-projection.fixture.ts:10-18`: exact Pi 0.99.2 pin; explicit test-only package root for disposable preflight fixtures.
- `agent/extensions/delegated-pi-loop/persisted-session.test.ts:16-63`: fourteen new rejection regressions; current-facing version labels updated. Existing behavioral expectations remain unchanged.
- `agent/extensions/delegated-pi-loop/instructions.test.ts:321-323`: precise assertions for the current override policy. All anti-duplication checks remain.
- `agent/extensions/delegated-pi-loop/persisted-session.ts:57,323`: comments only.
- `docs/adr/0009-delegated-routing-configuration.md:15-20`: dated 0.99.2 revalidation amendment; historical amendment preserved.
- `docs/delegated-pi-loop-agent-instructions.md:311` and `README.md:109`: current compatibility references.
- This findings report: exact baseline names, root causes, live verification, and final acceptance.

The seven tracked files have 71 insertions and 16 deletions. No executable production logic changed. Context Mode, AGENTS.md, npm scripts, routing, watchdogs, cleanup, and result code are unchanged.

| Check | Before | After |
| --- | --- | --- |
| Full delegated suite, normal concurrency | 1370/1469; 99 failures | 1483/1483; 0 failures |
| Focused instructions/persistence/resume | Blocked by obsolete contracts | 735/735 |
| New preflight regressions | Not present | 14/14 |
| Delegate typecheck | Passed during investigation | 51 files, 0 diagnostics |
| Context Mode suite | Prior acceptance: 287 passed | 287/287 |
| Context Mode typecheck | Prior acceptance: passed | Passed |
| Documentation synchronization | Passed during investigation | 3/3 |

Parent final acceptance command: `npm test && npm run typecheck`, cwd `agent/extensions/delegated-pi-loop`. Result: 1483 tests, 1483 passed, 0 failed/cancelled/skipped/todo; 67451.581168 ms. This independently reproduced the implementation's successful full run after all reviews finished.

The first new-regression run had six assertion-message mismatches because Node appends assertion diffs to messages. The correction matches the complete message prefix and still checks the assertion type and exact actual/expected helper types. The final focused and full runs passed.

Solution roles completed. The read-only oracle returned VALID. All three final reviews returned PASS with no blocking findings. Independent reviews also passed the fourteen preflight regressions, instruction checks, and typecheck. No remediation was required.

### Remaining failures and limits

No failures remain in final acceptance. Earlier concurrent investigations exposed timing-sensitive failures in catalog/cancellation and runner watchdog tests. Examples included `cancellation during recovery keeps one manager attempt and kills the child`, `catalog skip and timeout keep one idle execution child and process-local ordinals`, `catalog-only attempts stay without active tool idle telemetry`, and cleanup deadline/natural-settlement cases. Those observations passed in focused or serialized runs; neither the implementation's normal full run nor the parent's final normal full run reproduced them. This repair does not claim to eliminate scheduling-sensitive flakes. Production deadlines and the default suite concurrency remain unchanged.

The oracle still uses the existing Bun-global installation path by default. A different installation layout remains an environment limitation. Exact Pi 0.99.2 is the revalidated target; wider version support would require a separate compatibility decision and matrix. No compatibility decision is needed to complete this repair.

The human's TUI Escape action was not tested. Cancellation was tested through the real registration's AbortSignal path, without model inference. No paid model delegate was launched to reproduce tool behavior. Required investigation/implementation/review delegates were separate from local behavior tests.

Final safety checks: main checkout has no tracked diff; no staged changes; worktree changes remain unstaged. The temporary dependency symlink, local verification scripts, verification storage, and owned verification processes were removed. Owned fixture-process checks found no remaining processes. No commit, push, deployment, or hosted-service mutation occurred.
