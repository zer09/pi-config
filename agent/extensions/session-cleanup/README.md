# session-cleanup extension

Maintainer notes for the Pi runtime-owned session artifact cleanup.

## Purpose

This extension runs local session artifact cleanup during parent Pi startup without adding startup instructions to the agent prompt. The cleanup is intentionally a runtime implementation detail: do not add instructions about this extension or its helper script to `agent/AGENTS.md`.

## Runtime behavior

On `session_start` with reason `startup`, the extension:

1. Skips delegate child processes when `PI_DELEGATE_CHILD` is set.
2. Skips when `~/.pi/tmp/cleanup-sessions.last-run` is less than 24 hours old.
3. Acquires `~/.pi/tmp/cleanup-sessions.lock` to avoid concurrent startup races.
4. Removes a stale lock older than one hour and retries once.
5. Verifies the helper script is tracked by git and has no staged or unstaged diff.
6. Runs `cleanup-sessions.sh --safe` with a 120 second timeout.
7. Writes a fresh ISO timestamp to the stamp file only after successful cleanup.
8. Appends one compact maintainer log line to `~/.pi/tmp/session-cleanup.log` for parent startup cleanup attempts, including parsed deletion counts from the helper output when present.
9. Stays quiet for success and normal skips. It only warns through the UI for cleanup failure or unsafe helper state.

## Files

- `index.ts` - Pi extension entry point and testable runtime helpers.
- `cleanup-sessions.sh` - Hardened cleanup implementation. It deletes only old untracked, git-ignored artifacts under `~/.pi`.
- `session-cleanup.test.ts` - Bun tests for reason filtering, delegate filtering, stamp freshness, locking, success, failure, and safety checks.

## Log format

A successful run log line looks like:

```text
ts=2026-05-29T08:00:00.000Z status=success duration_ms=42 exit_code=0 killed=false session_files_deleted=2 session_empty_dirs_removed=1
```

Failure lines include `detail="..."` with the first stderr or stdout line. Normal skip lines omit exit and count fields.

## Maintenance rules

- Keep cleanup policy in this extension, not in `agent/AGENTS.md`.
- Keep the helper script colocated with the extension so ownership is obvious.
- Keep success and skip paths quiet in the UI. Use `~/.pi/tmp/session-cleanup.log` for maintainer visibility.
- Do not broaden deletion behavior without adding tests.
- If the helper script moves, update `SCRIPT_RELATIVE_PATH` and the test expectation in `session-cleanup.test.ts`.
- If the helper script changes, rerun the validation commands below before relying on startup cleanup.

## Validation

```sh
bun agent/extensions/session-cleanup/session-cleanup.test.ts
bun build agent/extensions/session-cleanup/index.ts \
  --target=node \
  --external @earendil-works/pi-coding-agent \
  --outfile=/tmp/session-cleanup-extension-check.js
node --check /tmp/session-cleanup-extension-check.js
git diff --check
```

## Manual smoke test

1. Ensure `agent/extensions/session-cleanup/cleanup-sessions.sh` is tracked and has no staged or unstaged diff.
2. Remove or age `~/.pi/tmp/cleanup-sessions.last-run` only if safe.
3. Start Pi normally.
4. Confirm no agent tool call is made for cleanup.
5. Confirm the stamp file is updated after successful cleanup.
6. Confirm `~/.pi/tmp/session-cleanup.log` has one compact line for the parent startup attempt.
7. Start Pi again within 24 hours and confirm cleanup is skipped.
8. Start a delegate and confirm cleanup is skipped when `PI_DELEGATE_CHILD` is set.
