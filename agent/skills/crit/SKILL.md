---
name: crit
description: "Run Crit's foreground human review loop for code, plans, diffs, or pages only when the user explicitly requests it. Generic review requests do not count."
disable-model-invocation: true
---

# Review with Crit

Use only for an explicit `$crit`, `/skill:crit`, or direct request for the Crit review loop. A generic code, plan, PR/MR, or page review request does not count. Do not launch an interactive review during maintenance or validation. Programmatic Crit tasks belong to [crit-cli](../crit-cli/SKILL.md).

## Action boundary

Reading feedback or starting a review does not authorize other mutations. Apply fixes only within the requested scope. Before any CLI write:

| Action | Required authorization |
|---|---|
| Local comments or replies | User request for that write; otherwise summarize changes without posting a reply. |
| Resolution, including bulk JSON `resolve` | Explicit user request, even after fixing the issue. |
| `crit pull` | Requested sync and exact PR/MR and local review target. |
| `crit push` | Explicit hosted action, PR/MR target, and review event; a dry-run is not permission to post. |
| `crit share` | Explicit publication of the exact files/included comments, destination, and visibility. |
| `crit unpublish` | Explicit deletion of the exact shared review/files at the intended destination. |

Do not expose credentials or persisted delete tokens. Use [crit-cli's action boundary and references](../crit-cli/SKILL.md#action-boundary) for these operations.

## Step 1: Pass arguments to `crit`

The CLI auto-detects the review mode from its arguments. **Do not ask the user which mode to use.** Pass arguments through:

```
crit <arguments>               # file, dir, URL, .html — CLI auto-detects mode
crit --pr <num|url>            # GitHub PR (range mode)
crit --mr <iid|url>            # GitLab MR (range mode)
crit --range <base>..<head>    # commit range (range mode)
crit                           # no args → branch diff
```
If no arguments, check conversation context:

1. A plan file was written earlier in this conversation → `crit <plan-file>`
2. Otherwise → bare `crit` (branch diff)

For another-device access, keep Crit on loopback and proxy through a trusted tunnel. `--public-url` changes the advertised URL but does not expose the server. Both `--public-url` (even on loopback) and a non-loopback `--host` require `--allow-unauthenticated-network`. Crit has no network authentication: reachable clients can read review/repo files and post comments that may trigger agents. Confirm this exposure before use; do not bind directly to a LAN/Tailscale IP.

## Step 2: Launch crit and block until review completes

**CRITICAL — you MUST run this step. Do NOT skip it. Do NOT proceed without it.**

Run `crit` in the foreground and block until it exits. When invoking through a tool runner, set the timeout to at least 3600 seconds for every foreground `crit` command (initial and next-round). Do not rely on short defaults like 600 seconds for human review time.

```bash
crit <plan-file>   # specific file
crit               # git mode
```

If a crit server is already running from earlier in this conversation, `crit` automatically connects to it. Starting from scratch, it spawns the daemon, opens the browser, and blocks until the user clicks "Finish Review".

`crit` prints the review URL on startup (e.g. `Started crit daemon at http://localhost:<port>`). Relay it verbatim:

> **"Crit is open at http://localhost:<port>. Leave inline comments, then click Finish Review."**

**Do NOT proceed until `crit` completes.** Do NOT ask the user to type anything. Do NOT read the review file early. Wait for the foreground command to finish — that is how you know the human is done reviewing. If the tool runner times out first, rerun the exact same `crit` command to reconnect and continue waiting.

## Step 3: Read the review output

When `crit` completes, read the finish prompt on stdout within the user's authorized scope. Check stderr for `approved: true` or `approved: false`. Approval ends the loop; report that no further changes were requested. Do not infer approval from empty stdout or a missing file path.

Unresolved comments may be embedded in stdout as JSON. Read a review file only if the prompt supplies its path. For mid-round re-entry or headless recovery, use `crit comments --json`; add `--plan <slug>` for plan reviews. If multiple sessions match, use `crit status --json` and select the intended `--session <id>`; do not guess. If feedback or approval remains unavailable, report the incomplete review and stop.

Review JSON has three comment types:
- `review_comments` (top-level, `r_`-prefixed IDs) — general feedback
- File comments (per-file `comments` array, with `scope: "file"`, `start_line: 0`, and `end_line: 0`) concern the file as a whole
- Line comments (per-file `comments` array, with `start_line`/`end_line`) — about specific lines

Identify all comments where `resolved` is `false` or missing. Unresolved comments may have `replies` — read them before acting.

When a comment has these fields:
- `quote`: the specific text the reviewer selected — focus your changes on the quoted text rather than the entire line range
- `anchor`: use it to locate the current position of the content; line numbers may be stale after edits
- `drifted: true`: original content was removed or heavily rewritten — line numbers are approximate at best

## Step 4: Address each review comment

For each unresolved comment:

1. Understand what the comment asks for
2. If it contains a suggestion block, apply that specific change
3. Revise the referenced file (plan or code file from the diff)
4. If the user requested a reply write, reply with what you did: `crit comment --reply-to <id> --author 'Pi' '<what you did>'`. Otherwise summarize without changing comments. Preserve `--session <id>` or `--plan <slug>` when needed.
5. **Do not pass `--resolve`.** Resolving is the reviewer's call. Only add `--resolve` if the user explicitly asks.

Editing the plan file triggers Crit's live reload — the user sees changes in the browser immediately.

### When replying to multiple comments

For requested replies, use `--json` for a single atomic bulk call instead of one invocation per comment. Use a JSON file for multi-paragraph bodies, as described in [bulk commenting](../crit-cli/references/commands-and-review-data.md#bulk-commenting-3-comments):

```bash
echo '[
  {"reply_to": "c_a1b2c3", "body": "Fixed"},
  {"reply_to": "c_d4e5f6", "body": "Refactored as suggested"}
]' | crit comment --json --author 'Pi'
```

## Step 5: Signal completion and start next round

**CRITICAL — you MUST run this step. Do NOT skip it. Do NOT proceed without it.**

The finish prompt on stdout supplies the next-round command. Preserve that command and its session/plan identity rather than rebuilding the original arguments. For ordinary reviews this is `crit --session <id>`. If it prints `crit plan --name <slug>`, keep the slug and supply the revised plan file (or plan content on stdin); plan mode requires input. Do not replace a session-specific command with bare `crit`.

On subsequent calls, `crit` automatically signals round-complete first, then blocks until the next "Finish Review" click.

Tell the user: **"Changes applied. Review the diff in your browser and click Finish Review when ready."**

**Do NOT proceed until `crit` completes.** When it does, return to Step 3. Stop on `approved: true`, not merely an absence of new comments. Keep the foreground timeout at least 3600 seconds for every round.

## Sharing

A request for the current review URL does not authorize publication. Relay the existing URL instead. Route explicitly requested sharing or unpublishing through [crit-cli](../crit-cli/SKILL.md#action-boundary), with the exact destination and visibility confirmed. Relay the resulting output and URL after redacting secrets. QR output is terminal-only; skip it in mobile apps and web chat.

## Maintenance

For future updates to this Crit skill, read `../../../docs/skills/crit-update-process.md`.
