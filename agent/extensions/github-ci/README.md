# GitHub CI Wait

`index.ts` registers the read-only `github_ci_wait` tool, labelled **GitHub CI Wait**. Pi discovers this entry when the directory is installed under its global extensions directory. This change does not activate the extension.

## Input

- `repo`: `OWNER/REPO`, not a URL or hostname-qualified repository.
- `runs`: 1-10 unique, positive safe-integer database IDs, each with an optional `label`.
- `label`: 1-80 printable characters on one line. Blank labels and control characters are rejected.
- `intervalSeconds`: finite number, minimum 5, default 15.
- `timeoutSeconds`: finite number, greater than 0 and at most 86400, default 1800.
- `failFast`: boolean, default `true`.

Unknown arguments and duplicate IDs are rejected before execution. Labels are shortened in results.

## Behavior

The first poll starts immediately. Each cycle queries all active runs concurrently, then settles before the next cycle. Queries do not pin an attempt, so active runs track the latest reported attempt. Completed runs are not polled again.

Only `completed` with conclusion `success` passes. Every other completed conclusion fails, including cancelled, skipped, neutral, and missing conclusions. All non-completed statuses keep waiting. With `failFast: true`, the first observed unsuccessful completion aborts other queries in that cycle. Their last known states remain in the result.

Each run tolerates two consecutive query failures. The third consecutive failure throws a concise watcher operation error. A successful query resets that run's counter. Failed queries never replace the last known state.

Each invocation uses `pi.exec("gh", args, { signal, timeout: 30000 })`. Only `gh run view ID --repo OWNER/REPO --json ...` is allowed. Polls request exactly `status,conclusion,attempt,headSha,event,url`. There are no shell commands, workflow mutations, log requests, or progress updates.

The monotonic deadline and the tool's cancellation signal propagate to every query. Fail-fast also aborts sibling queries. The watcher awaits every invocation before returning; subprocess termination latency belongs to Pi's `exec` implementation. The watcher clears its own timers and sleep listeners on every exit.

## Results

Normal results start with `PASS`, `FAIL`, `TIMEOUT`, or `CANCELLED`. Each run line includes its label/ID, latest attempt, and latest status or conclusion. `pollCount` counts cycles, not subprocesses. Details contain only the outcome, elapsed time, poll count, latest run states, and bounded failure summaries.

For unsuccessful completed runs, one optional `--json jobs` query runs if the deadline and cancellation permit it. Each summary retains at most two failed jobs and three failed step names per job. Successful, neutral, and skipped jobs/steps are omitted. Counts identify omitted failure details. Job URLs omit query strings and fragments; credential-bearing URLs are discarded. Jobs responses over 2,000,000 captured characters are not parsed.

Optional summary errors do not throw or erase an observed `FAIL`, including an expired summary deadline. Explicit cancellation still returns `CANCELLED`. A timed-out or cancelled watcher starts no summary queries.

Text output is below 25 lines and 4,000 UTF-8 bytes. Names are sanitized and shortened. Extra failure lines are omitted with a truncation notice. Run lines take priority. Raw command output, JSON responses, logs, environment values, and polling history are never returned or written to disk.

## Local checks

Run from this directory with the installed Node runtime:

```sh
node --import ./test-host.ts --test *.test.ts
node typecheck.mjs
```

Tests use `node:test`, fake monotonic time, fake sleeps, and mocked `pi.exec`. They make no GitHub calls and do not wait for real timers. The test loader resolves the installed TypeBox package from Bun's global installation. The type check uses the installed Pi, TypeBox, TypeScript, and Node declarations and checks production code plus tests. Both helpers honor `BUN_INSTALL`; neither installs dependencies.

Bun's test resolver did not resolve the host TypeBox package in this worktree, so the checks use Node's existing test runner instead. Live GitHub testing and global activation remain outside this increment.
