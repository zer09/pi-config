# ADR 0001: Split reader and writer delegates

## Status

Accepted

## Context

The extension provides two explicit delegate tools:

- `reader`: read-only investigation, review, validation planning, and documentation research.
- `writer`: tightly scoped local file changes.

The parent agent remains the orchestrator. Delegate tools must not route to or recommend other delegates.

## Decision

Provide separate `reader` and `writer` tools backed by shared delegate infrastructure and separate profiles.

`reader` uses persistent cwd-scoped sessions and read-oriented tools only.

`writer` uses fresh sessions per invocation, exact-file `allowedPaths`, restricted read/write tools, child process recursion guards, and writer-specific child guards. Writer is text-only in v1 and cannot delete, commit, push, deploy, comment on hosted services, or run broad shell/Context Mode commands.

## Consequences

- Tool names communicate capability and safety boundary directly.
- Reader can stay optimized for low parent-context investigation.
- Writer can enforce narrower path and text guards without burdening reader.
- Existing prompts and rules must use `reader` for read-only delegation.
- Future validation behavior should use a separate profile/tool instead of expanding writer permissions.
