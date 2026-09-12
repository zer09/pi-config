# Crit commands and review data

Apply the [root action boundary](../SKILL.md#action-boundary) before using any command below. Load only the section needed for the requested operation.

## Reading comments

The review file path is shown by `crit status`. Use `crit comments` for unresolved comments and `crit comments --json` for structured agent input. Add `--all` to include resolved comments or `--plan <slug>` for a plan review. Review-level comments appear first.

When multiple sessions match the current directory and branch, headless commands refuse to guess. Use `crit status --json`, select the intended session, then pass `--session <id>` to `comment`, `comments`, `share`, `pull`, or `push`.

## Review file format

Comments have three scopes:

- **Line comments** (`scope: "line"`): tied to specific lines, stored in `files.<path>.comments`.
- **File comments** (`scope: "file"`): about a file overall, stored in `files.<path>.comments` with `start_line: 0`.
- **Review comments** (`scope: "review"`): general feedback, stored in the top-level `review_comments` array.

```json
{
  "review_comments": [
    {
      "id": "r_f1e2d3",
      "body": "Overall the architecture looks good",
      "scope": "review",
      "author": "User Name",
      "resolved": false,
      "replies": [
        { "id": "rp_b4a5c6", "body": "Thanks, addressed the minor issues", "author": "Pi" }
      ]
    }
  ],
  "files": {
    "path/to/file.go": {
      "comments": [
        {
          "id": "c_a1b2c3",
          "start_line": 5,
          "end_line": 10,
          "body": "Comment text",
          "quote": "the specific words selected",
          "anchor": "The sessions table needs a complete rewrite...",
          "author": "User Name",
          "resolved": false,
          "replies": [
            { "id": "rp_c7d8e9", "body": "Fixed by extracting to helper", "author": "Pi" }
          ]
        }
      ]
    }
  }
}
```

Field rules:

- `resolved`: `false` or **missing** both mean unresolved. Only `true` means resolved.
- `quote` (optional): the specific text the reviewer selected narrows scope within the line range. Focus changes on the quoted text rather than the entire range.
- `anchor` (line comments): full text of the commented lines when placed. When edits shift line numbers, locate content by anchor rather than trusting `start_line`/`end_line`.
- `drifted: true`: original content was removed or heavily rewritten. Line numbers are approximate at best.
- Unresolved comments may have `replies`. Read them before acting.

## Authoring comments

Use these commands only for user-requested local comment writes or replies.

```bash
# Review-level (general feedback)
crit comment --author 'Pi' '<body>'

# File-level (whole file, no line numbers)
crit comment --author 'Pi' <path> '<body>'

# Line (single line or range)
crit comment --author 'Pi' <path>:<line> '<body>'
crit comment --author 'Pi' <path>:<start>-<end> '<body>'

# Reply to an existing comment
crit comment --reply-to <id> --author 'Pi' '<body>'
```

- Pass `--author 'Pi'` so comments are attributed correctly.
- Single-quote the body. Double quotes break on backticks and shell metacharacters.
- Line numbers reference the file on disk (1-indexed), not diff line numbers.
- Reply bodies support Markdown. Use code fences and inline code where helpful.
- Only pass `--resolve` when the user explicitly asks. Never resolve proactively. The same rule applies to the `resolve` field in `--json` mode.

## Bulk commenting (3+ comments)

Use `--json` for atomicity (single write, no partial state) and speed (one process). The JSON can come from stdin or `--file <path>`:

```bash
# stdin — fine for short, single-line bodies:
echo '[
  {"body": "overall feedback", "scope": "review"},
  {"path": "session.go", "body": "restructure", "scope": "file"},
  {"file": "src/auth.go", "line": 42, "body": "Missing null check"},
  {"file": "src/auth.go", "line": "50-55", "body": "Extract to helper"},
  {"reply_to": "c_a1b2c3", "body": "Fixed — added null check"},
  {"reply_to": "r_f1e2d3", "body": "Done"}
]' | crit comment --json --author 'Pi'
```

For multi-paragraph bodies, prefer `--file`. A literal newline inside a `"body"` string breaks JSON parsing, and shell-quoted heredocs make this easy to introduce by accident. Write valid JSON with escaped newlines to a temp file using the file-edit tool, then:

```bash
crit comment --json --file /tmp/crit-bulk.json --author 'Pi'
```

`--file -` explicitly reads stdin.

Per-entry schema:

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` / `path` | string | line/file comments | Relative path. `path` alone (no `line`) → file-level. |
| `line` | int/string | line comments | `42` or `"45-47"` |
| `end_line` | int | optional | Defaults to `line` |
| `body` | string | always | |
| `author` | string | optional | Per-entry override; falls back to `--author` |
| `scope` | string | optional | `"review"` / `"file"`; usually inferred |
| `reply_to` | string | replies | Comment ID (`c_…` or `r_…`) |
| `resolve` | bool | optional | Only when user explicitly asks |

Scope inference (when `scope` is omitted): `reply_to` → reply; no `file`/`path` and no `line` → review-level; `path` but no `line` → file-level; `file`/`path` + `line` → line.

## Multi-file disambiguation

Comment IDs belong to the selected session, but the same ID can collide across files. If `crit comment` errors with "comment found in multiple files", disambiguate with `--path`:

```bash
crit comment --reply-to c_a1b2c3 --path src/auth.go --author 'Pi' 'Fixed the null check'
```

In `--json` mode, set the `file` field on the entry. Review-level IDs (`r_…`) are globally unique and never need this.

## Plan-mode comments

Plan reviews (via `crit plan` or the ExitPlanMode hook) store the review file in `~/.crit/plans/<slug>/`. Pass `--plan <slug>` for plan-mode comments. Without it, `crit comment` looks in the project root and will not find the comments. The slug is shown in the review feedback prompt.

```bash
crit comment --plan my-plan-2026-03-23 --reply-to c_a1b2c3 --author 'Pi' 'Updated the plan'
```

## GitHub PR integration

`pull` updates the local review file and needs a request for that sync. `push` posts a GitHub review and needs explicit instruction for that exact action and PR target. A dry-run does not authorize a later push.

```bash
crit pull [pr-number]                                    # Fetch PR review comments into the review file
crit push [--dry-run] [--event <type>] [-m <msg>] [pr]   # Post review comments as a GitHub PR review
```

Requires `gh` CLI installed and authenticated. PR number is auto-detected from the current branch; verify it matches the requested target before syncing.

`--event` values: `comment` (default), `approve`, `request-changes`. `-m` adds a review-level body message. Approval and change-request events must match the user's explicit instruction.

## Sharing

Publishing and unpublishing are separate hosted actions. Apply the root's exact-action and target gates before either operation.

```bash
crit share <file> [file...]                          # Upload and print URL
crit share --qr <file>                               # Also print QR code (terminal only)
crit share --org <slug> <file>                       # Share under an organization
crit share --org <slug> --visibility unlisted <file> # Org share with explicit visibility
crit unpublish [file...]                              # Remove shared review
```

- Relay the output: copy the URL (and QR if used) into your response. Do not make the user search tool output.
- `--qr` is terminal-only. Skip it in mobile apps, web chat UIs, or anywhere Unicode block characters will not render correctly.
- `--org <slug>` shares under an organization. Visibility defaults to `organization` (members only). Override with `--visibility` (`organization`, `unlisted`, `public`).
- If a review file exists, comments for the shared files are included automatically. Include them when checking the authorized publication scope.
- Unpublish uses the persisted delete token in the review file. No extra args are needed. Do not expose the token.
