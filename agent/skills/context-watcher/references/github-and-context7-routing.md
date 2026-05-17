# GitHub and Context7 routing

This reference expands the GitHub and Context7 rules in `../SKILL.md`. Load it when GitHub/private GitHub data or current third-party library/API docs are involved.

## GitHub core rule

For GitHub repositories, pull requests, issues, reviews, comments, workflows, releases, or private GitHub data:

1. Load and follow the `gh-cli` skill.
2. Use authenticated `gh` CLI through Context Mode/RTK.
3. Do not use browser automation, web fetch tools, or direct GitHub URLs for private GitHub data unless the user explicitly requests browser inspection.
4. Keep GitHub writes behind the external hosted service mutation gate.

Examples of read-only routes:

```text
ctx_execute({ language: "shell", code: "rtk gh pr view 123 --comments" })
ctx_execute({ language: "shell", code: "rtk gh issue view 456" })
ctx_execute({ language: "shell", code: "rtk gh api repos/OWNER/REPO/pulls/123" })
```

## GitHub mutation gate

These require exact explicit user instruction:

- `git push`
- Creating or editing PRs/issues.
- Posting PR comments, issue comments, or reviews.
- Adding labels, assignees, reactions, or milestones.
- Closing/reopening issues or PRs.
- Merging PRs.
- Dispatching workflows.
- Creating releases.

Broad requests such as "handle this PR" or "take care of the issue" do not grant write permission. Draft the mutation instead.

## Browser/web usage for GitHub

Allowed without special permission:

- Public GitHub visual inspection.
- Browser inspection when explicitly requested by the user.
- Public repository research that does not require private authentication.

Not allowed by default:

- Fetching private repository data through browser/web tools.
- Posting comments or reviews without exact user instruction.

## Context7 docs preflight

For third-party library, framework, or API usage, version-specific behavior, or implementation against an external package:

1. Use local installed source first when answering behavior for packages installed on this machine.
2. Use Context7 for current official docs before relying on memory.
3. Use broad web search only when Context7 has no good match or public research is needed.
4. Do not send secrets, personal data, or proprietary source code in Context7 queries.

Typical route:

```text
ctx7 library <library-name>
ctx7 docs <resolved-library-id>
```

If Context7 CLI is not available, use the `context7-cli` skill instructions before choosing another source.

## URL and web docs route

For a user-provided URL:

1. Use `ctx_fetch_and_index`.
2. Query the indexed content with `ctx_search`.
3. Do not paste or reason over raw fetched page content.

## External hosted service reminder

GitHub and many API providers are external hosted services. Read-only fetch/list/search/query/diff operations are allowed. Create/update/delete/post/comment/react/assign/label/merge/push/publish/deploy/invite/rotate-key/quota/job mutations require exact explicit user instruction.
