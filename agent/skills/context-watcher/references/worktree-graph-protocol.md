# Worktree graph protocol

This reference expands the worktree rules in `../SKILL.md`. Load it when creating, using, watching, or removing worktrees.

## Directory layout

For multi-repo or feature work, use story-grouped roots:

```text
.worktrees/<story>/<feature-name>/<repo-name>/
```

Examples:

```text
.worktrees/google-sso/feature-a/webapp/
.worktrees/google-sso/feature-a/admin-dashboard/
.worktrees/google-sso/feature-b/core-frontend/
```

For standalone fixes, hotfixes, and issue work, use the common `issues` story:

```text
.worktrees/issues/<issue-number>/<repo-name>/
```

Examples:

```text
.worktrees/issues/1234/webapp/
.worktrees/issues/bug-login-timeout/api/
```

## Graph root selection

Build or update Code Review Graph at the root that contains all relevant code:

- Repo root for single-repo work.
- Story root for related multi-repo work.
- Feature root when it contains all repos for the feature.
- Issue root for issue-specific work.

If nested repositories live under a containing root, treat them as part of that containing root graph database when useful. Do not require every nested repo to be registered separately.

## Daemon-backed graphs

For active roots, prefer daemon-backed graphs:

1. Check whether the Code Review Graph daemon is running before the first graph query for a repo, story, feature, or issue root.
2. If the daemon is not running, start it unless this is a one-off read-only check where a watcher would be wasteful.
3. Check whether the containing root has `.code-review-graph/graph.db`.
4. If the database is missing or empty and build/update is authorized, build the graph for that root.
5. Add the containing root to the daemon watch list when useful.
6. Query the daemon-maintained graph instead of repeatedly rebuilding.

Daemon status is not graph availability. If daemon status reports stopped, unavailable, or zero registered repos, do not treat that as permission to skip graph-first. Start/build/query when appropriate.

## Stale or incomplete graph

If graph stats or queries show the graph is empty, stale, or incomplete:

1. Do not call that an automatic error.
2. Build or update if authorized and appropriate.
3. Retry the graph query.
4. Fall back to Context Mode/RTK only when graph remains insufficient or build/update is not appropriate.

## Removing worktrees

When removing a worktree group:

1. Remove the containing story/feature/issue root from the graph daemon watch list if it was added.
2. Verify removal targets are inside the expected worktree tree.
3. Before any `rm -rf`, verify the path is not a symlink to somewhere outside the expected tree.
4. Never delete outside the project directory or `.pi/` without explicit user confirmation.

## Safety reminders

- Worktree creation and local branch operations are local mutations and may use whitelisted direct Bash when safe.
- Remote branch pushes still require exact explicit user instruction.
- Keep graph-first behavior active inside worktrees.
