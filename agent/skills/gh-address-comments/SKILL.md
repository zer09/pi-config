---
name: gh-address-comments
description: Help address GitHub PR review comments, issue comments, and inline review threads on the open PR for the current branch using gh CLI. Use when the user asks to review, summarize, triage, or fix PR comments, address review feedback, handle GitHub code review comments, or inspect comments on the current branch's pull request.
---

# GitHub PR comment handler

Use this skill to find the open PR for the current branch, collect all conversation comments, reviews, and inline review threads, then help address selected feedback.

## Rules

- Load and follow the `gh-cli` skill first.
- Use authenticated `gh` CLI for GitHub data. In Pi, run read-only commands through Context Mode/RTK.
- Verify auth before fetching comments: `gh auth status`. If auth or rate-limit errors occur, ask the user to re-authenticate with `gh auth login`, then retry.
- Treat GitHub writes as external hosted service mutations. Do not comment, resolve threads, edit issues, push, merge, or update GitHub state unless the user explicitly requests that exact write.
- Do not expose tokens. Refer to token env vars by name only.
- Do not paste raw comment dumps into chat. Summarize and number actionable items.

## Workflow

1. Confirm the current branch has an associated open PR.
2. Run `scripts/fetch_comments.py` from this skill to fetch PR conversation comments, reviews, and review threads as JSON.
3. Summarize and number comments/threads needing attention.
4. Ask which numbered comments the user wants addressed, unless the user already explicitly requested a scope such as "address all actionable comments".
5. Apply local code fixes for the selected comments.
6. Run focused checks for changed code.
7. Summarize what changed and which comments were addressed.

## Script

Run from the target repository root:

```bash
python ~/.pi/agent/skills/gh-address-comments/scripts/fetch_comments.py
```

The script shells out to `gh pr view` and `gh api graphql`, resolves the PR for the current branch, and prints JSON with:

- `pull_request`
- `conversation_comments`
- `reviews`
- `review_threads`

## Maintenance

For future updates to this OpenAI-derived skill, read `../../../docs/skills/gh-address-comments-update-process.md`.
