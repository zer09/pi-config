# Sub-agent protocol

This reference expands the sub-agent rules in `../SKILL.md`. Load it when delegating to Pi sub-agents or orchestrating parallel investigations.

## Parent responsibility

The parent agent remains responsible for:

- Final decisions.
- Diff review.
- Validation.
- Commits.
- User-facing reporting.
- Ensuring sub-agents do not mutate external hosted services without exact authorization.

Do not use sub-agents just to think. Use them for isolated, tool-grounded investigation, review, testing, documentation research, consistency checks, or bounded parallel work.

## Default mode

Default sub-agent mode is read-only. File edits or mutating commands require explicit write mode and parent review.

Use Pi-native `subagent_run` when available. Do not use non-Pi delegation tools for this workflow unless the user explicitly asks.

## Required sub-agent instructions

Every sub-agent must be told to:

1. Load and follow `context-watcher` before using tools.
2. Use Context Mode for shell commands, read-only operations, logs, tests, builds, and large output.
3. Use RTK as the default prefix for read-only shell work when available.
4. Use Code Review Graph first for supported code exploration/review tasks.
5. Use the `gh-cli` skill and authenticated `gh` CLI through Context Mode/RTK for GitHub repo, PR, issue, workflow, release, review, comment, or private GitHub data.
6. Treat external hosted services as read-only unless the parent task explicitly authorizes the exact mutation.
7. Return compact structured findings only.

## Session layout

Use isolated persistent sessions under:

```text
.pi/agent/subagent-sessions/<workstream>/<agent>/
```

Normally run with `--continue` so later calls resume the same sub-agent workstream memory.

## Output contract

Sub-agents must not return:

- Raw logs.
- Full diffs.
- Broad grep output.
- Browser snapshots.
- Test dumps.
- Secrets.
- Environment variable values.

Prefer compact JSON with these fields:

```json
{
  "summary": "short result",
  "findings": [
    {
      "claim": "what was found",
      "evidence": "file path, symbol, test, graph query, or command summary",
      "confidence": "high|medium|low"
    }
  ],
  "tools_used": ["Context Mode", "Code Review Graph"],
  "blockers": [],
  "recommended_next_step": "specific action"
}
```

## External hosted service mutations

Sub-agents may read remote services when appropriate. They must not create, update, delete, post, comment, react, assign, label, close/reopen, merge, push, publish, deploy, invite, rotate keys, change quotas, or run jobs/workflows that change remote state unless the parent task explicitly authorizes that exact mutation.

Without explicit authorization, return a draft/checklist instead.

## Recursive sub-agents

Recursive sub-agent calls are disabled by default. Enable only when explicitly needed and bounded by the parent.
