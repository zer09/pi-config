---
name: crit-cli
description: "Use for local Crit review data, programmatic comments and replies, sharing, or GitHub sync. Interactive foreground review belongs to explicit $crit."
---

# Crit CLI

## Action boundary

Reading a review does not authorize changing it. Classify the requested action before choosing a command:

| Action | Required authorization |
|---|---|
| Read local review JSON, `crit status`, `crit comments` | Read-only. Do not add replies, resolve comments, or sync as a side effect. |
| `crit comment`, including replies | Mutates local review state. Require the user to request that comment write or reply. |
| Resolution with `--resolve` or JSON `resolve` | Mutates local review state. Never resolve without an explicit user request, even after fixing the issue. |
| `crit pull` | Reads GitHub but updates the local review file. Require a user request for that sync and its PR/review target. |
| `crit push` | Posts to GitHub. Require explicit user instruction for that exact hosted action, PR target, and review event. |
| `crit share` | Publishes files and included comments. Require explicit user instruction for that publication, target, and visibility. |
| `crit unpublish` | Deletes remote shared state. Require explicit user instruction to unpublish the exact shared review/files. |

`crit push --dry-run` previews a push; it does not authorize a later push. A request to pull does not authorize posting back to GitHub. Clarify missing targets or visibility before hosted writes. Do not expose credentials or persisted delete tokens.

Interactive foreground review is the explicit `$crit` workflow, not a CLI side effect. A generic request to "review" does not authorize launching it.

## Task routing

Load only the needed section of [commands and review data](references/commands-and-review-data.md):

| Task | Reference section |
|---|---|
| Read comments or interpret JSON | [Reading comments](references/commands-and-review-data.md#reading-comments) and [review file format](references/commands-and-review-data.md#review-file-format) |
| Write requested comments or replies | [Authoring](references/commands-and-review-data.md#authoring-comments); [bulk JSON](references/commands-and-review-data.md#bulk-commenting-3-comments) for 3+ comments |
| Select the correct reply or plan | [Multi-file disambiguation](references/commands-and-review-data.md#multi-file-disambiguation) and [plan-mode comments](references/commands-and-review-data.md#plan-mode-comments) |
| Sync with a PR | [GitHub PR integration](references/commands-and-review-data.md#github-pr-integration) |
| Publish or unpublish | [Sharing](references/commands-and-review-data.md#sharing) |

## Key correctness rules

- Use `crit status --json` when multiple sessions match. Select the intended session and pass `--session <id>` to `comment`, `comments`, `share`, `pull`, or `push`; do not guess.
- Use `--plan <slug>` for plan reviews. Without it, comments target the project review instead.
- Pass `--author 'Pi'` for agent-authored comments and replies. Single-quote CLI bodies; use a JSON file for multi-paragraph bulk bodies.
- Use file-on-disk line numbers (1-indexed), not diff positions. Preserve line, file, and review scope; do not turn general feedback into a line comment.
- Read existing replies and selected `quote` text. Missing or false `resolved` means unresolved. Use `anchor` when lines shift; `drifted: true` means line numbers are approximate.
- Use atomic `--json` for 3+ comments. The resolution gate also applies to each bulk entry.
- Organization shares default to members-only `organization` visibility. Do not silently widen visibility; follow the authorized scope.

## Completion

Report the requested read result or completed operation and its target. Relay command output, including a share URL and QR when used; QR is terminal-only. Redact secrets. Confirm requested local writes with a read-only check. Stop if the session, target, authorization, or required CLI/authentication is unavailable; do not substitute a broader action.

## Maintenance

For local overlays and future updates, read the [Crit update process](../../../docs/skills/crit-update-process.md).
