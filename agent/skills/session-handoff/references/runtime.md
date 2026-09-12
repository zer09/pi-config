# Handoff runtime commands

Use only the route authorized by the current request. Loading this reference does not authorize creating a handoff or continuing repository work.

Resolve `<skill-root>` to the directory containing the loaded `SKILL.md`. Resolve `<project-root>` from the current task. Run helpers from the project root so they inspect and write the correct project, not the skill installation.

## Create and chain

A request to create a handoff authorizes a new document under `<project-root>/handoffs/`, including completion and validation. It does not authorize changing older handoffs or Git state.

```bash
cd "<project-root>"
uv run python "<skill-root>/scripts/create_handoff.py" implementing-user-auth
```

The scaffold creates the handoff directory if needed and names the document `YYYY-MM-DD-HHMMSS-[slug].md`, for example `2024-01-15-143022-implementing-auth.md`. It pre-fills timestamp, project path, branch, recent commits, and modified/staged file names; it does not stage files.

Review metadata for sensitive information. If the metadata sources contain secrets, use the [template](handoff-template.md) with sanitized metadata instead of copying those values into a scaffold. Fill every placeholder, including title and metadata placeholders, not only `[TODO: ...]` sections.

For a requested continuation handoff:

```bash
uv run python "<skill-root>/scripts/create_handoff.py" auth-part-2 --continues-from 2024-01-15-143022-implementing-auth.md
```

Verify that the predecessor belongs to this task. The helper can suggest or pre-fill the most recent handoff even without `--continues-from`; correct unrelated links in the new document. An existing handoff is not a reason to create another.

A chain records context lineage:

```text
handoff-1.md <- handoff-2.md <- handoff-3.md
```

Each new document links to its predecessor and can identify older documents it supersedes. Do not edit predecessors merely to mark them superseded. When loading, read the newest selected handoff first, then relevant predecessors; report missing links rather than inventing context.

## Validate

```bash
uv run python "<skill-root>/scripts/validate_handoff.py" "<project-root>/handoffs/<handoff-file>.md"
```

The validator checks unresolved TODOs, populated required sections, potential secrets, referenced file existence, and a quality score from 0 to 100. Review the report, not only the exit code. A finalized handoff must have no secrets, unresolved placeholders, or empty required sections, and score at least 70. Fix issues in the requested document and rerun validation; report unresolved warnings.

Record environment variable names, not values. Never save credentials, tokens, cookies, private keys, or raw authentication headers. Automated secret detection supplements manual review; it does not prove a document is safe.

## Load and check staleness

If the user did not select a file, list project-local handoffs:

```bash
cd "<project-root>"
uv run python "<skill-root>/scripts/list_handoffs.py"
```

Read the selected handoff and verify that its recorded project path refers to the requested project before running the staleness helper:

```bash
uv run python "<skill-root>/scripts/check_staleness.py" "<project-root>/handoffs/<handoff-file>.md"
```

The helper compares age, commits, changed files, branch divergence, and missing references. Apply the [resume checklist](resume-checklist.md) to the current tree.

| Level | Interpretation |
| --- | --- |
| `FRESH` | Minimal detected drift; still verify assumptions and authorization. |
| `SLIGHTLY_STALE` | Review changed context before proposing continuation. |
| `STALE` | Recheck affected claims against current evidence. |
| `VERY_STALE` | Treat the handoff as historical context and reconstruct current state read-only. |
| `UNKNOWN` | Explain which checks are unavailable, such as Git history in a non-Git project. |

Helper recommendations do not authorize creating a fresh handoff, editing files, switching branches, starting services, or executing pending steps. Use the current user request to determine whether any continuation is authorized.
