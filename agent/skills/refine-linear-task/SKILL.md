---
name: refine-linear-task
description: Refine and enhance Linear issue descriptions. Use when the user asks to refine a Linear task, improve a task description, make a Linear issue clearer or more actionable, add acceptance criteria, enhance Linear issue scope/context, or prepare a Linear task for implementation.
---

# Linear task refiner

Use this skill to turn a vague or incomplete Linear issue into a clear, scoped, actionable task with testable acceptance criteria.

## Rules

- Load and follow `linear-cli` before interacting with Linear through the CLI.
- Treat Linear as an external hosted service. Fetch/list/read issues freely, but do not update descriptions, add comments, change status, assign, label, or delete unless the user explicitly requests that exact write.
- If the user asks to refine without explicitly asking to update Linear, produce a draft and ask before writing it back.
- Use file-based flags from `linear-cli` for multi-line descriptions/comments, such as `--description-file` and `--body-file`, to avoid markdown escaping bugs.
- If the task references code, research the relevant codebase first. Use code-review-graph when applicable, then Context Mode/RTK searches as needed.
- Preserve the original intent. Clarify and strengthen; do not expand scope without labeling it as an assumption.

## Inputs

Parse these from the request:

- `issue_identifier`: Linear issue ID, such as `DEV-123`.
- `--focus`: optional refinement focus: `security`, `performance`, `testing`, or `accessibility`.
- `--update`: update Linear only if the user explicitly requested it.

## Workflow

1. Fetch the issue title, description, status, assignee, labels, links, comments, and related issues when available.
2. Show a short current-state summary.
3. Analyze gaps:
   - Clarity: is the goal specific?
   - Context: is enough background included?
   - Scope: are in-scope and out-of-scope boundaries clear?
   - Acceptance criteria: are success conditions testable?
   - Technical notes: are relevant files, patterns, and constraints included?
   - Dependencies: are blockers or related issues captured?
4. Research codebase context if the issue touches existing code.
5. Draft the refined description.
6. Present before/after summary and improvements made.
7. Update Linear only after explicit approval for that update.

## Refined description template

```markdown
## Problem

<Clear statement of what needs to change and why.>

## Context

<Relevant product, user, technical, or design background.>

## Scope

### In scope

- <Specific included work>

### Out of scope

- <Explicit non-goals>

## Acceptance criteria

- [ ] <Testable success condition>
- [ ] <Testable success condition>

## Technical notes

- <Relevant files, patterns, APIs, constraints, or migration notes>

## Dependencies and references

- <Related Linear issues, PRs, docs, designs, or blockers>

## Assumptions

- <Assumptions made while refining, if any>
```

## Focus guidance

- `security`: include threat model notes, sensitive data handling, authz/authn boundaries, and security acceptance criteria.
- `performance`: include expected impact, budgets, measurement approach, and benchmark criteria.
- `testing`: emphasize unit/integration/e2e coverage, fixtures, regression cases, and edge cases.
- `accessibility`: include keyboard, focus, semantic markup, labels, contrast, and WCAG-oriented criteria.

## Output

Return:

- Issue ID and title.
- Status: draft only or updated.
- Gap analysis summary.
- Refined description.
- Improvements made.
- Next steps.

## Error handling

- Issue not found: verify identifier and access.
- No Linear auth/access: ask the user to configure Linear auth; provide a manual draft if the current description was supplied in chat.
- Update blocked or not authorized: provide a copy-paste-ready description and the exact command the user can run.

## Maintenance

For future updates to this Uniswap-derived skill, read `../../../docs/skills/refine-linear-task-update-process.md`.
