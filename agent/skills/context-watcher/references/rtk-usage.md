# RTK usage inside Context Mode

This reference expands the RTK rules in `../SKILL.md`. Load it when RTK flags, compression behavior, analytics, or RTK failure modes matter.

## Core rule

RTK is the default prefix for read-only shell commands when available. Run RTK inside Context Mode:

```text
ctx_execute({ language: "shell", code: "rtk git status --short --branch" })
```

Do not use RTK as a reason to bypass Context Mode. Context Mode controls sandboxing and indexing; RTK compresses command output.

## Common examples

```text
rtk git status --short --branch
rtk git log --oneline --max-count=20
rtk git diff --stat
rtk rg "pattern" path/
rtk find . -maxdepth 3 -type f
rtk npm test
rtk uv run pytest
```

Use these through `ctx_batch_execute` or `ctx_execute`, not raw Bash, unless the command is on the direct Bash whitelist and safe.

## Batch operations

Prefer one `ctx_batch_execute` call over many single commands:

```text
ctx_batch_execute({
  commands: [
    { label: "Git state", command: "rtk git status --short --branch" },
    { label: "Recent commits", command: "rtk git log --oneline --max-count=20" },
    { label: "Changed files", command: "rtk git diff --name-only" }
  ],
  queries: ["branch status changed files recent commits"]
})
```

Labels become searchable section titles. Make them descriptive.

## Command chaining

Keep chains simple and explicit:

```text
rtk sh -lc 'git status --short && git diff --stat'
```

If output requires counting, filtering, parsing, or comparison, use programmed analysis instead of shell pipelines that dump raw output.

## Global flags

Useful RTK flags vary by installation. Verify locally before relying on a flag. Common categories include:

- Output mode and compression level.
- Include/exclude path filters.
- Preview or dry-run behavior.
- Stats and diagnostics.

Do not guess flags. If unsure, run a compact help command through Context Mode and summarize the relevant options.

## Token savings reference

RTK is best for commands with repetitive or structured output:

- Git diffs, logs, and status.
- Test output.
- Build and lint logs.
- Directory listings and search results.
- Package manager output.

RTK is less important for tiny commands, but using it consistently inside Context Mode is still preferred for read-only shell work.

## Analytics

Run RTK diagnostics or analytics only through Context Mode. Summarize the result; do not paste long raw reports.

## Failure modes

If RTK is unavailable inside Context Mode:

1. Check whether `rtk` is on PATH in the sandbox.
2. Fall back to the same command without RTK only inside Context Mode, not raw Bash, unless the command is safe and whitelisted.
3. Record or summarize that RTK was unavailable.
4. See `fallback-and-troubleshooting.md` for repair steps.
